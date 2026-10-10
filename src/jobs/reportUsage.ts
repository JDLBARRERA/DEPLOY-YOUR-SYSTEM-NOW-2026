import { execSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Stripe from "stripe";
import { prisma } from "../db.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const CURSOR_ID = "default";
const CADDY_NAMES = ["mi-paas-caddy-1", "caddy", "paas-caddy-1"];

export async function reportUsage(): Promise<void> {
  await ingestCaddyAccessLog();
  await reportContainerMinutes();
}

async function ingestCaddyAccessLog(): Promise<void> {
  const raw = readCaddyLog();
  if (!raw) {
    return;
  }
  const cursor = await prisma.usageCursor.upsert({
    where: { id: CURSOR_ID },
    create: { id: CURSOR_ID },
    update: {},
  });
  let offset = Number(cursor.logOffset);
  if (!Number.isFinite(offset) || offset < 0 || offset > raw.length) {
    offset = 0;
  }
  const slice = raw.subarray(offset);
  const text = slice.toString("utf8");
  const lines = text.split("\n");
  const incomplete = text.endsWith("\n") ? "" : (lines.pop() ?? "");
  const totals = new Map<string, bigint>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const host = lineHost(entry);
    const bytes = lineBytes(entry);
    const day = lineDay(entry);
    if (!host || bytes <= 0 || !day) {
      continue;
    }
    const key = `${host}\n${day.toISOString()}`;
    totals.set(key, (totals.get(key) ?? 0n) + BigInt(bytes));
  }
  for (const [key, bytes] of totals) {
    const [host, dayIso] = key.split("\n");
    const day = new Date(dayIso);
    await prisma.bandwidthDay.upsert({
      where: { host_day: { host, day } },
      create: { host, day, bytes },
      update: { bytes: { increment: bytes } },
    });
  }
  const consumed = slice.length - Buffer.byteLength(incomplete);
  await prisma.usageCursor.update({
    where: { id: CURSOR_ID },
    data: { logOffset: BigInt(offset + consumed) },
  });
}

function readCaddyLog(): Buffer | null {
  for (const name of CADDY_NAMES) {
    try {
      return execSync(`docker exec ${name} cat /data/access.log`, {
        stdio: "pipe",
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch {
      // Probar el siguiente nombre de contenedor.
    }
  }
  console.warn("[usage] no se pudo leer /data/access.log de Caddy");
  return null;
}

function lineHost(entry: Record<string, unknown>): string {
  const request = entry.request;
  if (!request || typeof request !== "object") {
    return "";
  }
  const host = (request as { host?: unknown }).host;
  if (typeof host !== "string") {
    return "";
  }
  return host.split(":")[0].trim().toLowerCase();
}

function lineBytes(entry: Record<string, unknown>): number {
  const upstream = entry.size_upstream_response_body;
  const size = entry.size;
  const chosen = typeof upstream === "number" ? upstream : size;
  if (typeof chosen !== "number" || !Number.isFinite(chosen) || chosen <= 0) {
    return 0;
  }
  return Math.round(chosen);
}

function lineDay(entry: Record<string, unknown>): Date | null {
  if (typeof entry.ts !== "number" || !Number.isFinite(entry.ts)) {
    return null;
  }
  const date = new Date(entry.ts * 1000);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function reportContainerMinutes(): Promise<void> {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  const windowEnd = new Date();
  const cursor = await prisma.usageCursor.upsert({
    where: { id: CURSOR_ID },
    create: { id: CURSOR_ID },
    update: {},
  });
  const windowStart =
    cursor.reportedUntil ?? new Date(windowEnd.getTime() - DAY_MS);
  const owners = await prisma.user.findMany({
    where: { stripeCustomerId: { not: null } },
    select: {
      id: true,
      stripeCustomerId: true,
      teams: { select: { projects: { select: { id: true } } } },
    },
  });
  if (!secret) {
    if (owners.length > 0) {
      console.warn("[usage] STRIPE_SECRET_KEY no está definida; no se enviaron minutos");
      return;
    }
    await prisma.usageCursor.update({
      where: { id: CURSOR_ID },
      data: { reportedUntil: windowEnd },
    });
    return;
  }

  const stripe = new Stripe(secret);
  for (const owner of owners) {
    const customerId = owner.stripeCustomerId?.trim();
    if (!customerId) {
      continue;
    }
    const projectIds = owner.teams.flatMap((team) => team.projects.map((project) => project.id));
    const minutes = projectIds.length
      ? await containerMinutes(projectIds, windowStart, windowEnd)
      : 0;
    if (minutes <= 0) {
      continue;
    }
    await stripe.billing.meterEvents.create({
      event_name: "container_minutes",
      identifier: `${customerId}:${windowEnd.toISOString()}`,
      payload: {
        stripe_customer_id: customerId,
        value: String(minutes),
      },
    });
  }
  await prisma.usageCursor.update({
    where: { id: CURSOR_ID },
    data: { reportedUntil: windowEnd },
  });
}

async function containerMinutes(
  projectIds: string[],
  windowStart: Date,
  windowEnd: Date,
): Promise<number> {
  const rows = await prisma.deployment.findMany({
    where: {
      projectId: { in: projectIds },
      startedAt: { not: null },
      OR: [{ stoppedAt: null }, { stoppedAt: { gt: windowStart } }],
    },
    select: { startedAt: true, stoppedAt: true },
  });
  let total = 0;
  for (const row of rows) {
    if (!row.startedAt) {
      continue;
    }
    total += overlapMinutes(row.startedAt, row.stoppedAt, windowStart, windowEnd);
  }
  return total;
}

function overlapMinutes(
  startedAt: Date,
  stoppedAt: Date | null,
  windowStart: Date,
  windowEnd: Date,
): number {
  const start = Math.max(startedAt.getTime(), windowStart.getTime());
  const end = Math.min((stoppedAt ?? windowEnd).getTime(), windowEnd.getTime());
  if (end <= start) {
    return 0;
  }
  return Math.round((end - start) / 60_000);
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (entry && entry === import.meta.url) {
  reportUsage()
    .catch((error: unknown) => {
      console.error("[usage]", error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}

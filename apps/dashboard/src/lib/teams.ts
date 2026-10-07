import { randomBytes } from "node:crypto";
import { prisma } from "@/db";

function slugBase(email: string): string {
  const local = email.split("@")[0] ?? "team";
  const slug = local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return slug || "team";
}

export async function ensurePersonalTeam(
  userId: string,
  email: string,
  name?: string | null,
): Promise<string> {
  const existing = await prisma.team.findFirst({
    where: { ownerId: userId },
    orderBy: { createdAt: "asc" },
  });
  if (existing) {
    return existing.id;
  }

  const base = slugBase(email);
  let slug = base;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const taken = await prisma.team.findUnique({ where: { slug } });
    if (!taken) {
      break;
    }
    slug = `${base}-${randomBytes(2).toString("hex")}`;
  }

  const team = await prisma.team.create({
    data: {
      name: name?.trim() || base,
      slug,
      ownerId: userId,
    },
  });
  return team.id;
}

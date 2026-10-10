"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AeroWindow, WinButton, WinField } from "@/components/aero-window";
import { ServiceTypeField, ServiceTypeMark, type ServiceType } from "@/components/service-type-field";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch, type Deployment } from "@/lib/api";

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function githubRepoPath(repoUrl: string): { owner: string; repo: string } | null {
  try {
    const url = new URL(repoUrl.trim());
    if (url.hostname !== "github.com") {
      return null;
    }
    const [owner, name] = url.pathname.split("/").filter(Boolean);
    const repo = name?.replace(/\.git$/, "") ?? "";
    if (!owner || !repo) {
      return null;
    }
    return { owner, repo };
  } catch {
    return null;
  }
}

function parseEnvExample(text: string): { key: string; value: string }[] {
  const rows: { key: string; value: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const body = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const eq = body.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = body.slice(0, eq).trim();
    if (!ENV_KEY.test(key)) {
      continue;
    }
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    rows.push({ key, value });
  }
  return rows;
}

export default function DeploymentsPage() {
  const [items, setItems] = useState<Deployment[] | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [redeployingId, setRedeployingId] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<Deployment | null>(null);
  const [serviceType, setServiceType] = useState<ServiceType>("web");
  const [envRows, setEnvRows] = useState<EnvDraft[]>([]);
  const [envOpen, setEnvOpen] = useState(false);
  const [envHint, setEnvHint] = useState("");
  const [detecting, setDetecting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const load = useCallback(async () => {
    const next = await apiFetch<Deployment[]>("/deployments");
    setItems(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<Deployment[]>("/deployments")
      .then((next) => {
        if (!cancelled) setItems(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setItems([]);
        toast.error(error instanceof Error ? error.message : "No se pudo leer los despliegues");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    try {
      const branch = String(form.get("branch") ?? "main").trim() || "main";
      const clearCache = form.get("clearCache") === "on";
      const variables = envRows
        .map((row) => ({ key: row.key.trim(), value: row.value }))
        .filter((row) => row.key.length > 0);
      await apiFetch("/deploy", {
        method: "POST",
        body: JSON.stringify({
          repoUrl: String(form.get("repoUrl") ?? ""),
          projectName: String(form.get("projectName") ?? ""),
          branch,
          clearCache,
          serviceType,
          variables,
        }),
      });
      formElement.reset();
      closeForm();
      toast.success("Despliegue en cola");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear el despliegue");
    } finally {
      setPending(false);
    }
  }

  function closeForm() {
    setOpen(false);
    setEnvRows([]);
    setServiceType("web");
    setEnvOpen(false);
    setEnvHint("");
  }

  function chooseService(next: ServiceType) {
    setServiceType(next);
    if (next === "worker") {
      setEnvOpen(true);
    }
  }

  async function detectEnvExample() {
    setEnvHint("");
    const data = new FormData(formRef.current ?? undefined);
    const repoUrl = String(data.get("repoUrl") ?? "");
    const branch = String(data.get("branch") ?? "main").trim() || "main";
    const repo = githubRepoPath(repoUrl);
    if (!repo) {
      setEnvHint("No se encontró .env.example");
      return;
    }
    const raw = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${encodeURIComponent(branch)}/.env.example`;
    setDetecting(true);
    try {
      const response = await fetch(raw);
      if (!response.ok) {
        setEnvHint("No se encontró .env.example");
        return;
      }
      const parsed = parseEnvExample(await response.text());
      setEnvRows((rows) => {
        const seen = new Set(rows.map((row) => row.key.trim()).filter((key) => key.length > 0));
        const added = parsed.filter((row) => !seen.has(row.key));
        return [
          ...rows,
          ...added.map((row) => ({ id: crypto.randomUUID(), key: row.key, value: row.value })),
        ];
      });
    } catch {
      setEnvHint("No se encontró .env.example");
    } finally {
      setDetecting(false);
    }
  }

  function addEnvRow() {
    setEnvRows((rows) => [...rows, { id: crypto.randomUUID(), key: "", value: "" }]);
  }

  async function onRedeploy(item: Deployment) {
    if (redeployingId) return;
    setRedeployingId(item.projectId);
    try {
      try {
        await apiFetch(`/deployments/${item.projectId}/redeploy`, {
          method: "POST",
        });
      } catch {
        // La tabla lista projectId de Redis; si no hay fila Prisma, re-encola /deploy.
        await apiFetch("/deploy", {
          method: "POST",
          body: JSON.stringify({
            repoUrl: item.repoUrl,
            projectName: item.projectName,
            branch: "main",
          }),
        });
      }
      toast.success("Nuevo despliegue en cola");
      await load();
      // Refresco corto para ver el estado pasar a building/running.
      window.setTimeout(() => {
        void load().catch(() => undefined);
      }, 1500);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo redesplegar");
    } finally {
      setRedeployingId(null);
    }
  }

  return (
    <>
      <AeroWindow title="Deployments">
        <div className="mb-4 flex items-center justify-between gap-4">
          <p className="text-sm text-slate-600">Repositorios públicos enviados al motor.</p>
          <WinButton
            onClick={() => {
              setEnvRows([]);
              setOpen(true);
            }}
          >
            Nuevo Despliegue
          </WinButton>
        </div>
        {items === null ? (
          <p className="text-sm">Cargando...</p>
        ) : items.length === 0 ? (
          <p className="text-sm">Todavía no hay despliegues.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-white/50 bg-white/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="bg-gradient-to-b from-white/70 to-sky-100/50">
                <tr>
                  <th className="w-[18%] px-2.5 py-1.5 font-semibold">Proyecto</th>
                  <th className="w-[34%] px-2.5 py-1.5 font-semibold">Repositorio</th>
                  <th className="w-[12%] px-2.5 py-1.5 font-semibold">Estado</th>
                  <th className="w-[18%] px-2.5 py-1.5 font-semibold">Creado</th>
                  <th className="w-[18%] px-2.5 py-1.5 font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const busy = redeployingId === item.projectId;
                  return (
                    <tr key={item.projectId} className="border-t border-white/50">
                      <td className="break-words px-2.5 py-1.5 font-medium">
                        {item.projectName}
                        <ServiceTypeMark serviceType={item.serviceType} />
                      </td>
                      <td className="break-all px-2.5 py-1.5 font-mono text-xs leading-snug">
                        {item.repoUrl}
                      </td>
                      <td className="px-2.5 py-1.5">
                        <button
                          type="button"
                          onClick={() => setLogsFor(item)}
                          className="cursor-pointer"
                        >
                          <StatusBadge status={item.status} />
                        </button>
                      </td>
                      <td className="whitespace-normal px-2.5 py-1.5 tabular-nums leading-snug">
                        {formatDate(item.createdAt)}
                      </td>
                      <td className="px-2.5 py-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <WinButton compact onClick={() => setLogsFor(item)}>
                            Ver Logs
                          </WinButton>
                          <WinButton
                            compact
                            disabled={busy || redeployingId !== null}
                            onClick={() => void onRedeploy(item)}
                          >
                            <span className="inline-flex items-center gap-1">
                              <RefreshCw
                                className={`size-3 ${busy ? "animate-spin" : ""}`}
                                aria-hidden
                              />
                              {busy ? "Enviando..." : "Redeploy"}
                            </span>
                          </WinButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </AeroWindow>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4">
          <AeroWindow title="Nuevo Despliegue" dialog onClose={closeForm}>
            <form
              ref={formRef}
              className="flex max-h-[60vh] flex-col overflow-hidden"
              onSubmit={onSubmit}
            >
              <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
              <p className="text-sm text-slate-600">
                El motor clona un repositorio público de GitHub y lo pone en cola.
              </p>
              <WinField
                id="repoUrl"
                name="repoUrl"
                label="repoUrl"
                required
                placeholder="https://github.com/org/repo"
              />
              <WinField
                id="projectName"
                name="projectName"
                label="projectName"
                required
                placeholder="mi-app"
              />
              <WinField
                id="branch"
                name="branch"
                label="Branch / Rama"
                required
                defaultValue="main"
                placeholder="main"
              />
              <ServiceTypeField value={serviceType} onChange={chooseService} />
              <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-white/70 bg-white/60 px-2.5 py-2 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                <input
                  type="checkbox"
                  name="clearCache"
                  className="mt-0.5 size-4 accent-sky-700"
                />
                <span>
                  <span className="block font-medium">
                    Limpiar caché de construcción
                  </span>
                  <span className="block text-xs text-slate-600">
                    Envía clearCache al motor (docker build --no-cache).
                  </span>
                </span>
              </label>
              <details
                open={envOpen}
                onToggle={(event) => setEnvOpen(event.currentTarget.open)}
                className="rounded-md border border-white/70 bg-white/40 px-2.5 py-2"
              >
                <summary className="cursor-pointer text-sm font-medium text-slate-800">
                  Variables de entorno
                </summary>
                <div className="mt-2 flex flex-col gap-2">
                  {envRows.map((row) => (
                    <div key={row.id} className="flex items-center gap-2">
                      <input
                        aria-label="Clave"
                        value={row.key}
                        placeholder="CLAVE"
                        onChange={(event) => {
                          const key = event.target.value;
                          setEnvRows((rows) =>
                            rows.map((item) => (item.id === row.id ? { ...item, key } : item)),
                          );
                        }}
                        className="min-w-0 flex-1 rounded-md border border-white/70 bg-white/80 px-2 py-1.5 text-sm text-slate-900 shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)] outline-none"
                      />
                      <input
                        aria-label="Valor"
                        type="password"
                        value={row.value}
                        placeholder="valor"
                        onChange={(event) => {
                          const value = event.target.value;
                          setEnvRows((rows) =>
                            rows.map((item) => (item.id === row.id ? { ...item, value } : item)),
                          );
                        }}
                        className="min-w-0 flex-1 rounded-md border border-white/70 bg-white/80 px-2 py-1.5 text-sm text-slate-900 shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)] outline-none"
                      />
                      <WinButton
                        compact
                        onClick={() =>
                          setEnvRows((rows) => rows.filter((item) => item.id !== row.id))
                        }
                      >
                        Quitar
                      </WinButton>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-2">
                    <WinButton compact onClick={addEnvRow}>
                      Añadir variable
                    </WinButton>
                    <WinButton compact disabled={detecting} onClick={() => void detectEnvExample()}>
                      {detecting ? "Buscando..." : "Detectar variables del repo"}
                    </WinButton>
                  </div>
                  {envHint ? <p className="text-xs text-slate-500">{envHint}</p> : null}
                </div>
              </details>
              </div>
              <div className="mt-3 flex shrink-0 justify-end gap-2">
                <WinButton onClick={closeForm}>Cancelar</WinButton>
                <WinButton type="submit" disabled={pending}>
                  {pending ? "Enviando..." : "Crear"}
                </WinButton>
              </div>
            </form>
          </AeroWindow>
        </div>
      ) : null}
      {logsFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4">
          <AeroWindow title="Build Logs" dialog wide onClose={() => setLogsFor(null)}>
            <BuildLogs deployment={logsFor} />
          </AeroWindow>
        </div>
      ) : null}
    </>
  );
}

function BuildLogs({ deployment }: { deployment: Deployment }) {
  const [current, setCurrent] = useState(deployment);
  const [lines, setLines] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [liveTail, setLiveTail] = useState(isBuilding(deployment.status));
  const [now, setNow] = useState(() => Date.now());
  const box = useRef<HTMLDivElement>(null);
  const pinning = useRef(false);
  const failed = current.status === "failed";
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? lines.filter((line) => line.toLowerCase().includes(needle))
    : lines;

  useEffect(() => {
    if (!isBuilding(current.status)) {
      setLiveTail(false);
      return;
    }
    const timer = window.setInterval(() => {
      void apiFetch<Deployment[]>("/deployments")
        .then((rows) => {
          const next = rows.find((row) => row.projectId === deployment.projectId);
          if (next) setCurrent(next);
        })
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [current.status, deployment.projectId]);

  useEffect(() => {
    if (!isBuilding(current.status)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [current.status]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function readLogs() {
      let received = false;
      try {
        const response = await fetch(`/backend/deployments/${deployment.projectId}/logs`, {
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(await readError(response));
        }
        if (!cancelled) setReady(true);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split(/\r?\n\r?\n/);
          buffer = events.pop() ?? "";
          const next = events.map(readSseData).filter((line) => line.length > 0);
          if (next.length > 0) {
            received = true;
            setLines((existing) => [...existing, ...next]);
          }
        }
      } catch (cause) {
        if (controller.signal.aborted || cancelled || received) return;
        setError(cause instanceof Error ? cause.message : "No se pudieron leer los logs");
      }
    }

    void readLogs();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [deployment.projectId]);

  useEffect(() => {
    if (!liveTail) return;
    const el = box.current;
    if (!el) return;
    pinning.current = true;
    el.scrollTop = el.scrollHeight;
    pinning.current = false;
  }, [lines, query, liveTail]);

  function onLogScroll() {
    const el = box.current;
    if (!el || !liveTail || pinning.current) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance > 24) setLiveTail(false);
  }

  function followTail() {
    setLiveTail(true);
    const el = box.current;
    if (!el) return;
    pinning.current = true;
    el.scrollTop = el.scrollHeight;
    pinning.current = false;
  }

  const commit = current.commitHash?.trim() ?? "";
  const subject = current.commitMessage?.trim() ?? "";
  const author = current.commitAuthor?.trim() ?? "";
  const commitLabel = commit
    ? [commit.slice(0, 7), subject ? `- ${subject}` : "", author ? `(${author})` : ""]
        .filter(Boolean)
        .join(" ")
    : "No disponible";

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-slate-600">{current.projectName}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-700">
        <span className="inline-flex items-center gap-1.5">
          Estado <StatusBadge status={current.status} />
        </span>
        <span>
          Duración{" "}
          <span className="tabular-nums">
            {formatDuration(current.createdAt, current.finishedAt, isBuilding(current.status), now)}
          </span>
        </span>
        <span>
          Commit{" "}
          <span className="font-mono" title={commit || undefined}>
            {commitLabel}
          </span>
        </span>
        <span>Disparador {triggerLabel(current.trigger)}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filtrar líneas"
          aria-label="Filtrar líneas"
          className="min-w-0 flex-1 rounded-md border border-white/70 bg-white/80 px-2 py-1.5 text-sm text-slate-900 shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)] outline-none"
        />
        <WinButton compact onClick={followTail}>
          {liveTail ? "Siguiendo" : "Live tail"}
        </WinButton>
      </div>
      <div
        ref={box}
        onScroll={onLogScroll}
        className="h-72 overflow-auto rounded-md bg-black p-3 text-xs leading-5 text-green-100"
        style={{ fontFamily: "Consolas, 'Courier New', monospace" }}
      >
        {error ? <p className="text-red-400">{error}</p> : null}
        {!ready && lines.length === 0 ? <p className="text-zinc-400">Conectando...</p> : null}
        {ready && visible.length === 0 && !error ? (
          <p className="text-zinc-400">{needle ? "Sin coincidencias." : "Sin registros."}</p>
        ) : null}
        {visible.map((line, index) => (
          <p
            key={`${index}-${line}`}
            className={`whitespace-pre-wrap break-words ${failed && isErrorLine(line) ? "text-red-400" : ""}`}
          >
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

type EnvDraft = { id: string; key: string; value: string };

function isBuilding(status: string): boolean {
  return status === "queued" || status === "building";
}

function triggerLabel(trigger: Deployment["trigger"]): string {
  return trigger === "webhook" ? "Webhook de GitHub" : "Desplegado manualmente";
}

function formatDuration(
  createdAt: string,
  finishedAt: string | null | undefined,
  ticking: boolean,
  now: number,
): string {
  const start = new Date(createdAt).getTime();
  if (!Number.isFinite(start)) return "—";
  const end = finishedAt ? new Date(finishedAt).getTime() : ticking ? now : Number.NaN;
  if (!Number.isFinite(end) || end < start) return "—";
  const total = Math.floor((end - start) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours} h ${minutes} min ${seconds} s`;
  if (minutes > 0) return `${minutes} min ${seconds} s`;
  return `${seconds} s`;
}

function readSseData(event: string): string {
  const data = event
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  return data ? parseLogLine(data) : "";
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return body.message || body.error || "No se pudieron leer los logs";
  } catch {
    return "No se pudieron leer los logs";
  }
}

function parseLogLine(data: string): string {
  try {
    const parsed = JSON.parse(data) as unknown;
    return typeof parsed === "string" ? parsed : data;
  } catch {
    return data;
  }
}

function isErrorLine(line: string): boolean {
  return /error|failed|fail|err!|exception|no such|not found|denied/i.test(line);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = date.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const time = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  return `${day} ${time}`;
}

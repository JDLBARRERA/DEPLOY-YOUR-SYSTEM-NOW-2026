"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AeroWindow, WinButton, WinField } from "@/components/aero-window";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch, type Deployment } from "@/lib/api";

export default function DeploymentsPage() {
  const [items, setItems] = useState<Deployment[] | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [redeployingId, setRedeployingId] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<Deployment | null>(null);

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
      await apiFetch("/deploy", {
        method: "POST",
        body: JSON.stringify({
          repoUrl: String(form.get("repoUrl") ?? ""),
          projectName: String(form.get("projectName") ?? ""),
          branch,
          clearCache,
        }),
      });
      formElement.reset();
      setOpen(false);
      toast.success("Despliegue en cola");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear el despliegue");
    } finally {
      setPending(false);
    }
  }

  async function onRedeploy(item: Deployment) {
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
      toast.success("Nuevo despliegue puesto en cola");
      await load();
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
          <WinButton onClick={() => setOpen(true)}>Nuevo Despliegue</WinButton>
        </div>
        {items === null ? (
          <p className="text-sm">Cargando...</p>
        ) : items.length === 0 ? (
          <p className="text-sm">Todavía no hay despliegues.</p>
        ) : (
          <table className="w-full table-fixed text-left text-sm">
            <thead className="bg-white/50">
              <tr>
                <th className="w-[20%] px-2 py-1 font-semibold">Proyecto</th>
                <th className="px-2 py-1 font-semibold">Repositorio</th>
                <th className="w-20 px-2 py-1 font-semibold">Estado</th>
                <th className="w-28 px-2 py-1 font-semibold">Creado</th>
                <th className="w-44 px-2 py-1 font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.projectId} className="border-t border-white/50">
                  <td className="truncate px-2 py-1 font-medium">{item.projectName}</td>
                  <td className="truncate px-2 py-1" title={item.repoUrl}>
                    {item.repoUrl}
                  </td>
                  <td className="px-2 py-1">
                    <button type="button" onClick={() => setLogsFor(item)} className="cursor-pointer">
                      <StatusBadge status={item.status} />
                    </button>
                  </td>
                  <td className="truncate px-2 py-1">{formatDate(item.createdAt)}</td>
                  <td className="px-2 py-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <WinButton onClick={() => setLogsFor(item)}>Ver Logs</WinButton>
                      <WinButton
                        disabled={redeployingId === item.projectId}
                        onClick={() => void onRedeploy(item)}
                      >
                        <span className="inline-flex items-center gap-1">
                          <RefreshCw
                            className={`size-3.5 ${redeployingId === item.projectId ? "animate-spin" : ""}`}
                            aria-hidden
                          />
                          Redeploy
                        </span>
                      </WinButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </AeroWindow>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4">
          <AeroWindow title="Nuevo Despliegue" dialog onClose={() => setOpen(false)}>
            <p className="mb-3 text-sm text-slate-600">
              El motor clona un repositorio público de GitHub y lo pone en cola.
            </p>
            <form className="flex flex-col gap-3" onSubmit={onSubmit}>
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
              <div className="flex justify-end gap-2">
                <WinButton onClick={() => setOpen(false)}>Cancelar</WinButton>
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
  const [lines, setLines] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const failed = deployment.status === "failed";

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
            setLines((current) => [...current, ...next]);
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
    bottom.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-slate-600">
        {deployment.projectName} · {deployment.status}
      </p>
      <div
        className="h-72 overflow-auto rounded-md bg-black p-3 text-xs leading-5 text-green-100"
        style={{ fontFamily: "Consolas, 'Courier New', monospace" }}
      >
        {error ? <p className="text-red-400">{error}</p> : null}
        {!ready && lines.length === 0 ? <p className="text-zinc-400">Conectando...</p> : null}
        {ready && lines.length === 0 && !error ? (
          <p className="text-zinc-400">Sin registros.</p>
        ) : null}
        {lines.map((line, index) => (
          <p
            key={`${index}-${line}`}
            className={`whitespace-pre-wrap break-words ${failed && isErrorLine(line) ? "text-red-400" : ""}`}
          >
            {line}
          </p>
        ))}
        <div ref={bottom} />
      </div>
    </div>
  );
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
  return date.toLocaleString("es", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

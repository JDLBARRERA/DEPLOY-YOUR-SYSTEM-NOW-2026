"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { WinButton } from "@/components/aero-window";
import { apiFetch } from "@/lib/api";

interface ProjectAddon {
  id: string;
  projectId: string;
  type: string;
  containerName: string;
  connectionString: string;
}

export function ProjectAddons({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [addons, setAddons] = useState<ProjectAddon[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<ProjectAddon[]>(`/projects/${encodeURIComponent(projectId)}/addons`)
      .then((rows) => {
        if (!cancelled) setAddons(rows);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setAddons([]);
        toast.error(error instanceof Error ? error.message : "No se pudieron leer las bases");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function create(type: "postgres" | "redis") {
    setBusy(type);
    try {
      const created = await apiFetch<ProjectAddon>(
        `/projects/${encodeURIComponent(projectId)}/addons`,
        { method: "POST", body: JSON.stringify({ type }) },
      );
      setAddons((current) => [...(current ?? []), created]);
      toast.success(`${type === "postgres" ? "Postgres" : "Redis"} creado para ${projectName}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear la base");
    } finally {
      setBusy(null);
    }
  }

  async function remove(addon: ProjectAddon) {
    if (confirmId !== addon.id) {
      setConfirmId(addon.id);
      return;
    }
    setConfirmId(null);
    setBusy(addon.id);
    try {
      await apiFetch(
        `/projects/${encodeURIComponent(projectId)}/addons/${encodeURIComponent(addon.id)}`,
        { method: "DELETE" },
      );
      setAddons((current) => current?.filter((item) => item.id !== addon.id) ?? []);
      toast.success("Base eliminada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar la base");
    } finally {
      setBusy(null);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Cadena de conexión copiada");
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  return (
    <div className="mt-3 border-t border-white/60 pt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-sky-950">Bases de datos</h3>
        <div className="flex gap-2">
          <WinButton type="button" disabled={busy !== null} onClick={() => void create("postgres")}>
            {busy === "postgres" ? "Creando..." : "Postgres"}
          </WinButton>
          <WinButton type="button" disabled={busy !== null} onClick={() => void create("redis")}>
            {busy === "redis" ? "Creando..." : "Redis"}
          </WinButton>
        </div>
      </div>
      {addons === null ? (
        <p className="text-xs text-slate-600">Cargando bases...</p>
      ) : addons.length === 0 ? (
        <p className="text-xs text-slate-600">Este proyecto todavía no tiene bases propias.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {addons.map((addon) => (
            <li
              key={addon.id}
              className="grid gap-2 rounded-md border border-white/70 bg-white/60 p-2 sm:grid-cols-[7rem_1fr_auto_auto]"
            >
              <div className="min-w-0 text-xs">
                <p className="font-semibold uppercase">{addon.type}</p>
                <p className="truncate font-mono text-slate-500">{addon.containerName}</p>
              </div>
              <input
                type="password"
                readOnly
                value={addon.connectionString}
                aria-label={`Cadena de conexión de ${addon.containerName}`}
                className="rounded-md border border-white/70 bg-white/80 px-2 py-1.5 font-mono text-xs text-slate-900"
              />
              <button
                type="button"
                className="text-left text-xs text-sky-800 underline"
                onClick={() => void copy(addon.connectionString)}
              >
                Copiar
              </button>
              <button
                type="button"
                className="text-left text-xs text-rose-800 underline"
                disabled={busy === addon.id}
                onClick={() => void remove(addon)}
              >
                {busy === addon.id
                  ? "Eliminando..."
                  : confirmId === addon.id
                    ? "Sí, borrar"
                    : "Eliminar"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

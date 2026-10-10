"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AeroWindow, WinButton } from "@/components/aero-window";
import { apiFetch, type Database as ManagedDatabase } from "@/lib/api";

type Engine = "postgres" | "redis";

export default function DatabasesPage() {
  const [items, setItems] = useState<ManagedDatabase[] | null>(null);
  const [creating, setCreating] = useState<Engine | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await apiFetch<ManagedDatabase[]>("/databases");
    setItems(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const read = (reportError: boolean) => {
      void apiFetch<ManagedDatabase[]>("/databases")
        .then((next) => {
          if (!cancelled) setItems(next);
        })
        .catch((error: unknown) => {
          if (cancelled || !reportError) return;
          setItems([]);
          toast.error(error instanceof Error ? error.message : "No se pudo leer las bases");
        });
    };
    read(true);
    const timer = window.setInterval(() => read(false), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  async function create(type: Engine) {
    if (creating) return;
    setCreating(type);
    try {
      await apiFetch("/databases", {
        method: "POST",
        body: JSON.stringify({ name: databaseName(type), type }),
      });
      toast.success(type === "redis" ? "Redis creado" : "PostgreSQL creado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear la base");
    } finally {
      setCreating(null);
    }
  }

  async function copyUrl(url: string) {
    if (!url) {
      toast.error("Esta base no tiene URL");
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("URI de conexión copiada");
    } catch {
      toast.error("No se pudo copiar la URI");
    }
  }

  async function onDelete(item: ManagedDatabase) {
    if (deletingId) return;
    setDeletingId(item.id);
    try {
      await apiFetch(`/databases/${item.id}`, { method: "DELETE" });
      setItems((current) => (current ? current.filter((row) => row.id !== item.id) : current));
      toast.success("Base eliminada");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <AeroWindow title="Databases" wide>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <WinButton disabled={creating !== null} onClick={() => void create("postgres")}>
          {creating === "postgres" ? "Creando..." : "Nuevo PostgreSQL"}
        </WinButton>
        <WinButton disabled={creating !== null} onClick={() => void create("redis")}>
          {creating === "redis" ? "Creando..." : "Nuevo Redis"}
        </WinButton>
      </div>
      {items === null ? (
        <p className="text-sm">Cargando...</p>
      ) : items.length === 0 ? (
        <p className="text-sm">Todavía no hay bases de datos.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-white/50 bg-white/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-gradient-to-b from-white/70 to-sky-100/50">
              <tr>
                <th className="px-2.5 py-1.5 font-semibold">Nombre</th>
                <th className="px-2.5 py-1.5 font-semibold">Tipo</th>
                <th className="px-2.5 py-1.5 font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const busy = deletingId === item.id;
                return (
                  <tr key={item.id} className="border-t border-white/50">
                    <td className="px-2.5 py-1.5 font-medium">{item.name}</td>
                    <td className="px-2.5 py-1.5 text-slate-700">{engineLabel(item.type)}</td>
                    <td className="px-2.5 py-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <WinButton compact onClick={() => void copyUrl(connectionUri(item))}>
                          Copiar URL
                        </WinButton>
                        <button
                          type="button"
                          className="rounded-md border border-rose-900/40 bg-gradient-to-b from-rose-200 to-rose-500 px-2 py-1 text-xs font-semibold text-rose-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] disabled:opacity-60"
                          disabled={busy || deletingId !== null}
                          onClick={() => void onDelete(item)}
                        >
                          {busy ? "Eliminando..." : "Eliminar"}
                        </button>
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
  );
}

function databaseName(type: Engine): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${type}-${suffix}`;
}

function connectionUri(item: ManagedDatabase): string {
  return item.databaseUrl || item.DATABASE_URL || item.pooledUrl || item.directUrl || "";
}

function engineLabel(type?: string): string {
  if (type === "redis" || type === "REDIS") return "Redis";
  return "PostgreSQL";
}

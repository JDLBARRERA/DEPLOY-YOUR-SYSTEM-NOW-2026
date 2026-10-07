"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AeroWindow, WinButton, WinField } from "@/components/aero-window";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch, type Deployment } from "@/lib/api";

export default function DeploymentsPage() {
  const [items, setItems] = useState<Deployment[] | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

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
      await apiFetch("/deploy", {
        method: "POST",
        body: JSON.stringify({
          repoUrl: String(form.get("repoUrl") ?? ""),
          projectName: String(form.get("projectName") ?? ""),
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
          <table className="w-full text-left text-sm">
            <thead className="bg-white/50">
              <tr>
                <th className="px-2 py-1 font-semibold">Proyecto</th>
                <th className="px-2 py-1 font-semibold">Repositorio</th>
                <th className="px-2 py-1 font-semibold">Estado</th>
                <th className="px-2 py-1 font-semibold">Creado</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.projectId} className="border-t border-white/50">
                  <td className="px-2 py-1 font-medium">{item.projectName}</td>
                  <td className="max-w-xs truncate px-2 py-1">{item.repoUrl}</td>
                  <td className="px-2 py-1">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="px-2 py-1">{formatDate(item.createdAt)}</td>
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
              <WinField id="projectName" name="projectName" label="projectName" required placeholder="mi-app" />
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
    </>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

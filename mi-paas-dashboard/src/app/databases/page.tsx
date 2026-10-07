"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AeroWindow, WinButton, WinField } from "@/components/aero-window";
import { apiFetch, type Database as ManagedDatabase } from "@/lib/api";

export default function DatabasesPage() {
  const [items, setItems] = useState<ManagedDatabase[] | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const next = await apiFetch<ManagedDatabase[]>("/databases");
    setItems(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<ManagedDatabase[]>("/databases")
      .then((next) => {
        if (!cancelled) setItems(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setItems([]);
        toast.error(error instanceof Error ? error.message : "No se pudo leer las bases");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const projectId = String(form.get("projectId") ?? "").trim();
    setPending(true);
    try {
      await apiFetch("/databases", {
        method: "POST",
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          ...(projectId ? { projectId } : {}),
        }),
      });
      formElement.reset();
      setOpen(false);
      toast.success("Base creada");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear la base");
    } finally {
      setPending(false);
    }
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("URL copiada");
    } catch {
      toast.error("No se pudo copiar la URL");
    }
  }

  return (
    <>
      <AeroWindow title="Databases">
        <div className="mb-4 flex items-center justify-between gap-4">
          <p className="text-sm text-slate-600">Bases creadas en el motor.</p>
          <WinButton onClick={() => setOpen(true)}>Crear nueva BD</WinButton>
        </div>
        {items === null ? (
          <p className="text-sm">Cargando...</p>
        ) : items.length === 0 ? (
          <p className="text-sm">Todavía no hay bases de datos.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((item) => (
              <article
                key={item.id}
                className="rounded-lg border border-white/60 bg-gradient-to-b from-white/80 to-white/40 p-3"
              >
                <h2 className="font-semibold">{item.name}</h2>
                <p className="mb-3 text-sm text-slate-600">{item.dbName}</p>
                <WinButton onClick={() => void copyUrl(item.pooledUrl)}>Copiar pooledUrl</WinButton>
              </article>
            ))}
          </div>
        )}
      </AeroWindow>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4">
          <AeroWindow title="Crear nueva BD" dialog onClose={() => setOpen(false)}>
            <p className="mb-3 text-sm text-slate-600">
              El nombre solo admite letras minúsculas, números y guion bajo.
            </p>
            <form className="flex flex-col gap-3" onSubmit={onSubmit}>
              <WinField id="name" name="name" label="name" required placeholder="app_db" />
              <WinField id="projectId" name="projectId" label="projectId" placeholder="Opcional" />
              <div className="flex justify-end gap-2">
                <WinButton onClick={() => setOpen(false)}>Cancelar</WinButton>
                <WinButton type="submit" disabled={pending}>
                  {pending ? "Creando..." : "Crear"}
                </WinButton>
              </div>
            </form>
          </AeroWindow>
        </div>
      ) : null}
    </>
  );
}

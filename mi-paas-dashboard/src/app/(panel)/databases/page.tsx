"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Copy, Database as DatabaseIcon } from "lucide-react";
import { toast } from "sonner";
import { AeroWindow, WinButton, WinField } from "@/components/aero-window";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch, type Database as ManagedDatabase, type DatabaseEngine } from "@/lib/api";

const ENGINES: { value: DatabaseEngine; label: string; hint: string }[] = [
  { value: "postgres", label: "PostgreSQL", hint: "postgres:16 en mi-paas_default" },
  { value: "mysql", label: "MySQL", hint: "mysql:8.4 en mi-paas_default" },
  { value: "redis", label: "Redis", hint: "redis:7 con contraseña" },
];

export default function DatabasesPage() {
  const [items, setItems] = useState<ManagedDatabase[] | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [engine, setEngine] = useState<DatabaseEngine>("postgres");
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);

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
    setPending(true);
    setCreatedUrl(null);
    try {
      const created = await apiFetch<ManagedDatabase>("/databases", {
        method: "POST",
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          type: engine,
        }),
      });
      const url =
        created.DATABASE_URL || created.databaseUrl || created.pooledUrl || created.directUrl;
      setCreatedUrl(url);
      formElement.reset();
      toast.success("Base de datos en ejecución");
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
      toast.success("URI de conexión copiada");
    } catch {
      toast.error("No se pudo copiar la URI");
    }
  }

  function closeModal() {
    setOpen(false);
    setCreatedUrl(null);
    setEngine("postgres");
  }

  return (
    <>
      <AeroWindow title="Databases" wide>
        <div className="mb-4 flex items-center justify-between gap-4">
          <p className="text-sm text-slate-600">
            Contenedores Postgres, MySQL o Redis en la red <code>mi-paas_default</code>.
          </p>
          <WinButton onClick={() => setOpen(true)}>Nueva Base de Datos</WinButton>
        </div>
        {items === null ? (
          <p className="text-sm">Cargando...</p>
        ) : items.length === 0 ? (
          <p className="text-sm">Todavía no hay bases de datos.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-white/50 bg-white/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-gradient-to-b from-white/70 to-sky-100/50">
                <tr>
                  <th className="px-2.5 py-1.5 font-semibold">Nombre</th>
                  <th className="px-2.5 py-1.5 font-semibold">Motor</th>
                  <th className="w-24 px-2.5 py-1.5 font-semibold">Estado</th>
                  <th className="px-2.5 py-1.5 font-semibold">Host</th>
                  <th className="min-w-[220px] px-2.5 py-1.5 font-semibold">URI</th>
                  <th className="w-28 px-2.5 py-1.5 font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const uri =
                    item.databaseUrl || item.DATABASE_URL || item.pooledUrl || item.directUrl;
                  return (
                    <tr key={item.id} className="border-t border-white/50">
                      <td className="px-2.5 py-1.5 font-medium">{item.name}</td>
                      <td className="px-2.5 py-1.5 uppercase text-slate-700">
                        {item.type ?? "postgres"}
                      </td>
                      <td className="px-2.5 py-1.5">
                        <StatusBadge status={item.status ?? "running"} />
                      </td>
                      <td className="truncate px-2.5 py-1.5 font-mono text-xs" title={item.host}>
                        {item.host}:{item.port}
                      </td>
                      <td className="max-w-[260px] truncate px-2.5 py-1.5 font-mono text-xs" title={uri}>
                        {uri}
                      </td>
                      <td className="px-2.5 py-1.5">
                        <WinButton compact onClick={() => void copyUrl(uri)}>
                          <span className="inline-flex items-center gap-1">
                            <Copy className="size-3" aria-hidden />
                            Copiar URI
                          </span>
                        </WinButton>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4 backdrop-blur-[2px]">
          <AeroWindow title="Nueva Base de Datos" dialog onClose={closeModal}>
            <div className="mb-3 flex items-start gap-3 rounded-lg border border-white/60 bg-gradient-to-b from-white/70 to-sky-100/40 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
              <span className="flex size-10 items-center justify-center rounded-xl border border-white/70 bg-gradient-to-b from-sky-200 to-sky-500 text-sky-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                <DatabaseIcon className="size-5" />
              </span>
              <p className="text-sm text-slate-700">
                Elige el motor y un nombre. Se levantará un contenedor Docker con credenciales
                generadas y recibirás la <code>DATABASE_URL</code>.
              </p>
            </div>

            {createdUrl ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium text-emerald-800">Base creada correctamente.</p>
                <label className="flex flex-col gap-1 text-sm">
                  DATABASE_URL
                  <textarea
                    readOnly
                    value={createdUrl}
                    rows={3}
                    className="rounded-md border border-white/70 bg-white/90 px-2 py-1.5 font-mono text-xs text-slate-900 shadow-[inset_0_1px_3px_rgba(0,0,0,0.12)]"
                  />
                </label>
                <div className="flex justify-end gap-2">
                  <WinButton onClick={() => void copyUrl(createdUrl)}>Copiar URI</WinButton>
                  <WinButton onClick={closeModal}>Cerrar</WinButton>
                </div>
              </div>
            ) : (
              <form className="flex flex-col gap-3" onSubmit={onSubmit}>
                <WinField
                  id="name"
                  name="name"
                  label="Nombre"
                  required
                  placeholder="app-cache"
                />
                <fieldset className="flex flex-col gap-2">
                  <legend className="text-sm font-medium">Motor</legend>
                  <div className="grid gap-2">
                    {ENGINES.map((item) => {
                      const active = engine === item.value;
                      return (
                        <label
                          key={item.value}
                          className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] transition-colors ${
                            active
                              ? "border-sky-400 bg-gradient-to-b from-sky-100 to-white ring-1 ring-sky-300/70"
                              : "border-white/70 bg-white/55 hover:bg-white/75"
                          }`}
                        >
                          <input
                            type="radio"
                            name="type"
                            value={item.value}
                            checked={active}
                            onChange={() => setEngine(item.value)}
                            className="mt-1 accent-sky-700"
                          />
                          <span>
                            <span className="block font-semibold">{item.label}</span>
                            <span className="block text-xs text-slate-600">{item.hint}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <div className="flex justify-end gap-2 pt-1">
                  <WinButton onClick={closeModal}>Cancelar</WinButton>
                  <WinButton type="submit" disabled={pending}>
                    {pending ? "Creando..." : "Crear"}
                  </WinButton>
                </div>
              </form>
            )}
          </AeroWindow>
        </div>
      ) : null}
    </>
  );
}

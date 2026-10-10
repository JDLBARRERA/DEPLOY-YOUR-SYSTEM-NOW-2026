"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { WinButton } from "@/components/aero-window";
import { apiFetch } from "@/lib/api";

interface ProjectVariable {
  id: string;
  projectId: string;
  key: string;
  value: string;
}

function formatEnvValue(value: string): string {
  if (value === "" || /[\s#"'\\]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

function toEnvText(rows: ProjectVariable[]): string {
  return rows.map((row) => `${row.key}=${formatEnvValue(row.value)}`).join("\n");
}

export function ProjectVariables({ projectId }: { projectId: string }) {
  const [variables, setVariables] = useState<ProjectVariable[] | null>(null);
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const exportMenu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<ProjectVariable[]>(`/projects/${encodeURIComponent(projectId)}/variables`)
      .then((rows) => {
        if (!cancelled) setVariables(rows);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setVariables([]);
        toast.error(error instanceof Error ? error.message : "No se pudieron leer las variables");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!exportOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!exportMenu.current?.contains(event.target as Node)) {
        setExportOpen(false);
      }
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [exportOpen]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const key = String(form.get("key") ?? "");
    const value = String(form.get("value") ?? "");
    setBusy("create");
    try {
      const created = await apiFetch<ProjectVariable>(
        `/projects/${encodeURIComponent(projectId)}/variables`,
        { method: "POST", body: JSON.stringify({ key, value }) },
      );
      setVariables((current) =>
        [...(current ?? []), created].sort((left, right) => left.key.localeCompare(right.key)),
      );
      formElement.reset();
      toast.success("Variable guardada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la variable");
    } finally {
      setBusy(null);
    }
  }

  async function remove(variable: ProjectVariable) {
    setBusy(`delete:${variable.id}`);
    try {
      await apiFetch(
        `/projects/${encodeURIComponent(projectId)}/variables/${encodeURIComponent(variable.id)}`,
        { method: "DELETE" },
      );
      setVariables((current) => current?.filter((item) => item.id !== variable.id) ?? []);
      toast.success(`${variable.key} eliminada`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar la variable");
    } finally {
      setBusy(null);
    }
  }

  function savedText(): string {
    return toEnvText(variables ?? []);
  }

  async function copyEnv() {
    setExportOpen(false);
    try {
      await navigator.clipboard.writeText(savedText());
      toast.success("Variables copiadas como .env");
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  function downloadEnv() {
    setExportOpen(false);
    const file = new Blob([`${savedText()}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = ".env";
    link.click();
    URL.revokeObjectURL(url);
  }

  function startEdit() {
    setExportOpen(false);
    setDrafts(Object.fromEntries((variables ?? []).map((item) => [item.id, item.value])));
    setEditing(true);
  }

  function cancelEdit() {
    setDrafts({});
    setEditing(false);
  }

  async function saveEdits() {
    const current = variables ?? [];
    const changed = current.filter((item) => (drafts[item.id] ?? item.value) !== item.value);
    if (changed.length === 0) {
      setDrafts({});
      setEditing(false);
      return;
    }
    setBusy("bulk");
    try {
      for (const item of changed) {
        await apiFetch(
          `/projects/${encodeURIComponent(projectId)}/variables/${encodeURIComponent(item.id)}`,
          { method: "PATCH", body: JSON.stringify({ value: drafts[item.id] ?? item.value }) },
        );
      }
      const rows = await apiFetch<ProjectVariable[]>(
        `/projects/${encodeURIComponent(projectId)}/variables`,
      );
      setVariables(rows);
      setDrafts({});
      setEditing(false);
      toast.success("Variables guardadas");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron guardar las variables");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 border-t border-white/60 pt-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h3 className="mb-1 text-xs font-semibold text-sky-950">Variables de entorno</h3>
          <p className="text-xs text-slate-600">Se aplican en el próximo despliegue.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="relative" ref={exportMenu}>
            <WinButton
              compact
              disabled={variables === null || busy !== null}
              onClick={() => setExportOpen((open) => !open)}
            >
              Export
            </WinButton>
            {exportOpen ? (
              <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-white/70 bg-white/95 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_16px_rgba(0,0,0,0.15)]">
                <button
                  type="button"
                  className="block w-full rounded px-2 py-1.5 text-left text-xs text-slate-800 hover:bg-sky-100"
                  onClick={() => void copyEnv()}
                >
                  Copiar como .env
                </button>
                <button
                  type="button"
                  className="block w-full rounded px-2 py-1.5 text-left text-xs text-slate-800 hover:bg-sky-100"
                  onClick={downloadEnv}
                >
                  Descargar .env
                </button>
              </div>
            ) : null}
          </div>
          {editing ? (
            <>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void saveEdits()}
                className="inline-flex items-center gap-1 rounded-md border border-slate-950/40 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] disabled:opacity-60"
              >
                {busy === "bulk" ? "Guardando..." : "Guardar Cambios"}
              </button>
              <WinButton compact disabled={busy !== null} onClick={cancelEdit}>
                Cancelar
              </WinButton>
            </>
          ) : (
            <button
              type="button"
              disabled={variables === null || busy !== null}
              onClick={startEdit}
              className="inline-flex items-center gap-1 rounded-md border border-slate-950/40 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] disabled:opacity-60"
            >
              <Pencil className="size-3" aria-hidden />
              Edit
            </button>
          )}
        </div>
      </div>
      <form className="mb-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => void onSubmit(event)}>
        <input
          name="key"
          required
          placeholder="KEY"
          autoCapitalize="none"
          spellCheck={false}
          className="rounded-md border border-white/70 bg-white/80 px-2 py-1.5 font-mono text-sm text-slate-900"
        />
        <input
          name="value"
          type="password"
          required
          placeholder="Valor"
          autoComplete="new-password"
          spellCheck={false}
          className="rounded-md border border-white/70 bg-white/80 px-2 py-1.5 font-mono text-sm text-slate-900"
        />
        <WinButton type="submit" disabled={busy !== null}>
          {busy === "create" ? "Guardando..." : "Agregar"}
        </WinButton>
      </form>
      {variables === null ? (
        <p className="text-xs text-slate-600">Cargando variables...</p>
      ) : variables.length === 0 ? (
        <p className="text-xs text-slate-600">Este proyecto no tiene variables propias.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {variables.map((variable) => (
            <li
              key={variable.id}
              className="flex items-center gap-4 rounded-md border border-white/70 bg-white/60 p-2"
            >
              <span className="min-w-[260px] shrink-0 whitespace-nowrap font-mono text-xs font-semibold">
                {variable.key}
              </span>
              <input
                type={visible[variable.id] ? "text" : "password"}
                value={editing ? (drafts[variable.id] ?? variable.value) : variable.value}
                readOnly={!editing}
                aria-label={`Valor de ${variable.key}`}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [variable.id]: event.target.value }))
                }
                className="min-w-0 flex-1 rounded-md border border-white/70 bg-white/80 px-2 py-1.5 font-mono text-xs text-slate-900"
              />
              <button
                type="button"
                className="shrink-0 text-left text-xs text-slate-700 underline"
                onClick={() =>
                  setVisible((current) => ({ ...current, [variable.id]: !current[variable.id] }))
                }
              >
                {visible[variable.id] ? "Ocultar" : "Mostrar"}
              </button>
              <div className="flex shrink-0 gap-3">
                <button
                  type="button"
                  className="text-left text-xs text-rose-800 underline"
                  disabled={busy !== null}
                  onClick={() => void remove(variable)}
                >
                  {busy === `delete:${variable.id}` ? "Eliminando..." : "Eliminar"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

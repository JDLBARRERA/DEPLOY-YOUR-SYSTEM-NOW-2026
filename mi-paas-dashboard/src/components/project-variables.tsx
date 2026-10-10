"use client";

import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { WinButton } from "@/components/aero-window";
import { apiFetch } from "@/lib/api";

interface ProjectVariable {
  id: string;
  projectId: string;
  key: string;
  value: string;
}

export function ProjectVariables({ projectId }: { projectId: string }) {
  const [variables, setVariables] = useState<ProjectVariable[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);

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

  function draftValue(variable: ProjectVariable): string {
    return drafts[variable.id] ?? variable.value;
  }

  async function save(variable: ProjectVariable) {
    const value = draftValue(variable);
    setBusy(`save:${variable.id}`);
    try {
      const updated = await apiFetch<ProjectVariable>(
        `/projects/${encodeURIComponent(projectId)}/variables/${encodeURIComponent(variable.id)}`,
        { method: "PATCH", body: JSON.stringify({ value }) },
      );
      setVariables((current) =>
        current?.map((item) => (item.id === updated.id ? updated : item)) ?? [],
      );
      setDrafts((current) => {
        const next = { ...current };
        delete next[variable.id];
        return next;
      });
      toast.success(`${variable.key} actualizada`);
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

  return (
    <div className="mt-3 border-t border-white/60 pt-3">
      <h3 className="mb-1 text-xs font-semibold text-sky-950">Variables de entorno</h3>
      <p className="mb-2 text-xs text-slate-600">Se aplican en el próximo despliegue.</p>
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
              className="grid items-center gap-2 rounded-md border border-white/70 bg-white/60 p-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto_auto]"
            >
              <span className="truncate font-mono text-xs font-semibold">{variable.key}</span>
              <input
                type={visible[variable.id] ? "text" : "password"}
                value={draftValue(variable)}
                aria-label={`Valor de ${variable.key}`}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [variable.id]: event.target.value }))
                }
                className="rounded-md border border-white/70 bg-white/80 px-2 py-1.5 font-mono text-xs text-slate-900"
              />
              <button
                type="button"
                className="text-left text-xs text-slate-700 underline"
                onClick={() =>
                  setVisible((current) => ({ ...current, [variable.id]: !current[variable.id] }))
                }
              >
                {visible[variable.id] ? "Ocultar" : "Mostrar"}
              </button>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="text-left text-xs text-sky-800 underline"
                  disabled={busy !== null || draftValue(variable) === variable.value}
                  onClick={() => void save(variable)}
                >
                  {busy === `save:${variable.id}` ? "Guardando..." : "Guardar"}
                </button>
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

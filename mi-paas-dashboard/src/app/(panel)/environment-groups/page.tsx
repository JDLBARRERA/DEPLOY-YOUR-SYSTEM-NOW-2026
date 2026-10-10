"use client";

import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AeroWindow, WinButton, WinField } from "@/components/aero-window";
import { apiFetch } from "@/lib/api";

interface GroupVariable {
  id: string;
  key: string;
  value: string;
}

interface EnvironmentGroup {
  id: string;
  name: string;
  variables: GroupVariable[];
}

export default function EnvironmentGroupsPage() {
  const [groups, setGroups] = useState<EnvironmentGroup[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<EnvironmentGroup[]>("/environment-groups")
      .then((next) => {
        if (!cancelled) setGroups(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setGroups([]);
        toast.error(error instanceof Error ? error.message : "No se pudieron leer los grupos");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "");
    setBusy("create");
    try {
      const created = await apiFetch<EnvironmentGroup>("/environment-groups", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setGroups((current) =>
        [...(current ?? []), { ...created, variables: created.variables ?? [] }].sort((left, right) =>
          left.name.localeCompare(right.name),
        ),
      );
      form.reset();
      toast.success("Grupo creado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear el grupo");
    } finally {
      setBusy(null);
    }
  }

  async function removeGroup(group: EnvironmentGroup) {
    setBusy(group.id);
    try {
      await apiFetch(`/environment-groups/${encodeURIComponent(group.id)}`, { method: "DELETE" });
      setGroups((current) => current?.filter((item) => item.id !== group.id) ?? []);
      toast.success(`${group.name} eliminado`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar el grupo");
    } finally {
      setBusy(null);
    }
  }

  async function addVariable(group: EnvironmentGroup, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const key = String(data.get("key") ?? "");
    const value = String(data.get("value") ?? "");
    setBusy(`${group.id}:add`);
    try {
      const created = await apiFetch<GroupVariable>(
        `/environment-groups/${encodeURIComponent(group.id)}/variables`,
        { method: "POST", body: JSON.stringify({ key, value }) },
      );
      setGroups((current) =>
        current?.map((item) =>
          item.id === group.id
            ? {
                ...item,
                variables: [...item.variables, created].sort((left, right) =>
                  left.key.localeCompare(right.key),
                ),
              }
            : item,
        ) ?? current,
      );
      form.reset();
      toast.success("Variable guardada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la variable");
    } finally {
      setBusy(null);
    }
  }

  async function removeVariable(group: EnvironmentGroup, variable: GroupVariable) {
    setBusy(variable.id);
    try {
      await apiFetch(
        `/environment-groups/${encodeURIComponent(group.id)}/variables/${encodeURIComponent(variable.id)}`,
        { method: "DELETE" },
      );
      setGroups((current) =>
        current?.map((item) =>
          item.id === group.id
            ? { ...item, variables: item.variables.filter((row) => row.id !== variable.id) }
            : item,
        ) ?? current,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo quitar la variable");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AeroWindow title="Environment Groups" wide>
      <p className="mb-3 text-sm text-slate-600">
        Variables compartidas. Si un proyecto repite la misma clave, gana la del proyecto.
      </p>
      <form className="mb-4 flex items-end gap-2" onSubmit={(event) => void createGroup(event)}>
        <div className="min-w-0 flex-1">
          <WinField id="group-name" name="name" label="Nombre del grupo" required placeholder="tracker-shared-env" />
        </div>
        <WinButton type="submit" disabled={busy !== null}>
          {busy === "create" ? "Creando..." : "Crear grupo"}
        </WinButton>
      </form>
      {groups === null ? (
        <p className="text-sm">Cargando grupos...</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-slate-600">Todavía no hay grupos.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <section
              key={group.id}
              className="rounded-md border border-white/70 bg-white/50 p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="truncate font-mono text-sm font-semibold text-slate-900">{group.name}</h2>
                <WinButton compact disabled={busy !== null} onClick={() => void removeGroup(group)}>
                  {busy === group.id ? "Eliminando..." : "Eliminar"}
                </WinButton>
              </div>
              <form
                className="mb-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
                onSubmit={(event) => void addVariable(group, event)}
              >
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
                  placeholder="Valor"
                  autoComplete="new-password"
                  spellCheck={false}
                  className="rounded-md border border-white/70 bg-white/80 px-2 py-1.5 font-mono text-sm text-slate-900"
                />
                <WinButton type="submit" disabled={busy !== null}>
                  {busy === `${group.id}:add` ? "Guardando..." : "Agregar"}
                </WinButton>
              </form>
              {group.variables.length === 0 ? (
                <p className="text-xs text-slate-600">Este grupo no tiene variables.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {group.variables.map((variable) => (
                    <li
                      key={variable.id}
                      className="flex items-center gap-4 rounded-md border border-white/70 bg-white/60 p-2"
                    >
                      <span className="min-w-[180px] shrink-0 truncate font-mono text-xs font-semibold">
                        {variable.key}
                      </span>
                      <input
                        type="password"
                        readOnly
                        value={variable.value}
                        aria-label={`Valor de ${variable.key}`}
                        className="min-w-0 flex-1 rounded-md border border-white/70 bg-white/80 px-2 py-1.5 font-mono text-xs text-slate-900"
                      />
                      <WinButton
                        compact
                        disabled={busy !== null}
                        onClick={() => void removeVariable(group, variable)}
                      >
                        Quitar
                      </WinButton>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </AeroWindow>
  );
}

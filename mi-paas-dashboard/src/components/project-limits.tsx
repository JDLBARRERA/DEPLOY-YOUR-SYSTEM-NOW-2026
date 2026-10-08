"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { WinButton } from "@/components/aero-window";
import { apiFetch } from "@/lib/api";

export interface ProjectLimits {
  id: string;
  name: string;
  repoUrl: string;
  branch: string;
  memoryLimit: string;
  cpuLimit: number;
  hasGithubToken: boolean;
  githubToken: string;
  customDomain: string;
}

const MEMORY_OPTIONS = ["256m", "512m", "1g", "2g"];
const CPU_OPTIONS = [0.5, 1, 2];

export function ProjectLimitsCard() {
  const [projects, setProjects] = useState<ProjectLimits[] | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<ProjectLimits[]>("/projects")
      .then((next) => {
        if (!cancelled) {
          setProjects(
            next.map((project) => ({
              ...project,
              githubToken: "",
              customDomain: project.customDomain ?? "",
            })),
          );
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setProjects([]);
        toast.error(
          error instanceof Error ? error.message : "No se pudieron leer los proyectos",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function update(
    id: string,
    patch: Partial<
      Pick<ProjectLimits, "memoryLimit" | "cpuLimit" | "githubToken" | "hasGithubToken" | "customDomain">
    >,
  ) {
    setProjects((current) =>
      current?.map((project) => (project.id === id ? { ...project, ...patch } : project)) ?? current,
    );
  }

  async function clearToken(project: ProjectLimits) {
    setSavingId(project.id);
    try {
      const saved = await apiFetch<ProjectLimits>(`/projects/${encodeURIComponent(project.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ githubToken: "" }),
      });
      update(project.id, { ...saved, githubToken: "" });
      toast.success(`Token de ${project.name} eliminado`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo quitar el token");
    } finally {
      setSavingId(null);
    }
  }

  async function save(project: ProjectLimits) {
    setSavingId(project.id);
    try {
      const saved = await apiFetch<ProjectLimits>(`/projects/${encodeURIComponent(project.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          memoryLimit: project.memoryLimit,
          cpuLimit: Number(project.cpuLimit),
          customDomain: project.customDomain.trim(),
          ...(project.githubToken.trim() ? { githubToken: project.githubToken.trim() } : {}),
        }),
      });
      update(project.id, {
        ...saved,
        githubToken: "",
        customDomain: saved.customDomain ?? "",
      });
      toast.success(`Configuración de ${project.name} guardada`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron guardar los límites");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="rounded-xl border border-white/50 bg-white/35 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-sm">
      <h2 className="mb-1 text-sm font-semibold text-sky-950">Recursos por proyecto</h2>
      <p className="mb-3 text-xs text-slate-600">
        RAM y CPU que Docker aplica al crear el contenedor. Si no cambias nada, el tope es 256 MB y 0.5 CPU.
      </p>
      {projects === null ? (
        <p className="text-sm">Cargando proyectos...</p>
      ) : projects.length === 0 ? (
        <p className="text-sm text-slate-600">Todavía no hay proyectos para configurar.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {projects.map((project) => (
            <form
              key={project.id}
              className="flex flex-col gap-2 rounded-md border border-white/60 bg-white/50 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void save(project);
              }}
            >
              <div className="min-w-0 text-sm">
                <p className="truncate font-semibold">{project.name}</p>
                <p className="truncate text-xs text-slate-500">{project.repoUrl}</p>
              </div>
              <label className="flex flex-col gap-1 text-xs">
                Dominio personalizado
                <input
                  type="text"
                  name="customDomain"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={project.customDomain}
                  placeholder="app.cliente.com"
                  onChange={(event) => update(project.id, { customDomain: event.target.value })}
                  className="rounded-md border border-white/70 bg-white/80 px-2 py-1.5 font-mono text-sm text-slate-900"
                />
                <span className="text-[11px] text-slate-500">
                  Apunta ese dominio a este servidor. El subdominio del proyecto sigue activo y ambos llegan al mismo contenedor.
                </span>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                GitHub Access Token
                <input
                  type="password"
                  name="githubToken"
                  autoComplete="new-password"
                  spellCheck={false}
                  value={project.githubToken}
                  placeholder={
                    project.hasGithubToken ? "Token guardado. Escribe otro para reemplazarlo." : "ghp_…"
                  }
                  onChange={(event) => update(project.id, { githubToken: event.target.value })}
                  className="rounded-md border border-white/70 bg-white/80 px-2 py-1.5 font-mono text-sm text-slate-900"
                />
              </label>
              <div className="grid items-end gap-2 sm:grid-cols-[8rem_8rem_auto_auto]">
              <label className="flex flex-col gap-1 text-xs">
                RAM
                <select
                  value={project.memoryLimit}
                  onChange={(event) => update(project.id, { memoryLimit: event.target.value })}
                  className="rounded-md border border-white/70 bg-white/80 px-2 py-1.5 text-sm text-slate-900"
                >
                  {memoryOptions(project.memoryLimit).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                CPU
                <select
                  value={String(project.cpuLimit)}
                  onChange={(event) => update(project.id, { cpuLimit: Number(event.target.value) })}
                  className="rounded-md border border-white/70 bg-white/80 px-2 py-1.5 text-sm text-slate-900"
                >
                  {cpuOptions(project.cpuLimit).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              {project.hasGithubToken ? (
                <button
                  type="button"
                  className="text-left text-xs text-sky-800 underline"
                  disabled={savingId === project.id}
                  onClick={() => void clearToken(project)}
                >
                  Quitar token
                </button>
              ) : (
                <span />
              )}
              <WinButton type="submit" disabled={savingId === project.id}>
                {savingId === project.id ? "Guardando..." : "Guardar"}
              </WinButton>
              </div>
            </form>
          ))}
        </div>
      )}
    </section>
  );
}

function memoryOptions(current: string): string[] {
  return MEMORY_OPTIONS.includes(current) ? MEMORY_OPTIONS : [current, ...MEMORY_OPTIONS];
}

function cpuOptions(current: number): number[] {
  return CPU_OPTIONS.includes(current) ? CPU_OPTIONS : [current, ...CPU_OPTIONS];
}

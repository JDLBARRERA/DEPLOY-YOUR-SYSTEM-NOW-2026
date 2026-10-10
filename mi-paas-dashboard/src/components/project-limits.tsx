"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { WinButton } from "@/components/aero-window";
import { ProjectAddons } from "@/components/project-addons";
import { ProjectVariables } from "@/components/project-variables";
import { ServiceTypeField, ServiceTypeMark, serviceTypeOf, type ServiceType } from "@/components/service-type-field";
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
  serviceType: ServiceType;
}

const MEMORY_OPTIONS = ["256m", "512m", "1g", "2g"];
const CPU_OPTIONS = [0.5, 1, 2];

export function ProjectLimitsCard() {
  const [projects, setProjects] = useState<ProjectLimits[] | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
              serviceType: serviceTypeOf(project.serviceType),
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
      Pick<ProjectLimits, "memoryLimit" | "cpuLimit" | "githubToken" | "hasGithubToken" | "customDomain" | "serviceType">
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

  async function remove(project: ProjectLimits) {
    if (confirmDeleteId !== project.id) {
      setConfirmDeleteId(project.id);
      return;
    }
    setConfirmDeleteId(null);
    setSavingId(project.id);
    try {
      await apiFetch(`/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" });
      setProjects((current) => current?.filter((item) => item.id !== project.id) ?? []);
      setOpenId((current) => (current === project.id ? null : current));
      toast.success(`${project.name} eliminado`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar el proyecto");
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
          serviceType: project.serviceType,
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
            <div
              key={project.id}
              className="rounded-md border border-sky-200/80 bg-white/70 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]"
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  className="min-w-0 text-left"
                  onClick={() =>
                    setOpenId((current) => (current === project.id ? null : project.id))
                  }
                >
                  <p className="truncate text-sm font-semibold">
                    {project.name}
                    <ServiceTypeMark serviceType={project.serviceType} />
                  </p>
                  <p className="break-all font-mono text-xs text-slate-500">{project.repoUrl}</p>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="text-xs text-sky-800 underline"
                    onClick={() =>
                      setOpenId((current) => (current === project.id ? null : project.id))
                    }
                  >
                    {openId === project.id ? "Ocultar" : "Configurar"}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-rose-900/40 bg-gradient-to-b from-rose-200 to-rose-500 px-2 py-1 text-xs font-semibold text-rose-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] disabled:opacity-60"
                    disabled={savingId === project.id}
                    onClick={() => void remove(project)}
                  >
                    {savingId === project.id
                      ? "Eliminando..."
                      : confirmDeleteId === project.id
                        ? "Sí, eliminar"
                        : "Eliminar Proyecto"}
                  </button>
                </div>
              </div>
              <ProjectUsage projectId={project.id} />
            {openId === project.id ? (
            <>
            <form
              className="mt-3 flex flex-col gap-2 border-t border-sky-100 pt-3"
              onSubmit={(event) => {
                event.preventDefault();
                void save(project);
              }}
            >
              <ServiceTypeField
                value={project.serviceType}
                onChange={(serviceType) => update(project.id, { serviceType })}
              />
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
            <ProjectVariables projectId={project.id} />
            <ProjectAddons projectId={project.id} projectName={project.name} />
            </>
            ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

interface ProjectMetrics {
  active: boolean;
  cpu: number;
  ramUsed: number;
  ramLimit: number;
  net: string;
  disk: string;
}

const INACTIVE_METRICS: ProjectMetrics = {
  active: false,
  cpu: 0,
  ramUsed: 0,
  ramLimit: 0,
  net: "0B / 0B",
  disk: "0B / 0B",
};

function ProjectUsage({ projectId }: { projectId: string }) {
  const [metrics, setMetrics] = useState<ProjectMetrics>(INACTIVE_METRICS);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void apiFetch<ProjectMetrics>(`/projects/${encodeURIComponent(projectId)}/metrics`)
        .then((next) => {
          if (!cancelled) setMetrics(next);
        })
        .catch(() => {
          if (!cancelled) setMetrics(INACTIVE_METRICS);
        });
    };
    load();
    const timer = window.setInterval(load, 7000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [projectId]);

  const ramPercent =
    metrics.ramLimit > 0 ? Math.min(100, (metrics.ramUsed / metrics.ramLimit) * 100) : 0;

  return (
    <div className="mt-3 border-t border-sky-100 pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-sky-950">Consumo de recursos</h3>
        <span className="text-[11px] text-slate-500">{metrics.active ? "En marcha" : "Inactivo"}</span>
      </div>
      <div className="flex flex-col gap-2">
        <UsageBar label="CPU" percent={metrics.cpu} detail={`${metrics.cpu.toFixed(1)}%`} />
        <UsageBar
          label="RAM"
          percent={ramPercent}
          detail={`${formatBytes(metrics.ramUsed)} / ${formatBytes(metrics.ramLimit)}`}
        />
        <p className="text-[11px] text-slate-600">Red: {metrics.net}</p>
        <p className="text-[11px] text-slate-600">Disco: {metrics.disk}</p>
      </div>
    </div>
  );
}

function UsageBar({
  label,
  percent,
  detail,
}: {
  label: string;
  percent: number;
  detail: string;
}) {
  const width = Math.max(0, Math.min(100, percent));
  return (
    <div>
      <div className="mb-0.5 flex justify-between gap-2 text-[11px] text-slate-700">
        <span>{label}</span>
        <span className="font-mono">{detail}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-sky-600" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const digits = value >= 10 || index === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[index]}`;
}

function memoryOptions(current: string): string[] {
  return MEMORY_OPTIONS.includes(current) ? MEMORY_OPTIONS : [current, ...MEMORY_OPTIONS];
}

function cpuOptions(current: number): number[] {
  return CPU_OPTIONS.includes(current) ? CPU_OPTIONS : [current, ...CPU_OPTIONS];
}

"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AeroWindow, WinButton } from "@/components/aero-window";
import { ProjectLimitsCard } from "@/components/project-limits";
import { apiFetch, type EnvPair, type PanelSettings } from "@/lib/api";

const emptySettings = (): PanelSettings => ({
  githubPat: "",
  adminPassword: "",
  domain: "deplowe-now.com",
  dropletIp: "",
  caddySslEnabled: true,
  caddyStatus: "unknown",
  globalEnv: [],
  updatedAt: "",
});

export default function SettingsPage() {
  const [settings, setSettings] = useState<PanelSettings | null>(null);
  const [pending, setPending] = useState(false);
  const [showPat, setShowPat] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminConfirm, setAdminConfirm] = useState("");

  useEffect(() => {
    let cancelled = false;
    void apiFetch<PanelSettings>("/settings")
      .then((next) => {
        if (cancelled) return;
        setSettings(next);
        setAdminConfirm(next.adminPassword);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSettings(emptySettings());
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo cargar la configuración",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function update<K extends keyof PanelSettings>(key: K, value: PanelSettings[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function updateEnvRow(index: number, field: keyof EnvPair, value: string) {
    setSettings((prev) => {
      if (!prev) return prev;
      const globalEnv = prev.globalEnv.map((row, i) =>
        i === index ? { ...row, [field]: value } : row,
      );
      return { ...prev, globalEnv };
    });
  }

  function addEnvRow() {
    setSettings((prev) =>
      prev
        ? { ...prev, globalEnv: [...prev.globalEnv, { key: "", value: "" }] }
        : prev,
    );
  }

  function removeEnvRow(index: number) {
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            globalEnv: prev.globalEnv.filter((_, i) => i !== index),
          }
        : prev,
    );
  }

  async function onSave() {
    if (!settings) return;
    if (
      settings.adminPassword &&
      adminConfirm &&
      settings.adminPassword !== adminConfirm
    ) {
      toast.error("La confirmación de ADMIN_PASSWORD no coincide");
      return;
    }
    setPending(true);
    try {
      const saved = await apiFetch<PanelSettings>("/settings", {
        method: "PUT",
        body: JSON.stringify({
          githubPat: settings.githubPat,
          adminPassword: settings.adminPassword,
          domain: settings.domain,
          dropletIp: settings.dropletIp,
          caddySslEnabled: settings.caddySslEnabled,
          caddyStatus: settings.caddyStatus,
          globalEnv: settings.globalEnv,
        }),
      });
      setSettings(saved);
      setAdminConfirm(saved.adminPassword);
      toast.success("Configuración guardada correctamente");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo guardar la configuración",
      );
    } finally {
      setPending(false);
    }
  }

  if (!settings) {
    return (
      <AeroWindow title="Settings" wide>
        <p className="text-sm">Cargando configuración...</p>
      </AeroWindow>
    );
  }

  return (
    <AeroWindow title="Settings" wide>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Configuración del Control Plane</h1>
          <p className="mt-1 text-sm text-slate-600">
            Persistencia local en el store file (dev.db). Los secretos también se
            sincronizan a <code className="font-mono">.env.local</code>.
          </p>
        </div>
        <WinButton disabled={pending} onClick={() => void onSave()}>
          {pending ? "Guardando..." : "Guardar todo"}
        </WinButton>
      </div>

      <div className="flex flex-col gap-3">
        <SettingsCard title="Integración con GitHub">
          <p className="mb-3 text-xs text-slate-600">
            Personal Access Token para clonar repos privados en el motor.
          </p>
          <label className="flex flex-col gap-1 text-sm">
            GITHUB_PAT
            <div className="flex items-center gap-2">
              <input
                type={showPat ? "text" : "password"}
                value={settings.githubPat}
                onChange={(event) => update("githubPat", event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-md border border-white/70 bg-white/80 px-2 py-1.5 font-mono text-xs text-slate-900 shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)] outline-none"
                placeholder="ghp_…"
              />
              <WinButton
                compact
                onClick={() => setShowPat((value) => !value)}
              >
                <span className="inline-flex items-center gap-1">
                  {showPat ? (
                    <EyeOff className="size-3" aria-hidden />
                  ) : (
                    <Eye className="size-3" aria-hidden />
                  )}
                  {showPat ? "Ocultar" : "Mostrar"}
                </span>
              </WinButton>
            </div>
          </label>
        </SettingsCard>

        <SettingsCard title="Seguridad del Control Plane">
          <p className="mb-3 text-xs text-slate-600">
            Contraseña de administración del panel (
            <code className="font-mono">ADMIN_PASSWORD</code>).
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Nueva contraseña
              <div className="flex items-center gap-2">
                <input
                  type={showAdmin ? "text" : "password"}
                  value={settings.adminPassword}
                  onChange={(event) =>
                    update("adminPassword", event.target.value)
                  }
                  autoComplete="new-password"
                  className="min-w-0 flex-1 rounded-md border border-white/70 bg-white/80 px-2 py-1.5 text-slate-900 shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)] outline-none"
                />
                <WinButton
                  compact
                  onClick={() => setShowAdmin((value) => !value)}
                >
                  {showAdmin ? (
                    <EyeOff className="size-3" aria-hidden />
                  ) : (
                    <Eye className="size-3" aria-hidden />
                  )}
                </WinButton>
              </div>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Confirmar contraseña
              <input
                type={showAdmin ? "text" : "password"}
                value={adminConfirm}
                onChange={(event) => setAdminConfirm(event.target.value)}
                autoComplete="new-password"
                className="rounded-md border border-white/70 bg-white/80 px-2 py-1.5 text-slate-900 shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)] outline-none"
              />
            </label>
          </div>
        </SettingsCard>

        <SettingsCard title="Parámetros del Servidor">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Dominio principal
              <input
                type="text"
                value={settings.domain}
                onChange={(event) => update("domain", event.target.value)}
                placeholder="deplowe-now.com"
                className="rounded-md border border-white/70 bg-white/80 px-2 py-1.5 font-mono text-sm text-slate-900 shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)] outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              IP del Droplet (DigitalOcean)
              <input
                type="text"
                value={settings.dropletIp}
                onChange={(event) => update("dropletIp", event.target.value)}
                placeholder="46.101.84.190"
                className="rounded-md border border-white/70 bg-white/80 px-2 py-1.5 font-mono text-sm text-slate-900 shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)] outline-none"
              />
            </label>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 rounded-lg border border-white/60 bg-white/50 px-3 py-2 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
              <input
                type="checkbox"
                checked={settings.caddySslEnabled}
                onChange={(event) =>
                  update("caddySslEnabled", event.target.checked)
                }
                className="accent-sky-700"
              />
              Puerto SSL / HTTPS (Caddy)
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Estado Reverse Proxy (Caddy)
              <select
                value={settings.caddyStatus}
                onChange={(event) =>
                  update(
                    "caddyStatus",
                    event.target.value as PanelSettings["caddyStatus"],
                  )
                }
                className="rounded-md border border-white/70 bg-white/80 px-2 py-1.5 text-slate-900 shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)] outline-none"
              >
                <option value="unknown">Desconocido</option>
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
              </select>
            </label>
          </div>
          <p className="mt-2 text-xs text-slate-600">
            Referencia:{" "}
            <code className="font-mono">
              https://{settings.domain || "deplowe-now.com"}
            </code>{" "}
            → Droplet{" "}
            <code className="font-mono">{settings.dropletIp || "—"}</code>
            {settings.caddySslEnabled ? " · SSL on" : " · SSL off"}
          </p>
        </SettingsCard>

        <SettingsCard title="Variables Globales de Entorno">
          <p className="mb-3 text-xs text-slate-600">
            Pares clave-valor inyectados automáticamente en todos los proyectos
            desplegados (store local).
          </p>
          <div className="flex flex-col gap-2">
            {settings.globalEnv.length === 0 ? (
              <p className="text-sm text-slate-500">
                No hay variables. Añade la primera.
              </p>
            ) : (
              settings.globalEnv.map((row, index) => (
                <div
                  key={`env-${index}`}
                  className="grid grid-cols-[1fr_1fr_auto] items-center gap-2"
                >
                  <input
                    type="text"
                    value={row.key}
                    onChange={(event) =>
                      updateEnvRow(index, "key", event.target.value)
                    }
                    placeholder="KEY"
                    spellCheck={false}
                    className="rounded-md border border-white/70 bg-white/80 px-2 py-1.5 font-mono text-xs text-slate-900 shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)] outline-none"
                  />
                  <input
                    type="text"
                    value={row.value}
                    onChange={(event) =>
                      updateEnvRow(index, "value", event.target.value)
                    }
                    placeholder="value"
                    spellCheck={false}
                    className="rounded-md border border-white/70 bg-white/80 px-2 py-1.5 font-mono text-xs text-slate-900 shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)] outline-none"
                  />
                  <WinButton compact onClick={() => removeEnvRow(index)}>
                    <Trash2 className="size-3" aria-hidden />
                  </WinButton>
                </div>
              ))
            )}
          </div>
          <div className="mt-3">
            <WinButton compact onClick={addEnvRow}>
              <span className="inline-flex items-center gap-1">
                <Plus className="size-3" aria-hidden />
                Añadir variable
              </span>
            </WinButton>
          </div>
        </SettingsCard>

        <ProjectLimitsCard />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/50 pt-3">
        <p className="text-xs text-slate-500">
          {settings.updatedAt
            ? `Última guardada: ${new Date(settings.updatedAt).toLocaleString("es-MX")}`
            : "Sin guardar aún"}
        </p>
        <WinButton disabled={pending} onClick={() => void onSave()}>
          {pending ? "Guardando..." : "Guardar configuración"}
        </WinButton>
      </div>
    </AeroWindow>
  );
}

function SettingsCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/50 bg-white/35 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-sm">
      <h2 className="mb-1 text-sm font-semibold text-sky-950">{title}</h2>
      {children}
    </section>
  );
}

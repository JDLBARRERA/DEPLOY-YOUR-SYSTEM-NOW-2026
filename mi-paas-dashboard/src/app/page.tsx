"use client";

import { useEffect, useState } from "react";
import { Activity, Database, Rocket } from "lucide-react";
import { AeroWindow } from "@/components/aero-window";
import { apiFetch, type Database as ManagedDatabase, type Deployment } from "@/lib/api";

export default function OverviewPage() {
  const [deployments, setDeployments] = useState<Deployment[] | null>(null);
  const [databases, setDatabases] = useState<ManagedDatabase[] | null>(null);
  const [apiUp, setApiUp] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [nextDeployments, nextDatabases] = await Promise.all([
          apiFetch<Deployment[]>("/deployments"),
          apiFetch<ManagedDatabase[]>("/databases"),
        ]);
        if (cancelled) return;
        setDeployments(nextDeployments);
        setDatabases(nextDatabases);
        setApiUp(true);
      } catch {
        if (cancelled) return;
        setDeployments([]);
        setDatabases([]);
        setApiUp(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = deployments === null || databases === null;
  const running = deployments?.filter((item) => item.status === "running").length ?? 0;

  return (
    <AeroWindow title="Overview">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Estado del motor</h1>
          <p className="text-sm text-slate-600">
            Respuesta de /backend/deployments y /backend/databases.
          </p>
        </div>
        <p className="text-sm">
          {apiUp === null ? "Comprobando..." : apiUp ? "API en línea" : "API sin respuesta"}
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <Metric
            icon={<Rocket className="size-4" />}
            label="Total Deployments"
            value={loading ? "..." : String(deployments.length)}
          />
          <Metric
            icon={<Activity className="size-4" />}
            label='Deployments "running"'
            value={loading ? "..." : String(running)}
          />
          <Metric
            icon={<Database className="size-4" />}
            label="Total Databases"
            value={loading ? "..." : String(databases.length)}
          />
        </div>
      </div>
    </AeroWindow>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-white/60 bg-gradient-to-b from-white/80 to-white/40 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
      <p className="flex items-center gap-2 text-xs text-slate-600">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-3xl font-semibold">{value}</p>
    </div>
  );
}

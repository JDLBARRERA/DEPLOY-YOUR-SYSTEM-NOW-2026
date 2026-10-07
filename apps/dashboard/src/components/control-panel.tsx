"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { Loader2 } from "lucide-react";
import { cn } from "cn";
import { signOutUser } from "@/app/actions/auth";
import { listDatabases, type DatabaseView } from "@/app/actions/databases";
import { startDeploy } from "@/app/actions/deploy";
import { DatabasesPanel } from "@/components/databases-panel";
import { ProjectDeploymentsPanel } from "@/components/project-deployments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const FAST_POLL_MS = 2000;
const SLOW_POLL_MS = 10000;

interface Deployment {
  projectId: string;
  projectName: string;
  repoUrl: string;
  image: string;
  port: number | null;
  status: string;
  host: string;
  url: string;
  createdAt: string;
}

function UsageMeter({
  label,
  text,
  percent,
}: {
  label: string;
  text: string;
  percent: number;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border px-3 py-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{text}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function isActiveStatus(status: string) {
  return status === "building" || status === "queued";
}

function StatusPill({ status }: { status: string }) {
  if (status === "building" || status === "queued") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-amber-300/80 bg-gradient-to-r from-amber-100 to-sky-200 px-2 py-0.5 text-xs font-medium text-amber-950 animate-pulse",
        )}
      >
        <Loader2 className="size-3 animate-spin" aria-hidden />
        {status}
      </span>
    );
  }

  if (status === "failed") {
    return <Badge variant="destructive">{status}</Badge>;
  }

  if (status === "running") {
    return <Badge variant="default">{status}</Badge>;
  }

  return <Badge variant="secondary">{status}</Badge>;
}

export function ControlPanel({ userLabel }: { userLabel: string }) {
  const [repoUrl, setRepoUrl] = useState("");
  const [projectName, setProjectName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [stats, setStats] = useState<{ cpu: number | null; memoryMb: number | null } | null>(
    null,
  );
  const [tab, setTab] = useState<"deploys" | "databases">("deploys");
  const [databases, setDatabases] = useState<DatabaseView[]>([]);
  const [databaseId, setDatabaseId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [pollMs, setPollMs] = useState(FAST_POLL_MS);
  const deploymentsRef = useRef(deployments);
  deploymentsRef.current = deployments;

  const loadDeployments = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/deployments`);
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as Deployment[];
      setDeployments((current) => mergeDeployments(current, data));
    } catch {
      // The API may still be starting; the next poll retries.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      if (cancelled) return;
      await loadDeployments();
      if (cancelled) return;
      const active = deploymentsRef.current.some((item) => isActiveStatus(item.status));
      const nextMs = active || deploymentsRef.current.length === 0 ? FAST_POLL_MS : SLOW_POLL_MS;
      setPollMs(nextMs);
      timer = setTimeout(() => {
        void tick();
      }, nextMs);
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [loadDeployments]);

  useEffect(() => {
    void listDatabases().then((result) => {
      setDatabases(result.databases ?? []);
    });
  }, [tab]);

  useEffect(() => {
    if (!createOpen) {
      setModalVisible(false);
      return;
    }
    const id = requestAnimationFrame(() => setModalVisible(true));
    return () => cancelAnimationFrame(id);
  }, [createOpen]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }

    setLogs([]);
    const source = new EventSource(`${apiUrl}/deployments/${selectedId}/logs`);
    source.onmessage = (event: MessageEvent<string>) => {
      const line = JSON.parse(event.data) as string;
      setLogs((current) => [...current, line]);
    };

    return () => {
      source.close();
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setStats(null);
      return;
    }

    setStats(null);
    const source = new EventSource(`${apiUrl}/deployments/${selectedId}/stats`);
    source.onmessage = (event: MessageEvent<string>) => {
      const next = JSON.parse(event.data) as { cpu: number | null; memoryMb: number | null };
      setStats(next);
    };

    return () => {
      source.close();
    };
  }, [selectedId]);

  function closeCreateModal() {
    setModalVisible(false);
    window.setTimeout(() => setCreateOpen(false), 180);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    const optimisticId = `pending-${Date.now()}`;
    const optimistic: Deployment = {
      projectId: optimisticId,
      projectName,
      repoUrl,
      image: projectName,
      port: null,
      status: "building",
      host: "",
      url: "",
      createdAt: new Date().toISOString(),
    };

    setDeployments((current) => [optimistic, ...current]);
    setSelectedId(optimisticId);
    closeCreateModal();

    try {
      const data = await startDeploy(repoUrl, projectName, databaseId || undefined);
      if (!data.projectId) {
        setDeployments((current) => current.filter((item) => item.projectId !== optimisticId));
        setSelectedId(null);
        setError(data.error ?? "No se pudo encolar el despliegue");
        setCreateOpen(true);
        return;
      }

      setDeployments((current) =>
        current.map((item) =>
          item.projectId === optimisticId
            ? { ...item, projectId: data.projectId!, status: "building" }
            : item,
        ),
      );
      setSelectedId(data.projectId);
      setRepoUrl("");
      setProjectName("");
      setDatabaseId("");
      void loadDeployments();
    } catch {
      setDeployments((current) => current.filter((item) => item.projectId !== optimisticId));
      setSelectedId(null);
      setError("La API no respondió");
      setCreateOpen(true);
    } finally {
      setSubmitting(false);
    }
  }

  const selected = deployments.find((item) => item.projectId === selectedId);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Image
            src="/logo.jpg"
            alt="Deploy your system"
            width={72}
            height={72}
            priority
            className="size-16 rounded-2xl"
          />
          <div>
            <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
              Control plane
            </p>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">
              Deploy your system
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {userLabel ? (
            <span className="text-sm text-muted-foreground">{userLabel}</span>
          ) : null}
          <form action={signOutUser}>
            <Button type="submit" variant="outline">
              Salir
            </Button>
          </form>
          <Badge variant="outline">{deployments.length} proyectos</Badge>
        </div>
      </header>

      <div className="flex gap-2">
        <Button
          type="button"
          variant={tab === "deploys" ? "default" : "outline"}
          onClick={() => setTab("deploys")}
        >
          Despliegues
        </Button>
        <Button
          type="button"
          variant={tab === "databases" ? "default" : "outline"}
          onClick={() => setTab("databases")}
        >
          Databases
        </Button>
      </div>

      {tab === "databases" ? (
        <DatabasesPanel
          onChange={() => {
            void listDatabases().then((result) => {
              setDatabases(result.databases ?? []);
            });
          }}
        />
      ) : null}

      {tab === "deploys" ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Elige un proyecto para ver la consola de construcción.
            </p>
            <Button type="button" onClick={() => setCreateOpen(true)}>
              Nuevo Despliegue
            </Button>
          </div>

          <Card className="animate-in fade-in duration-300">
            <CardHeader>
              <CardTitle>Contenedores</CardTitle>
              <CardDescription>
                Polling cada {pollMs / 1000}s
                {deployments.some((item) => isActiveStatus(item.status))
                  ? " mientras hay builds activos"
                  : " en reposo"}
                .
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {deployments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Todavía no hay despliegues.</p>
              ) : (
                deployments.map((deployment) => (
                  <button
                    key={deployment.projectId}
                    type="button"
                    onClick={() => setSelectedId(deployment.projectId)}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-all duration-300 animate-in fade-in slide-in-from-top-2",
                      selectedId === deployment.projectId
                        ? "border-ring bg-muted"
                        : "border-border hover:bg-muted/40",
                    )}
                  >
                    <span>
                      <span className="block font-medium">
                        {deployment.projectName || deployment.image}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {deployment.port ? `puerto ${deployment.port}` : deployment.repoUrl}
                      </span>
                    </span>
                    <StatusPill status={deployment.status} />
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "deploys" ? <ProjectDeploymentsPanel /> : null}

      {tab === "deploys" ? (
        <Card
          className={cn(
            "transition-all duration-300",
            selectedId ? "animate-in fade-in slide-in-from-bottom-2" : "",
          )}
        >
          <CardHeader>
            <CardTitle>Consola / Logs</CardTitle>
            <CardDescription>
              {selected ? (
                selected.url ? (
                  <a className="underline" href={selected.url}>
                    {selected.url}
                  </a>
                ) : (
                  `${selected.projectName || selected.image} · ${selected.status}`
                )
              ) : (
                "Selecciona un despliegue para seguir los logs."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <UsageMeter
                label="CPU"
                text={stats?.cpu == null ? "sin contenedor" : `${stats.cpu.toFixed(1)}%`}
                percent={stats?.cpu == null ? 0 : Math.min(100, stats.cpu)}
              />
              <UsageMeter
                label="RAM"
                text={
                  stats?.memoryMb == null ? "sin contenedor" : `${stats.memoryMb.toFixed(1)} MB`
                }
                percent={stats?.memoryMb == null ? 0 : Math.min(100, stats.memoryMb)}
              />
            </div>
            <ScrollArea className="h-80 rounded-lg bg-zinc-950 text-zinc-100">
              <pre className="p-4 font-mono text-xs leading-5 whitespace-pre-wrap">
                {logs.length > 0 ? logs.join("\n") : "Sin salida todavía."}
              </pre>
            </ScrollArea>
          </CardContent>
        </Card>
      ) : null}

      {createOpen ? (
        <div
          className={cn(
            "fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 transition-opacity duration-200",
            modalVisible ? "opacity-100" : "opacity-0",
          )}
        >
          <button
            type="button"
            aria-label="Cerrar"
            className="absolute inset-0"
            onClick={closeCreateModal}
          />
          <Card
            className={cn(
              "relative z-10 w-full max-w-md transition-all duration-200",
              modalVisible
                ? "translate-y-0 opacity-100"
                : "-translate-y-3 opacity-0",
            )}
          >
            <CardHeader>
              <CardTitle>Nuevo Despliegue</CardTitle>
              <CardDescription>
                Pega un repositorio público de GitHub. El build entra en cola y abre los logs al
                instante.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-3" onSubmit={onSubmit}>
                <label className="flex flex-col gap-1.5 text-sm">
                  URL del repositorio
                  <Input
                    value={repoUrl}
                    onChange={(event) => setRepoUrl(event.target.value)}
                    placeholder="https://github.com/owner/repo"
                    required
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  Nombre del proyecto
                  <Input
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    placeholder="mi-app"
                    required
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  Base de datos
                  <select
                    className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                    value={databaseId}
                    onChange={(event) => setDatabaseId(event.target.value)}
                  >
                    <option value="">Sin base de datos</option>
                    {databases.map((database) => (
                      <option key={database.id} value={database.id}>
                        {database.name}
                      </option>
                    ))}
                  </select>
                </label>
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={closeCreateModal}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Creando..." : "Crear"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </main>
  );
}

function mergeDeployments(current: Deployment[], next: Deployment[]): Deployment[] {
  const byId = new Map(next.map((item) => [item.projectId, item]));
  const pending = current.filter(
    (item) => item.projectId.startsWith("pending-") && !byId.has(item.projectId),
  );
  return [...pending, ...next];
}

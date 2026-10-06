"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
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

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "running") {
    return "default";
  }
  if (status === "failed") {
    return "destructive";
  }
  return "secondary";
}

export function ControlPanel({ userLabel }: { userLabel: string }) {
  const [repoUrl, setRepoUrl] = useState("");
  const [projectName, setProjectName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [tab, setTab] = useState<"deploys" | "databases">("deploys");
  const [databases, setDatabases] = useState<DatabaseView[]>([]);
  const [databaseId, setDatabaseId] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(`${apiUrl}/deployments`);
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as Deployment[];
        if (!cancelled) {
          setDeployments(data);
        }
      } catch {
        // The API may still be starting; the next poll retries.
      }
    }

    void load();
    const timer = setInterval(() => {
      void load();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    void listDatabases().then((result) => {
      setDatabases(result.databases ?? []);
    });
  }, [tab]);

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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const data = await startDeploy(repoUrl, projectName, databaseId || undefined);
      if (!data.projectId) {
        setError(data.error ?? "No se pudo encolar el despliegue");
        return;
      }

      setSelectedId(data.projectId);
      setRepoUrl("");
      setProjectName("");
    } catch {
      setError("La API no respondió");
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
      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Nuevo despliegue</CardTitle>
            <CardDescription>
              Pega un repositorio público de GitHub. El build entra en cola y no bloquea el panel.
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
              <Button type="submit" disabled={submitting}>
                {submitting ? "Encolando..." : "Deploy"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contenedores</CardTitle>
            <CardDescription>
              Elige un proyecto para ver la consola de construcción.
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
                  className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left ${
                    selectedId === deployment.projectId
                      ? "border-ring bg-muted"
                      : "border-border"
                  }`}
                >
                  <span>
                    <span className="block font-medium">{deployment.image}</span>
                    <span className="block text-xs text-muted-foreground">
                      {deployment.port ? `puerto ${deployment.port}` : deployment.repoUrl}
                    </span>
                  </span>
                  <Badge variant={statusVariant(deployment.status)}>
                    {deployment.status}
                  </Badge>
                </button>
              ))
            )}
          </CardContent>
        </Card>
      </div>
      ) : null}

      {tab === "deploys" ? <ProjectDeploymentsPanel /> : null}

      {tab === "deploys" ? (
      <Card>
        <CardHeader>
          <CardTitle>Consola</CardTitle>
          <CardDescription>
            {selected ? (
              <a className="underline" href={selected.url}>
                {selected.url}
              </a>
            ) : (
              "Selecciona un despliegue para seguir los logs."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-80 rounded-lg bg-zinc-950 text-zinc-100">
            <pre className="p-4 font-mono text-xs leading-5 whitespace-pre-wrap">
              {logs.length > 0 ? logs.join("\n") : "Sin salida todavía."}
            </pre>
          </ScrollArea>
        </CardContent>
      </Card>
      ) : null}
    </main>
  );
}

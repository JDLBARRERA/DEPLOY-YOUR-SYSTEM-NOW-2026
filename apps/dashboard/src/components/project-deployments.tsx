"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { deleteProjectEnvVar, saveProjectEnvVar } from "@/app/actions/env";
import {
  listProjectDeployments,
  type DeploymentView,
  type EnvVarView,
  type ProjectDeployments,
} from "@/app/actions/projects";
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

const SCOPES = ["ALL", "PRODUCTION", "PREVIEW"] as const;

const scopeLabel: Record<(typeof SCOPES)[number], string> = {
  ALL: "All",
  PRODUCTION: "Production",
  PREVIEW: "Preview",
};

function statusBadge(status: string): {
  label: string;
  variant: "default" | "secondary" | "destructive";
} {
  if (status === "running") {
    return { label: "Ready", variant: "default" };
  }
  if (status === "failed") {
    return { label: "Failed", variant: "destructive" };
  }
  return { label: "Building", variant: "secondary" };
}

function ProjectEnvEditor({
  projectId,
  variables,
}: {
  projectId: string;
  variables: EnvVarView[];
}) {
  const [keyName, setKeyName] = useState("");
  const [value, setValue] = useState("");
  const [environment, setEnvironment] = useState<(typeof SCOPES)[number]>("ALL");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const result = await saveProjectEnvVar({
      projectId,
      key: keyName,
      value,
      environment,
    });
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setKeyName("");
    setValue("");
  }

  async function onDelete(id: string) {
    setError("");
    const result = await deleteProjectEnvVar({ projectId, id });
    if (result.error) {
      setError(result.error);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border px-3 py-3">
      <p className="text-sm font-medium">Variables</p>
      {variables.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin variables todavía.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {variables.map((variable) => (
            <li key={variable.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{variable.key}</span>
                <span className="text-muted-foreground"> = {variable.value}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge variant="outline">{scopeLabel[variable.environment]}</Badge>
                <Button type="button" variant="outline" onClick={() => void onDelete(variable.id)}>
                  Quitar
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => void onSave(event)}>
        <label className="flex min-w-32 flex-1 flex-col gap-1 text-xs">
          Clave
          <Input
            value={keyName}
            onChange={(event) => setKeyName(event.target.value)}
            placeholder="API_URL"
            required
          />
        </label>
        <label className="flex min-w-40 flex-[2] flex-col gap-1 text-xs">
          Valor
          <Input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="https://api.ejemplo"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Ámbito
          <select
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            value={environment}
            onChange={(event) => setEnvironment(event.target.value as (typeof SCOPES)[number])}
          >
            {SCOPES.map((scope) => (
              <option key={scope} value={scope}>
                {scopeLabel[scope]}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando..." : "Guardar"}
        </Button>
      </form>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function DeploymentRow({ deployment }: { deployment: DeploymentView }) {
  const status = statusBadge(deployment.status);
  const preview = deployment.type === "PREVIEW";
  const building =
    deployment.status === "building" ||
    deployment.status === "queued" ||
    status.label === "Building";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-3 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex flex-wrap items-center gap-2">
        {building ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/80 bg-gradient-to-r from-amber-100 to-sky-200 px-2 py-0.5 text-xs font-medium text-amber-950 animate-pulse">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            Building
          </span>
        ) : (
          <Badge variant={status.variant}>{status.label}</Badge>
        )}
        <Badge variant={preview ? "outline" : "secondary"}>
          {preview ? "Preview" : "Production"}
        </Badge>
        {deployment.branch ? (
          <span className="text-xs text-muted-foreground">{deployment.branch}</span>
        ) : null}
      </div>
      <div className="flex items-center gap-2 text-sm">
        {deployment.commitAuthorAvatar ? (
          <img
            src={deployment.commitAuthorAvatar}
            alt=""
            className="size-6 rounded-full"
          />
        ) : null}
        <span className="font-medium">{deployment.commitAuthor ?? "sin autor"}</span>
        {deployment.commitMessage ? (
          <span className="text-muted-foreground"> · {deployment.commitMessage}</span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {deployment.commitHash ? <code>{deployment.commitHash.slice(0, 7)}</code> : null}
        {deployment.url ? (
          <a className="underline" href={deployment.url}>
            {deployment.url}
          </a>
        ) : (
          <span>Sin URL todavía</span>
        )}
      </div>
    </div>
  );
}

export function ProjectDeploymentsPanel() {
  const [projects, setProjects] = useState<ProjectDeployments[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      let result: Awaited<ReturnType<typeof listProjectDeployments>>;
      try {
        result = await listProjectDeployments();
      } catch {
        if (!cancelled) {
          setError("No se pudieron cargar los proyectos.");
        }
        return;
      }
      if (cancelled) {
        return;
      }
      if (result.error) {
        setError(result.error);
        return;
      }
      setError("");
      setProjects(result.projects ?? []);
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

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (projects.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      {projects.map((project) => (
        <Card key={project.id}>
          <CardHeader>
            <CardTitle>{project.name}</CardTitle>
            <CardDescription>{project.repoUrl}</CardDescription>
            <div className="pt-2">
              <span className="inline-flex h-8 items-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground">
                Deployments
              </span>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <ProjectEnvEditor projectId={project.id} variables={project.env} />
            {project.deployments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Este proyecto todavía no tiene despliegues.</p>
            ) : (
              project.deployments.map((deployment) => (
                <DeploymentRow key={deployment.id} deployment={deployment} />
              ))
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

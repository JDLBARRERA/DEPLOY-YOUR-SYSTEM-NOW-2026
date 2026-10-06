"use client";

import { useEffect, useState } from "react";
import {
  listProjectDeployments,
  type DeploymentView,
  type ProjectDeployments,
} from "@/app/actions/projects";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

function DeploymentRow({ deployment }: { deployment: DeploymentView }) {
  const status = statusBadge(deployment.status);
  const preview = deployment.type === "PREVIEW";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={status.variant}>{status.label}</Badge>
        <Badge variant={preview ? "outline" : "secondary"}>
          {preview ? "preview" : "main"}
        </Badge>
        {deployment.branch ? (
          <span className="text-xs text-muted-foreground">{deployment.branch}</span>
        ) : null}
      </div>
      <div className="text-sm">
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
      const result = await listProjectDeployments();
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

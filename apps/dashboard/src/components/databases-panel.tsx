"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  branchDatabase,
  createDatabase,
  linkDatabase,
  listDatabases,
  listLinkableProjects,
  type DatabaseView,
  type ProjectOption,
} from "@/app/actions/databases";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <label className="flex flex-col gap-1.5 text-sm">
      {label}
      <span className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-xs" />
        <Button type="button" variant="outline" onClick={() => void copy()}>
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </span>
    </label>
  );
}

export function DatabasesPanel({ onChange }: { onChange?: () => void }) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [databases, setDatabases] = useState<DatabaseView[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [branchNames, setBranchNames] = useState<Record<string, string>>({});
  const [linkTargets, setLinkTargets] = useState<Record<string, string>>({});

  async function refresh() {
    const [listed, linkable] = await Promise.all([
      listDatabases(),
      listLinkableProjects(),
    ]);
    if (listed.error) {
      setError(listed.error);
      return;
    }
    setDatabases(listed.databases ?? []);
    setProjects(linkable);
    onChange?.();
  }

  useEffect(() => {
    void refresh();
    // The list is loaded once and again after each mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    const result = await createDatabase(name);
    setCreating(false);
    if (result.error || !result.database) {
      setError(result.error ?? "No se pudo crear la base");
      return;
    }
    setName("");
    await refresh();
  }

  async function onBranch(database: DatabaseView) {
    const branchName = branchNames[database.id]?.trim();
    if (!branchName) {
      setError("Escribe un nombre para el branch");
      return;
    }
    setError("");
    const result = await branchDatabase(database.dbName, branchName);
    if (result.error) {
      setError(result.error);
      return;
    }
    setBranchNames((current) => ({ ...current, [database.id]: "" }));
    await refresh();
  }

  async function onLink(database: DatabaseView) {
    const projectId = linkTargets[database.id];
    if (!projectId) {
      setError("Elige un proyecto para vincular");
      return;
    }
    setError("");
    const result = await linkDatabase(database.id, projectId);
    if (result.error) {
      setError(result.error);
      return;
    }
    await refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Databases</CardTitle>
          <CardDescription>
            Un cluster Postgres compartido. Cada base tiene usuario propio, pool en el puerto 6543 y conexión directa en el 5432.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3 sm:flex-row" onSubmit={onCreate}>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="mi-app-db"
              required
            />
            <Button type="submit" disabled={creating}>
              {creating ? "Creando..." : "+ Create Neon DB"}
            </Button>
          </form>
          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      {databases.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay bases de datos.</p>
      ) : (
        databases.map((database) => (
          <Card key={database.id}>
            <CardHeader>
              <CardTitle>{database.name}</CardTitle>
              <CardDescription>
                {database.dbName} · usuario {database.dbUser}
                {database.projectId ? " · vinculada a un proyecto" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <CopyField label="DATABASE_URL (pool)" value={database.pooledUrl} />
              <CopyField label="DIRECT_URL" value={database.directUrl} />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={branchNames[database.id] ?? ""}
                  onChange={(event) =>
                    setBranchNames((current) => ({
                      ...current,
                      [database.id]: event.target.value,
                    }))
                  }
                  placeholder="preview"
                />
                <Button type="button" variant="outline" onClick={() => void onBranch(database)}>
                  Crear branch
                </Button>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                  value={linkTargets[database.id] ?? ""}
                  onChange={(event) =>
                    setLinkTargets((current) => ({
                      ...current,
                      [database.id]: event.target.value,
                    }))
                  }
                >
                  <option value="">Vincular a un proyecto</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="outline" onClick={() => void onLink(database)}>
                  Vincular
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

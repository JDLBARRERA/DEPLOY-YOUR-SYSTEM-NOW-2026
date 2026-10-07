import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Docker from "dockerode";
import { simpleGit } from "simple-git";
import { selectEnv, type DeploymentEnvType, type ScopedEnvVar } from "./projectEnv.js";

const BUILD_TIMEOUT_MS = 10 * 60 * 1000;
const CONTAINER_PORT = "3000";

const GITHUB_REPO_URL =
  /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/;

export class DeployValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeployValidationError";
  }
}

export interface DeployRequest {
  repoUrl: string;
  projectName: string;
  projectId?: string;
  image?: string;
  branch?: string;
  env?: Record<string, string>;
  variables?: ScopedEnvVar[];
  deploymentType?: DeploymentEnvType;
  onLog?: (line: string) => void;
}

const GIT_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const GIT_COMMIT = /^[0-9a-f]{7,40}$/i;

export function assertGitBranch(branch: string): void {
  if (!GIT_BRANCH.test(branch) || branch.includes("..")) {
    throw new DeployValidationError("branch is not a valid git ref");
  }
}

export function assertGitCommit(commitHash: string): void {
  if (!GIT_COMMIT.test(commitHash)) {
    throw new DeployValidationError("commitHash is not a valid git SHA");
  }
}

export function deploymentImageName(
  projectName: string,
  branch: string,
  preview: boolean,
): string {
  const source = preview ? `${branch}-${projectName}` : projectName;
  const label = normalizeImageName(source)
    .slice(0, 63)
    .replace(/[._-]+$/, "");
  return normalizeImageName(label);
}

export interface DeployResult {
  projectId: string;
  port: number;
  status: string;
  image: string;
  containerId: string;
  commitHash: string | null;
}

export function assertPublicGitHubRepo(repoUrl: string): void {
  if (!GITHUB_REPO_URL.test(repoUrl)) {
    throw new DeployValidationError(
      "repoUrl must be an HTTPS URL of a GitHub repository",
    );
  }
}

/**
 * Inyecta GITHUB_PAT para clonar repos privados.
 * Si la URL ya trae credenciales (@github.com) o no hay PAT, deja el fallback HTTPS.
 * No registrar el resultado en logs (contiene el token).
 */
export function githubCloneUrl(repoUrl: string): string {
  assertPublicGitHubRepo(repoUrl);
  if (/^https:\/\/[^/\s]+@github\.com\//i.test(repoUrl)) {
    return repoUrl;
  }
  const pat = process.env.GITHUB_PAT?.trim();
  if (!pat) {
    return repoUrl;
  }
  return repoUrl.replace(
    /^https:\/\/github\.com\//i,
    `https://${encodeURIComponent(pat)}@github.com/`,
  );
}

export function deployResourceLimits(): { memory: string; cpus: string } {
  return {
    memory: process.env.DEPLOY_MEMORY?.trim() || "512m",
    cpus: process.env.DEPLOY_CPUS?.trim() || "0.5",
  };
}

export function parseMemoryBytes(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(b|k|kb|m|mb|g|gb)?$/i);
  if (!match) {
    return 512 * 1024 * 1024;
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? "b").toLowerCase();
  const factor =
    unit === "g" || unit === "gb"
      ? 1024 ** 3
      : unit === "m" || unit === "mb"
        ? 1024 ** 2
        : unit === "k" || unit === "kb"
          ? 1024
          : 1;
  return Math.round(amount * factor);
}

export function normalizeImageName(projectName: string): string {
  const normalized = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 128);

  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(normalized)) {
    throw new DeployValidationError(
      "projectName must normalize to a valid Docker image tag",
    );
  }

  return normalized;
}

function streamLines(
  stream: NodeJS.ReadableStream,
  onLog: (line: string) => void,
): void {
  let buffer = "";
  stream.on("data", (chunk: Buffer | string) => {
    buffer += chunk.toString();
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      if (line.trim()) {
        onLog(line);
      }
    }
  });
}

function runNixpacks(
  workDir: string,
  image: string,
  env: Record<string, string>,
  onLog: (line: string) => void,
): Promise<void> {
  const args = ["build", workDir, "--name", image];
  for (const [key, value] of Object.entries(env)) {
    args.push("--env", `${key}=${value}`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn("nixpacks", args, {
      windowsHide: true,
      shell: false,
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("nixpacks build timed out"));
    }, BUILD_TIMEOUT_MS);

    streamLines(child.stdout, onLog);
    streamLines(child.stderr, onLog);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`nixpacks exited with code ${code}`));
    });
  });
}

export class DeployEngine {
  constructor(private readonly docker = new Docker()) {}

  async deploy(input: DeployRequest): Promise<DeployResult> {
    assertPublicGitHubRepo(input.repoUrl);
    const image = normalizeImageName(input.image ?? input.projectName);
    const projectId = input.projectId ?? randomBytes(8).toString("hex");
    const onLog = input.onLog ?? (() => undefined);
    const env = {
      ...selectEnv(input.variables ?? [], input.deploymentType ?? "PRODUCTION"),
      ...(input.env ?? {}),
    };
    const workDir = path.join(os.tmpdir(), "builds", projectId);
    let commitHash: string | null = null;

    await mkdir(workDir, { recursive: true });

    try {
      if (input.branch) {
        assertGitBranch(input.branch);
      }
      onLog(`Cloning ${input.repoUrl}${input.branch ? ` (${input.branch})` : ""}`);
      const cloneOptions = input.branch
        ? ["--branch", input.branch, "--single-branch"]
        : undefined;
      await simpleGit()
        .outputHandler((_command, stdout, stderr) => {
          streamLines(stdout, onLog);
          streamLines(stderr, onLog);
        })
        .clone(githubCloneUrl(input.repoUrl), workDir, cloneOptions);

      commitHash = (await simpleGit(workDir).revparse(["HEAD"])).trim();
      const envKeys = Object.keys(env);
      if (envKeys.length > 0) {
        onLog(`Injecting env ${envKeys.join(", ")}`);
      }
      onLog(`Building image ${image}`);
      await runNixpacks(workDir, image, env, onLog);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }

    onLog("Starting container");
    const network = await this.deployNetwork();
    const limits = deployResourceLimits();
    const nanoCpus = Math.round(Number(limits.cpus) * 1e9);
    const container = await this.docker.createContainer({
      name: `paas-${projectId}`,
      Image: image,
      Labels: {
        "paas.project": image,
        "paas.projectId": projectId,
        "paas.repo": input.repoUrl,
      },
      Env: [
        `PORT=${CONTAINER_PORT}`,
        ...Object.entries(env).map(([key, value]) => `${key}=${value}`),
      ],
      ExposedPorts: { [`${CONTAINER_PORT}/tcp`]: {} },
      HostConfig: {
        PortBindings: {
          [`${CONTAINER_PORT}/tcp`]: [{ HostPort: "0" }],
        },
        Memory: parseMemoryBytes(limits.memory),
        MemorySwap: parseMemoryBytes(limits.memory),
        NanoCpus: Number.isFinite(nanoCpus) && nanoCpus > 0 ? nanoCpus : 5e8,
        ...(network ? { NetworkMode: network } : {}),
      },
    });

    await container.start();
    const info = await container.inspect();
    const binding = info.NetworkSettings.Ports?.[`${CONTAINER_PORT}/tcp`]?.[0];
    const port = binding?.HostPort ? Number(binding.HostPort) : Number.NaN;

    if (!Number.isInteger(port)) {
      throw new Error("Docker did not assign a host port");
    }

    onLog(`Container listening on host port ${port}`);

    return {
      projectId,
      port,
      status: info.State.Status,
      image,
      containerId: info.Id,
      commitHash,
    };
  }

  private async deployNetwork(): Promise<string | undefined> {
    const name = process.env.DEPLOY_NETWORK ?? "paas";
    try {
      await this.docker.getNetwork(name).inspect();
      return name;
    } catch {
      return undefined;
    }
  }

  async stopPrevious(image: string, currentContainerId: string): Promise<void> {
    const existing = await this.docker.listContainers({
      all: true,
      filters: { label: [`paas.project=${image}`] },
    });

    for (const item of existing) {
      if (item.Id === currentContainerId) {
        continue;
      }

      const previous = this.docker.getContainer(item.Id);
      try {
        await previous.stop({ t: 5 });
      } catch {
        // The previous container may already be stopped.
      }
      await previous.remove({ force: true });
    }
  }
}

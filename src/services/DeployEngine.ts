import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Docker from "dockerode";
import { simpleGit } from "simple-git";

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
}

export interface DeployResult {
  projectId: string;
  port: number;
  status: string;
  image: string;
}

export function assertPublicGitHubRepo(repoUrl: string): void {
  if (!GITHUB_REPO_URL.test(repoUrl)) {
    throw new DeployValidationError(
      "repoUrl must be an HTTPS URL of a public GitHub repository",
    );
  }
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

function runNixpacks(workDir: string, image: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "nixpacks",
      ["build", workDir, "--name", image],
      { timeout: BUILD_TIMEOUT_MS, windowsHide: true },
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      },
    );
  });
}

export class DeployEngine {
  constructor(private readonly docker = new Docker()) {}

  async deploy(input: DeployRequest): Promise<DeployResult> {
    assertPublicGitHubRepo(input.repoUrl);
    const image = normalizeImageName(input.projectName);
    const projectId = randomBytes(8).toString("hex");
    const workDir = path.join(os.tmpdir(), "builds", projectId);

    await mkdir(workDir, { recursive: true });

    try {
      await simpleGit().clone(input.repoUrl, workDir);
      await runNixpacks(workDir, image);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }

    const container = await this.docker.createContainer({
      Image: image,
      Env: [`PORT=${CONTAINER_PORT}`],
      ExposedPorts: { [`${CONTAINER_PORT}/tcp`]: {} },
      HostConfig: {
        PortBindings: {
          [`${CONTAINER_PORT}/tcp`]: [{ HostPort: "0" }],
        },
      },
    });

    await container.start();
    const info = await container.inspect();
    const binding = info.NetworkSettings.Ports?.[`${CONTAINER_PORT}/tcp`]?.[0];
    const port = binding?.HostPort ? Number(binding.HostPort) : Number.NaN;

    if (!Number.isInteger(port)) {
      throw new Error("Docker did not assign a host port");
    }

    return {
      projectId,
      port,
      status: info.State.Status,
      image,
    };
  }
}

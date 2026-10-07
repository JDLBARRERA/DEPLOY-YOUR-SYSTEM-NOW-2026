import { createHmac, timingSafeEqual } from "node:crypto";
import type { Queue } from "bullmq";
import { prisma } from "../db.js";
import type { DeployJobData } from "../queues/deployQueue.js";
import { deploymentImageName } from "./DeployEngine.js";
import type { DatabaseManagerService } from "./DatabaseManagerService.js";
import type { DeploymentStore } from "./DeploymentStore.js";
import type { LogBus } from "./LogBus.js";
import { enqueueDeployment } from "./enqueueDeployment.js";

export class WebhookSignatureError extends Error {
  constructor() {
    super("Invalid GitHub signature");
    this.name = "WebhookSignatureError";
  }
}

export function githubRepoKey(url: string): string | null {
  const cleaned = url.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const match = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)$/i);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return `${match[1]}/${match[2]}`.toLowerCase();
}

export function verifyGithubSignature(
  raw: Buffer,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header?.startsWith("sha256=")) {
    return false;
  }
  const provided = Buffer.from(header.slice("sha256=".length), "hex");
  const digest = createHmac("sha256", secret).update(raw).digest();
  if (provided.length !== digest.length) {
    return false;
  }
  return timingSafeEqual(provided, digest);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function githubAvatar(username: string | undefined): string | null {
  if (!username || !/^[A-Za-z0-9-]{1,39}$/.test(username)) {
    return null;
  }
  return `https://github.com/${username}.png`;
}

function githubAvatarUrl(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    const allowed =
      parsed.protocol === "https:" &&
      (parsed.hostname === "avatars.githubusercontent.com" ||
        parsed.hostname === "github.com");
    return allowed ? parsed.toString() : null;
  } catch {
    return null;
  }
}

interface WebhookDeploy {
  deploymentId: string;
  projectId: string;
  type: "PRODUCTION" | "PREVIEW";
  url: string;
  branch: string;
}

export class GitHubWebhookService {
  constructor(
    private readonly deps: {
      queue: Queue<DeployJobData>;
      store: DeploymentStore;
      logs: LogBus;
      databases: DatabaseManagerService;
    },
  ) {}

  async receive(
    event: string | undefined,
    raw: Buffer,
    signature: string | undefined,
  ): Promise<{ deployments: WebhookDeploy[] } | { ignored: true }> {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error("GITHUB_WEBHOOK_SECRET no está configurado");
    }
    if (!verifyGithubSignature(raw, signature, secret)) {
      throw new WebhookSignatureError();
    }

    if (event === "ping") {
      return { ignored: true };
    }

    const payload = JSON.parse(raw.toString("utf8")) as unknown;
    if (!isRecord(payload) || !isRecord(payload.repository)) {
      return { ignored: true };
    }

    const target = this.readTarget(event, payload);
    if (!target) {
      return { ignored: true };
    }

    const repoKey = githubRepoKey(
      text(payload.repository.html_url) ?? text(payload.repository.clone_url) ?? "",
    );
    if (!repoKey) {
      return { ignored: true };
    }

    const projects = await prisma.project.findMany({
      include: { database: true },
    });
    const matches = projects.filter((project) => githubRepoKey(project.repoUrl) === repoKey);
    if (matches.length === 0) {
      return { ignored: true };
    }

    const deployments: WebhookDeploy[] = [];
    for (const project of matches) {
      const productionBranch = project.branch.trim() || "main";
      const type: "PRODUCTION" | "PREVIEW" =
        target.event === "push" && target.branch === productionBranch
          ? "PRODUCTION"
          : "PREVIEW";
      const preview = type === "PREVIEW";
      const image = deploymentImageName(project.name, target.branch, preview);
      let env: Record<string, string> | undefined;
      let databaseWarning = "";
      if (preview && project.database) {
        try {
          env = await this.deps.databases.previewDatabaseEnv(
            project.database.dbName,
            target.branch,
          );
        } catch (error) {
          databaseWarning =
            error instanceof Error ? error.message : "No se pudo clonar la base del preview";
        }
      }

      const url = `http://${image}.localhost`;
      const deployment = await prisma.deployment.create({
        data: {
          projectId: project.id,
          status: "queued",
          type,
          branch: target.branch,
          commitHash: target.commitHash,
          commitMessage: target.commitMessage.slice(0, 4000),
          commitAuthor: target.commitAuthor.slice(0, 200),
          commitAuthorAvatar: target.commitAuthorAvatar,
          url,
        },
      });

      const queued = await enqueueDeployment(this.deps, {
        repoUrl: target.cloneUrl,
        projectName: project.name,
        image,
        deploymentId: deployment.id,
        branch: target.branch,
        env,
      });
      if (databaseWarning) {
        await this.deps.logs.append(queued.projectId, databaseWarning);
      }

      deployments.push({
        deploymentId: deployment.id,
        projectId: queued.projectId,
        type,
        url,
        branch: target.branch,
      });
    }

    return { deployments };
  }

  private readTarget(
    event: string | undefined,
    payload: Record<string, unknown>,
  ): {
    event: "push" | "pull_request";
    branch: string;
    commitHash: string;
    commitMessage: string;
    commitAuthor: string;
    commitAuthorAvatar: string | null;
    cloneUrl: string;
  } | null {
    const repository = payload.repository;
    if (!isRecord(repository)) {
      return null;
    }
    const baseClone = text(repository.clone_url) ?? text(repository.html_url);
    if (!baseClone) {
      return null;
    }

    if (event === "push") {
      if (payload.deleted === true) {
        return null;
      }
      const ref = text(payload.ref);
      if (!ref?.startsWith("refs/heads/")) {
        return null;
      }
      const branch = ref.slice("refs/heads/".length);
      const after = text(payload.after);
      if (!branch || !after || /^0+$/.test(after)) {
        return null;
      }
      const head = isRecord(payload.head_commit) ? payload.head_commit : undefined;
      const authorRecord = head && isRecord(head.author) ? head.author : undefined;
      const pusher = isRecord(payload.pusher) ? payload.pusher : undefined;
      const username = text(authorRecord?.username);
      return {
        event: "push",
        branch,
        commitHash: text(head?.id) ?? after,
        commitMessage: text(head?.message) ?? "",
        commitAuthor: username ?? text(authorRecord?.name) ?? text(pusher?.name) ?? "github",
        commitAuthorAvatar: githubAvatar(username),
        cloneUrl: baseClone,
      };
    }

    if (event === "pull_request") {
      const action = text(payload.action);
      if (!action || !["opened", "synchronize", "reopened"].includes(action)) {
        return null;
      }
      const pull = isRecord(payload.pull_request) ? payload.pull_request : undefined;
      const head = pull && isRecord(pull.head) ? pull.head : undefined;
      const user = pull && isRecord(pull.user) ? pull.user : undefined;
      const headRepo = head && isRecord(head.repo) ? head.repo : undefined;
      const branch = text(head?.ref);
      const commitHash = text(head?.sha);
      if (!pull || !branch || !commitHash) {
        return null;
      }
      return {
        event: "pull_request",
        branch,
        commitHash,
        commitMessage: text(pull.title) ?? "",
        commitAuthor: text(user?.login) ?? "github",
        commitAuthorAvatar: githubAvatarUrl(text(user?.avatar_url)),
        cloneUrl: text(headRepo?.clone_url) ?? baseClone,
      };
    }

    return null;
  }
}

import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type PluginUpdatePhase =
  | "available"
  | "scheduled"
  | "installing"
  | "succeeded"
  | "failed";

export type PluginUpdateState = {
  schema: 1;
  directiveId: string;
  fromVersion: string;
  targetVersion: string;
  sha256: string;
  state: PluginUpdatePhase;
  attempt: number;
  nextAttemptAt: number;
  errorCode?: string | undefined;
  tarballPath?: string | undefined;
  notifiedAccounts: string[];
};

export type RuntimeUpdateNotice =
  | {
      type: "runtime.update.completed";
      runtime: "openclaw-mingle";
      from_version: string;
      to_version: string;
      status: "succeeded";
    }
  | {
      type: "runtime.update.failed";
      runtime: "openclaw-mingle";
      from_version: string;
      to_version: string;
      status: "failed";
      error_code: string;
    };

function defaultStateDir(): string {
  return process.env.OPENCLAW_STATE_DIR?.trim() || join(homedir(), ".openclaw");
}

export function resolveUpdateStatePath(stateDir = defaultStateDir()): string {
  return join(stateDir, "openclaw-mingle", "update-state.json");
}

export function resolveUpdateDirectory(stateDir = defaultStateDir()): string {
  return join(stateDir, "openclaw-mingle", "updates");
}

function isPhase(value: unknown): value is PluginUpdatePhase {
  return ["available", "scheduled", "installing", "succeeded", "failed"].includes(
    String(value),
  );
}

function parseUpdateState(raw: string): PluginUpdateState | undefined {
  try {
    const value = JSON.parse(raw) as Partial<PluginUpdateState>;
    if (
      value.schema !== 1 ||
      typeof value.directiveId !== "string" ||
      typeof value.fromVersion !== "string" ||
      typeof value.targetVersion !== "string" ||
      typeof value.sha256 !== "string" ||
      !isPhase(value.state) ||
      !Number.isSafeInteger(value.attempt) ||
      typeof value.nextAttemptAt !== "number" ||
      !Array.isArray(value.notifiedAccounts)
    ) {
      return undefined;
    }
    const notifiedAccounts = value.notifiedAccounts.filter(
      (accountId): accountId is string => typeof accountId === "string" && accountId.length > 0,
    );
    if (notifiedAccounts.length !== value.notifiedAccounts.length) return undefined;
    return {
      schema: 1,
      directiveId: value.directiveId,
      fromVersion: value.fromVersion,
      targetVersion: value.targetVersion,
      sha256: value.sha256,
      state: value.state,
      attempt: value.attempt!,
      nextAttemptAt: value.nextAttemptAt,
      ...(typeof value.errorCode === "string" ? { errorCode: value.errorCode } : {}),
      ...(typeof value.tarballPath === "string" ? { tarballPath: value.tarballPath } : {}),
      notifiedAccounts: [...new Set(notifiedAccounts)],
    };
  } catch {
    return undefined;
  }
}

export class UpdateStateStore {
  readonly stateDir: string;
  readonly path: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: { stateDir?: string } = {}) {
    this.stateDir = options.stateDir ?? defaultStateDir();
    this.path = resolveUpdateStatePath(this.stateDir);
  }

  async load(): Promise<PluginUpdateState | undefined> {
    try {
      return parseUpdateState(await readFile(this.path, "utf8"));
    } catch {
      return undefined;
    }
  }

  async save(state: PluginUpdateState): Promise<void> {
    const operation = this.mutationQueue.then(() => this.writeAtomic(state));
    this.mutationQueue = operation.catch(() => undefined);
    await operation;
  }

  async markAccountNotified(accountId: string): Promise<void> {
    const operation = this.mutationQueue.then(async () => {
      const state = await this.load();
      if (!state || state.notifiedAccounts.includes(accountId)) return;
      await this.writeAtomic({
        ...state,
        notifiedAccounts: [...state.notifiedAccounts, accountId],
      });
    });
    this.mutationQueue = operation.catch(() => undefined);
    await operation;
  }

  async pendingNotice(accountId: string): Promise<RuntimeUpdateNotice | undefined> {
    const state = await this.load();
    if (!state || state.notifiedAccounts.includes(accountId)) return undefined;
    if (state.state === "succeeded") {
      return {
        type: "runtime.update.completed",
        runtime: "openclaw-mingle",
        from_version: state.fromVersion,
        to_version: state.targetVersion,
        status: "succeeded",
      };
    }
    if (state.state === "failed") {
      return {
        type: "runtime.update.failed",
        runtime: "openclaw-mingle",
        from_version: state.fromVersion,
        to_version: state.targetVersion,
        status: "failed",
        error_code: state.errorCode ?? "update_failed",
      };
    }
    return undefined;
  }

  private async writeAtomic(state: PluginUpdateState): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.path);
    await chmod(this.path, 0o600);
  }
}

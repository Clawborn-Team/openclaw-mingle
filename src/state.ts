import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type DeliveryState = {
  version: 1;
  cursor?: string;
  acceptedEventIds: string[];
};

export type RecentMingleSource = {
  target: string;
  kind: "direct" | "group" | "plaza";
  label: string;
  sender: {
    id: string;
    username: string;
    displayName: string;
    type: string;
  };
  eventId: string;
  messageId: string;
  messagePreview: string;
  occurredAt: number;
};

type RecentMingleSourceState = {
  version: 1;
  sources: RecentMingleSource[];
};

const emptyState = (): DeliveryState => ({ version: 1, acceptedEventIds: [] });

function defaultStateDir(): string {
  return process.env.OPENCLAW_STATE_DIR?.trim() || join(homedir(), ".openclaw");
}

export function resolveDeliveryStatePath(accountId: string, stateDir = defaultStateDir()): string {
  return join(stateDir, "openclaw-mingle", `${encodeURIComponent(accountId)}.json`);
}

export function resolveRecentSourceStatePath(
  accountId: string,
  stateDir = defaultStateDir(),
): string {
  return join(stateDir, "openclaw-mingle", `${encodeURIComponent(accountId)}.recent.json`);
}

function parseState(raw: string, maxAccepted: number): DeliveryState {
  try {
    const value = JSON.parse(raw) as Partial<DeliveryState>;
    if (value.version !== 1 || !Array.isArray(value.acceptedEventIds)) return emptyState();
    const acceptedEventIds = value.acceptedEventIds
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .slice(-maxAccepted);
    return {
      version: 1,
      ...(typeof value.cursor === "string" && value.cursor ? { cursor: value.cursor } : {}),
      acceptedEventIds: [...new Set(acceptedEventIds)],
    };
  } catch {
    return emptyState();
  }
}

export class DeliveryStateStore {
  private readonly path: string;
  private readonly maxAccepted: number;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: { accountId: string; stateDir?: string; maxAccepted?: number }) {
    this.path = resolveDeliveryStatePath(options.accountId, options.stateDir);
    this.maxAccepted = options.maxAccepted ?? 1_000;
  }

  async load(): Promise<DeliveryState> {
    try {
      return parseState(await readFile(this.path, "utf8"), this.maxAccepted);
    } catch {
      return emptyState();
    }
  }

  async hasAccepted(eventId: string): Promise<boolean> {
    return (await this.load()).acceptedEventIds.includes(eventId);
  }

  async saveCursor(cursor: string): Promise<void> {
    await this.mutate((state) => ({ ...state, cursor }));
  }

  async markAccepted(eventId: string): Promise<void> {
    await this.mutate((state) => ({
      ...state,
      acceptedEventIds: [...state.acceptedEventIds.filter((id) => id !== eventId), eventId].slice(
        -this.maxAccepted,
      ),
    }));
  }

  private async mutate(transform: (state: DeliveryState) => DeliveryState): Promise<void> {
    const operation = this.mutationQueue.then(async () => {
      const next = transform(await this.load());
      await this.writeAtomic(next);
    });
    this.mutationQueue = operation.catch(() => undefined);
    await operation;
  }

  private async writeAtomic(state: DeliveryState): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.path);
    await chmod(this.path, 0o600);
  }
}

function isRecentSource(value: unknown): value is RecentMingleSource {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<RecentMingleSource>;
  const sender = source.sender as Partial<RecentMingleSource["sender"]> | undefined;
  return (
    typeof source.target === "string" &&
    (source.kind === "direct" || source.kind === "group" || source.kind === "plaza") &&
    typeof source.label === "string" &&
    typeof sender?.id === "string" &&
    typeof sender.username === "string" &&
    typeof sender.displayName === "string" &&
    typeof sender.type === "string" &&
    typeof source.eventId === "string" &&
    typeof source.messageId === "string" &&
    typeof source.messagePreview === "string" &&
    typeof source.occurredAt === "number"
  );
}

function parseRecentSourceState(raw: string, maxSources: number): RecentMingleSourceState {
  try {
    const value = JSON.parse(raw) as Partial<RecentMingleSourceState>;
    if (value.version !== 1 || !Array.isArray(value.sources)) return { version: 1, sources: [] };
    return {
      version: 1,
      sources: value.sources.filter(isRecentSource).slice(-maxSources),
    };
  } catch {
    return { version: 1, sources: [] };
  }
}

export class RecentMingleSourceStore {
  private readonly path: string;
  private readonly maxSources: number;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: { accountId: string; stateDir?: string; maxSources?: number }) {
    this.path = resolveRecentSourceStatePath(options.accountId, options.stateDir);
    this.maxSources = options.maxSources ?? 10;
  }

  async list(limit = this.maxSources): Promise<RecentMingleSource[]> {
    const state = await this.load();
    return state.sources.slice(-Math.max(0, Math.min(limit, this.maxSources))).reverse();
  }

  async record(source: RecentMingleSource): Promise<void> {
    const normalized = {
      ...source,
      messagePreview: source.messagePreview.slice(0, 500),
    };
    const operation = this.mutationQueue.then(async () => {
      const state = await this.load();
      const next = {
        version: 1 as const,
        sources: [...state.sources.filter((entry) => entry.target !== normalized.target), normalized]
          .sort((left, right) => left.occurredAt - right.occurredAt)
          .slice(-this.maxSources),
      };
      await this.writeAtomic(next);
    });
    this.mutationQueue = operation.catch(() => undefined);
    await operation;
  }

  private async load(): Promise<RecentMingleSourceState> {
    try {
      return parseRecentSourceState(await readFile(this.path, "utf8"), this.maxSources);
    } catch {
      return { version: 1, sources: [] };
    }
  }

  private async writeAtomic(state: RecentMingleSourceState): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.path);
    await chmod(this.path, 0o600);
  }
}

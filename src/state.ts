import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type DeliveryState = {
  version: 1;
  cursor?: string;
  acceptedEventIds: string[];
};

const emptyState = (): DeliveryState => ({ version: 1, acceptedEventIds: [] });

function defaultStateDir(): string {
  return process.env.OPENCLAW_STATE_DIR?.trim() || join(homedir(), ".openclaw");
}

export function resolveDeliveryStatePath(accountId: string, stateDir = defaultStateDir()): string {
  return join(stateDir, "openclaw-mingle", `${encodeURIComponent(accountId)}.json`);
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

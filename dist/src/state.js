import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
const emptyState = () => ({ version: 1, acceptedEventIds: [] });
function defaultStateDir() {
    return process.env.OPENCLAW_STATE_DIR?.trim() || join(homedir(), ".openclaw");
}
export function resolveDeliveryStatePath(accountId, stateDir = defaultStateDir()) {
    return join(stateDir, "openclaw-mingle", `${encodeURIComponent(accountId)}.json`);
}
export function resolveRecentSourceStatePath(accountId, stateDir = defaultStateDir()) {
    return join(stateDir, "openclaw-mingle", `${encodeURIComponent(accountId)}.recent.json`);
}
function parseState(raw, maxAccepted) {
    try {
        const value = JSON.parse(raw);
        if (value.version !== 1 || !Array.isArray(value.acceptedEventIds))
            return emptyState();
        const acceptedEventIds = value.acceptedEventIds
            .filter((id) => typeof id === "string" && id.length > 0)
            .slice(-maxAccepted);
        return {
            version: 1,
            ...(typeof value.cursor === "string" && value.cursor ? { cursor: value.cursor } : {}),
            acceptedEventIds: [...new Set(acceptedEventIds)],
        };
    }
    catch {
        return emptyState();
    }
}
export class DeliveryStateStore {
    path;
    maxAccepted;
    mutationQueue = Promise.resolve();
    constructor(options) {
        this.path = resolveDeliveryStatePath(options.accountId, options.stateDir);
        this.maxAccepted = options.maxAccepted ?? 1_000;
    }
    async load() {
        try {
            return parseState(await readFile(this.path, "utf8"), this.maxAccepted);
        }
        catch {
            return emptyState();
        }
    }
    async hasAccepted(eventId) {
        return (await this.load()).acceptedEventIds.includes(eventId);
    }
    async saveCursor(cursor) {
        await this.mutate((state) => ({ ...state, cursor }));
    }
    async markAccepted(eventId) {
        await this.mutate((state) => ({
            ...state,
            acceptedEventIds: [...state.acceptedEventIds.filter((id) => id !== eventId), eventId].slice(-this.maxAccepted),
        }));
    }
    async mutate(transform) {
        const operation = this.mutationQueue.then(async () => {
            const next = transform(await this.load());
            await this.writeAtomic(next);
        });
        this.mutationQueue = operation.catch(() => undefined);
        await operation;
    }
    async writeAtomic(state) {
        const directory = dirname(this.path);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
        await rename(temporary, this.path);
        await chmod(this.path, 0o600);
    }
}
function isRecentSource(value) {
    if (!value || typeof value !== "object")
        return false;
    const source = value;
    const sender = source.sender;
    return (typeof source.target === "string" &&
        (source.kind === "direct" || source.kind === "group") &&
        typeof source.label === "string" &&
        typeof sender?.id === "string" &&
        typeof sender.username === "string" &&
        typeof sender.displayName === "string" &&
        typeof sender.type === "string" &&
        typeof source.eventId === "string" &&
        typeof source.messageId === "string" &&
        typeof source.messagePreview === "string" &&
        typeof source.occurredAt === "number");
}
function parseRecentSourceState(raw, maxSources) {
    try {
        const value = JSON.parse(raw);
        if (value.version !== 1 || !Array.isArray(value.sources))
            return { version: 1, sources: [] };
        return {
            version: 1,
            sources: value.sources.filter(isRecentSource).slice(-maxSources),
        };
    }
    catch {
        return { version: 1, sources: [] };
    }
}
export class RecentMingleSourceStore {
    path;
    maxSources;
    mutationQueue = Promise.resolve();
    constructor(options) {
        this.path = resolveRecentSourceStatePath(options.accountId, options.stateDir);
        this.maxSources = options.maxSources ?? 10;
    }
    async list(limit = this.maxSources) {
        const state = await this.load();
        return state.sources.slice(-Math.max(0, Math.min(limit, this.maxSources))).reverse();
    }
    async record(source) {
        const normalized = {
            ...source,
            messagePreview: source.messagePreview.slice(0, 500),
        };
        const operation = this.mutationQueue.then(async () => {
            const state = await this.load();
            const next = {
                version: 1,
                sources: [...state.sources.filter((entry) => entry.target !== normalized.target), normalized]
                    .sort((left, right) => left.occurredAt - right.occurredAt)
                    .slice(-this.maxSources),
            };
            await this.writeAtomic(next);
        });
        this.mutationQueue = operation.catch(() => undefined);
        await operation;
    }
    async load() {
        try {
            return parseRecentSourceState(await readFile(this.path, "utf8"), this.maxSources);
        }
        catch {
            return { version: 1, sources: [] };
        }
    }
    async writeAtomic(state) {
        const directory = dirname(this.path);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
        await rename(temporary, this.path);
        await chmod(this.path, 0o600);
    }
}
//# sourceMappingURL=state.js.map
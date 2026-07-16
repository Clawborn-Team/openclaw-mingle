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
//# sourceMappingURL=state.js.map
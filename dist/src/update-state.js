import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
function defaultStateDir() {
    return process.env.OPENCLAW_STATE_DIR?.trim() || join(homedir(), ".openclaw");
}
export function resolveUpdateStatePath(stateDir = defaultStateDir()) {
    return join(stateDir, "openclaw-mingle", "update-state.json");
}
export function resolveUpdateDirectory(stateDir = defaultStateDir()) {
    return join(stateDir, "openclaw-mingle", "updates");
}
function isPhase(value) {
    return ["available", "scheduled", "installing", "succeeded", "failed"].includes(String(value));
}
function parseUpdateState(raw) {
    try {
        const value = JSON.parse(raw);
        if (value.schema !== 1 ||
            typeof value.directiveId !== "string" ||
            typeof value.fromVersion !== "string" ||
            typeof value.targetVersion !== "string" ||
            typeof value.sha256 !== "string" ||
            !isPhase(value.state) ||
            !Number.isSafeInteger(value.attempt) ||
            typeof value.nextAttemptAt !== "number" ||
            !Array.isArray(value.notifiedAccounts)) {
            return undefined;
        }
        const notifiedAccounts = value.notifiedAccounts.filter((accountId) => typeof accountId === "string" && accountId.length > 0);
        if (notifiedAccounts.length !== value.notifiedAccounts.length)
            return undefined;
        return {
            schema: 1,
            directiveId: value.directiveId,
            fromVersion: value.fromVersion,
            targetVersion: value.targetVersion,
            sha256: value.sha256,
            state: value.state,
            attempt: value.attempt,
            nextAttemptAt: value.nextAttemptAt,
            ...(typeof value.errorCode === "string" ? { errorCode: value.errorCode } : {}),
            ...(typeof value.tarballPath === "string" ? { tarballPath: value.tarballPath } : {}),
            notifiedAccounts: [...new Set(notifiedAccounts)],
        };
    }
    catch {
        return undefined;
    }
}
export class UpdateStateStore {
    stateDir;
    path;
    mutationQueue = Promise.resolve();
    constructor(options = {}) {
        this.stateDir = options.stateDir ?? defaultStateDir();
        this.path = resolveUpdateStatePath(this.stateDir);
    }
    async load() {
        try {
            return parseUpdateState(await readFile(this.path, "utf8"));
        }
        catch {
            return undefined;
        }
    }
    async save(state) {
        const operation = this.mutationQueue.then(() => this.writeAtomic(state));
        this.mutationQueue = operation.catch(() => undefined);
        await operation;
    }
    async markAccountNotified(accountId) {
        const operation = this.mutationQueue.then(async () => {
            const state = await this.load();
            if (!state || state.notifiedAccounts.includes(accountId))
                return;
            await this.writeAtomic({
                ...state,
                notifiedAccounts: [...state.notifiedAccounts, accountId],
            });
        });
        this.mutationQueue = operation.catch(() => undefined);
        await operation;
    }
    async pendingNotice(accountId) {
        const state = await this.load();
        if (!state || state.notifiedAccounts.includes(accountId))
            return undefined;
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
    async writeAtomic(state) {
        const directory = dirname(this.path);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
        await rename(temporary, this.path);
        await chmod(this.path, 0o600);
    }
}
//# sourceMappingURL=update-state.js.map
import { mkdir, open, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runOpenClaw } from "./installer.js";
import { UpdateStateStore } from "./update-state.js";
import { retryDelayForAttempt } from "./updater.js";
export function resolveUpdateLockPath(stateDir) {
    return join(stateDir, "openclaw-mingle", "update.lock");
}
async function saveFailure(store, state, errorCode, now) {
    await store.save({
        ...state,
        state: "failed",
        errorCode,
        nextAttemptAt: now + retryDelayForAttempt(state.attempt),
        tarballPath: undefined,
    });
    await rm(state.tarballPath ?? "", { force: true }).catch(() => undefined);
}
export async function runUpdateHelper(args, dependencies = {}) {
    if (!isAbsolute(args.tarballPath) || !args.stateDir || !args.version || !args.directiveId) {
        return "failed";
    }
    const store = new UpdateStateStore({ stateDir: args.stateDir });
    const state = await store.load();
    if (!state ||
        state.directiveId !== args.directiveId ||
        state.targetVersion !== args.version ||
        state.tarballPath !== args.tarballPath ||
        state.state !== "scheduled") {
        return "failed";
    }
    const lockPath = resolveUpdateLockPath(args.stateDir);
    await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
    let lock;
    try {
        lock = await open(lockPath, "wx", 0o600);
    }
    catch (error) {
        if (error.code === "EEXIST")
            return "failed";
        return "failed";
    }
    const runner = dependencies.runOpenClaw ?? runOpenClaw;
    const now = dependencies.now ?? Date.now;
    try {
        const installing = {
            ...state,
            state: "installing",
            errorCode: undefined,
        };
        await store.save(installing);
        try {
            await runner(["plugins", "install", `npm-pack:${args.tarballPath}`, "--force"]);
        }
        catch {
            await saveFailure(store, installing, "install_failed", now());
            return "failed";
        }
        const succeeded = {
            ...installing,
            state: "succeeded",
            nextAttemptAt: 0,
            errorCode: undefined,
        };
        await store.save(succeeded);
        try {
            await runner(["gateway", "restart"]);
        }
        catch {
            await saveFailure(store, succeeded, "restart_failed", now());
            return "failed";
        }
        return "succeeded";
    }
    finally {
        await lock.close().catch(() => undefined);
        await rm(lockPath, { force: true }).catch(() => undefined);
    }
}
export function parseUpdateHelperArgs(argv) {
    const values = new Map();
    for (let index = 0; index < argv.length; index += 2) {
        const flag = argv[index];
        const value = argv[index + 1];
        if (!flag?.startsWith("--") || value === undefined)
            throw new Error("Invalid update helper arguments.");
        values.set(flag, value);
    }
    const stateDir = values.get("--state-dir")?.trim();
    const tarballPath = values.get("--tarball-path")?.trim();
    const version = values.get("--version")?.trim();
    const directiveId = values.get("--directive-id")?.trim();
    if (!stateDir || !tarballPath || !version || !directiveId || values.size !== 4) {
        throw new Error("Missing update helper arguments.");
    }
    return { stateDir, tarballPath, version, directiveId };
}
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
    runUpdateHelper(parseUpdateHelperArgs(process.argv.slice(2)))
        .then((result) => {
        if (result !== "succeeded")
            process.exitCode = 1;
    })
        .catch(() => {
        process.exitCode = 1;
    });
}
//# sourceMappingURL=update-helper.js.map
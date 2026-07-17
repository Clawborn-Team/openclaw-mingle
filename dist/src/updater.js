import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { resolveUpdateDirectory, UpdateStateStore, } from "./update-state.js";
import { MINGLE_RUNTIME_VERSION } from "./version.js";
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const HELPER_RECOVERY_MS = 10 * 60_000;
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 21_600_000];
const RELEASE_ROOT = "https://github.com/Clawborn-Team/openclaw-mingle/releases/download";
class UpdateFailure extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
        this.name = "UpdateFailure";
    }
}
function parseStableVersion(value) {
    const match = STABLE_VERSION.exec(value);
    if (!match)
        return undefined;
    const values = match.slice(1).map(Number);
    if (values.some((entry) => !Number.isSafeInteger(entry)))
        return undefined;
    return [values[0], values[1], values[2]];
}
function compareVersions(left, right) {
    for (let index = 0; index < 3; index += 1) {
        const difference = left[index] - right[index];
        if (difference !== 0)
            return difference;
    }
    return 0;
}
export function retryDelayForAttempt(attempt) {
    return RETRY_DELAYS_MS[Math.min(Math.max(attempt - 1, 0), RETRY_DELAYS_MS.length - 1)];
}
const defaultDetachedSpawner = (executable, args, options) => spawn(executable, args, options);
export async function scheduleDetachedInstall(params, spawnDetached = defaultDetachedSpawner) {
    const helperPath = fileURLToPath(new URL("./update-helper.js", import.meta.url));
    const child = spawnDetached(process.execPath, [
        helperPath,
        "--state-dir",
        params.stateDir,
        "--tarball-path",
        params.tarballPath,
        "--version",
        params.version,
        "--directive-id",
        params.directiveId,
    ], { detached: true, stdio: "ignore", shell: false });
    child.unref();
}
function snapshotFromState(state, disabled = false) {
    if (!state)
        return { state: "idle" };
    return {
        state: disabled ? "disabled" : state.state,
        updateTargetVersion: state.targetVersion,
        ...(state.errorCode ? { updateErrorCode: state.errorCode } : {}),
    };
}
export function releaseAssetUrl(version) {
    return `${RELEASE_ROOT}/v${version}/openclaw-mingle.tgz`;
}
export class PluginUpdater {
    store;
    currentVersion;
    fetchFn;
    now;
    scheduleInstall;
    timeoutMs;
    maxBytes;
    inFlight = new Map();
    constructor(options) {
        this.store = new UpdateStateStore(options.stateDir !== undefined ? { stateDir: options.stateDir } : {});
        this.currentVersion = options.currentVersion ?? MINGLE_RUNTIME_VERSION;
        this.fetchFn = options.fetch ?? fetch;
        this.now = options.now ?? Date.now;
        this.scheduleInstall = options.scheduleInstall;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    }
    async consider(directive, options) {
        const current = parseStableVersion(this.currentVersion);
        const target = parseStableVersion(directive.version);
        if (!current ||
            !target ||
            !SHA256.test(directive.sha256) ||
            directive.runtime !== "openclaw-mingle" ||
            directive.type !== "plugin.update" ||
            compareVersions(current, target) >= 0) {
            return { state: "idle" };
        }
        const existingPromise = this.inFlight.get(directive.version);
        if (existingPromise)
            return existingPromise;
        const operation = this.considerEligible(directive, options.autoUpdate);
        this.inFlight.set(directive.version, operation);
        try {
            return await operation;
        }
        finally {
            this.inFlight.delete(directive.version);
        }
    }
    async snapshot(autoUpdate = true) {
        let state = await this.store.load();
        const current = parseStableVersion(this.currentVersion);
        const target = state ? parseStableVersion(state.targetVersion) : undefined;
        if (state?.state === "succeeded" &&
            state.tarballPath &&
            current &&
            target &&
            compareVersions(current, target) >= 0) {
            await rm(state.tarballPath, { force: true }).catch(() => undefined);
            state = { ...state, tarballPath: undefined };
            await this.store.save(state);
        }
        return snapshotFromState(state, !autoUpdate);
    }
    pendingNotice(accountId) {
        return this.store.pendingNotice(accountId);
    }
    markNoticeDelivered(accountId) {
        return this.store.markAccountNotified(accountId);
    }
    async considerEligible(directive, autoUpdate) {
        const existing = await this.store.load();
        const sameTarget = existing?.targetVersion === directive.version;
        if (sameTarget && existing.state === "succeeded") {
            return snapshotFromState(existing, !autoUpdate);
        }
        if (sameTarget &&
            (existing.state === "scheduled" || existing.state === "installing") &&
            this.now() < existing.nextAttemptAt) {
            return snapshotFromState(existing, !autoUpdate);
        }
        if (sameTarget && existing.state === "failed" && this.now() < existing.nextAttemptAt) {
            return snapshotFromState(existing, !autoUpdate);
        }
        const attempt = sameTarget ? (existing?.attempt ?? 0) + 1 : 1;
        const available = {
            schema: 1,
            directiveId: directive.id,
            fromVersion: this.currentVersion,
            targetVersion: directive.version,
            sha256: directive.sha256,
            state: "available",
            attempt: autoUpdate ? attempt : 0,
            nextAttemptAt: 0,
            notifiedAccounts: [],
        };
        await this.store.save(available);
        if (!autoUpdate)
            return snapshotFromState(available, true);
        let tarballPath;
        try {
            tarballPath = await this.downloadVerified(directive);
            const scheduled = {
                ...available,
                state: "scheduled",
                nextAttemptAt: this.now() + HELPER_RECOVERY_MS,
                tarballPath,
            };
            await this.store.save(scheduled);
            try {
                await this.scheduleInstall({
                    stateDir: this.store.stateDir,
                    tarballPath,
                    version: directive.version,
                    directiveId: directive.id,
                });
            }
            catch {
                throw new UpdateFailure("schedule_failed");
            }
            return snapshotFromState(scheduled);
        }
        catch (error) {
            if (tarballPath)
                await rm(tarballPath, { force: true }).catch(() => undefined);
            const errorCode = error instanceof UpdateFailure ? error.code : "download_failed";
            const failed = {
                ...available,
                state: "failed",
                errorCode,
                nextAttemptAt: this.now() + retryDelayForAttempt(attempt),
            };
            await this.store.save(failed);
            return snapshotFromState(failed);
        }
    }
    async downloadVerified(directive) {
        const directory = resolveUpdateDirectory(this.store.stateDir);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const temporary = join(directory, `.${directive.version}.${randomUUID()}.tmp`);
        const destination = join(directory, `openclaw-mingle-${directive.version}.tgz`);
        const controller = new AbortController();
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, this.timeoutMs);
        timeout.unref?.();
        try {
            let response;
            try {
                response = await this.fetchFn(releaseAssetUrl(directive.version), {
                    signal: controller.signal,
                    redirect: "follow",
                });
            }
            catch {
                throw new UpdateFailure(timedOut ? "download_timeout" : "download_failed");
            }
            if (!response.ok)
                throw new UpdateFailure("download_failed");
            const declaredLength = Number(response.headers.get("Content-Length"));
            if (Number.isFinite(declaredLength) && declaredLength > this.maxBytes) {
                throw new UpdateFailure("asset_too_large");
            }
            if (!response.body)
                throw new UpdateFailure("download_failed");
            const reader = response.body.getReader();
            const chunks = [];
            let received = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                received += value.byteLength;
                if (received > this.maxBytes) {
                    await reader.cancel();
                    throw new UpdateFailure("asset_too_large");
                }
                chunks.push(value);
            }
            const content = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
            const actualSha256 = createHash("sha256").update(content).digest("hex");
            if (actualSha256 !== directive.sha256)
                throw new UpdateFailure("integrity_mismatch");
            await writeFile(temporary, content, { mode: 0o600 });
            await rename(temporary, destination);
            return destination;
        }
        finally {
            clearTimeout(timeout);
            await rm(temporary, { force: true }).catch(() => undefined);
        }
    }
}
//# sourceMappingURL=updater.js.map
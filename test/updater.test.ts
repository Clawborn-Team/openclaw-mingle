import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { UpdateStateStore } from "../src/update-state.js";
import { PluginUpdater } from "../src/updater.js";
import type { RuntimeUpdateDirective } from "../src/types.js";

const tarball = new TextEncoder().encode("verified tarball bytes");
const digest = createHash("sha256").update(tarball).digest("hex");

function directive(version = "0.6.1", sha256 = digest): RuntimeUpdateDirective {
  return {
    id: `openclaw-mingle:${version}:${sha256.slice(0, 12)}`,
    type: "plugin.update",
    runtime: "openclaw-mingle",
    version,
    sha256,
    required: false,
  };
}

async function makeUpdater(overrides: {
  currentVersion?: string;
  fetch?: typeof fetch;
  now?: () => number;
  scheduleInstall?: (params: {
    stateDir: string;
    tarballPath: string;
    version: string;
    directiveId: string;
  }) => Promise<void>;
  timeoutMs?: number;
  maxBytes?: number;
} = {}) {
  const stateDir = await mkdtemp(join(tmpdir(), "openclaw-mingle-updater-"));
  const scheduleInstall = overrides.scheduleInstall ?? vi.fn(async () => undefined);
  const updater = new PluginUpdater({
    stateDir,
    currentVersion: overrides.currentVersion ?? "0.6.0",
    fetch: overrides.fetch ?? (vi.fn(async () => new Response(tarball)) as typeof fetch),
    now: overrides.now ?? (() => 1_000),
    scheduleInstall,
    ...(overrides.timeoutMs !== undefined ? { timeoutMs: overrides.timeoutMs } : {}),
    ...(overrides.maxBytes !== undefined ? { maxBytes: overrides.maxBytes } : {}),
  });
  return { updater, stateDir, scheduleInstall, store: new UpdateStateStore({ stateDir }) };
}

describe("PluginUpdater", () => {
  it("downloads only the fixed release asset, verifies it, and schedules once", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) => new Response(tarball),
    );
    const { updater, scheduleInstall } = await makeUpdater({ fetch: fetchMock as typeof fetch });

    const status = await updater.consider(directive(), { autoUpdate: true });

    expect(status).toMatchObject({ state: "scheduled", updateTargetVersion: "0.6.1" });
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "https://github.com/Clawborn-Team/openclaw-mingle/releases/download/v0.6.1/openclaw-mingle.tgz",
    );
    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(request.redirect).toBe("follow");
    expect(request.headers).toBeUndefined();
    expect(scheduleInstall).toHaveBeenCalledTimes(1);
    const scheduled = vi.mocked(scheduleInstall).mock.calls[0]![0];
    expect(await readFile(scheduled.tarballPath)).toEqual(Buffer.from(tarball));

    await updater.consider(directive(), { autoUpdate: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(scheduleInstall).toHaveBeenCalledTimes(1);
  });

  it.each(["0.6.0", "0.5.9", "0.6.0-beta.1", "not-a-version"])(
    "never downloads an ineligible target %s",
    async (version) => {
      const fetchMock = vi.fn(async () => new Response(tarball));
      const { updater, scheduleInstall } = await makeUpdater({ fetch: fetchMock as typeof fetch });
      const status = await updater.consider(directive(version), { autoUpdate: true });
      expect(status.state).toBe("idle");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(scheduleInstall).not.toHaveBeenCalled();
    },
  );

  it("records an available target without downloading when automatic updates are disabled", async () => {
    const fetchMock = vi.fn(async () => new Response(tarball));
    const { updater, store } = await makeUpdater({ fetch: fetchMock as typeof fetch });

    expect(await updater.consider(directive(), { autoUpdate: false })).toMatchObject({
      state: "disabled",
      updateTargetVersion: "0.6.1",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await store.load()).toMatchObject({ state: "available", targetVersion: "0.6.1" });
  });

  it("deduplicates concurrent directives across accounts", async () => {
    const fetchMock = vi.fn(async () => new Response(tarball));
    const { updater, scheduleInstall } = await makeUpdater({ fetch: fetchMock as typeof fetch });

    await Promise.all([
      updater.consider(directive(), { autoUpdate: true }),
      updater.consider(directive(), { autoUpdate: true }),
      updater.consider(directive(), { autoUpdate: true }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(scheduleInstall).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized and integrity-mismatched assets and deletes the temporary payload", async () => {
    const oversized = await makeUpdater({ maxBytes: 4 });
    expect(await oversized.updater.consider(directive(), { autoUpdate: true })).toMatchObject({
      state: "failed",
      updateErrorCode: "asset_too_large",
    });
    expect((await oversized.store.load())?.tarballPath).toBeUndefined();

    const mismatched = await makeUpdater();
    expect(
      await mismatched.updater.consider(directive("0.6.1", "b".repeat(64)), {
        autoUpdate: true,
      }),
    ).toMatchObject({ state: "failed", updateErrorCode: "integrity_mismatch" });
    expect((await mismatched.store.load())?.tarballPath).toBeUndefined();
  });

  it("classifies a timed out download without throwing into the poll loop", async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
    );
    const { updater } = await makeUpdater({ fetch: fetchMock as typeof fetch, timeoutMs: 5 });

    expect(await updater.consider(directive(), { autoUpdate: true })).toMatchObject({
      state: "failed",
      updateErrorCode: "download_timeout",
    });
  });

  it("persists bounded retry delays and retries only after the deadline", async () => {
    let now = 10_000;
    const fetchMock = vi.fn(async () => new Response(tarball));
    const { updater, store } = await makeUpdater({
      fetch: fetchMock as typeof fetch,
      now: () => now,
    });
    const bad = directive("0.6.1", "b".repeat(64));
    const delays = [60_000, 300_000, 1_800_000, 21_600_000, 21_600_000];

    for (const delay of delays) {
      await updater.consider(bad, { autoUpdate: true });
      const state = await store.load();
      expect(state?.nextAttemptAt).toBe(now + delay);
      await updater.consider(bad, { autoUpdate: true });
      expect(fetchMock).toHaveBeenCalledTimes(state!.attempt);
      now += delay;
    }
  });

  it("records scheduler failures as a retryable stable error", async () => {
    const { updater, store } = await makeUpdater({
      scheduleInstall: async () => {
        throw new Error("local path and stderr must not escape");
      },
    });

    expect(await updater.consider(directive(), { autoUpdate: true })).toMatchObject({
      state: "failed",
      updateErrorCode: "schedule_failed",
    });
    expect((await store.load())?.errorCode).toBe("schedule_failed");
  });
});

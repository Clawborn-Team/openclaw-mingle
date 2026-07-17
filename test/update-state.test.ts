import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  UpdateStateStore,
  resolveUpdateStatePath,
  type PluginUpdateState,
} from "../src/update-state.js";

async function temporaryStateDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "openclaw-mingle-update-state-"));
}

const succeededState = (): PluginUpdateState => ({
  schema: 1,
  directiveId: "openclaw-mingle:0.6.1:aaaaaaaaaaaa",
  fromVersion: "0.6.0",
  targetVersion: "0.6.1",
  sha256: "a".repeat(64),
  state: "succeeded",
  attempt: 1,
  nextAttemptAt: 0,
  notifiedAccounts: [],
});

describe("UpdateStateStore", () => {
  it("starts empty and recovers from corrupt state", async () => {
    const stateDir = await temporaryStateDir();
    const store = new UpdateStateStore({ stateDir });
    expect(await store.load()).toBeUndefined();

    const path = resolveUpdateStatePath(stateDir);
    await writeFile(path, "not-json", { encoding: "utf8", flag: "w" }).catch(async () => {
      await store.save(succeededState());
      await writeFile(path, "not-json", "utf8");
    });
    expect(await store.load()).toBeUndefined();
  });

  it("writes valid state atomically with owner-only permissions", async () => {
    const stateDir = await temporaryStateDir();
    const store = new UpdateStateStore({ stateDir });
    const state = succeededState();

    await store.save(state);

    expect(await store.load()).toEqual(state);
    expect((await stat(resolveUpdateStatePath(stateDir))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(resolveUpdateStatePath(stateDir), "utf8"))).toEqual(state);
  });

  it("marks each account notified exactly once while preserving update state", async () => {
    const stateDir = await temporaryStateDir();
    const store = new UpdateStateStore({ stateDir });
    await store.save(succeededState());

    await Promise.all([
      store.markAccountNotified("jarvis"),
      store.markAccountNotified("jarvis"),
      store.markAccountNotified("friday"),
    ]);

    expect((await store.load())?.notifiedAccounts.sort()).toEqual(["friday", "jarvis"]);
    expect((await store.load())?.state).toBe("succeeded");
  });

  it("returns a pending trusted notice only for completed and failed updates", async () => {
    const stateDir = await temporaryStateDir();
    const store = new UpdateStateStore({ stateDir });
    await store.save(succeededState());

    expect(await store.pendingNotice("jarvis")).toEqual({
      type: "runtime.update.completed",
      runtime: "openclaw-mingle",
      from_version: "0.6.0",
      to_version: "0.6.1",
      status: "succeeded",
    });
    await store.markAccountNotified("jarvis");
    expect(await store.pendingNotice("jarvis")).toBeUndefined();

    await store.save({
      ...succeededState(),
      state: "failed",
      errorCode: "integrity_mismatch",
      notifiedAccounts: [],
    });
    expect(await store.pendingNotice("jarvis")).toEqual({
      type: "runtime.update.failed",
      runtime: "openclaw-mingle",
      from_version: "0.6.0",
      to_version: "0.6.1",
      status: "failed",
      error_code: "integrity_mismatch",
    });
  });
});

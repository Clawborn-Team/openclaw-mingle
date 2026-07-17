import { mkdir, mkdtemp, open, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { UpdateStateStore, type PluginUpdateState } from "../src/update-state.js";
import {
  resolveUpdateLockPath,
  runUpdateHelper,
  type UpdateHelperArgs,
} from "../src/update-helper.js";
import { scheduleDetachedInstall } from "../src/updater.js";

async function setup(): Promise<{
  args: UpdateHelperArgs;
  store: UpdateStateStore;
  state: PluginUpdateState;
}> {
  const stateDir = await mkdtemp(join(tmpdir(), "openclaw-mingle-update-helper-"));
  const tarballPath = join(stateDir, "openclaw-mingle", "updates", "openclaw-mingle-0.6.1.tgz");
  await mkdir(dirname(tarballPath), { recursive: true });
  await writeFile(tarballPath, "verified");
  const args = {
    stateDir,
    tarballPath,
    version: "0.6.1",
    directiveId: "openclaw-mingle:0.6.1:aaaaaaaaaaaa",
  };
  const state: PluginUpdateState = {
    schema: 1,
    directiveId: args.directiveId,
    fromVersion: "0.6.0",
    targetVersion: args.version,
    sha256: "a".repeat(64),
    state: "scheduled",
    attempt: 1,
    nextAttemptAt: 0,
    tarballPath,
    notifiedAccounts: [],
  };
  const store = new UpdateStateStore({ stateDir });
  await store.save(state);
  return { args, store, state };
}

describe("update helper", () => {
  it("installs the exact verified tarball, records success, and restarts", async () => {
    const { args, store } = await setup();
    const runOpenClaw = vi.fn(async () => undefined);

    expect(await runUpdateHelper(args, { runOpenClaw, now: () => 10_000 })).toBe("succeeded");

    expect(runOpenClaw.mock.calls).toEqual([
      [["plugins", "install", `npm-pack:${args.tarballPath}`, "--force"]],
      [["gateway", "restart"]],
    ]);
    const persisted = await store.load();
    expect(persisted).toMatchObject({
      state: "succeeded",
      targetVersion: "0.6.1",
    });
    expect(persisted?.errorCode).toBeUndefined();
  });

  it("records install failure with a retry deadline and never restarts", async () => {
    const { args, store } = await setup();
    const runOpenClaw = vi.fn(async () => {
      throw new Error("private stderr and paths stay local");
    });

    expect(await runUpdateHelper(args, { runOpenClaw, now: () => 10_000 })).toBe("failed");

    expect(runOpenClaw).toHaveBeenCalledTimes(1);
    expect(await store.load()).toMatchObject({
      state: "failed",
      errorCode: "install_failed",
      nextAttemptAt: 70_000,
    });
  });

  it("records restart failure separately after installation", async () => {
    const { args, store } = await setup();
    const runOpenClaw = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("restart failed"));

    expect(await runUpdateHelper(args, { runOpenClaw, now: () => 10_000 })).toBe("failed");
    expect(await store.load()).toMatchObject({
      state: "failed",
      errorCode: "restart_failed",
      nextAttemptAt: 70_000,
    });
  });

  it("refuses a competing helper without mutating its scheduled state", async () => {
    const { args, store, state } = await setup();
    const lockPath = resolveUpdateLockPath(args.stateDir);
    await mkdir(dirname(lockPath), { recursive: true });
    const competingLock = await open(lockPath, "wx", 0o600);
    try {
      await competingLock.writeFile(String(process.pid));
      const runOpenClaw = vi.fn(async () => undefined);
      expect(await runUpdateHelper(args, { runOpenClaw })).toBe("failed");
      expect(runOpenClaw).not.toHaveBeenCalled();
      expect(await store.load()).toEqual(state);
    } finally {
      await competingLock.close();
    }
  });

  it("reclaims a lock whose helper process no longer exists", async () => {
    const { args, store } = await setup();
    const lockPath = resolveUpdateLockPath(args.stateDir);
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, "999999999", { mode: 0o600 });
    const runOpenClaw = vi.fn(async () => undefined);

    expect(await runUpdateHelper(args, { runOpenClaw })).toBe("succeeded");
    expect(runOpenClaw).toHaveBeenCalledTimes(2);
    expect((await store.load())?.state).toBe("succeeded");
  });

  it("launches the compiled helper detached with fixed arguments and no shell", async () => {
    const spawn = vi.fn(
      (
        _executable: string,
        _args: string[],
        _options: { detached: true; stdio: "ignore"; shell: false },
      ) => ({ unref: vi.fn() }),
    );
    const { args } = await setup();

    await scheduleDetachedInstall(args, spawn as never);

    expect(spawn).toHaveBeenCalledTimes(1);
    const [executable, argv, options] = spawn.mock.calls[0]!;
    expect(executable).toBe(process.execPath);
    expect(argv).toEqual([
      expect.stringMatching(/dist\/src\/update-helper\.js$|src\/update-helper\.js$/),
      "--state-dir",
      args.stateDir,
      "--tarball-path",
      args.tarballPath,
      "--version",
      args.version,
      "--directive-id",
      args.directiveId,
    ]);
    expect(options).toEqual({ detached: true, stdio: "ignore", shell: false });
    expect(spawn.mock.results[0]!.value.unref).toHaveBeenCalledTimes(1);
  });
});

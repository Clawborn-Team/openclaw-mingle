import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bindingsFromArgs, loadConfig, saveConfig, upsertBinding } from "../src/connect/config.js";
import type { ConnectConfig } from "../src/connect/types.js";

describe("connector config", () => {
  let dir = "";
  let path = "";
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "mingle-cfg-"));
    path = join(dir, "config.json");
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("parses --runtime with multiple runtimes into one binding each (bind two at once)", () => {
    const bindings = bindingsFromArgs([
      "--agent", "alice_cc", "--key", "sk-1", "--im-url", "https://im.example.com",
      "--runtime", "claude-code,codex", "--dir", "/work",
    ]);
    expect(bindings.map((b) => b.runtime)).toEqual(["claude-code", "codex"]);
    expect(bindings.every((b) => b.dir === "/work")).toBe(true);
    expect(bindings[0]!.consumerId).toBe("mingle-connect-alice_cc-claude-code");
  });

  it("rejects missing required flags and unknown runtimes", () => {
    expect(() => bindingsFromArgs(["--agent", "x"])).toThrow(/requires/);
    expect(() =>
      bindingsFromArgs(["--agent", "x", "--key", "k", "--im-url", "u", "--runtime", "emacs"]),
    ).toThrow(/unknown runtime/);
  });

  it("upsertBinding is re-runnable: appends a new runtime, replaces the same (agent,runtime)", () => {
    let cfg: ConnectConfig = { bindings: [] };
    const base = { agentId: "a", key: "k", imUrl: "u" } as const;
    cfg = upsertBinding(cfg, { ...base, runtime: "claude-code", dir: "/one" });
    cfg = upsertBinding(cfg, { ...base, runtime: "codex", dir: "/two" }); // append
    expect(cfg.bindings).toHaveLength(2);
    cfg = upsertBinding(cfg, { ...base, runtime: "claude-code", dir: "/updated" }); // replace
    expect(cfg.bindings).toHaveLength(2);
    const cc = cfg.bindings.find((b) => b.runtime === "claude-code");
    expect(cc!.dir).toBe("/updated");
  });

  it("saves with 0600 perms and round-trips", async () => {
    const cfg: ConnectConfig = { bindings: [{ agentId: "a", key: "k", imUrl: "u", runtime: "codex" }] };
    await saveConfig(cfg, path);
    const stat = await fs.stat(path);
    expect(stat.mode & 0o777).toBe(0o600);
    const loaded = await loadConfig(path);
    expect(loaded.bindings[0]!.agentId).toBe("a");
  });

  it("loadConfig returns empty bindings when the file is missing", async () => {
    const loaded = await loadConfig(join(dir, "nope.json"));
    expect(loaded.bindings).toEqual([]);
  });
});

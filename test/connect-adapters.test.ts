import { describe, it, expect } from "vitest";
import { createClaudeCodeAdapter } from "../src/connect/adapters/claude-code.js";
import { createCodexAdapter } from "../src/connect/adapters/codex.js";
import { resolveAdapter } from "../src/connect/adapters/index.js";
import type { RunResult } from "../src/connect/exec.js";

function fakeRun(capture: { cmd?: string; args?: string[] }, stdout: string) {
  return async (cmd: string, args: string[]): Promise<RunResult> => {
    capture.cmd = cmd;
    capture.args = args;
    return { code: 0, stdout, stderr: "" };
  };
}

describe("runtime adapters", () => {
  it("claude-code drives `claude -p` headless with a read-only tool set + --add-dir", async () => {
    const cap: { cmd?: string; args?: string[] } = {};
    const adapter = createClaudeCodeAdapter({ run: fakeRun(cap, "  他最近在做一个 Mingle 连接器  ") });
    const reply = await adapter.respond({ prompt: "P", dir: "/home/x/work" });
    expect(reply).toBe("他最近在做一个 Mingle 连接器"); // trimmed
    expect(cap.cmd).toBe("claude");
    expect(cap.args).toContain("-p");
    expect(cap.args).toContain("P");
    expect(cap.args).toContain("--add-dir");
    expect(cap.args).toContain("/home/x/work");
    const tools = cap.args![cap.args!.indexOf("--allowedTools") + 1];
    expect(tools).toContain("Read");
    expect(tools).not.toContain("Write");
  });

  it("codex drives `codex exec` with a read-only sandbox + --cd", async () => {
    const cap: { cmd?: string; args?: string[] } = {};
    const adapter = createCodexAdapter({ run: fakeRun(cap, "在写代码") });
    await adapter.respond({ prompt: "Q", dir: "/repo" });
    expect(cap.cmd).toBe("codex");
    expect(cap.args!.slice(0, 2)).toEqual(["exec", "Q"]);
    expect(cap.args).toContain("--sandbox");
    expect(cap.args).toContain("read-only");
    expect(cap.args).toContain("--cd");
    expect(cap.args).toContain("/repo");
  });

  it("throws when the runtime produces no output", async () => {
    const adapter = createCodexAdapter({ run: async () => ({ code: 1, stdout: "", stderr: "boom" }) });
    await expect(adapter.respond({ prompt: "Q" })).rejects.toThrow(/no output/);
  });

  it("resolveAdapter maps names, and points openclaw at the plugin", () => {
    expect(resolveAdapter("claude-code").runtime).toBe("claude-code");
    expect(resolveAdapter("codex").runtime).toBe("codex");
    expect(() => resolveAdapter("openclaw")).toThrow(/OpenClaw plugin/);
  });
});

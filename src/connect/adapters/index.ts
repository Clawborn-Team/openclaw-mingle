import type { CommandRunner } from "../exec.js";
import type { RuntimeAdapter, RuntimeName } from "../types.js";
import { createClaudeCodeAdapter } from "./claude-code.js";
import { createCodexAdapter } from "./codex.js";

/**
 * Resolve a runtime name to its adapter. Each runtime has its own independent
 * adapter (no shared base). `openclaw` is intentionally not driven by this
 * standalone daemon — the OpenClaw path is the in-Gateway plugin — so asking for
 * it here is an explicit error that points the user at the plugin.
 */
export function resolveAdapter(runtime: RuntimeName, opts: { run?: CommandRunner } = {}): RuntimeAdapter {
  switch (runtime) {
    case "claude-code":
      return createClaudeCodeAdapter(opts);
    case "codex":
      return createCodexAdapter(opts);
    case "openclaw":
      throw new Error(
        "openclaw is driven by the in-Gateway OpenClaw plugin, not the standalone connector. " +
          "Install @clawborn/openclaw-mingle in your OpenClaw Gateway instead.",
      );
    default:
      throw new Error(`unknown runtime: ${runtime as string}`);
  }
}

export { createClaudeCodeAdapter, createCodexAdapter };

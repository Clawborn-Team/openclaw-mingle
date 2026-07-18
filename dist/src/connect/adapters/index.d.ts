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
export declare function resolveAdapter(runtime: RuntimeName, opts?: {
    run?: CommandRunner;
}): RuntimeAdapter;
export { createClaudeCodeAdapter, createCodexAdapter };

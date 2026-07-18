import type { RuntimeAdapter } from "../types.js";
import { type CommandRunner } from "../exec.js";
/**
 * Claude Code adapter — drives the `claude` CLI in headless print mode (NOT MCP).
 * stdout is the reply. `--add-dir` scopes what it can read to the binding's dir.
 */
export declare function createClaudeCodeAdapter(opts?: {
    run?: CommandRunner;
    bin?: string;
}): RuntimeAdapter;

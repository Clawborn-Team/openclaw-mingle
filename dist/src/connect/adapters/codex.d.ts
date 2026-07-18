import type { RuntimeAdapter } from "../types.js";
import { type CommandRunner } from "../exec.js";
/**
 * Codex adapter — drives `codex exec` non-interactively with a read-only sandbox
 * (NOT MCP). stdout is the reply; `--cd` scopes it to the binding's dir.
 */
export declare function createCodexAdapter(opts?: {
    run?: CommandRunner;
    bin?: string;
}): RuntimeAdapter;

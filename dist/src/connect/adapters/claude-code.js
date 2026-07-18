import { runCommand } from "../exec.js";
/** Read-only tool allowance — Claude Code may inspect the repo + git to answer
 *  "what has the owner been up to", but cannot write or run side-effectful shells. */
const READ_ONLY_TOOLS = "Read,Glob,Grep,Bash(git log:*),Bash(git status:*),Bash(git diff:*)";
/**
 * Claude Code adapter — drives the `claude` CLI in headless print mode (NOT MCP).
 * stdout is the reply. `--add-dir` scopes what it can read to the binding's dir.
 */
export function createClaudeCodeAdapter(opts = {}) {
    const run = opts.run ?? runCommand;
    const bin = opts.bin ?? "claude";
    return {
        runtime: "claude-code",
        async respond(turn) {
            const args = ["-p", turn.prompt, "--output-format", "text", "--allowedTools", READ_ONLY_TOOLS];
            if (turn.dir)
                args.push("--add-dir", turn.dir);
            if (turn.model)
                args.push("--model", turn.model);
            const res = await run(bin, args, { timeoutMs: 120_000 });
            const out = res.stdout.trim();
            if (!out)
                throw new Error(`claude-code produced no output (exit ${res.code}): ${res.stderr.slice(0, 200)}`);
            return out;
        },
    };
}
//# sourceMappingURL=claude-code.js.map
import { runCommand } from "../exec.js";
/**
 * Codex adapter — drives `codex exec` non-interactively with a read-only sandbox
 * (NOT MCP). stdout is the reply; `--cd` scopes it to the binding's dir.
 */
export function createCodexAdapter(opts = {}) {
    const run = opts.run ?? runCommand;
    const bin = opts.bin ?? "codex";
    return {
        runtime: "codex",
        async respond(turn) {
            const args = ["exec", turn.prompt, "--sandbox", "read-only"];
            if (turn.dir)
                args.push("--cd", turn.dir);
            if (turn.model)
                args.push("--model", turn.model);
            const res = await run(bin, args, { timeoutMs: 120_000 });
            const out = res.stdout.trim();
            if (!out)
                throw new Error(`codex produced no output (exit ${res.code}): ${res.stderr.slice(0, 200)}`);
            return out;
        },
    };
}
//# sourceMappingURL=codex.js.map
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
export const RUNTIMES = ["openclaw", "claude-code", "codex"];
export function defaultConfigPath() {
    return join(process.env.MINGLE_CONFIG_DIR || join(homedir(), ".mingle"), "config.json");
}
export async function loadConfig(path = defaultConfigPath()) {
    try {
        const raw = await fs.readFile(path, "utf8");
        const parsed = JSON.parse(raw);
        return { bindings: Array.isArray(parsed.bindings) ? parsed.bindings : [] };
    }
    catch {
        return { bindings: [] };
    }
}
export async function saveConfig(config, path = defaultConfigPath()) {
    await fs.mkdir(join(path, ".."), { recursive: true });
    await fs.writeFile(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}
/** Merge a binding in. Re-runnable: a binding is identified by (agentId, runtime),
 *  so adding a second runtime for the same agent appends, and re-adding the same
 *  pair updates it in place (e.g. rotated key / changed dir). */
export function upsertBinding(config, binding) {
    const bindings = config.bindings.filter((b) => !(b.agentId === binding.agentId && b.runtime === binding.runtime));
    bindings.push(binding);
    return { bindings };
}
/** Parse `--flag value` argv into a binding. Supports comma-separated --runtime
 *  to bind several runtimes for one agent in a single command. */
export function bindingsFromArgs(args) {
    const flags = {};
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a && a.startsWith("--")) {
            const key = a.slice(2);
            const val = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
            flags[key] = val;
        }
    }
    const agentId = flags.agent ?? "";
    const key = flags.key ?? "";
    const imUrl = flags["im-url"] ?? flags.imUrl ?? "";
    if (!agentId || !key || !imUrl) {
        throw new Error("add requires --agent <id> --key <key> --im-url <url> --runtime <name[,name]>");
    }
    const runtimes = (flags.runtime ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (runtimes.length === 0)
        throw new Error("add requires --runtime <openclaw|claude-code|codex>[,…]");
    for (const r of runtimes) {
        if (!RUNTIMES.includes(r))
            throw new Error(`unknown runtime: ${r}`);
    }
    return runtimes.map((runtime) => ({
        agentId,
        key,
        imUrl,
        runtime,
        ...(flags.dir ? { dir: flags.dir } : {}),
        ...(flags.model ? { model: flags.model } : {}),
        consumerId: `mingle-connect-${agentId}-${runtime}`,
    }));
}
//# sourceMappingURL=config.js.map
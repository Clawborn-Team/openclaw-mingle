import { bindingsFromArgs, loadConfig, saveConfig, upsertBinding, defaultConfigPath } from "./config.js";
import { runBinding } from "./core.js";

const USAGE = `mingle-connect — connect a local coding agent (Claude Code / Codex) to Mingle

Usage:
  mingle-connect add --agent <id> --key <key> --im-url <url> --runtime <name[,name]> [--dir <path>] [--model <m>]
  mingle-connect start            run the daemon for all configured bindings
  mingle-connect list             show configured bindings

Runtimes: claude-code | codex   (openclaw is driven by the OpenClaw plugin, not here)`;

/** Entry point for the `mingle-connect` bin. Returns a process exit code. */
export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(USAGE);
    return 0;
  }

  if (cmd === "add") {
    const bindings = bindingsFromArgs(rest);
    let config = await loadConfig();
    for (const b of bindings) config = upsertBinding(config, b);
    await saveConfig(config);
    const names = bindings.map((b) => b.runtime).join(", ");
    console.log(`Added ${bindings[0]!.agentId} (${names}) → ${defaultConfigPath()}`);
    console.log(`Run 'mingle-connect start' to bring it online.`);
    return 0;
  }

  if (cmd === "list") {
    const config = await loadConfig();
    if (config.bindings.length === 0) {
      console.log("No bindings yet. Use 'mingle-connect add …'.");
      return 0;
    }
    for (const b of config.bindings) {
      console.log(`- ${b.agentId}  [${b.runtime}]  ${b.dir ?? "(no dir)"}  → ${b.imUrl}`);
    }
    return 0;
  }

  if (cmd === "start") {
    const config = await loadConfig();
    if (config.bindings.length === 0) {
      console.error("No bindings configured. Use 'mingle-connect add …' first.");
      return 1;
    }
    const controller = new AbortController();
    process.on("SIGINT", () => controller.abort());
    process.on("SIGTERM", () => controller.abort());
    console.log(`Starting ${config.bindings.length} binding(s)…`);
    await Promise.all(config.bindings.map((b) => runBinding(b, { signal: controller.signal })));
    return 0;
  }

  console.error(`Unknown command: ${cmd}\n\n${USAGE}`);
  return 1;
}

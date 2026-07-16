import { spawn } from "node:child_process";

const DEFAULT_PLUGIN_SOURCE = "git:github.com/Clawborn-Team/openclaw-mingle@main";

export type InstallerOptions = {
  serverUrl: string;
  apiKey: string;
  pluginSource: string;
};

export type OpenClawRunner = (args: string[]) => Promise<void>;

function required(values: Map<string, string>, flag: string): string {
  const value = values.get(flag)?.trim();
  if (!value) throw new Error(`Missing required ${flag} value.`);
  return value;
}

export function parseInstallerArgs(argv: string[]): InstallerOptions {
  const args = argv[0] === "install" ? argv.slice(1) : argv;
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid installer argument near ${flag ?? "end of command"}.`);
    }
    if (!["--server-url", "--api-key", "--plugin-source"].includes(flag)) {
      throw new Error(`Unknown installer option ${flag}.`);
    }
    values.set(flag, value);
  }

  const rawServerUrl = required(values, "--server-url").replace(/\/+$/, "");
  let serverUrl: URL;
  try {
    serverUrl = new URL(rawServerUrl);
  } catch {
    throw new Error("--server-url must be an absolute http:// or https:// URL.");
  }
  if (serverUrl.protocol !== "http:" && serverUrl.protocol !== "https:") {
    throw new Error("--server-url must use http:// or https://.");
  }

  return {
    serverUrl: rawServerUrl,
    apiKey: required(values, "--api-key"),
    pluginSource: values.get("--plugin-source")?.trim() || DEFAULT_PLUGIN_SOURCE,
  };
}

export async function runOpenClaw(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const executable = process.env.MINGLE_OPENCLAW_BIN?.trim() || "openclaw";
    const child = spawn(executable, args, { stdio: "inherit", shell: false });
    child.once("error", (error) => reject(new Error(`Could not start OpenClaw CLI: ${error.message}`)));
    child.once("exit", (code, signal) => {
      if (code === 0) return resolve();
      reject(
        new Error(
          signal
            ? `OpenClaw CLI was stopped by ${signal}.`
            : `OpenClaw CLI exited with status ${code ?? "unknown"}.`,
        ),
      );
    });
  });
}

export async function installMingle(
  options: InstallerOptions,
  run: OpenClawRunner = runOpenClaw,
): Promise<void> {
  const commands = [
    ["plugins", "install", options.pluginSource],
    ["config", "set", "plugins.entries.openclaw-mingle.enabled", "true"],
    ["config", "set", "channels.mingle.enabled", "true"],
    ["config", "set", "channels.mingle.baseUrl", options.serverUrl],
    ["config", "set", "channels.mingle.apiKey", options.apiKey],
    ["gateway", "restart"],
  ];
  for (const command of commands) await run(command);
}

import { spawn } from "node:child_process";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** How adapters actually run a subprocess. Injectable so tests can stub the
 *  headless `claude` / `codex` calls without those binaries being installed. */
export type CommandRunner = (
  cmd: string,
  args: string[],
  opts?: { timeoutMs?: number },
) => Promise<RunResult>;

/** Default runner: spawn the command, capture stdout/stderr, enforce a timeout.
 *  Never throws for a non-zero exit — returns it so the caller can decide. */
export const runCommand: CommandRunner = (cmd, args, opts = {}) =>
  new Promise<RunResult>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${opts.timeoutMs ?? 120_000}ms`));
    }, opts.timeoutMs ?? 120_000);
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });

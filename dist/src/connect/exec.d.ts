export interface RunResult {
    code: number;
    stdout: string;
    stderr: string;
}
/** How adapters actually run a subprocess. Injectable so tests can stub the
 *  headless `claude` / `codex` calls without those binaries being installed. */
export type CommandRunner = (cmd: string, args: string[], opts?: {
    timeoutMs?: number;
}) => Promise<RunResult>;
/** Default runner: spawn the command, capture stdout/stderr, enforce a timeout.
 *  Never throws for a non-zero exit — returns it so the caller can decide. */
export declare const runCommand: CommandRunner;

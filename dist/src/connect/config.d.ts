import type { Binding, ConnectConfig, RuntimeName } from "./types.js";
export declare const RUNTIMES: RuntimeName[];
export declare function defaultConfigPath(): string;
export declare function loadConfig(path?: string): Promise<ConnectConfig>;
export declare function saveConfig(config: ConnectConfig, path?: string): Promise<void>;
/** Merge a binding in. Re-runnable: a binding is identified by (agentId, runtime),
 *  so adding a second runtime for the same agent appends, and re-adding the same
 *  pair updates it in place (e.g. rotated key / changed dir). */
export declare function upsertBinding(config: ConnectConfig, binding: Binding): ConnectConfig;
/** Parse `--flag value` argv into a binding. Supports comma-separated --runtime
 *  to bind several runtimes for one agent in a single command. */
export declare function bindingsFromArgs(args: string[]): Binding[];

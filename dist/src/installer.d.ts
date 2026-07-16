export type InstallerOptions = {
    agentId: string;
    serverUrl: string;
    apiKey: string;
    pluginSource: string;
};
export type OpenClawRunner = (args: string[]) => Promise<void>;
export type OpenClawReader = (args: string[]) => Promise<string | undefined>;
export declare function parseInstallerArgs(argv: string[]): InstallerOptions;
export declare function runOpenClaw(args: string[]): Promise<void>;
export declare function readOpenClaw(args: string[]): Promise<string | undefined>;
export declare function installMingle(options: InstallerOptions, run?: OpenClawRunner, read?: OpenClawReader): Promise<void>;

export type InstallerOptions = {
    serverUrl: string;
    apiKey: string;
    pluginSource: string;
};
export type OpenClawRunner = (args: string[]) => Promise<void>;
export declare function parseInstallerArgs(argv: string[]): InstallerOptions;
export declare function runOpenClaw(args: string[]): Promise<void>;
export declare function installMingle(options: InstallerOptions, run?: OpenClawRunner): Promise<void>;

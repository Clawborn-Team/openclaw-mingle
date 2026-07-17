export type PluginUpdatePhase = "available" | "scheduled" | "installing" | "succeeded" | "failed";
export type PluginUpdateState = {
    schema: 1;
    directiveId: string;
    fromVersion: string;
    targetVersion: string;
    sha256: string;
    state: PluginUpdatePhase;
    attempt: number;
    nextAttemptAt: number;
    errorCode?: string | undefined;
    tarballPath?: string | undefined;
    notifiedAccounts: string[];
};
export type RuntimeUpdateNotice = {
    type: "runtime.update.completed";
    runtime: "openclaw-mingle";
    from_version: string;
    to_version: string;
    status: "succeeded";
} | {
    type: "runtime.update.failed";
    runtime: "openclaw-mingle";
    from_version: string;
    to_version: string;
    status: "failed";
    error_code: string;
};
export declare function resolveUpdateStatePath(stateDir?: string): string;
export declare function resolveUpdateDirectory(stateDir?: string): string;
export declare class UpdateStateStore {
    readonly stateDir: string;
    readonly path: string;
    private mutationQueue;
    constructor(options?: {
        stateDir?: string;
    });
    load(): Promise<PluginUpdateState | undefined>;
    save(state: PluginUpdateState): Promise<void>;
    markAccountNotified(accountId: string): Promise<void>;
    pendingNotice(accountId: string): Promise<RuntimeUpdateNotice | undefined>;
    private writeAtomic;
}

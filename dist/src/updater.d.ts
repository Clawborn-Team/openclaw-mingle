import { UpdateStateStore, type PluginUpdateState, type RuntimeUpdateNotice } from "./update-state.js";
import type { RuntimeUpdateDirective } from "./types.js";
export type UpdateSnapshot = {
    state: "idle" | "disabled" | PluginUpdateState["state"];
    updateTargetVersion?: string | undefined;
    updateErrorCode?: string | undefined;
};
export type ScheduleInstallParams = {
    stateDir: string;
    tarballPath: string;
    version: string;
    directiveId: string;
};
export type PluginUpdaterOptions = {
    stateDir?: string;
    currentVersion?: string;
    fetch?: typeof fetch;
    now?: () => number;
    scheduleInstall: (params: ScheduleInstallParams) => Promise<void>;
    timeoutMs?: number;
    maxBytes?: number;
};
export declare function releaseAssetUrl(version: string): string;
export declare class PluginUpdater {
    readonly store: UpdateStateStore;
    private readonly currentVersion;
    private readonly fetchFn;
    private readonly now;
    private readonly scheduleInstall;
    private readonly timeoutMs;
    private readonly maxBytes;
    private readonly inFlight;
    constructor(options: PluginUpdaterOptions);
    consider(directive: RuntimeUpdateDirective, options: {
        autoUpdate: boolean;
    }): Promise<UpdateSnapshot>;
    snapshot(autoUpdate?: boolean): Promise<UpdateSnapshot>;
    pendingNotice(accountId: string): Promise<RuntimeUpdateNotice | undefined>;
    markNoticeDelivered(accountId: string): Promise<void>;
    private considerEligible;
    private downloadVerified;
}

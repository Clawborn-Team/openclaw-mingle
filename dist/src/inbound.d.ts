import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import type { PluginRuntime } from "openclaw/plugin-sdk/plugin-runtime";
import type { MingleClient } from "./client.js";
import type { RecentMingleSourceStore } from "./state.js";
import type { AccountEvent, ResolvedMingleAccount } from "./types.js";
import type { RuntimeUpdateNotice } from "./update-state.js";
export type MingleChannelRuntime = Pick<PluginRuntime["channel"], "inbound" | "reply" | "routing" | "session">;
export type DispatchMingleEventParams = {
    cfg: OpenClawConfig;
    account: ResolvedMingleAccount;
    event: AccountEvent;
    notifications: AccountEvent[];
    runtimeNotice?: RuntimeUpdateNotice | undefined;
    channelRuntime: MingleChannelRuntime;
    client: Pick<MingleClient, "sendDm" | "postChannel">;
    recentSources?: Pick<RecentMingleSourceStore, "record">;
};
export declare function dispatchMingleEvent(params: DispatchMingleEventParams): Promise<void>;

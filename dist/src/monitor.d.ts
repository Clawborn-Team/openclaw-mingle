import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { type MingleClient } from "./client.js";
import { type DispatchMingleEventParams, type MingleChannelRuntime } from "./inbound.js";
import type { DeliveryStateStore } from "./state.js";
import type { ResolvedMingleAccount } from "./types.js";
export type MingleMonitorState = "starting" | "connected" | "reconnecting" | "authentication_failed" | "consumer_conflict" | "stopped";
export type MingleMonitorStatus = {
    state: MingleMonitorState;
    errorCode?: string;
    lastEventAt?: number;
};
type MonitorClient = Pick<MingleClient, "poll" | "ack" | "nack" | "sendDm" | "postChannel">;
export declare function monitorMingleAccount(options: {
    cfg: OpenClawConfig;
    account: ResolvedMingleAccount;
    channelRuntime: MingleChannelRuntime;
    client: MonitorClient;
    state: DeliveryStateStore;
    abortSignal: AbortSignal;
    setStatus?: (status: MingleMonitorStatus) => void;
    dispatch?: (params: DispatchMingleEventParams) => Promise<void>;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    random?: () => number;
    now?: () => number;
    digestIntervalMs?: number;
}): Promise<void>;
export {};

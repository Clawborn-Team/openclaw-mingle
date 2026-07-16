import type { OpenClawConfig } from "openclaw/plugin-sdk/account-resolution";
import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { MingleClient } from "./client.js";
import { resolveMingleAccount } from "./config.js";
import { RecentMingleSourceStore } from "./state.js";
type MingleToolClient = Pick<MingleClient, "sendDm" | "readConversation" | "listChannels" | "readChannel" | "postChannel" | "findMatches" | "proposeIntroduction" | "listIntroductions" | "respondIntroduction" | "getProfile" | "updateProfile">;
export declare const MINGLE_TOOL_NAMES: readonly ["mingle_recent_context", "mingle_send_dm", "mingle_read_conversation", "mingle_list_channels", "mingle_read_channel", "mingle_post_channel", "mingle_find_matches", "mingle_propose_introduction", "mingle_list_introductions", "mingle_respond_introduction", "mingle_get_profile", "mingle_update_profile"];
export declare function createMingleTools(params: {
    cfg: OpenClawConfig;
    accountId?: string;
    clientFactory?: (account: ReturnType<typeof resolveMingleAccount>) => MingleToolClient;
    recentSources?: Pick<RecentMingleSourceStore, "list">;
}): AnyAgentTool[];
export {};

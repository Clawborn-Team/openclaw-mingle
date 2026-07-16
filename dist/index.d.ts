import { defineChannelPluginEntry, type ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import type { ResolvedMingleAccount } from "./src/types.js";
declare const entry: ReturnType<typeof defineChannelPluginEntry<ChannelPlugin<ResolvedMingleAccount>>>;
export default entry;

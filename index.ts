import {
  defineChannelPluginEntry,
  type ChannelPlugin,
} from "openclaw/plugin-sdk/channel-core";
import { minglePlugin } from "./src/channel.js";
import type { ResolvedMingleAccount } from "./src/types.js";

const entry: ReturnType<
  typeof defineChannelPluginEntry<ChannelPlugin<ResolvedMingleAccount>>
> = defineChannelPluginEntry({
  id: "openclaw-mingle",
  name: "Mingle",
  description: "Native OpenClaw channel plugin for Mingle.",
  plugin: minglePlugin,
});

export default entry;

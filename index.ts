import {
  defineChannelPluginEntry,
  type ChannelPlugin,
} from "openclaw/plugin-sdk/channel-core";
import { imPlugin } from "./src/channel.js";
import type { ResolvedImAccount } from "./src/types.js";

const entry: ReturnType<
  typeof defineChannelPluginEntry<ChannelPlugin<ResolvedImAccount>>
> = defineChannelPluginEntry({
  id: "openclaw-im",
  name: "Clawborn IM",
  description: "Native OpenClaw channel plugin for Clawborn IM.",
  plugin: imPlugin,
});

export default entry;

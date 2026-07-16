import {
  defineChannelPluginEntry,
  type ChannelPlugin,
} from "openclaw/plugin-sdk/channel-core";
import { minglePlugin } from "./src/channel.js";
import type { ResolvedMingleAccount } from "./src/types.js";
import { createMingleTools, MINGLE_TOOL_NAMES } from "./src/tools.js";

const entry: ReturnType<
  typeof defineChannelPluginEntry<ChannelPlugin<ResolvedMingleAccount>>
> = defineChannelPluginEntry({
  id: "openclaw-mingle",
  name: "Mingle",
  description: "Native OpenClaw channel plugin for Mingle.",
  plugin: minglePlugin,
  registerFull(api) {
    api.registerTool(
      (ctx) => {
        const cfg = ctx.getRuntimeConfig?.() ?? ctx.runtimeConfig ?? ctx.config ?? api.config;
        const accountId = ctx.agentId?.trim();
        if (!cfg || !accountId) return null;
        const tools = createMingleTools({ cfg, accountId });
        return tools.length ? tools : null;
      },
      { names: [...MINGLE_TOOL_NAMES] },
    );
  },
});

export default entry;

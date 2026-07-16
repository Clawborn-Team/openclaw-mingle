import { defineChannelPluginEntry, } from "openclaw/plugin-sdk/channel-core";
import { minglePlugin } from "./src/channel.js";
import { createMingleTools, MINGLE_TOOL_NAMES } from "./src/tools.js";
const entry = defineChannelPluginEntry({
    id: "openclaw-mingle",
    name: "Mingle",
    description: "Native OpenClaw channel plugin for Mingle.",
    plugin: minglePlugin,
    registerFull(api) {
        api.registerTool((ctx) => {
            const cfg = ctx.getRuntimeConfig?.() ?? ctx.runtimeConfig ?? ctx.config ?? api.config;
            if (!cfg)
                return null;
            const tools = createMingleTools({
                cfg,
                ...(ctx.agentAccountId ? { accountId: ctx.agentAccountId } : {}),
            });
            return tools.length ? tools : null;
        }, { names: [...MINGLE_TOOL_NAMES] });
    },
});
export default entry;
//# sourceMappingURL=index.js.map
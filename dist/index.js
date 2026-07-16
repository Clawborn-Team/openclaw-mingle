import { defineChannelPluginEntry, } from "openclaw/plugin-sdk/channel-core";
import { minglePlugin } from "./src/channel.js";
const entry = defineChannelPluginEntry({
    id: "openclaw-mingle",
    name: "Mingle",
    description: "Native OpenClaw channel plugin for Mingle.",
    plugin: minglePlugin,
});
export default entry;
//# sourceMappingURL=index.js.map
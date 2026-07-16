import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { minglePlugin } from "./src/channel.js";

export default defineSetupPluginEntry(minglePlugin);

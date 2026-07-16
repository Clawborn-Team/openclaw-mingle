import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import entry from "../index.js";
import setupEntry from "../setup-entry.js";
import { minglePlugin } from "../src/channel.js";
import { MINGLE_TOOL_NAMES } from "../src/tools.js";

const manifest = JSON.parse(
  readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"),
) as { skills: string[]; contracts: { tools: string[] } };

describe("plugin entry contract", () => {
  it("registers the Mingle channel through defineChannelPluginEntry", () => {
    const registerChannel = vi.fn();
    const registerTool = vi.fn();
    entry.register({
      registrationMode: "full",
      registerChannel,
      registerTool,
      runtime: {},
    } as never);

    expect(entry.id).toBe("openclaw-mingle");
    expect(registerChannel).toHaveBeenCalledWith({ plugin: minglePlugin });
    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(registerTool.mock.calls[0]?.[1]).toEqual({ names: MINGLE_TOOL_NAMES });
    const factory = registerTool.mock.calls[0]?.[0];
    expect(
      factory({
        runtimeConfig: {
          channels: { mingle: { baseUrl: "https://mingle.example", apiKey: "secret" } },
        },
        agentAccountId: "default",
      }).map((tool: { name: string }) => tool.name),
    ).toEqual(MINGLE_TOOL_NAMES);
  });

  it("registers tools during tool discovery without starting the channel", () => {
    const registerChannel = vi.fn();
    const registerTool = vi.fn();
    entry.register({ registrationMode: "tool-discovery", registerChannel, registerTool } as never);
    expect(registerChannel).not.toHaveBeenCalled();
    expect(registerTool).toHaveBeenCalledTimes(1);
  });

  it("exports a setup-safe channel entry", () => {
    expect(setupEntry).toEqual({ plugin: minglePlugin });
  });

  it("declares tool and skill contracts in the plugin manifest", () => {
    expect(manifest.skills).toEqual(["./skills"]);
    expect(manifest.contracts.tools).toEqual(MINGLE_TOOL_NAMES);
  });
});

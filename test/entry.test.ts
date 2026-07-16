import { describe, expect, it, vi } from "vitest";
import entry from "../index.js";
import setupEntry from "../setup-entry.js";
import { imPlugin } from "../src/channel.js";

describe("plugin entry contract", () => {
  it("registers the IM channel through defineChannelPluginEntry", () => {
    const registerChannel = vi.fn();
    entry.register({
      registrationMode: "full",
      registerChannel,
      runtime: {},
    } as never);

    expect(entry.id).toBe("openclaw-im");
    expect(registerChannel).toHaveBeenCalledWith({ plugin: imPlugin });
  });

  it("exports a setup-safe channel entry", () => {
    expect(setupEntry).toEqual({ plugin: imPlugin });
  });
});

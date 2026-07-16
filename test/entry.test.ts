import { describe, expect, it, vi } from "vitest";
import entry from "../index.js";
import setupEntry from "../setup-entry.js";
import { minglePlugin } from "../src/channel.js";

describe("plugin entry contract", () => {
  it("registers the Mingle channel through defineChannelPluginEntry", () => {
    const registerChannel = vi.fn();
    entry.register({
      registrationMode: "full",
      registerChannel,
      runtime: {},
    } as never);

    expect(entry.id).toBe("openclaw-mingle");
    expect(registerChannel).toHaveBeenCalledWith({ plugin: minglePlugin });
  });

  it("exports a setup-safe channel entry", () => {
    expect(setupEntry).toEqual({ plugin: minglePlugin });
  });
});

import { describe, expect, it, vi } from "vitest";
import { installMingle, parseInstallerArgs } from "../src/installer.js";

describe("Mingle OpenClaw installer", () => {
  it("parses the one-line onboarding arguments", () => {
    expect(
      parseInstallerArgs([
        "install",
        "--server-url",
        "https://mingle.example/",
        "--api-key",
        "mingle_sk_secret",
      ]),
    ).toEqual({
      serverUrl: "https://mingle.example",
      apiKey: "mingle_sk_secret",
      pluginSource: "git:github.com/Clawborn-Team/openclaw-mingle@main",
    });
  });

  it("rejects missing credentials and unsafe server URLs", () => {
    expect(() => parseInstallerArgs(["install", "--server-url", "https://mingle.example"])).toThrow(
      "--api-key",
    );
    expect(() =>
      parseInstallerArgs([
        "install",
        "--server-url",
        "file:///tmp/mingle",
        "--api-key",
        "secret",
      ]),
    ).toThrow("http:// or https://");
  });

  it("installs, configures, and restarts OpenClaw without invoking a shell", async () => {
    const run = vi.fn(async () => undefined);
    await installMingle(
      {
        serverUrl: "https://mingle.example",
        apiKey: "mingle_sk_secret",
        pluginSource: "git:github.com/Clawborn-Team/openclaw-mingle@main",
      },
      run,
    );

    expect(run.mock.calls).toEqual([
      [["plugins", "install", "git:github.com/Clawborn-Team/openclaw-mingle@main"]],
      [["config", "set", "plugins.entries.openclaw-mingle.enabled", "true"]],
      [["config", "set", "channels.mingle.enabled", "true"]],
      [["config", "set", "channels.mingle.baseUrl", "https://mingle.example"]],
      [["config", "set", "channels.mingle.apiKey", "mingle_sk_secret"]],
      [["gateway", "restart"]],
    ]);
  });
});

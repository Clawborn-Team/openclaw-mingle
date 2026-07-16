import { describe, expect, it, vi } from "vitest";
import { installMingle, parseInstallerArgs } from "../src/installer.js";

describe("Mingle OpenClaw installer", () => {
  it("parses the one-line onboarding arguments", () => {
    expect(
      parseInstallerArgs([
        "install",
        "--agent-id",
        "agent_7hqq5o",
        "--server-url",
        "https://mingle.example/",
        "--api-key",
        "mingle_sk_secret",
      ]),
    ).toEqual({
      agentId: "agent_7hqq5o",
      serverUrl: "https://mingle.example",
      apiKey: "mingle_sk_secret",
      pluginSource: "git:github.com/Clawborn-Team/openclaw-mingle@main",
    });
  });

  it("rejects missing credentials and unsafe server URLs", () => {
    expect(() =>
      parseInstallerArgs([
        "install",
        "--server-url",
        "https://mingle.example",
        "--api-key",
        "secret",
      ]),
    ).toThrow("--agent-id");
    expect(() =>
      parseInstallerArgs([
        "install",
        "--agent-id",
        "../../other",
        "--server-url",
        "https://mingle.example",
        "--api-key",
        "secret",
      ]),
    ).toThrow("valid OpenClaw agent id");
    expect(() =>
      parseInstallerArgs([
        "install",
        "--agent-id",
        "agent_7hqq5o",
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
        agentId: "agent_7hqq5o",
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
      [["config", "set", "channels.mingle.accounts.agent_7hqq5o.enabled", "true"]],
      [
        [
          "config",
          "set",
          "channels.mingle.accounts.agent_7hqq5o.baseUrl",
          "https://mingle.example",
        ],
      ],
      [
        [
          "config",
          "set",
          "channels.mingle.accounts.agent_7hqq5o.apiKey",
          "mingle_sk_secret",
        ],
      ],
      [
        [
          "agents",
          "bind",
          "--agent",
          "agent_7hqq5o",
          "--bind",
          "mingle:agent_7hqq5o",
        ],
      ],
      [["gateway", "restart"]],
    ]);
  });
});

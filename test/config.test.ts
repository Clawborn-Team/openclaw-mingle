import { afterEach, describe, expect, it } from "vitest";
import { listImAccountIds, resolveImAccount } from "../src/config.js";

afterEach(() => {
  delete process.env.IM_SERVER_URL;
  delete process.env.IM_API_KEY;
});

describe("IM channel configuration", () => {
  it("resolves the implicit default account and normalizes the base URL", () => {
    const cfg = {
      channels: { im: { baseUrl: "https://im.example.test///", apiKey: "im_sk_secret" } },
    } as never;

    expect(listImAccountIds(cfg)).toEqual(["default"]);
    expect(resolveImAccount(cfg)).toMatchObject({
      accountId: "default",
      enabled: true,
      configured: true,
      baseUrl: "https://im.example.test",
      apiKey: "im_sk_secret",
      consumerId: "openclaw-im-default",
    });
  });

  it("resolves named accounts without inheriting the default account secret", () => {
    const cfg = {
      channels: {
        im: {
          baseUrl: "https://default.example",
          apiKey: "default-secret",
          accounts: {
            lobster: { baseUrl: "https://lobster.example", apiKey: "lobster-secret" },
          },
        },
      },
    } as never;

    expect(listImAccountIds(cfg)).toEqual(["default", "lobster"]);
    expect(resolveImAccount(cfg, "lobster")).toMatchObject({
      accountId: "lobster",
      baseUrl: "https://lobster.example",
      apiKey: "lobster-secret",
      consumerId: "openclaw-im-lobster",
    });
  });

  it("uses environment fallback only for the default account", () => {
    process.env.IM_SERVER_URL = "https://env.example/";
    process.env.IM_API_KEY = "env-secret";
    const cfg = { channels: { im: { accounts: { lobster: {} } } } } as never;

    expect(resolveImAccount(cfg, "default")).toMatchObject({
      configured: true,
      baseUrl: "https://env.example",
      apiKey: "env-secret",
    });
    expect(resolveImAccount(cfg, "lobster").configured).toBe(false);
  });

  it("accepts an already-resolved SecretInput and rejects non-http base URLs", () => {
    const secretCfg = {
      channels: { im: { baseUrl: "http://localhost:8787", apiKey: " resolved-secret " } },
    } as never;
    expect(resolveImAccount(secretCfg).apiKey).toBe("resolved-secret");

    const badCfg = {
      channels: { im: { baseUrl: "file:///tmp/im", apiKey: "secret" } },
    } as never;
    expect(() => resolveImAccount(badCfg)).toThrow("http:// or https://");
  });
});

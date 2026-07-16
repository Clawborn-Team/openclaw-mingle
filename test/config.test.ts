import { afterEach, describe, expect, it } from "vitest";
import { listMingleAccountIds, resolveMingleAccount } from "../src/config.js";

afterEach(() => {
  delete process.env.MINGLE_SERVER_URL;
  delete process.env.MINGLE_API_KEY;
});

describe("Mingle channel configuration", () => {
  it("resolves the implicit default account and normalizes the base URL", () => {
    const cfg = {
      channels: { mingle: { baseUrl: "https://im.example.test///", apiKey: "im_sk_secret" } },
    } as never;

    expect(listMingleAccountIds(cfg)).toEqual(["default"]);
    expect(resolveMingleAccount(cfg)).toMatchObject({
      accountId: "default",
      enabled: true,
      configured: true,
      baseUrl: "https://im.example.test",
      apiKey: "im_sk_secret",
      consumerId: "openclaw-mingle-default",
    });
  });

  it("resolves named accounts without inheriting the default account secret", () => {
    const cfg = {
      channels: {
        mingle: {
          baseUrl: "https://default.example",
          apiKey: "default-secret",
          accounts: {
            lobster: { baseUrl: "https://lobster.example", apiKey: "lobster-secret" },
          },
        },
      },
    } as never;

    expect(listMingleAccountIds(cfg)).toEqual(["default", "lobster"]);
    expect(resolveMingleAccount(cfg, "lobster")).toMatchObject({
      accountId: "lobster",
      baseUrl: "https://lobster.example",
      apiKey: "lobster-secret",
      consumerId: "openclaw-mingle-lobster",
    });
  });

  it("uses environment fallback only for the default account", () => {
    process.env.MINGLE_SERVER_URL = "https://env.example/";
    process.env.MINGLE_API_KEY = "env-secret";
    const cfg = { channels: { mingle: { accounts: { lobster: {} } } } } as never;

    expect(resolveMingleAccount(cfg, "default")).toMatchObject({
      configured: true,
      baseUrl: "https://env.example",
      apiKey: "env-secret",
    });
    expect(resolveMingleAccount(cfg, "lobster").configured).toBe(false);
  });

  it("accepts an already-resolved SecretInput and rejects non-http base URLs", () => {
    const secretCfg = {
      channels: { mingle: { baseUrl: "http://localhost:8787", apiKey: " resolved-secret " } },
    } as never;
    expect(resolveMingleAccount(secretCfg).apiKey).toBe("resolved-secret");

    const badCfg = {
      channels: { mingle: { baseUrl: "file:///tmp/im", apiKey: "secret" } },
    } as never;
    expect(() => resolveMingleAccount(badCfg)).toThrow("http:// or https://");
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { MingleConfigSchema } from "../src/config-schema.js";
import {
  isMingleAutoUpdateEnabled,
  listMingleAccountIds,
  resolveMingleAccount,
} from "../src/config.js";

afterEach(() => {
  delete process.env.MINGLE_SERVER_URL;
  delete process.env.MINGLE_API_KEY;
});

describe("Mingle channel configuration", () => {
  it("resolves the implicit default account and normalizes the base URL", () => {
    const cfg = {
      channels: { mingle: { baseUrl: "https://mingle.example.test///", apiKey: "mingle_sk_secret" } },
    } as never;

    expect(listMingleAccountIds(cfg)).toEqual(["default"]);
    expect(resolveMingleAccount(cfg)).toMatchObject({
      accountId: "default",
      enabled: true,
      configured: true,
      baseUrl: "https://mingle.example.test",
      apiKey: "mingle_sk_secret",
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

  it("enables automatic updates by default and honors the Gateway-global opt-out", () => {
    expect(isMingleAutoUpdateEnabled({ channels: { mingle: {} } } as never)).toBe(true);
    expect(
      isMingleAutoUpdateEnabled({ channels: { mingle: { autoUpdate: false } } } as never),
    ).toBe(false);
  });

  it("allows autoUpdate only at the channel top level", () => {
    const schema = MingleConfigSchema.schema as {
      properties: Record<string, unknown>;
    };
    const accounts = schema.properties.accounts as {
      additionalProperties: { properties: Record<string, unknown> };
    };

    expect(schema.properties).toHaveProperty("autoUpdate");
    expect(accounts.additionalProperties.properties).not.toHaveProperty("autoUpdate");
  });
});

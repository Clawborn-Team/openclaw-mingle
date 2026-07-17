import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { minglePlugin } from "../src/channel.js";

afterEach(() => vi.unstubAllGlobals());

describe("native Mingle channel", () => {
  it("aligns channel identity, manifest, direct-only capabilities, and account inspection", async () => {
    const manifest = JSON.parse(
      await readFile(resolve("openclaw.plugin.json"), "utf8"),
    ) as { channels: string[] };
    const cfg = {
      channels: { mingle: { baseUrl: "https://im.example", apiKey: "secret" } },
    } as never;

    expect(manifest.channels).toEqual(["mingle"]);
    expect(minglePlugin.id).toBe("mingle");
    expect(minglePlugin.meta).toMatchObject({ id: "mingle", label: "Mingle" });
    expect(minglePlugin.capabilities).toMatchObject({ chatTypes: ["direct", "group"], media: false });
    expect(minglePlugin.config.listAccountIds(cfg)).toEqual(["default"]);
    expect(minglePlugin.config.inspectAccount?.(cfg, "default")).toMatchObject({
      enabled: true,
      configured: true,
      tokenStatus: "available",
    });
    expect(
      minglePlugin.status?.buildAccountSnapshot?.({
        account: minglePlugin.config.resolveAccount(cfg, "default"),
        runtime: {
          updateState: "failed",
          updateTargetVersion: "0.6.1",
          updateErrorCode: "integrity_mismatch",
        },
      } as never),
    ).toMatchObject({
      runtimeVersion: "0.6.0",
      updateState: "failed",
      updateTargetVersion: "0.6.1",
      updateErrorCode: "integrity_mismatch",
    });
  });

  it("normalizes direct targets and sends explicit outbound text idempotently", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ message: { id: "msg-1" } }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const cfg = {
      channels: { mingle: { baseUrl: "https://im.example", apiKey: "secret" } },
    } as never;

    expect(minglePlugin.messaging?.normalizeTarget?.("mingle:peer-1")).toBe("peer-1");
    const result = await minglePlugin.outbound?.sendText?.({
      cfg,
      accountId: "default",
      to: "mingle:peer-1",
      text: "hello",
    } as never);

    expect(result).toMatchObject({ channel: "mingle", messageId: "msg-1", chatId: "peer-1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://im.example/v1/messages");
    expect(JSON.parse(String(init?.body))).toEqual({ to: "peer-1", body: "hello" });
    expect(new Headers(init?.headers).get("Idempotency-Key")).toMatch(/^mingle-send:/);
  });

  it("routes explicit group targets through the Mingle channel API", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ message: { id: "group-msg-1" } }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const cfg = {
      channels: { mingle: { baseUrl: "https://im.example", apiKey: "secret" } },
    } as never;

    const result = await minglePlugin.outbound?.sendText?.({
      cfg,
      accountId: "default",
      to: "mingle:group:builders",
      text: "hello builders",
    } as never);

    expect(result).toMatchObject({
      channel: "mingle",
      messageId: "group-msg-1",
      chatId: "group:builders",
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://im.example/v1/channels/builders/messages");
    expect(JSON.parse(String(init?.body))).toEqual({ body: "hello builders" });
    expect(new Headers(init?.headers).get("Idempotency-Key")).toMatch(/^mingle-send:/);
  });

  it("routes explicit plaza targets through the Mingle channel API without losing target kind", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ message: { id: "plaza-msg-1" } }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const cfg = {
      channels: { mingle: { baseUrl: "https://im.example", apiKey: "secret" } },
    } as never;

    const result = await minglePlugin.outbound?.sendText?.({
      cfg,
      accountId: "default",
      to: "mingle:plaza:agent-square",
      text: "hello plaza",
    } as never);

    expect(result).toMatchObject({
      channel: "mingle",
      messageId: "plaza-msg-1",
      chatId: "plaza:agent-square",
    });
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "https://im.example/v1/channels/agent-square/messages",
    );
  });

  it("fails fast when the runtime is missing or the account is unconfigured", async () => {
    const gateway = minglePlugin.gateway?.startAccount;
    expect(gateway).toBeDefined();
    await expect(
      gateway?.({
        cfg: { channels: { mingle: { apiKey: "secret" } } },
        account: {
          accountId: "default",
          enabled: true,
          configured: true,
          baseUrl: "https://im.example",
          apiKey: "secret",
          consumerId: "consumer",
        },
        abortSignal: new AbortController().signal,
        setStatus: vi.fn(),
        log: { warn: vi.fn() },
      } as never),
    ).rejects.toThrow("channelRuntime");

    await expect(
      gateway?.({
        cfg: { channels: { mingle: {} } },
        account: {
          accountId: "default",
          enabled: true,
          configured: false,
          baseUrl: "http://localhost:8787",
          apiKey: "",
          consumerId: "consumer",
        },
        channelRuntime: {},
        abortSignal: new AbortController().signal,
        setStatus: vi.fn(),
      } as never),
    ).rejects.toThrow("not configured");
  });

  it("starts and stops cleanly when Gateway shutdown is already requested", async () => {
    const controller = new AbortController();
    controller.abort();
    const setStatus = vi.fn();
    await minglePlugin.gateway?.startAccount?.({
      cfg: { channels: { mingle: { baseUrl: "https://im.example", apiKey: "secret" } } },
      account: {
        accountId: "default",
        enabled: true,
        configured: true,
        baseUrl: "https://im.example",
        apiKey: "secret",
        consumerId: "consumer",
      },
      channelRuntime: {},
      abortSignal: controller.signal,
      setStatus,
    } as never);

    expect(setStatus).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "default", running: false, statusState: "stopped" }),
    );
  });
});

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { imPlugin } from "../src/channel.js";

afterEach(() => vi.unstubAllGlobals());

describe("native IM channel", () => {
  it("aligns channel identity, manifest, direct-only capabilities, and account inspection", async () => {
    const manifest = JSON.parse(
      await readFile(resolve("openclaw.plugin.json"), "utf8"),
    ) as { channels: string[] };
    const cfg = {
      channels: { im: { baseUrl: "https://im.example", apiKey: "secret" } },
    } as never;

    expect(manifest.channels).toEqual(["im"]);
    expect(imPlugin.id).toBe("im");
    expect(imPlugin.meta).toMatchObject({ id: "im", label: "Clawborn IM" });
    expect(imPlugin.capabilities).toMatchObject({ chatTypes: ["direct"], media: false });
    expect(imPlugin.config.listAccountIds(cfg)).toEqual(["default"]);
    expect(imPlugin.config.inspectAccount?.(cfg, "default")).toMatchObject({
      enabled: true,
      configured: true,
      tokenStatus: "available",
    });
  });

  it("normalizes direct targets and sends explicit outbound text idempotently", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ message: { id: "msg-1" } }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const cfg = {
      channels: { im: { baseUrl: "https://im.example", apiKey: "secret" } },
    } as never;

    expect(imPlugin.messaging?.normalizeTarget?.("im:peer-1")).toBe("peer-1");
    const result = await imPlugin.outbound?.sendText?.({
      cfg,
      accountId: "default",
      to: "im:peer-1",
      text: "hello",
    } as never);

    expect(result).toMatchObject({ channel: "im", messageId: "msg-1", chatId: "peer-1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://im.example/v1/messages");
    expect(JSON.parse(String(init?.body))).toEqual({ to: "peer-1", body: "hello" });
    expect(new Headers(init?.headers).get("Idempotency-Key")).toMatch(/^im-send:/);
  });

  it("fails fast when the runtime is missing or the account is unconfigured", async () => {
    const gateway = imPlugin.gateway?.startAccount;
    expect(gateway).toBeDefined();
    await expect(
      gateway?.({
        cfg: { channels: { im: { apiKey: "secret" } } },
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
        cfg: { channels: { im: {} } },
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
    await imPlugin.gateway?.startAccount?.({
      cfg: { channels: { im: { baseUrl: "https://im.example", apiKey: "secret" } } },
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

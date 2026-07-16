import { afterEach, describe, expect, it, vi } from "vitest";
import { ImApiError, ImClient, redactImError } from "../src/client.js";

const account = {
  accountId: "default",
  enabled: true,
  configured: true,
  baseUrl: "https://im.example.test",
  apiKey: "im_sk_top_secret",
  consumerId: "openclaw-im-default",
};

afterEach(() => vi.unstubAllGlobals());

describe("ImClient", () => {
  it("polls with auth, consumer id, cursor, wait, and signal", async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          schema: "im.account-event-center.v1",
          events: [],
          notifications: [],
          next_cursor: "cursor-2",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const packet = await new ImClient(account).poll({ cursor: "cursor-1", waitMs: 25_000, signal });

    expect(packet.next_cursor).toBe("cursor-2");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://im.example.test/v1/event-center/updates?cursor=cursor-1&wait=25000",
    );
    expect(init).toMatchObject({ signal });
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer im_sk_top_secret");
    expect(new Headers(init?.headers).get("X-IM-Consumer-ID")).toBe("openclaw-im-default");
  });

  it("ACKs, NACKs, and sends idempotent DMs with the generic REST contract", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ acknowledged: 2 }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ state: "retry", available_at: 123 }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: { id: "msg-1" } }), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = new ImClient(account);

    await client.ack(["evt-1"], ["ntf-1"]);
    await client.nack("evt-2", "dispatch_failed");
    await client.sendDm("peer-1", "hello", "im-reply:evt-1:0");

    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({
      event_ids: ["evt-1"],
      notification_ids: ["ntf-1"],
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({
      event_id: "evt-2",
      reason: "dispatch_failed",
    });
    expect(new Headers(fetchMock.mock.calls[2]![1]?.headers).get("Idempotency-Key")).toBe(
      "im-reply:evt-1:0",
    );
  });

  it("classifies API errors and never exposes the credential", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: { code: "consumer_conflict", message: "already active" } }),
          { status: 409 },
        ),
      ),
    );

    const error = await new ImClient(account).poll({ waitMs: 0 }).catch((value) => value);
    expect(error).toBeInstanceOf(ImApiError);
    expect(error).toMatchObject({ status: 409, code: "consumer_conflict", retryable: false });
    expect(redactImError(new Error(`failed with ${account.apiKey}`), account.apiKey)).not.toContain(
      account.apiKey,
    );
  });

  it("rejects an invalid Event Center response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ events: "wrong" }), { status: 200 })),
    );

    await expect(new ImClient(account).poll({ waitMs: 0 })).rejects.toThrow(
      "Invalid Event Center response",
    );
  });
});

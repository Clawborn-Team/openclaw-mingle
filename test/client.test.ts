import { afterEach, describe, expect, it, vi } from "vitest";
import { MingleApiError, MingleClient, redactMingleError } from "../src/client.js";

const account = {
  accountId: "default",
  enabled: true,
  configured: true,
  baseUrl: "https://mingle.example.test",
  apiKey: "mingle_sk_top_secret",
  consumerId: "openclaw-mingle-default",
};

afterEach(() => vi.unstubAllGlobals());

describe("MingleClient", () => {
  it("polls with auth, consumer id, cursor, wait, and signal", async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          schema: "mingle.account-event-center.v1",
          events: [],
          notifications: [],
          next_cursor: "cursor-2",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const packet = await new MingleClient(account).poll({ cursor: "cursor-1", waitMs: 25_000, signal });

    expect(packet.next_cursor).toBe("cursor-2");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://mingle.example.test/v1/event-center/updates?cursor=cursor-1&wait=25000",
    );
    expect(init).toMatchObject({ signal });
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer mingle_sk_top_secret");
    expect(new Headers(init?.headers).get("X-Mingle-Consumer-ID")).toBe("openclaw-mingle-default");
  });

  it("ACKs, NACKs, and sends idempotent DM and group replies with the generic REST contract", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ acknowledged: 2 }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ state: "retry", available_at: 123 }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: { id: "msg-1" } }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: { id: "group-msg-1" } }), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = new MingleClient(account);

    await client.ack(["evt-1"], ["ntf-1"]);
    await client.nack("evt-2", "dispatch_failed");
    await client.sendDm("peer-1", "hello", "mingle-reply:evt-1:0");
    await client.postChannel("builders", "hello group", "mingle-reply:evt-group-1:0");

    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({
      event_ids: ["evt-1"],
      notification_ids: ["ntf-1"],
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({
      event_id: "evt-2",
      reason: "dispatch_failed",
    });
    expect(new Headers(fetchMock.mock.calls[2]![1]?.headers).get("Idempotency-Key")).toBe(
      "mingle-reply:evt-1:0",
    );
    expect(String(fetchMock.mock.calls[3]![0])).toBe(
      "https://mingle.example.test/v1/channels/builders/messages",
    );
    expect(new Headers(fetchMock.mock.calls[3]![1]?.headers).get("Idempotency-Key")).toBe(
      "mingle-reply:evt-group-1:0",
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

    const error = await new MingleClient(account).poll({ waitMs: 0 }).catch((value) => value);
    expect(error).toBeInstanceOf(MingleApiError);
    expect(error).toMatchObject({ status: 409, code: "consumer_conflict", retryable: false });
    expect(redactMingleError(new Error(`failed with ${account.apiKey}`), account.apiKey)).not.toContain(
      account.apiKey,
    );
  });

  it("rejects an invalid Event Center response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ events: "wrong" }), { status: 200 })),
    );

    await expect(new MingleClient(account).poll({ waitMs: 0 })).rejects.toThrow(
      "Invalid Event Center response",
    );
  });

  it("maps the Mingle social surface to the public REST API", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new MingleClient(account);

    await client.readConversation("peer name");
    await client.listChannels({ discover: true, q: "agent clubs", kind: "group", limit: 12 });
    await client.readChannel("builders", { after: 4, limit: 20 });
    await client.postChannel("builders", "hello group");
    await client.findMatches(8);
    await client.proposeIntroduction({
      toAgent: "other-agent",
      context: "We both build agent systems.",
      commonGround: ["agents"],
      suggestedTopics: ["reliability"],
      collaborationIdeas: ["compare designs"],
    });
    await client.listIntroductions();
    await client.respondIntroduction("intro/id", "accept");
    await client.getProfile();
    await client.updateProfile({
      displayName: "Mingle Lobster",
      bio: "Helpful",
      interests: ["agents"],
      lookingFor: "Builders",
      avatar: "🦞",
    });

    expect(fetchMock.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([
      ["https://mingle.example.test/v1/messages?with=peer+name", "GET"],
      [
        "https://mingle.example.test/v1/channels/discover?q=agent+clubs&kind=group&limit=12",
        "GET",
      ],
      ["https://mingle.example.test/v1/channels/builders/messages?after=4&limit=20", "GET"],
      ["https://mingle.example.test/v1/channels/builders/messages", "POST"],
      ["https://mingle.example.test/v1/matches?limit=8", "GET"],
      ["https://mingle.example.test/v1/introductions", "POST"],
      ["https://mingle.example.test/v1/introductions", "GET"],
      ["https://mingle.example.test/v1/introductions/intro%2Fid/accept", "POST"],
      ["https://mingle.example.test/v1/me", "GET"],
      ["https://mingle.example.test/v1/me", "PATCH"],
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[3]![1]?.body))).toEqual({ body: "hello group" });
    expect(JSON.parse(String(fetchMock.mock.calls[5]![1]?.body))).toEqual({
      to_agent: "other-agent",
      context: "We both build agent systems.",
      common_ground: ["agents"],
      suggested_topics: ["reliability"],
      collaboration_ideas: ["compare designs"],
    });
    expect(JSON.parse(String(fetchMock.mock.calls[9]![1]?.body))).toEqual({
      display_name: "Mingle Lobster",
      bio: "Helpful",
      interests: ["agents"],
      looking_for: "Builders",
      avatar: "🦞",
    });
  });
});

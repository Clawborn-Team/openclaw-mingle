import { describe, expect, it, vi } from "vitest";
import { dispatchMingleEvent } from "../src/inbound.js";
import type { AccountEvent, ResolvedMingleAccount } from "../src/types.js";

const account: ResolvedMingleAccount = {
  accountId: "default",
  enabled: true,
  configured: true,
  baseUrl: "https://im.example",
  apiKey: "secret",
  consumerId: "openclaw-mingle-default",
};

const event: AccountEvent = {
  id: "evt-1",
  type: "dm.message.created",
  delivery_class: "wake",
  occurred_at: 123,
  resource: { type: "message", id: "msg-1" },
  payload: {
    conversation: { kind: "direct", peer_id: "acc-b", peer_username: "bob" },
    sender: { id: "acc-b", username: "bob", display_name: "Bob", type: "agent" },
    message: { id: "msg-1", body: "hello", created_at: 123 },
  },
};

const groupEvent: AccountEvent = {
  id: "evt-group-1",
  type: "channel.mention.created",
  delivery_class: "wake",
  occurred_at: 456,
  resource: { type: "channel_message", id: "group-msg-1" },
  payload: {
    conversation: {
      kind: "group",
      channel_id: "channel-1",
      channel_slug: "builders",
      channel_name: "Builders",
    },
    sender: { id: "user-1", username: "alice", display_name: "Alice", type: "user" },
    message: { id: "group-msg-1", body: "@lobster hello", created_at: 456 },
    mentioned_username: "lobster",
  },
};

function runtimeThatDelivers(texts: Array<string | undefined>) {
  const capture: { context?: Record<string, unknown> } = {};
  const runtime = {
    routing: {
      resolveAgentRoute: vi.fn(() => ({
        agentId: "main",
        sessionKey: "agent:main:mingle:direct:acc-b",
        mainSessionKey: "agent:main:main",
      })),
    },
    session: {
      resolveStorePath: vi.fn(() => "/tmp/sessions.json"),
      recordInboundSession: vi.fn(),
    },
    reply: {
      dispatchReplyWithBufferedBlockDispatcher: vi.fn(),
    },
    inbound: {
      buildContext: vi.fn((input: Record<string, unknown>) => {
        capture.context = input;
        return input;
      }),
      run: vi.fn(async ({ raw, adapter }: any) => {
        const ingested = adapter.ingest(raw);
        const turn = await adapter.resolveTurn(ingested);
        for (const text of texts) await turn.delivery.deliver({ text });
      }),
    },
  };
  return { runtime, capture };
}

describe("dispatchMingleEvent", () => {
  it("routes a DM to a stable direct session and sends replies with stable idempotency keys", async () => {
    const { runtime, capture } = runtimeThatDelivers(["first", "second"]);
    const sendDm = vi.fn(async () => ({ id: "reply-1" }));
    const postChannel = vi.fn(async () => ({ id: "unused" }));

    await dispatchMingleEvent({
      cfg: { session: {} } as never,
      account,
      event,
      notifications: [],
      channelRuntime: runtime as never,
      client: { sendDm, postChannel },
    });

    expect(runtime.routing.resolveAgentRoute).toHaveBeenCalledWith({
      cfg: { session: {} },
      channel: "mingle",
      accountId: "default",
      peer: { kind: "direct", id: "acc-b" },
    });
    expect(capture.context).toMatchObject({
      channel: "mingle",
      from: "mingle:acc-b",
      conversation: { kind: "direct", id: "acc-b", label: "bob" },
      route: {
        agentId: "main",
        routeSessionKey: "agent:main:mingle:direct:acc-b",
        dispatchSessionKey: "agent:main:mingle:direct:acc-b",
      },
      reply: { to: "mingle:acc-b" },
      extra: { MingleEventId: "evt-1", MingleMessageId: "msg-1" },
    });
    expect(sendDm).toHaveBeenNthCalledWith(1, "acc-b", "first", "mingle-reply:evt-1:0");
    expect(sendDm).toHaveBeenNthCalledWith(2, "acc-b", "second", "mingle-reply:evt-1:1");
  });

  it("routes a group mention to a stable group session and posts replies to the source group", async () => {
    const { runtime, capture } = runtimeThatDelivers(["group reply"]);
    runtime.routing.resolveAgentRoute.mockReturnValue({
      agentId: "main",
      sessionKey: "agent:main:mingle:group:channel-1",
      mainSessionKey: "agent:main:main",
    });
    const sendDm = vi.fn();
    const postChannel = vi.fn(async () => ({ id: "reply-group-1" }));

    await dispatchMingleEvent({
      cfg: { session: {} } as never,
      account,
      event: groupEvent,
      notifications: [],
      channelRuntime: runtime as never,
      client: { sendDm, postChannel },
    });

    expect(runtime.routing.resolveAgentRoute).toHaveBeenCalledWith({
      cfg: { session: {} },
      channel: "mingle",
      accountId: "default",
      peer: { kind: "group", id: "channel-1" },
    });
    expect(capture.context).toMatchObject({
      from: "mingle:group:channel-1",
      conversation: { kind: "group", id: "channel-1", label: "Builders" },
      reply: { to: "mingle:group:builders" },
      extra: { MingleEventId: "evt-group-1", MingleMessageId: "group-msg-1" },
    });
    expect(postChannel).toHaveBeenCalledWith(
      "builders",
      "group reply",
      "mingle-reply:evt-group-1:0",
    );
    expect(sendDm).not.toHaveBeenCalled();
  });

  it("accepts a no-text final without creating a visible Mingle message", async () => {
    const { runtime } = runtimeThatDelivers([undefined, ""]);
    const sendDm = vi.fn();
    const postChannel = vi.fn();

    await dispatchMingleEvent({
      cfg: {} as never,
      account,
      event,
      notifications: [],
      channelRuntime: runtime as never,
      client: { sendDm, postChannel },
    });

    expect(sendDm).not.toHaveBeenCalled();
    expect(postChannel).not.toHaveBeenCalled();
  });
});

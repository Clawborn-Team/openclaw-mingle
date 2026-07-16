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

const groupFollowupEvent: AccountEvent = {
  id: "evt-followup-1",
  type: "channel.followup.created",
  delivery_class: "wake",
  occurred_at: 457,
  resource: { type: "channel_message", id: "group-msg-2" },
  payload: {
    conversation: {
      kind: "group",
      channel_id: "channel-1",
      channel_slug: "builders",
      channel_name: "Builders",
    },
    sender: { id: "user-1", username: "alice", display_name: "Alice", type: "user" },
    message: { id: "group-msg-2", body: "continue the conversation", created_at: 457 },
    attention: {
      reason: "active_group_conversation",
      idle_expires_at: 120_457,
      hard_expires_at: 600_457,
      read_recent_context: true,
    },
  },
};

const digestEvent: AccountEvent = {
  id: "digest-300000",
  type: "account.digest",
  delivery_class: "wake",
  occurred_at: 300_000,
  resource: { type: "account", id: "default" },
  payload: { interval_ms: 300_000 },
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
    const record = vi.fn(async () => undefined);

    await dispatchMingleEvent({
      cfg: { session: {} } as never,
      account,
      event: groupEvent,
      notifications: [],
      channelRuntime: runtime as never,
      client: { sendDm, postChannel },
      recentSources: { record },
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
    expect(record).toHaveBeenCalledWith({
      target: "group:builders",
      kind: "group",
      label: "Builders",
      sender: {
        id: "user-1",
        username: "alice",
        displayName: "Alice",
        type: "user",
      },
      eventId: "evt-group-1",
      messageId: "group-msg-1",
      messagePreview: "@lobster hello",
      occurredAt: 456,
    });
  });

  it("routes an active follow-up through the same group session and reply target", async () => {
    const { runtime, capture } = runtimeThatDelivers(["follow-up reply"]);
    runtime.routing.resolveAgentRoute.mockReturnValue({
      agentId: "main",
      sessionKey: "agent:main:mingle:group:channel-1",
      mainSessionKey: "agent:main:main",
    });
    const sendDm = vi.fn();
    const postChannel = vi.fn(async () => ({ id: "reply-followup-1" }));

    await dispatchMingleEvent({
      cfg: { session: {} } as never,
      account,
      event: groupFollowupEvent,
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
      extra: { MingleEventId: "evt-followup-1", MingleMessageId: "group-msg-2" },
    });
    expect(postChannel).toHaveBeenCalledWith(
      "builders",
      "follow-up reply",
      "mingle-reply:evt-followup-1:0",
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

  it("runs a digest in a stable Event Center session without delivering a visible reply", async () => {
    const { runtime, capture } = runtimeThatDelivers(["heartbeat complete"]);
    runtime.routing.resolveAgentRoute.mockReturnValue({
      agentId: "main",
      sessionKey: "agent:main:mingle:event-center",
      mainSessionKey: "agent:main:main",
    });
    const sendDm = vi.fn();
    const postChannel = vi.fn();
    const record = vi.fn(async () => undefined);

    await dispatchMingleEvent({
      cfg: {} as never,
      account,
      event: digestEvent,
      notifications: [],
      channelRuntime: runtime as never,
      client: { sendDm, postChannel },
      recentSources: { record },
    });

    expect(runtime.routing.resolveAgentRoute).toHaveBeenCalledWith({
      cfg: {},
      channel: "mingle",
      accountId: "default",
      peer: { kind: "direct", id: "event-center" },
    });
    expect(capture.context).toMatchObject({
      from: "mingle:event-center",
      conversation: { kind: "direct", id: "event-center", label: "Account Event Center" },
      extra: { MingleEventId: "digest-300000" },
    });
    expect(sendDm).not.toHaveBeenCalled();
    expect(postChannel).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});

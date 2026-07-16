import { describe, expect, it, vi } from "vitest";
import { dispatchImEvent } from "../src/inbound.js";
import type { AccountEvent, ResolvedImAccount } from "../src/types.js";

const account: ResolvedImAccount = {
  accountId: "default",
  enabled: true,
  configured: true,
  baseUrl: "https://im.example",
  apiKey: "secret",
  consumerId: "openclaw-im-default",
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

function runtimeThatDelivers(texts: Array<string | undefined>) {
  const capture: { context?: Record<string, unknown> } = {};
  const runtime = {
    routing: {
      resolveAgentRoute: vi.fn(() => ({
        agentId: "main",
        sessionKey: "agent:main:im:direct:acc-b",
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

describe("dispatchImEvent", () => {
  it("routes a DM to a stable direct session and sends replies with stable idempotency keys", async () => {
    const { runtime, capture } = runtimeThatDelivers(["first", "second"]);
    const sendDm = vi.fn(async () => ({ id: "reply-1" }));

    await dispatchImEvent({
      cfg: { session: {} } as never,
      account,
      event,
      notifications: [],
      channelRuntime: runtime as never,
      client: { sendDm },
    });

    expect(runtime.routing.resolveAgentRoute).toHaveBeenCalledWith({
      cfg: { session: {} },
      channel: "im",
      accountId: "default",
      peer: { kind: "direct", id: "acc-b" },
    });
    expect(capture.context).toMatchObject({
      channel: "im",
      from: "im:acc-b",
      conversation: { kind: "direct", id: "acc-b", label: "bob" },
      route: {
        agentId: "main",
        routeSessionKey: "agent:main:im:direct:acc-b",
        dispatchSessionKey: "agent:main:im:direct:acc-b",
      },
      reply: { to: "im:acc-b" },
      extra: { ImEventId: "evt-1", ImMessageId: "msg-1" },
    });
    expect(sendDm).toHaveBeenNthCalledWith(1, "acc-b", "first", "im-reply:evt-1:0");
    expect(sendDm).toHaveBeenNthCalledWith(2, "acc-b", "second", "im-reply:evt-1:1");
  });

  it("accepts a no-text final without creating a visible IM message", async () => {
    const { runtime } = runtimeThatDelivers([undefined, ""]);
    const sendDm = vi.fn();

    await dispatchImEvent({
      cfg: {} as never,
      account,
      event,
      notifications: [],
      channelRuntime: runtime as never,
      client: { sendDm },
    });

    expect(sendDm).not.toHaveBeenCalled();
  });
});

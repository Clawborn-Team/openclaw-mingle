import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MingleApiError } from "../src/client.js";
import type { DispatchMingleEventParams } from "../src/inbound.js";
import { monitorMingleAccount } from "../src/monitor.js";
import { DeliveryStateStore } from "../src/state.js";
import type { AccountEvent, EventCenterPacket, ResolvedMingleAccount } from "../src/types.js";

const account: ResolvedMingleAccount = {
  accountId: "default",
  enabled: true,
  configured: true,
  baseUrl: "https://im.example",
  apiKey: "secret",
  consumerId: "openclaw-mingle-default",
};

const event = (id: string): AccountEvent => ({
  id,
  type: "dm.message.created",
  delivery_class: "wake",
  occurred_at: 123,
  resource: { type: "message", id: `msg-${id}` },
  payload: {
    conversation: { kind: "direct", peer_id: "peer", peer_username: "bob" },
    sender: { id: "peer", username: "bob", type: "agent" },
    message: { id: `msg-${id}`, body: id, created_at: 123 },
  },
});

const packet = (
  events: AccountEvent[],
  notifications: AccountEvent[] = [],
  cursor = "cursor-1",
): EventCenterPacket => ({
  schema: "mingle.account-event-center.v1",
  events,
  notifications,
  next_cursor: cursor,
});

function apiError(status: number, code: string, retryAfterMs?: number) {
  return new MingleApiError({
    status,
    code,
    message: code,
    retryable: status === 429 || status >= 500,
    ...(retryAfterMs ? { retryAfterMs } : {}),
  });
}

describe("monitorMingleAccount", () => {
  let state: DeliveryStateStore;
  let stateDir: string;
  let controller: AbortController;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "im-monitor-"));
    state = new DeliveryStateStore({
      accountId: "default",
      stateDir,
    });
    controller = new AbortController();
  });

  it("saves cursor, dispatches serially, attaches notifications once, marks accepted, then ACKs", async () => {
    const notification = {
      ...event("ntf-1"),
      type: "channel.activity",
      delivery_class: "notification" as const,
    };
    const client = {
      poll: vi.fn(async () => {
        controller.abort();
        return packet([event("evt-1"), event("evt-2")], [notification], "cursor-2");
      }),
      ack: vi.fn(async () => 1),
      nack: vi.fn(async () => undefined),
      sendDm: vi.fn(),
      postChannel: vi.fn(),
    };
    const dispatch = vi.fn(async (_params: DispatchMingleEventParams) => undefined);

    await monitorMingleAccount({
      cfg: {} as never,
      account,
      channelRuntime: {} as never,
      client,
      state,
      abortSignal: controller.signal,
      dispatch,
    });

    expect((await state.load()).cursor).toBe("cursor-2");
    expect(dispatch.mock.calls.map((call) => call[0].event.id)).toEqual(["evt-1", "evt-2"]);
    expect(dispatch.mock.calls[0]![0].notifications).toEqual([notification]);
    expect(dispatch.mock.calls[1]![0].notifications).toEqual([]);
    expect(client.ack).toHaveBeenNthCalledWith(1, ["evt-1"], ["ntf-1"], controller.signal);
    expect(client.ack).toHaveBeenNthCalledWith(2, ["evt-2"], [], controller.signal);
    expect(await state.hasAccepted("evt-1")).toBe(true);
    expect(await state.hasAccepted("ntf-1")).toBe(true);
  });

  it("suppresses an accepted redelivery after restart and ACKs without another turn", async () => {
    await state.markAccepted("evt-1");
    const client = {
      poll: vi.fn(async () => {
        controller.abort();
        return packet([event("evt-1")]);
      }),
      ack: vi.fn(async () => 1),
      nack: vi.fn(),
      sendDm: vi.fn(),
      postChannel: vi.fn(),
    };
    const dispatch = vi.fn();

    await monitorMingleAccount({
      cfg: {} as never,
      account,
      channelRuntime: {} as never,
      client,
      state: new DeliveryStateStore({
        accountId: "default",
        stateDir,
      }),
      abortSignal: controller.signal,
      dispatch,
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(client.ack).toHaveBeenCalledWith(["evt-1"], [], controller.signal);
  });

  it("does not NACK or repeat a turn when ACK fails after accepted state is durable", async () => {
    const client = {
      poll: vi
        .fn()
        .mockResolvedValueOnce(packet([event("evt-1")], [], "cursor-1"))
        .mockImplementationOnce(async () => {
          controller.abort();
          return packet([event("evt-1")], [], "cursor-1");
        }),
      ack: vi
        .fn()
        .mockRejectedValueOnce(new Error("ACK response lost"))
        .mockResolvedValueOnce(1),
      nack: vi.fn(async () => undefined),
      sendDm: vi.fn(),
      postChannel: vi.fn(),
    };
    const dispatch = vi.fn(async (_params: DispatchMingleEventParams) => undefined);

    await monitorMingleAccount({
      cfg: {} as never,
      account,
      channelRuntime: {} as never,
      client,
      state,
      abortSignal: controller.signal,
      dispatch,
      sleep: async () => undefined,
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(client.nack).not.toHaveBeenCalled();
    expect(client.ack).toHaveBeenCalledTimes(2);
  });

  it("NACKs a failed event and attaches notifications to the next successful turn", async () => {
    const notification = {
      ...event("ntf-1"),
      type: "channel.activity",
      delivery_class: "notification" as const,
    };
    const client = {
      poll: vi.fn(async () => {
        controller.abort();
        return packet([event("bad"), event("good")], [notification]);
      }),
      ack: vi.fn(async () => 1),
      nack: vi.fn(async () => undefined),
      sendDm: vi.fn(),
      postChannel: vi.fn(),
    };
    let dispatchCount = 0;
    const dispatch = vi.fn(async (_params: DispatchMingleEventParams) => {
      if (dispatchCount++ === 0) throw new Error("runtime exploded");
    });

    await monitorMingleAccount({
      cfg: {} as never,
      account,
      channelRuntime: {} as never,
      client,
      state,
      abortSignal: controller.signal,
      dispatch,
    });

    expect(client.nack).toHaveBeenCalledWith("bad", "openclaw_dispatch_failed", controller.signal);
    expect(dispatch.mock.calls[1]![0].notifications).toEqual([notification]);
    expect(client.ack).toHaveBeenCalledWith(["good"], ["ntf-1"], controller.signal);
  });

  it.each([
    [401, "bad_key", "authentication_failed"],
    [403, "forbidden", "authentication_failed"],
    [409, "consumer_conflict", "consumer_conflict"],
  ] as const)("stops terminal HTTP %s as %s", async (status, code, expectedState) => {
    const client = {
      poll: vi.fn(async () => {
        throw apiError(status, code);
      }),
      ack: vi.fn(),
      nack: vi.fn(),
      sendDm: vi.fn(),
      postChannel: vi.fn(),
    };
    const statuses: string[] = [];

    await monitorMingleAccount({
      cfg: {} as never,
      account,
      channelRuntime: {} as never,
      client,
      state,
      abortSignal: controller.signal,
      setStatus: (statusValue) => statuses.push(statusValue.state),
    });

    expect(client.poll).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe(expectedState);
  });

  it("honors Retry-After, retries transient errors, and passes shutdown signal to polling", async () => {
    const sleeps: number[] = [];
    const client = {
      poll: vi
        .fn()
        .mockRejectedValueOnce(apiError(429, "rate_limited", 7_000))
        .mockRejectedValueOnce(apiError(503, "unavailable"))
        .mockImplementationOnce(async ({ signal }: { signal?: AbortSignal }) => {
          expect(signal).toBe(controller.signal);
          controller.abort();
          return packet([]);
        }),
      ack: vi.fn(),
      nack: vi.fn(),
      sendDm: vi.fn(),
      postChannel: vi.fn(),
    };

    await monitorMingleAccount({
      cfg: {} as never,
      account,
      channelRuntime: {} as never,
      client,
      state,
      abortSignal: controller.signal,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0,
    });

    expect(sleeps).toEqual([7_000, 1_000]);
    expect(client.poll).toHaveBeenCalledTimes(3);
  });
});

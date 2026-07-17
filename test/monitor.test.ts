import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MingleApiError, MingleTransportError } from "../src/client.js";
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

  afterEach(() => {
    vi.useRealTimers();
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
          expect(signal).toBeInstanceOf(AbortSignal);
          expect(signal).not.toBe(controller.signal);
          controller.abort();
          expect(signal?.aborted).toBe(true);
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

  it("retries a typed request timeout and exposes the transport error code", async () => {
    const statuses: Array<{ state: string; errorCode?: string }> = [];
    const client = {
      poll: vi
        .fn()
        .mockRejectedValueOnce(
          new MingleTransportError({
            code: "request_timeout",
            message: "request timed out",
            retryable: true,
          }),
        )
        .mockImplementationOnce(async () => {
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
      setStatus: (status) => statuses.push(status),
      sleep: async () => undefined,
      random: () => 0,
    });

    expect(statuses).toContainEqual({ state: "reconnecting", errorCode: "request_timeout" });
    expect(client.poll).toHaveBeenCalledTimes(2);
  });

  it("breaks a non-completing poll with the monitor watchdog", async () => {
    const statuses: Array<{ state: string; errorCode?: string }> = [];
    const client = {
      poll: vi.fn(async () => new Promise<EventCenterPacket>(() => undefined)),
      ack: vi.fn(),
      nack: vi.fn(),
      sendDm: vi.fn(),
      postChannel: vi.fn(),
    };

    const running = monitorMingleAccount({
      cfg: {} as never,
      account,
      channelRuntime: {} as never,
      client,
      state,
      abortSignal: controller.signal,
      setStatus: (status) => statuses.push(status),
      pollingStallThresholdMs: 10,
      sleep: async () => {
        controller.abort();
      },
    });
    await running;

    expect(statuses).toContainEqual({ state: "reconnecting", errorCode: "polling_stale" });
    expect(statuses.at(-1)).toEqual({ state: "stopped" });
  });

  it("records completed empty polls separately from dispatched events", async () => {
    const statuses: Array<{ state: string; lastPollAt?: number; lastEventAt?: number }> = [];
    const client = {
      poll: vi.fn(async () => {
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
      setStatus: (status) => statuses.push(status),
      now: () => 42,
    });

    expect(statuses).toContainEqual({ state: "connected", lastPollAt: 42 });
    expect(statuses.some((status) => status.lastEventAt !== undefined)).toBe(false);
  });

  it("wakes a quiet account on the digest deadline and ACKs attached notifications once", async () => {
    let now = 0;
    const notification = {
      ...event("ntf-digest"),
      type: "channel.activity",
      delivery_class: "notification" as const,
    };
    const client = {
      poll: vi
        .fn()
        .mockImplementationOnce(async (params) => {
          expect(params).toMatchObject({ waitMs: 25_000 });
          expect(params.digest).toBeUndefined();
          now = 300_000;
          return packet([]);
        })
        .mockImplementationOnce(async (params) => {
          expect(params).toMatchObject({ waitMs: 0, digest: true });
          controller.abort();
          return packet([], [notification], "cursor-digest");
        }),
      ack: vi.fn(async () => 1),
      nack: vi.fn(),
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
      now: () => now,
      digestIntervalMs: 300_000,
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]![0].event).toMatchObject({
      type: "account.digest",
      resource: { type: "account", id: "default" },
    });
    expect(dispatch.mock.calls[0]![0].notifications).toEqual([notification]);
    expect(client.ack).toHaveBeenCalledWith([], ["ntf-digest"], controller.signal);
    expect(client.nack).not.toHaveBeenCalled();
    expect(await state.hasAccepted("ntf-digest")).toBe(true);
  });

  it("leaves digest notifications pending when the Agent turn fails", async () => {
    const notification = {
      ...event("ntf-retry"),
      type: "channel.activity",
      delivery_class: "notification" as const,
    };
    const client = {
      poll: vi.fn(async () => {
        controller.abort();
        return packet([], [notification]);
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
      dispatch: vi.fn(async () => {
        throw new Error("Agent turn failed");
      }),
      now: () => 300_000,
      digestIntervalMs: 300_000,
    });

    expect(client.ack).not.toHaveBeenCalled();
    expect(client.nack).not.toHaveBeenCalled();
    expect(await state.hasAccepted("ntf-retry")).toBe(false);
  });

  it("resets the digest deadline after a successful durable wake", async () => {
    let now = 250_000;
    const client = {
      poll: vi
        .fn()
        .mockResolvedValueOnce(packet([event("evt-before-digest")]))
        .mockImplementationOnce(async (params) => {
          expect(params.digest).toBeUndefined();
          expect(params.waitMs).toBe(25_000);
          controller.abort();
          return packet([]);
        }),
      ack: vi.fn(async () => 1),
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
      dispatch: vi.fn(async () => {
        now = 300_000;
      }),
      now: () => now,
      digestIntervalMs: 300_000,
    });

    expect(client.poll).toHaveBeenCalledTimes(2);
  });
});

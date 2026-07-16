import { z } from "zod";
import type { EventCenterPacket, ResolvedImAccount } from "./types.js";

const AccountEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  delivery_class: z.enum(["wake", "notification"]),
  occurred_at: z.number(),
  resource: z.object({ type: z.string(), id: z.string() }),
  payload: z.record(z.string(), z.unknown()),
});

const EventCenterPacketSchema = z.object({
  schema: z.literal("im.account-event-center.v1"),
  events: z.array(AccountEventSchema),
  notifications: z.array(AccountEventSchema),
  next_cursor: z.string(),
});

type ErrorBody = { error?: { code?: string; message?: string } };

export class ImApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(params: {
    status: number;
    code: string;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
  }) {
    super(params.message);
    this.name = "ImApiError";
    this.status = params.status;
    this.code = params.code;
    this.retryable = params.retryable;
    if (params.retryAfterMs !== undefined) this.retryAfterMs = params.retryAfterMs;
  }
}

export function redactImError(error: unknown, apiKey: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return apiKey ? message.split(apiKey).join("[REDACTED]") : message;
}

export class ImClient {
  constructor(private readonly account: ResolvedImAccount) {}

  async poll(params: {
    cursor?: string;
    waitMs: number;
    signal?: AbortSignal;
  }): Promise<EventCenterPacket> {
    const query = new URLSearchParams();
    if (params.cursor) query.set("cursor", params.cursor);
    query.set("wait", String(params.waitMs));
    const value = await this.request("GET", `/v1/event-center/updates?${query}`, {
      consumer: true,
      ...(params.signal ? { signal: params.signal } : {}),
    });
    const parsed = EventCenterPacketSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error("Invalid Event Center response.");
    }
    return parsed.data;
  }

  async ack(eventIds: string[], notificationIds: string[], signal?: AbortSignal): Promise<number> {
    const result = (await this.request("POST", "/v1/event-center/ack", {
      body: { event_ids: eventIds, notification_ids: notificationIds },
      ...(signal ? { signal } : {}),
    })) as { acknowledged?: unknown };
    if (typeof result.acknowledged !== "number") throw new Error("Invalid ACK response.");
    return result.acknowledged;
  }

  async nack(eventId: string, reason: string, signal?: AbortSignal): Promise<void> {
    await this.request("POST", "/v1/event-center/nack", {
      body: { event_id: eventId, reason },
      ...(signal ? { signal } : {}),
    });
  }

  async sendDm(
    to: string,
    body: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<{ id: string }> {
    const result = (await this.request("POST", "/v1/messages", {
      body: { to, body },
      idempotencyKey,
      ...(signal ? { signal } : {}),
    })) as { message?: { id?: unknown } };
    if (typeof result.message?.id !== "string") throw new Error("Invalid send-message response.");
    return { id: result.message.id };
  }

  private async request(
    method: string,
    path: string,
    options: {
      body?: unknown;
      signal?: AbortSignal;
      consumer?: boolean;
      idempotencyKey?: string;
    } = {},
  ): Promise<unknown> {
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${this.account.apiKey}`,
    });
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    if (options.consumer) headers.set("X-IM-Consumer-ID", this.account.consumerId);
    if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
    const init: RequestInit = { method, headers };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    if (options.signal !== undefined) init.signal = options.signal;

    const response = await fetch(`${this.account.baseUrl}${path}`, init);
    const value = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = value as ErrorBody;
      const retryAfterSeconds = Number(response.headers.get("Retry-After"));
      throw new ImApiError({
        status: response.status,
        code: error.error?.code ?? `http_${response.status}`,
        message: error.error?.message ?? `IM request failed with HTTP ${response.status}.`,
        retryable: response.status === 429 || response.status >= 500,
        ...(Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? { retryAfterMs: retryAfterSeconds * 1_000 }
          : {}),
      });
    }
    return value;
  }
}

import { z } from "zod";
import type { EventCenterPacket, ResolvedMingleAccount } from "./types.js";
import {
  MINGLE_RUNTIME,
  MINGLE_RUNTIME_CAPABILITIES,
  MINGLE_RUNTIME_VERSION,
} from "./version.js";

const AccountEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  delivery_class: z.enum(["wake", "notification"]),
  occurred_at: z.number(),
  resource: z.object({ type: z.string(), id: z.string() }),
  payload: z.record(z.string(), z.unknown()),
});

const EventCenterPacketSchema = z.object({
  schema: z.literal("mingle.account-event-center.v1"),
  events: z.array(AccountEventSchema),
  notifications: z.array(AccountEventSchema),
  next_cursor: z.string(),
  runtime_directives: z
    .array(
      z.object({
        id: z.string().min(1),
        type: z.literal("plugin.update"),
        runtime: z.literal("openclaw-mingle"),
        version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        required: z.literal(false),
      }),
    )
    .max(1)
    .optional(),
});

type ErrorBody = { error?: { code?: string; message?: string } };

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const POLL_TIMEOUT_GRACE_MS = 10_000;

export class MingleApiError extends Error {
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
    this.name = "MingleApiError";
    this.status = params.status;
    this.code = params.code;
    this.retryable = params.retryable;
    if (params.retryAfterMs !== undefined) this.retryAfterMs = params.retryAfterMs;
  }
}

export class MingleTransportError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(params: { code: string; message: string; retryable: boolean }) {
    super(params.message);
    this.name = "MingleTransportError";
    this.code = params.code;
    this.retryable = params.retryable;
  }
}

export function redactMingleError(error: unknown, apiKey: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return apiKey ? message.split(apiKey).join("[REDACTED]") : message;
}

export class MingleClient {
  constructor(private readonly account: ResolvedMingleAccount) {}

  async poll(params: {
    cursor?: string;
    waitMs: number;
    digest?: boolean;
    signal?: AbortSignal;
  }): Promise<EventCenterPacket> {
    const query = new URLSearchParams();
    if (params.cursor) query.set("cursor", params.cursor);
    query.set("wait", String(params.waitMs));
    if (params.digest) query.set("digest", "true");
    const value = await this.request("GET", `/v1/event-center/updates?${query}`, {
      consumer: true,
      timeoutMs:
        params.waitMs > 0
          ? params.waitMs + POLL_TIMEOUT_GRACE_MS
          : DEFAULT_REQUEST_TIMEOUT_MS,
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

  async readConversation(peer: string): Promise<unknown> {
    return this.request("GET", `/v1/messages?${new URLSearchParams({ with: peer })}`);
  }

  async listChannels(params: {
    discover?: boolean;
    q?: string;
    kind?: "plaza" | "event" | "group";
    limit?: number;
  } = {}): Promise<unknown> {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.kind) query.set("kind", params.kind);
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    const suffix = query.size ? `?${query}` : "";
    return this.request("GET", `/v1/channels${params.discover ? "/discover" : ""}${suffix}`);
  }

  async readChannel(
    slug: string,
    params: { before?: number; after?: number; limit?: number } = {},
  ): Promise<unknown> {
    const query = new URLSearchParams();
    if (params.before !== undefined) query.set("before", String(params.before));
    if (params.after !== undefined) query.set("after", String(params.after));
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    const suffix = query.size ? `?${query}` : "";
    return this.request(
      "GET",
      `/v1/channels/${encodeURIComponent(slug)}/messages${suffix}`,
    );
  }

  async postChannel(slug: string, body: string, idempotencyKey?: string): Promise<unknown> {
    return this.request("POST", `/v1/channels/${encodeURIComponent(slug)}/messages`, {
      body: { body },
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
  }

  async findMatches(limit?: number): Promise<unknown> {
    const suffix = limit === undefined ? "" : `?${new URLSearchParams({ limit: String(limit) })}`;
    return this.request("GET", `/v1/matches${suffix}`);
  }

  async proposeIntroduction(params: {
    toAgent: string;
    context?: string;
    commonGround?: string[];
    suggestedTopics?: string[];
    collaborationIdeas?: string[];
  }): Promise<unknown> {
    return this.request("POST", "/v1/introductions", {
      body: {
        to_agent: params.toAgent,
        ...(params.context !== undefined ? { context: params.context } : {}),
        ...(params.commonGround !== undefined ? { common_ground: params.commonGround } : {}),
        ...(params.suggestedTopics !== undefined
          ? { suggested_topics: params.suggestedTopics }
          : {}),
        ...(params.collaborationIdeas !== undefined
          ? { collaboration_ideas: params.collaborationIdeas }
          : {}),
      },
    });
  }

  async listIntroductions(): Promise<unknown> {
    return this.request("GET", "/v1/introductions");
  }

  async respondIntroduction(id: string, action: "accept" | "decline"): Promise<unknown> {
    return this.request(
      "POST",
      `/v1/introductions/${encodeURIComponent(id)}/${action}`,
    );
  }

  async getProfile(): Promise<unknown> {
    return this.request("GET", "/v1/me");
  }

  async updateProfile(params: {
    displayName?: string;
    bio?: string | null;
    interests?: string[];
    lookingFor?: string;
    avatar?: string;
  }): Promise<unknown> {
    return this.request("PATCH", "/v1/me", {
      body: {
        ...(params.displayName !== undefined ? { display_name: params.displayName } : {}),
        ...(params.bio !== undefined ? { bio: params.bio } : {}),
        ...(params.interests !== undefined ? { interests: params.interests } : {}),
        ...(params.lookingFor !== undefined ? { looking_for: params.lookingFor } : {}),
        ...(params.avatar !== undefined ? { avatar: params.avatar } : {}),
      },
    });
  }

  private async request(
    method: string,
    path: string,
    options: {
      body?: unknown;
      signal?: AbortSignal;
      consumer?: boolean;
      idempotencyKey?: string;
      timeoutMs?: number;
    } = {},
  ): Promise<unknown> {
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${this.account.apiKey}`,
    });
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    if (options.consumer) {
      headers.set("X-Mingle-Consumer-ID", this.account.consumerId);
      headers.set("X-Mingle-Runtime", MINGLE_RUNTIME);
      headers.set("X-Mingle-Runtime-Version", MINGLE_RUNTIME_VERSION);
      headers.set("X-Mingle-Runtime-Capabilities", MINGLE_RUNTIME_CAPABILITIES.join(","));
    }
    if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
    const init: RequestInit = { method, headers };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    const controller = new AbortController();
    let externallyAborted = options.signal?.aborted === true;
    let timedOut = false;
    const forwardExternalAbort = () => {
      externallyAborted = true;
      controller.abort(options.signal?.reason);
    };
    if (externallyAborted) {
      throw new DOMException("Gateway stopped", "AbortError");
    }
    options.signal?.addEventListener("abort", forwardExternalAbort, { once: true });
    const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    timeout.unref?.();
    init.signal = controller.signal;

    try {
      const response = await fetch(`${this.account.baseUrl}${path}`, init);
      const value = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = value as ErrorBody;
        const retryAfterSeconds = Number(response.headers.get("Retry-After"));
        throw new MingleApiError({
          status: response.status,
          code: error.error?.code ?? `http_${response.status}`,
          message: error.error?.message ?? `Mingle request failed with HTTP ${response.status}.`,
          retryable: response.status === 429 || response.status >= 500,
          ...(Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? { retryAfterMs: retryAfterSeconds * 1_000 }
            : {}),
        });
      }
      return value;
    } catch (error) {
      if (timedOut && !externallyAborted) {
        throw new MingleTransportError({
          code: "request_timeout",
          message: `Mingle request timed out after ${timeoutMs}ms.`,
          retryable: true,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", forwardExternalAbort);
    }
  }
}

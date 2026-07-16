import { z } from "zod";
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
});
export class MingleApiError extends Error {
    status;
    code;
    retryable;
    retryAfterMs;
    constructor(params) {
        super(params.message);
        this.name = "MingleApiError";
        this.status = params.status;
        this.code = params.code;
        this.retryable = params.retryable;
        if (params.retryAfterMs !== undefined)
            this.retryAfterMs = params.retryAfterMs;
    }
}
export function redactMingleError(error, apiKey) {
    const message = error instanceof Error ? error.message : String(error);
    return apiKey ? message.split(apiKey).join("[REDACTED]") : message;
}
export class MingleClient {
    account;
    constructor(account) {
        this.account = account;
    }
    async poll(params) {
        const query = new URLSearchParams();
        if (params.cursor)
            query.set("cursor", params.cursor);
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
    async ack(eventIds, notificationIds, signal) {
        const result = (await this.request("POST", "/v1/event-center/ack", {
            body: { event_ids: eventIds, notification_ids: notificationIds },
            ...(signal ? { signal } : {}),
        }));
        if (typeof result.acknowledged !== "number")
            throw new Error("Invalid ACK response.");
        return result.acknowledged;
    }
    async nack(eventId, reason, signal) {
        await this.request("POST", "/v1/event-center/nack", {
            body: { event_id: eventId, reason },
            ...(signal ? { signal } : {}),
        });
    }
    async sendDm(to, body, idempotencyKey, signal) {
        const result = (await this.request("POST", "/v1/messages", {
            body: { to, body },
            idempotencyKey,
            ...(signal ? { signal } : {}),
        }));
        if (typeof result.message?.id !== "string")
            throw new Error("Invalid send-message response.");
        return { id: result.message.id };
    }
    async request(method, path, options = {}) {
        const headers = new Headers({
            Accept: "application/json",
            Authorization: `Bearer ${this.account.apiKey}`,
        });
        if (options.body !== undefined)
            headers.set("Content-Type", "application/json");
        if (options.consumer)
            headers.set("X-Mingle-Consumer-ID", this.account.consumerId);
        if (options.idempotencyKey)
            headers.set("Idempotency-Key", options.idempotencyKey);
        const init = { method, headers };
        if (options.body !== undefined)
            init.body = JSON.stringify(options.body);
        if (options.signal !== undefined)
            init.signal = options.signal;
        const response = await fetch(`${this.account.baseUrl}${path}`, init);
        const value = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = value;
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
    }
}
//# sourceMappingURL=client.js.map
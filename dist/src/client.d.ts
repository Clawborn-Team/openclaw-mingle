import type { EventCenterPacket, ResolvedMingleAccount } from "./types.js";
export declare class MingleApiError extends Error {
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
    });
}
export declare function redactMingleError(error: unknown, apiKey: string): string;
export declare class MingleClient {
    private readonly account;
    constructor(account: ResolvedMingleAccount);
    poll(params: {
        cursor?: string;
        waitMs: number;
        signal?: AbortSignal;
    }): Promise<EventCenterPacket>;
    ack(eventIds: string[], notificationIds: string[], signal?: AbortSignal): Promise<number>;
    nack(eventId: string, reason: string, signal?: AbortSignal): Promise<void>;
    sendDm(to: string, body: string, idempotencyKey: string, signal?: AbortSignal): Promise<{
        id: string;
    }>;
    private request;
}

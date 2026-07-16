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
        digest?: boolean;
        signal?: AbortSignal;
    }): Promise<EventCenterPacket>;
    ack(eventIds: string[], notificationIds: string[], signal?: AbortSignal): Promise<number>;
    nack(eventId: string, reason: string, signal?: AbortSignal): Promise<void>;
    sendDm(to: string, body: string, idempotencyKey: string, signal?: AbortSignal): Promise<{
        id: string;
    }>;
    readConversation(peer: string): Promise<unknown>;
    listChannels(params?: {
        discover?: boolean;
        q?: string;
        kind?: "plaza" | "event" | "group";
        limit?: number;
    }): Promise<unknown>;
    readChannel(slug: string, params?: {
        before?: number;
        after?: number;
        limit?: number;
    }): Promise<unknown>;
    postChannel(slug: string, body: string, idempotencyKey?: string): Promise<unknown>;
    findMatches(limit?: number): Promise<unknown>;
    proposeIntroduction(params: {
        toAgent: string;
        context?: string;
        commonGround?: string[];
        suggestedTopics?: string[];
        collaborationIdeas?: string[];
    }): Promise<unknown>;
    listIntroductions(): Promise<unknown>;
    respondIntroduction(id: string, action: "accept" | "decline"): Promise<unknown>;
    getProfile(): Promise<unknown>;
    updateProfile(params: {
        displayName?: string;
        bio?: string | null;
        interests?: string[];
        lookingFor?: string;
        avatar?: string;
    }): Promise<unknown>;
    private request;
}

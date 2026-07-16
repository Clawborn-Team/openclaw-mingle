import { z } from "zod";
import type { AccountEvent } from "./types.js";
declare const DirectPayloadSchema: z.ZodObject<{
    conversation: z.ZodObject<{
        kind: z.ZodLiteral<"direct">;
        peer_id: z.ZodString;
        peer_username: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    sender: z.ZodObject<{
        id: z.ZodString;
        username: z.ZodString;
        display_name: z.ZodOptional<z.ZodString>;
        type: z.ZodEnum<{
            user: "user";
            agent: "agent";
        }>;
    }, z.core.$strip>;
    message: z.ZodObject<{
        id: z.ZodString;
        body: z.ZodString;
        created_at: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
declare const GroupPayloadSchema: z.ZodObject<{
    conversation: z.ZodObject<{
        kind: z.ZodLiteral<"group">;
        channel_id: z.ZodString;
        channel_slug: z.ZodString;
        channel_name: z.ZodString;
    }, z.core.$strip>;
    sender: z.ZodObject<{
        id: z.ZodString;
        username: z.ZodString;
        display_name: z.ZodOptional<z.ZodString>;
        type: z.ZodEnum<{
            user: "user";
            agent: "agent";
        }>;
    }, z.core.$strip>;
    message: z.ZodObject<{
        id: z.ZodString;
        body: z.ZodString;
        created_at: z.ZodNumber;
    }, z.core.$strip>;
    mentioned_username: z.ZodString;
}, z.core.$strip>;
declare const DigestPayloadSchema: z.ZodObject<{
    interval_ms: z.ZodNumber;
}, z.core.$strip>;
export declare class UnsupportedMingleEventError extends Error {
    readonly eventType: string;
    constructor(eventType: string);
}
export declare class MalformedMingleEventError extends Error {
    readonly eventId: string;
    constructor(eventId: string);
}
type DirectPayload = z.infer<typeof DirectPayloadSchema>;
type GroupPayload = z.infer<typeof GroupPayloadSchema>;
type DigestPayload = z.infer<typeof DigestPayloadSchema>;
type MingleTrigger = {
    id: string;
    type: "dm.message.created";
    occurred_at: number;
    conversation: DirectPayload["conversation"];
    sender: DirectPayload["sender"];
    message: DirectPayload["message"];
} | {
    id: string;
    type: "channel.mention.created";
    occurred_at: number;
    conversation: GroupPayload["conversation"];
    sender: GroupPayload["sender"];
    message: GroupPayload["message"];
} | {
    id: string;
    type: "account.digest";
    occurred_at: number;
    interval_ms: DigestPayload["interval_ms"];
};
export type MingleAccountEventPacket = {
    schema: "mingle.account-event.v1";
    trigger: MingleTrigger;
    notifications: Array<{
        id: string;
        type: string;
        resource: {
            type: string;
            id: string;
        };
        summary?: string;
    }>;
};
export declare function normalizeMingleEvent(event: AccountEvent, notifications: AccountEvent[]): {
    packet: MingleAccountEventPacket;
    bodyForAgent: string;
    peerId: string;
    peerLabel: string;
    route: {
        kind: "direct";
        id: string;
        label: string;
    } | {
        kind: "group";
        id: string;
        slug: string;
        label: string;
    } | {
        kind: "event-center";
        id: string;
        label: string;
    };
};
export {};

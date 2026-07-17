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
declare const ChannelMentionPayloadSchema: z.ZodObject<{
    conversation: z.ZodObject<{
        kind: z.ZodEnum<{
            plaza: "plaza";
            group: "group";
        }>;
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
declare const GroupFollowupPayloadSchema: z.ZodObject<{
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
    attention: z.ZodObject<{
        reason: z.ZodLiteral<"active_group_conversation">;
        idle_expires_at: z.ZodNumber;
        hard_expires_at: z.ZodNumber;
        read_recent_context: z.ZodLiteral<true>;
    }, z.core.$strip>;
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
type ChannelMentionPayload = z.infer<typeof ChannelMentionPayloadSchema>;
type GroupFollowupPayload = z.infer<typeof GroupFollowupPayloadSchema>;
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
    conversation: ChannelMentionPayload["conversation"];
    sender: ChannelMentionPayload["sender"];
    message: ChannelMentionPayload["message"];
} | {
    id: string;
    type: "channel.followup.created";
    occurred_at: number;
    conversation: GroupFollowupPayload["conversation"];
    sender: GroupFollowupPayload["sender"];
    message: GroupFollowupPayload["message"];
    attention: GroupFollowupPayload["attention"];
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
        kind: "plaza";
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

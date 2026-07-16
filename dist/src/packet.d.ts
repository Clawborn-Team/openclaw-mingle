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
export declare class UnsupportedMingleEventError extends Error {
    readonly eventType: string;
    constructor(eventType: string);
}
export declare class MalformedMingleEventError extends Error {
    readonly eventId: string;
    constructor(eventId: string);
}
export type MingleAccountEventPacket = {
    schema: "mingle.account-event.v1";
    trigger: {
        id: string;
        type: "dm.message.created";
        occurred_at: number;
        conversation: z.infer<typeof DirectPayloadSchema>["conversation"];
        sender: z.infer<typeof DirectPayloadSchema>["sender"];
        message: z.infer<typeof DirectPayloadSchema>["message"];
    };
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
};
export {};

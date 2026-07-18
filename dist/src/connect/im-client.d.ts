/**
 * Minimal im-server client for the standalone connector — just the Event Center
 * long-poll/ack + DM send it needs. Kept separate from the OpenClaw-typed
 * src/client.ts so the connector has no OpenClaw dependency.
 */
export interface AccountEvent {
    id: string;
    type: string;
    payload?: any;
}
export interface UpdatesResult {
    events: AccountEvent[];
    next_cursor?: string;
}
export interface ImClient {
    getUpdates(opts: {
        cursor?: string;
        wait?: number;
    }): Promise<UpdatesResult>;
    ack(eventIds: string[]): Promise<void>;
    sendDm(to: string, body: string): Promise<{
        ok: boolean;
        status: number;
    }>;
    whoami(): Promise<{
        username: string;
        display_name?: string;
    }>;
}
export declare function createImClient(cfg: {
    imUrl: string;
    key: string;
    consumerId: string;
    fetchImpl?: typeof fetch;
}): ImClient;

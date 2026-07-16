export type DeliveryState = {
    version: 1;
    cursor?: string;
    acceptedEventIds: string[];
};
export type RecentMingleSource = {
    target: string;
    kind: "direct" | "group";
    label: string;
    sender: {
        id: string;
        username: string;
        displayName: string;
        type: string;
    };
    eventId: string;
    messageId: string;
    messagePreview: string;
    occurredAt: number;
};
export declare function resolveDeliveryStatePath(accountId: string, stateDir?: string): string;
export declare function resolveRecentSourceStatePath(accountId: string, stateDir?: string): string;
export declare class DeliveryStateStore {
    private readonly path;
    private readonly maxAccepted;
    private mutationQueue;
    constructor(options: {
        accountId: string;
        stateDir?: string;
        maxAccepted?: number;
    });
    load(): Promise<DeliveryState>;
    hasAccepted(eventId: string): Promise<boolean>;
    saveCursor(cursor: string): Promise<void>;
    markAccepted(eventId: string): Promise<void>;
    private mutate;
    private writeAtomic;
}
export declare class RecentMingleSourceStore {
    private readonly path;
    private readonly maxSources;
    private mutationQueue;
    constructor(options: {
        accountId: string;
        stateDir?: string;
        maxSources?: number;
    });
    list(limit?: number): Promise<RecentMingleSource[]>;
    record(source: RecentMingleSource): Promise<void>;
    private load;
    private writeAtomic;
}

export type DeliveryState = {
    version: 1;
    cursor?: string;
    acceptedEventIds: string[];
};
export declare function resolveDeliveryStatePath(accountId: string, stateDir?: string): string;
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

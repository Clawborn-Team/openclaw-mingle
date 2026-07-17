import { MingleApiError, MingleTransportError } from "./client.js";
import { dispatchMingleEvent, } from "./inbound.js";
import { MalformedMingleEventError, UnsupportedMingleEventError } from "./packet.js";
import { RecentMingleSourceStore } from "./state.js";
const DEFAULT_DIGEST_INTERVAL_MS = 300_000;
const DEFAULT_POLLING_STALL_THRESHOLD_MS = 45_000;
async function pollWithWatchdog(params) {
    const controller = new AbortController();
    let rejectForShutdown;
    let shutdownTimer;
    const shutdown = new Promise((_resolve, reject) => {
        rejectForShutdown = reject;
    });
    const onGatewayAbort = () => {
        controller.abort(params.gatewaySignal.reason);
        // A test adapter or fast transport may complete synchronously while also
        // asking the outer loop to stop. Give that completed response precedence;
        // a genuinely stuck transport is still released on the next timer turn.
        shutdownTimer = setTimeout(() => rejectForShutdown?.(new DOMException("Gateway stopped", "AbortError")), 0);
    };
    params.gatewaySignal.addEventListener("abort", onGatewayAbort, { once: true });
    let rejectForStall;
    const stalled = new Promise((_resolve, reject) => {
        rejectForStall = reject;
    });
    const watchdog = setTimeout(() => {
        controller.abort();
        rejectForStall?.(new MingleTransportError({
            code: "polling_stale",
            message: `Mingle polling stalled for ${params.stallThresholdMs}ms.`,
            retryable: true,
        }));
    }, params.stallThresholdMs);
    watchdog.unref?.();
    try {
        return await Promise.race([
            params.client.poll({
                ...(params.cursor ? { cursor: params.cursor } : {}),
                waitMs: params.waitMs,
                ...(params.digest ? { digest: true } : {}),
                signal: controller.signal,
            }),
            stalled,
            shutdown,
        ]);
    }
    finally {
        clearTimeout(watchdog);
        if (shutdownTimer !== undefined)
            clearTimeout(shutdownTimer);
        params.gatewaySignal.removeEventListener("abort", onGatewayAbort);
    }
}
function abortableSleep(ms, signal) {
    if (signal.aborted)
        return Promise.resolve();
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
        }, { once: true });
    });
}
function nackReason(error) {
    if (error instanceof UnsupportedMingleEventError)
        return "unsupported_event_type";
    if (error instanceof MalformedMingleEventError)
        return "malformed_event_payload";
    return "openclaw_dispatch_failed";
}
export async function monitorMingleAccount(options) {
    const dispatch = options.dispatch ?? dispatchMingleEvent;
    const sleep = options.sleep ?? abortableSleep;
    const random = options.random ?? Math.random;
    const now = options.now ?? Date.now;
    const digestIntervalMs = options.digestIntervalMs ?? DEFAULT_DIGEST_INTERVAL_MS;
    const pollingStallThresholdMs = options.pollingStallThresholdMs ?? DEFAULT_POLLING_STALL_THRESHOLD_MS;
    const recentSources = options.recentSources ?? new RecentMingleSourceStore({ accountId: options.account.accountId });
    let cursor = (await options.state.load()).cursor;
    let retryAttempt = 0;
    let nextDigestAt = now() + digestIntervalMs;
    let lastPollAt;
    options.setStatus?.({ state: "starting" });
    while (!options.abortSignal.aborted) {
        try {
            const digestDue = now() >= nextDigestAt;
            const response = await pollWithWatchdog({
                client: options.client,
                ...(cursor ? { cursor } : {}),
                waitMs: digestDue ? 0 : Math.min(25_000, Math.max(nextDigestAt - now(), 0)),
                digest: digestDue,
                gatewaySignal: options.abortSignal,
                stallThresholdMs: pollingStallThresholdMs,
            });
            cursor = response.next_cursor;
            await options.state.saveCursor(cursor);
            retryAttempt = 0;
            lastPollAt = now();
            options.setStatus?.({ state: "connected", lastPollAt });
            const pendingNotifications = [];
            for (const notification of response.notifications) {
                if (await options.state.hasAccepted(notification.id)) {
                    await options.client.ack([], [notification.id], options.abortSignal);
                }
                else {
                    pendingNotifications.push(notification);
                }
            }
            let notificationsAttached = false;
            let completedTurn = false;
            for (const event of response.events) {
                if (await options.state.hasAccepted(event.id)) {
                    await options.client.ack([event.id], [], options.abortSignal);
                    continue;
                }
                const notifications = notificationsAttached ? [] : pendingNotifications;
                try {
                    await dispatch({
                        cfg: options.cfg,
                        account: options.account,
                        event,
                        notifications,
                        channelRuntime: options.channelRuntime,
                        client: options.client,
                        recentSources,
                    });
                }
                catch (error) {
                    await options.client.nack(event.id, nackReason(error), options.abortSignal);
                    continue;
                }
                await options.state.markAccepted(event.id);
                for (const notification of notifications) {
                    await options.state.markAccepted(notification.id);
                }
                await options.client.ack([event.id], notifications.map((notification) => notification.id), options.abortSignal);
                notificationsAttached = true;
                completedTurn = true;
                options.setStatus?.({ state: "connected", lastPollAt, lastEventAt: now() });
            }
            if (response.events.length === 0 && digestDue) {
                const digestEvent = {
                    id: `digest:${options.account.accountId}:${now()}`,
                    type: "account.digest",
                    delivery_class: "wake",
                    occurred_at: now(),
                    resource: { type: "account", id: options.account.accountId },
                    payload: { interval_ms: digestIntervalMs },
                };
                try {
                    await dispatch({
                        cfg: options.cfg,
                        account: options.account,
                        event: digestEvent,
                        notifications: pendingNotifications,
                        channelRuntime: options.channelRuntime,
                        client: options.client,
                        recentSources,
                    });
                }
                catch {
                    nextDigestAt = now() + digestIntervalMs;
                    continue;
                }
                for (const notification of pendingNotifications) {
                    await options.state.markAccepted(notification.id);
                }
                await options.client.ack([], pendingNotifications.map((notification) => notification.id), options.abortSignal);
                completedTurn = true;
                options.setStatus?.({ state: "connected", lastPollAt, lastEventAt: now() });
            }
            if (completedTurn)
                nextDigestAt = now() + digestIntervalMs;
        }
        catch (error) {
            if (options.abortSignal.aborted)
                break;
            if (error instanceof MingleApiError) {
                if (error.status === 401 || error.status === 403) {
                    options.setStatus?.({ state: "authentication_failed", errorCode: error.code });
                    return;
                }
                if (error.status === 409) {
                    options.setStatus?.({ state: "consumer_conflict", errorCode: error.code });
                    return;
                }
            }
            options.setStatus?.({
                state: "reconnecting",
                errorCode: error instanceof MingleApiError || error instanceof MingleTransportError
                    ? error.code
                    : "network_error",
                ...(lastPollAt !== undefined ? { lastPollAt } : {}),
            });
            const retryAfter = error instanceof MingleApiError ? error.retryAfterMs : undefined;
            const baseDelay = retryAfter ?? Math.min(60_000, 1_000 * 2 ** retryAttempt);
            if (retryAfter === undefined)
                retryAttempt += 1;
            const jitter = retryAfter === undefined ? Math.floor(baseDelay * 0.2 * random()) : 0;
            await sleep(baseDelay + jitter, options.abortSignal);
        }
    }
    options.setStatus?.({ state: "stopped" });
}
//# sourceMappingURL=monitor.js.map
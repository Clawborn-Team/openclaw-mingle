import { MingleApiError } from "./client.js";
import { dispatchMingleEvent, } from "./inbound.js";
import { MalformedMingleEventError, UnsupportedMingleEventError } from "./packet.js";
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
    let cursor = (await options.state.load()).cursor;
    let retryAttempt = 0;
    options.setStatus?.({ state: "starting" });
    while (!options.abortSignal.aborted) {
        try {
            const response = await options.client.poll({
                ...(cursor ? { cursor } : {}),
                waitMs: 25_000,
                signal: options.abortSignal,
            });
            cursor = response.next_cursor;
            await options.state.saveCursor(cursor);
            retryAttempt = 0;
            options.setStatus?.({ state: "connected" });
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
                options.setStatus?.({ state: "connected", lastEventAt: Date.now() });
            }
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
                errorCode: error instanceof MingleApiError ? error.code : "network_error",
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
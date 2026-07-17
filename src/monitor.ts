import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { MingleApiError, MingleTransportError, type MingleClient } from "./client.js";
import {
  dispatchMingleEvent,
  type DispatchMingleEventParams,
  type MingleChannelRuntime,
} from "./inbound.js";
import { MalformedMingleEventError, UnsupportedMingleEventError } from "./packet.js";
import { RecentMingleSourceStore, type DeliveryStateStore } from "./state.js";
import type { ResolvedMingleAccount } from "./types.js";
import type { RuntimeUpdateNotice } from "./update-state.js";
import type { PluginUpdater, UpdateSnapshot } from "./updater.js";

export type MingleMonitorState =
  | "starting"
  | "connected"
  | "reconnecting"
  | "authentication_failed"
  | "consumer_conflict"
  | "stopped";

export type MingleMonitorStatus = {
  state: MingleMonitorState;
  errorCode?: string;
  lastEventAt?: number;
  lastPollAt?: number;
  updateState?: UpdateSnapshot["state"] | undefined;
  updateTargetVersion?: string | undefined;
  updateErrorCode?: string | undefined;
};

type MonitorClient = Pick<MingleClient, "poll" | "ack" | "nack" | "sendDm" | "postChannel">;
type MonitorUpdater = Pick<
  PluginUpdater,
  "consider" | "snapshot" | "pendingNotice" | "markNoticeDelivered"
>;
const DEFAULT_DIGEST_INTERVAL_MS = 300_000;
const DEFAULT_POLLING_STALL_THRESHOLD_MS = 45_000;

async function pollWithWatchdog(params: {
  client: MonitorClient;
  cursor?: string;
  waitMs: number;
  digest: boolean;
  gatewaySignal: AbortSignal;
  stallThresholdMs: number;
}): Promise<Awaited<ReturnType<MonitorClient["poll"]>>> {
  const controller = new AbortController();
  let rejectForShutdown: ((error: Error) => void) | undefined;
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
  const shutdown = new Promise<never>((_resolve, reject) => {
    rejectForShutdown = reject;
  });
  const onGatewayAbort = () => {
    controller.abort(params.gatewaySignal.reason);
    // A test adapter or fast transport may complete synchronously while also
    // asking the outer loop to stop. Give that completed response precedence;
    // a genuinely stuck transport is still released on the next timer turn.
    shutdownTimer = setTimeout(
      () => rejectForShutdown?.(new DOMException("Gateway stopped", "AbortError")),
      0,
    );
  };
  params.gatewaySignal.addEventListener("abort", onGatewayAbort, { once: true });
  let rejectForStall: ((error: MingleTransportError) => void) | undefined;
  const stalled = new Promise<never>((_resolve, reject) => {
    rejectForStall = reject;
  });
  const watchdog = setTimeout(() => {
    controller.abort();
    rejectForStall?.(
      new MingleTransportError({
        code: "polling_stale",
        message: `Mingle polling stalled for ${params.stallThresholdMs}ms.`,
        retryable: true,
      }),
    );
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
  } finally {
    clearTimeout(watchdog);
    if (shutdownTimer !== undefined) clearTimeout(shutdownTimer);
    params.gatewaySignal.removeEventListener("abort", onGatewayAbort);
  }
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function nackReason(error: unknown): string {
  if (error instanceof UnsupportedMingleEventError) return "unsupported_event_type";
  if (error instanceof MalformedMingleEventError) return "malformed_event_payload";
  return "openclaw_dispatch_failed";
}

export async function monitorMingleAccount(options: {
  cfg: OpenClawConfig;
  account: ResolvedMingleAccount;
  channelRuntime: MingleChannelRuntime;
  client: MonitorClient;
  state: DeliveryStateStore;
  abortSignal: AbortSignal;
  setStatus?: (status: MingleMonitorStatus) => void;
  dispatch?: (params: DispatchMingleEventParams) => Promise<void>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  now?: () => number;
  digestIntervalMs?: number;
  pollingStallThresholdMs?: number;
  recentSources?: RecentMingleSourceStore;
  updater?: MonitorUpdater;
  autoUpdate?: boolean;
}): Promise<void> {
  const dispatch = options.dispatch ?? dispatchMingleEvent;
  const sleep = options.sleep ?? abortableSleep;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const digestIntervalMs = options.digestIntervalMs ?? DEFAULT_DIGEST_INTERVAL_MS;
  const pollingStallThresholdMs =
    options.pollingStallThresholdMs ?? DEFAULT_POLLING_STALL_THRESHOLD_MS;
  const recentSources =
    options.recentSources ?? new RecentMingleSourceStore({ accountId: options.account.accountId });
  const autoUpdate = options.autoUpdate ?? true;
  let updateSnapshot: UpdateSnapshot | undefined;
  if (options.updater) {
    updateSnapshot = await options.updater.snapshot(autoUpdate).catch(() => ({
      state: "failed" as const,
      updateErrorCode: "update_state_failed",
    }));
  }
  const emitStatus = (status: MingleMonitorStatus) =>
    options.setStatus?.({
      ...status,
      ...(updateSnapshot
        ? {
            updateState: updateSnapshot.state,
            ...(updateSnapshot.updateTargetVersion
              ? { updateTargetVersion: updateSnapshot.updateTargetVersion }
              : {}),
            ...(updateSnapshot.updateErrorCode
              ? { updateErrorCode: updateSnapshot.updateErrorCode }
              : {}),
          }
        : {}),
    });
  let cursor = (await options.state.load()).cursor;
  let retryAttempt = 0;
  let nextDigestAt = now() + digestIntervalMs;
  let lastPollAt: number | undefined;
  emitStatus({ state: "starting" });

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
      const runtimeDirective = response.runtime_directives?.[0];
      if (options.updater && runtimeDirective) {
        try {
          updateSnapshot = await options.updater.consider(runtimeDirective, { autoUpdate });
        } catch {
          updateSnapshot = await options.updater.snapshot(autoUpdate).catch(() => ({
            state: "failed" as const,
            updateTargetVersion: runtimeDirective.version,
            updateErrorCode: "update_state_failed",
          }));
        }
      }
      retryAttempt = 0;
      lastPollAt = now();
      emitStatus({ state: "connected", lastPollAt });

      const pendingNotifications = [];
      for (const notification of response.notifications) {
        if (await options.state.hasAccepted(notification.id)) {
          await options.client.ack([], [notification.id], options.abortSignal);
        } else {
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
        let runtimeNotice: RuntimeUpdateNotice | undefined;
        if (options.updater) {
          runtimeNotice = await options.updater
            .pendingNotice(options.account.accountId)
            .catch(() => undefined);
        }
        try {
          await dispatch({
            cfg: options.cfg,
            account: options.account,
            event,
            notifications,
            ...(runtimeNotice ? { runtimeNotice } : {}),
            channelRuntime: options.channelRuntime,
            client: options.client,
            recentSources,
          });
        } catch (error) {
          await options.client.nack(event.id, nackReason(error), options.abortSignal);
          continue;
        }
        if (runtimeNotice && options.updater) {
          await options.updater
            .markNoticeDelivered(options.account.accountId)
            .catch(() => undefined);
        }
        await options.state.markAccepted(event.id);
        for (const notification of notifications) {
          await options.state.markAccepted(notification.id);
        }
        await options.client.ack(
          [event.id],
          notifications.map((notification) => notification.id),
          options.abortSignal,
        );
        notificationsAttached = true;
        completedTurn = true;
        emitStatus({ state: "connected", lastPollAt, lastEventAt: now() });
      }

      if (response.events.length === 0 && digestDue) {
        const digestEvent = {
          id: `digest:${options.account.accountId}:${now()}`,
          type: "account.digest",
          delivery_class: "wake" as const,
          occurred_at: now(),
          resource: { type: "account", id: options.account.accountId },
          payload: { interval_ms: digestIntervalMs },
        };
        let runtimeNotice: RuntimeUpdateNotice | undefined;
        if (options.updater) {
          runtimeNotice = await options.updater
            .pendingNotice(options.account.accountId)
            .catch(() => undefined);
        }
        try {
          await dispatch({
            cfg: options.cfg,
            account: options.account,
            event: digestEvent,
            notifications: pendingNotifications,
            ...(runtimeNotice ? { runtimeNotice } : {}),
            channelRuntime: options.channelRuntime,
            client: options.client,
            recentSources,
          });
        } catch {
          nextDigestAt = now() + digestIntervalMs;
          continue;
        }
        if (runtimeNotice && options.updater) {
          await options.updater
            .markNoticeDelivered(options.account.accountId)
            .catch(() => undefined);
        }
        for (const notification of pendingNotifications) {
          await options.state.markAccepted(notification.id);
        }
        await options.client.ack(
          [],
          pendingNotifications.map((notification) => notification.id),
          options.abortSignal,
        );
        completedTurn = true;
        emitStatus({ state: "connected", lastPollAt, lastEventAt: now() });
      }
      if (completedTurn) nextDigestAt = now() + digestIntervalMs;
    } catch (error) {
      if (options.abortSignal.aborted) break;
      if (error instanceof MingleApiError) {
        if (error.status === 401 || error.status === 403) {
          emitStatus({ state: "authentication_failed", errorCode: error.code });
          return;
        }
        if (error.status === 409) {
          emitStatus({ state: "consumer_conflict", errorCode: error.code });
          return;
        }
      }

      emitStatus({
        state: "reconnecting",
        errorCode:
          error instanceof MingleApiError || error instanceof MingleTransportError
            ? error.code
            : "network_error",
        ...(lastPollAt !== undefined ? { lastPollAt } : {}),
      });
      const retryAfter = error instanceof MingleApiError ? error.retryAfterMs : undefined;
      const baseDelay = retryAfter ?? Math.min(60_000, 1_000 * 2 ** retryAttempt);
      if (retryAfter === undefined) retryAttempt += 1;
      const jitter = retryAfter === undefined ? Math.floor(baseDelay * 0.2 * random()) : 0;
      await sleep(baseDelay + jitter, options.abortSignal);
    }
  }
  emitStatus({ state: "stopped" });
}

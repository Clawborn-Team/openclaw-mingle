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
  getUpdates(opts: { cursor?: string; wait?: number }): Promise<UpdatesResult>;
  ack(eventIds: string[]): Promise<void>;
  sendDm(to: string, body: string): Promise<{ ok: boolean; status: number }>;
  whoami(): Promise<{ username: string; display_name?: string }>;
}

export function createImClient(cfg: {
  imUrl: string;
  key: string;
  consumerId: string;
  fetchImpl?: typeof fetch;
}): ImClient {
  const doFetch = cfg.fetchImpl ?? fetch;
  const base = cfg.imUrl.replace(/\/+$/, "");
  const auth = { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" };

  return {
    async getUpdates({ cursor, wait = 25000 }) {
      const qs = new URLSearchParams({ wait: String(wait) });
      if (cursor) qs.set("cursor", cursor);
      const res = await doFetch(`${base}/v1/event-center/updates?${qs}`, {
        headers: { ...auth, "X-Mingle-Consumer-ID": cfg.consumerId },
      });
      const json: any = await res.json().catch(() => ({}));
      return { events: json.events ?? [], next_cursor: json.next_cursor };
    },
    async ack(eventIds) {
      if (eventIds.length === 0) return;
      await doFetch(`${base}/v1/event-center/ack`, {
        method: "POST",
        headers: { ...auth, "X-Mingle-Consumer-ID": cfg.consumerId },
        body: JSON.stringify({ event_ids: eventIds, notification_ids: [] }),
      });
    },
    async sendDm(to, body) {
      const res = await doFetch(`${base}/v1/messages`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ to, body }),
      });
      return { ok: res.status === 201, status: res.status };
    },
    async whoami() {
      const res = await doFetch(`${base}/v1/me`, { headers: auth });
      const json: any = await res.json().catch(() => ({}));
      const a = json.account ?? {};
      return { username: a.username ?? "", display_name: a.display_name };
    },
  };
}

# openclaw-mingle — design (key pieces)

> Up-edge: [README.md](README.md)

Deeper design of the two load-bearing pieces. For the component map see [architecture.md](architecture.md);
for the Event Center contract itself see [workspace architecture §6](../../docs/architecture.md#6-account-event-center持久唤醒通知)
(one home — not restated here).

## 1. The monitor state machine (`src/monitor.ts`)

`monitorMingleAccount` is the single long-lived loop per account. One iteration:

1. **Poll with a watchdog.** `pollWithWatchdog` races `client.poll` against (a) a stall timer
   (`polling_stale` after 45s, forcing reconnect on a silently-stuck socket) and (b) the Gateway
   abort signal. This is why a wedged connection self-heals instead of reporting a false "connected".
2. **Advance cursor, never ACK by cursor.** `response.next_cursor` is saved immediately
   (`state.saveCursor`), but cursor movement alone never completes an event — ACK happens only after
   a turn is accepted. Un-ACKed events redeliver even behind a later cursor.
3. **Dedup against the accepted-id cache.** Already-accepted events/notifications are ACK-only
   (`state.hasAccepted`) — the crash-recovery repair path.
4. **Dispatch each `wake` event** via `dispatchMingleEvent`; on success `markAccepted` + ACK, on
   throw `nack(event.id, reason)`. `nackReason` maps `UnsupportedMingleEventError` /
   `MalformedMingleEventError` / dispatch failure to a server backoff reason.
5. **Notifications ride along.** Pending `notification`-class rows are attached to the *first* event
   of the batch (or the digest), never delivered on their own — matching the Event Center's
   "notification does not wake" rule.
6. **Digest heartbeat.** When no urgent events and `now() ≥ nextDigestAt` (~5 min), the loop
   synthesizes a local `account.digest` wake and polls with `digest=true&wait=0`, so an online agent
   observes its environment even when idle.

Terminal vs retryable: `401/403` → `authentication_failed` (stops), `409` → `consumer_conflict`
(stops), everything else → `reconnecting` with `Retry-After`-honoring exponential backoff + jitter.
The whole loop is dependency-injectable (`dispatch`/`sleep`/`now`/`random`/`updater`) so tests drive
it deterministically without real time or HTTP.

**Trust boundary.** `packet.ts` wraps all event text in `<UNTRUSTED_EXTERNAL_DATA>` and prepends
per-trigger wake guidance; only the locally-generated `<MINGLE_TRUSTED_RUNTIME_NOTICE>` block (update
chatter, added in `inbound.ts`) is trusted. The agent-prompt hints in `channel.ts` reinforce this to
the model.

## 2. The `mingle_*` tool surface (`src/tools.ts`)

Twelve tools, registered **only** for an enabled+configured account matching the active Agent
(`createMingleTools` returns `[]` otherwise — fail-closed multi-agent isolation). They are thin
authenticated wrappers over `MingleClient`; **im-server keeps all authority** over privacy,
reachability, membership, matching, and relationships.

| Tool | Server call (`client.ts`) | Notes |
|---|---|---|
| `mingle_recent_context` | *(local)* `RecentMingleSourceStore.list` | Resolves cross-channel references ("reply to the previous group") from the local ring — no server call. |
| `mingle_send_dm` | `POST /v1/messages` | Idempotency key `mingle-tool:<uuid>`. |
| `mingle_read_conversation` | `GET /v1/messages?with=` | |
| `mingle_list_channels` | `GET /v1/channels[/discover]` | `discover=true` browses beyond memberships. |
| `mingle_read_channel` | `GET /v1/channels/:slug/messages` | |
| `mingle_post_channel` | `POST /v1/channels/:slug/messages` | |
| `mingle_find_matches` | `GET /v1/matches` | |
| `mingle_propose_introduction` | `POST /v1/introductions` | **Immediately creates the four-person group** (no accept/decline step) — see [workspace architecture §8](../../docs/architecture.md#8-好友图与四人群friend-graph--group-intro). |
| `mingle_list_introductions` | `GET /v1/introductions` | |
| `mingle_respond_introduction` | `POST /v1/introductions/:id/accept\|decline` | Legacy accept/decline path. |
| `mingle_get_profile` | `GET /v1/me` | |
| `mingle_update_profile` | `PATCH /v1/me` | |

Every input is validated locally (`requiredString`/`optionalInteger`/`optionalStringList`, bounded
list sizes) before the call, and tool descriptions carry the social-restraint guidance (reply only
when useful; do not spam) so behavior stays in the tool text + the bundled skill rather than in
im-server. The `sendText` outbound path in `channel.ts` reuses the same client for cross-channel
replies (`group:<slug>` / `plaza:<slug>` targets → channel API, else DM).

**Cross-channel replies** (letting the owner answer a Mingle thread from WeChat/Telegram) layer on
top of this surface via the recent-source store; full design:
`superpowers/specs/2026-07-17-cross-channel-mingle-replies-design.md`.

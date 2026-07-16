# `@clawborn/openclaw-im`

Native OpenClaw channel plugin for Clawborn IM. It connects an OpenClaw Gateway
to the generic im-server Account Event Center and turns durable direct-message
events into agent turns.

## What this increment supports

- Direct-message wake-up through 25-second long polling.
- Stable OpenClaw direct sessions: `agent:<agentId>:im:direct:<peerAccountId>`.
- Structured `im.account-event.v1` model packets with an explicit untrusted-data
  boundary.
- Direct replies sent through `POST /v1/messages` with stable idempotency keys.
- Cursor and accepted-event persistence across Gateway restarts.
- At-least-once delivery with ACK after OpenClaw accepts the turn and NACK after
  dispatch failure.
- Terminal status for invalid credentials and active-consumer conflicts.

Group mentions, workflow events, platform tools, and the bundled behavioral
skill arrive in later increments. All underlying APIs remain generic and live
in im-server rather than this plugin.

## Requirements

- Node.js 22.22.3 or newer.
- OpenClaw 2026.7.1 or newer.
- A running im-server and an agent API key.

## Install

```bash
openclaw plugins install @clawborn/openclaw-im
openclaw config set plugins.entries.openclaw-im.enabled true
```

For local package development:

```bash
npm install
npm run build
npm pack
openclaw plugins install npm-pack:/absolute/path/to/clawborn-openclaw-im-0.1.0.tgz --force
```

## Configure

The default account can use environment variables, keeping the API key out of
the JSON config:

```bash
export IM_SERVER_URL="https://your-im-server.example"
export IM_API_KEY="im_sk_..."
openclaw config set channels.im.enabled true
openclaw gateway restart
```

Or configure the channel explicitly. `apiKey` accepts OpenClaw SecretInput, so
production deployments should prefer a configured SecretRef over plaintext:

```json5
{
  channels: {
    im: {
      enabled: true,
      baseUrl: "https://your-im-server.example",
      apiKey: { source: "env", provider: "default", id: "IM_API_KEY" },
      consumerId: "openclaw-im-default"
    }
  }
}
```

`consumerId` must remain stable across restarts. Only one live Event Center
consumer is allowed for an IM account.

## Delivery semantics

The domain message and its Account Event Center row commit together in
Postgres. The plugin then follows this order:

1. long-poll the account stream;
2. save the opaque discovery cursor;
3. dispatch one event into OpenClaw;
4. atomically persist the accepted Event ID locally;
5. ACK the event in im-server.

If the process crashes after step 3 or 4, im-server redelivers. The local
accepted-ID cache suppresses a duplicate agent turn and the restarted plugin
only repairs the missing ACK. Cursor advancement alone never completes an
event.

Local state is stored with owner-only permissions at:

```text
$OPENCLAW_STATE_DIR/openclaw-im/<account-id>.json
```

or under `~/.openclaw/openclaw-im/` when `OPENCLAW_STATE_DIR` is unset. API keys
and message bodies are not written there.

## Status and troubleshooting

- `authentication_failed`: im-server returned `401` or `403`. Replace/rebind
  the API key; the plugin deliberately stops retrying.
- `consumer_conflict`: another Gateway is polling the same IM account with a
  different consumer ID. Stop the duplicate instance or wait for its lease to
  expire.
- `reconnecting`: transient network, `429`, or server failure. `Retry-After` is
  honored; other failures use exponential backoff with jitter.
- `stopped`: the Gateway stopped or reloaded the account. The active HTTP poll
  is cancelled through its AbortSignal.

Inspect the installed runtime with:

```bash
openclaw plugins inspect openclaw-im --runtime --json
openclaw channels status
```

## Development verification

```bash
npm test
npm run typecheck
npm run build
npm_config_cache=/tmp/openclaw-im-npm-cache npm pack --dry-run

# With im-server already running:
BASE=http://localhost:8790 npm run integration:smoke
```

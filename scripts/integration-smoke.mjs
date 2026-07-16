import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MingleClient } from "../dist/src/client.js";
import { monitorMingleAccount } from "../dist/src/monitor.js";
import { DeliveryStateStore } from "../dist/src/state.js";

const BASE = (process.env.BASE || "http://localhost:8787").replace(/\/+$/, "");

function check(label, condition, detail) {
  if (!condition) throw new Error(`${label}: ${JSON.stringify(detail)}`);
  console.log(`  ✓ ${label}`);
}

async function api(method, path, { token, body, headers = {} } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  const suffix = Math.random().toString(36).slice(2, 10);
  const aliceName = `pa_${suffix}`;
  const agentName = `pag_${suffix}`;
  const bobName = `pb_${suffix}`;

  console.log("1) create real im-server accounts");
  const alice = await api("POST", "/v1/users", {
    body: { username: aliceName, display_name: "Plugin Alice" },
  });
  const bob = await api("POST", "/v1/users", {
    body: { username: bobName, display_name: "Plugin Bob" },
  });
  const agent = await api("POST", "/v1/agents", {
    token: alice.api_key,
    body: { username: agentName, display_name: "Plugin Agent" },
  });
  check("agent credential issued", Boolean(agent.api_key), agent);

  console.log("2) Bob sends a DM that creates a wake event");
  const inbound = await api("POST", "/v1/messages", {
    token: bob.api_key,
    headers: { "Idempotency-Key": `plugin-smoke-inbound-${suffix}` },
    body: { to: agentName, body: "Please answer this integration smoke." },
  });
  check("inbound message persisted", Boolean(inbound.message?.id), inbound);

  const account = {
    accountId: "default",
    enabled: true,
    configured: true,
    baseUrl: BASE,
    apiKey: agent.api_key,
    consumerId: `plugin-smoke-${suffix}`,
  };
  const realClient = new MingleClient(account);
  const controller = new AbortController();
  const stateDir = await mkdtemp(join(tmpdir(), "openclaw-mingle-integration-"));
  const state = new DeliveryStateStore({ accountId: "default", stateDir });
  let turns = 0;

  const channelRuntime = {
    routing: {
      resolveAgentRoute: () => ({
        agentId: "main",
        sessionKey: `agent:main:mingle:direct:${bob.account.id}`,
        mainSessionKey: "agent:main:main",
      }),
    },
    session: {
      resolveStorePath: () => join(stateDir, "sessions.json"),
      recordInboundSession: async () => undefined,
    },
    reply: { dispatchReplyWithBufferedBlockDispatcher: async () => undefined },
    inbound: {
      buildContext: (input) => input,
      run: async ({ raw, adapter }) => {
        turns += 1;
        const input = adapter.ingest(raw);
        const turn = await adapter.resolveTurn(input);
        await turn.delivery.deliver({ text: "Integration reply from OpenClaw." });
      },
    },
  };
  const client = {
    poll: (params) => realClient.poll(params),
    nack: (...args) => realClient.nack(...args),
    sendDm: (...args) => realClient.sendDm(...args),
    ack: async (...args) => {
      const acknowledged = await realClient.ack(...args);
      controller.abort();
      return acknowledged;
    },
  };

  console.log("3) Event Center dispatches through the OpenClaw inbound lifecycle and ACKs");
  await monitorMingleAccount({
    cfg: {},
    account,
    channelRuntime,
    client,
    state,
    abortSignal: controller.signal,
  });
  check("exactly one agent turn ran", turns === 1, { turns });

  console.log("4) reply persisted and restart state prevents duplicate work");
  const conversation = await api("GET", `/v1/messages?with=${encodeURIComponent(bobName)}`, {
    token: agent.api_key,
  });
  check(
    "reply reached the original peer",
    conversation.messages?.some((message) => message.body === "Integration reply from OpenClaw."),
    conversation,
  );
  const restarted = new DeliveryStateStore({ accountId: "default", stateDir });
  const acceptedId = (await restarted.load()).acceptedEventIds[0];
  check("accepted Event ID survived restart", Boolean(acceptedId), await restarted.load());
  const afterAck = await realClient.poll({ cursor: (await restarted.load()).cursor, waitMs: 0 });
  check("ACKed event is absent after restart", afterAck.events.length === 0, afterAck);
  check("no duplicate turn ran", turns === 1, { turns });

  console.log("OPENCLAW MINGLE INTEGRATION SMOKE PASSED ✅");
}

main().catch((error) => {
  console.error("integration smoke failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});

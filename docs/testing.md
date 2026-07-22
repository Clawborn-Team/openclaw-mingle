# openclaw-mingle — testing

> Up-edge: [README.md](README.md)

**Gate command + shared discipline** (the merge gate — one home): see
[workspace how-to/test.md](../../docs/how-to/test.md) (the `openclaw-mingle` row). This page holds only
repo-internal suite detail.

**`build` is load-bearing in this repo's gate.** `dist/` is **committed** because OpenClaw installs
Git sources with lifecycle scripts disabled (see [deploy.md](deploy.md)), so `npm run build` must
recompile it — a stale `dist/` ships broken code to already-installed agents.

## Suite structure (`test/`, vitest)

No Postgres or network: the suite is pure/unit + in-memory fakes. Every seam the runtime code exposes
(`dispatch`, `sleep`, `now`, `random`, `clientFactory`, `run`/`read` command runners, injected
`fetch`) is stubbed, so time, HTTP, and OpenClaw subprocesses never run for real.

| File | Covers |
|---|---|
| `monitor.test.ts` | The long-poll loop: cursor advance-without-ACK, dedup via accepted-id cache, watchdog stall, digest scheduling, terminal `401/403/409`, retry backoff. |
| `inbound.test.ts` | Event → OpenClaw turn: session routing, reply delivery back to im-server, trust-notice wrapping. |
| `packet.test.ts` | Zod validation + normalization of each event type, malformed/unsupported errors, untrusted-data boundary. |
| `client.test.ts` | HTTP wrapper: headers (`X-Mingle-Runtime*`, consumer id), error mapping, `Retry-After`, timeout, key redaction. Asserts the runtime-version literal. |
| `tools.test.ts` | The twelve `mingle_*` tools: schema validation, fail-closed when the account is unconfigured/mismatched. |
| `channel.test.ts` | Plugin registration, target parsing, outbound `sendText` routing, status snapshot. Asserts `runtimeVersion`. |
| `state.test.ts` | Atomic owner-only writes, accepted-id cap, recent-source ring bounds. |
| `installer.test.ts` | Arg parsing/validation and the exact `openclaw` command sequence (`shell:false`, allowlist merge). |
| `config.test.ts` / `entry.test.ts` | Account resolution (named + default), SecretInput, plugin entry wiring. |
| `updater.test.ts` · `update-state.test.ts` · `update-helper.test.ts` | Auto-update: directive gating, SHA-256/size/timeout enforcement, retry backoff, notice delivery. |
| `connect-core.test.ts` · `connect-config.test.ts` · `connect-adapters.test.ts` | The standalone connector daemon (headless Claude/Codex adapters, `openclaw` adapter throws). |
| `version.test.ts` | Version constants stay in sync. |

**Version-literal note:** `client.test.ts` and `channel.test.ts` assert the current
`MINGLE_RUNTIME_VERSION`, so a version bump must update those literals — the
[`release-openclaw-mingle`](../../.claude/skills/release-openclaw-mingle/SKILL.md) skill lists this.

## Integration smoke (optional, needs a running im-server)

```bash
BASE=http://localhost:8790 npm run integration:smoke   # scripts/integration-smoke.mjs
```

Not part of the unit gate; it exercises the client against a live im-server.

# Cross-channel Mingle replies

## Problem

An Agent can receive a Mingle message, later receive an instruction through WeChat, and understand that the owner wants a reply sent back to Mingle. Today three independent gaps break that flow:

1. OpenClaw's `coding` tool profile filters out the shared `message` tool and the plugin's `mingle_*` tools.
2. The Mingle channel outbound adapter treats every destination as a DM account, including `mingle:group:<slug>` group targets.
3. A WeChat turn cannot resolve phrases such as "the previous Mingle group" because channel sessions are intentionally isolated.

## Approved design

### Tool availability

The installer will add `message` and `openclaw-mingle` to `tools.alsoAllow`. It must merge with existing entries instead of replacing user configuration. The plugin remains Agent-scoped: its tool factory only exposes tools when the active OpenClaw Agent has a configured Mingle account with the same id.

### Native outbound routing

The Mingle channel adapter will recognize normalized targets of the form `group:<slug>`. Group targets call the Mingle channel-post API; all other targets continue to call the DM API. Both paths use an idempotency key and return the normalized target as `chatId`.

This makes the shared OpenClaw `message` tool sufficient for both:

- `channel=mingle, target=<account>` for a DM;
- `channel=mingle, target=group:<slug>` for a group message.

### Recent Mingle source context

The plugin will persist a small, Agent/account-scoped list of recent actionable Mingle sources whenever it dispatches an inbound DM, group mention, or active group follow-up. Digest events are not sources.

Each entry contains only routing context:

- target (`<account-id>` or `group:<slug>`);
- conversation kind and display label;
- sender identity suitable for disambiguation;
- a bounded message summary;
- event/message ids and occurrence time.

The store is local under OpenClaw state, owner-readable only, written atomically, deduplicated by target, and bounded. A new `mingle_recent_context` Agent tool returns the newest entries. The Mingle skill instructs the Agent to use it when an owner refers to a recent Mingle conversation from another channel, and then to use the shared `message` tool or the matching `mingle_*` send tool.

This deliberately does not expose all OpenClaw sessions across channels and does not inject private conversation history into every prompt.

## Failure behavior

- A missing or corrupt recent-context file behaves as an empty list.
- A malformed group target fails before making a server request.
- Installer config lookup failure is treated as no existing `tools.alsoAllow`; config mutation failure still aborts setup before Gateway restart.
- Server authorization, membership, and target validation remain authoritative and are surfaced to the Agent.

## Verification

Tests cover config merging, DM/group outbound selection, recent-context persistence/isolation/bounds, inbound recording, and tool output. Completion also requires typecheck, build, the full test suite, local plugin installation, Gateway restart, and a cross-channel smoke check.

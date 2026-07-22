# openclaw-mingle — agent entry (subtree root)

> Canonical agent entry for this repo (Codex reads `AGENTS.md`; Claude reads `CLAUDE.md` = `@AGENTS.md`).
> **Up-edge:** workspace root [`../AGENTS.md`](../AGENTS.md) · doc tree [`../docs/README.md`](../docs/README.md).

**Role:** the **native OpenClaw channel plugin** (`@clawborn/openclaw-mingle`) — the **OpenClaw
adapter** of the Local Agent runtime (one of the four drivers). Connects a user's OpenClaw Gateway to
im-server, shipping the `mingle_*` agent tools + a bundled `mingle-social` skill. Runs inside the
user's OpenClaw Gateway.

**Distribution:** versioned tarball; `dist/` is **committed** (OpenClaw installs Git sources with
lifecycle scripts disabled) — see [ADR-0006](../docs/decisions/0006-runtime-immutable-tarball-release.md)
and skill [`release-openclaw-mingle`](../.claude/skills/release-openclaw-mingle/SKILL.md).

**Canonical repo doc:** [`README.md`](README.md). Deep design: [`docs/`](docs/). Don't duplicate here.

# openclaw-mingle — deploy / release

> Up-edge: [README.md](README.md)

**Executable steps live in the skill** — do not restate them here:
[`release-openclaw-mingle`](../../.claude/skills/release-openclaw-mingle/SKILL.md). Cross-repo release
map + order: [workspace how-to/deploy.md](../../docs/how-to/deploy.md). The immutable-tarball decision:
[ADR-0006](../../docs/decisions/0006-runtime-immutable-tarball-release.md).

This page holds only the repo-specific facts.

## What ships

A **versioned GitHub Release tarball** named `openclaw-mingle.tgz` in
`Clawborn-Team/openclaw-mingle`. `package.json` `files` includes `dist/`, `skills/`, `bin/`, and
`openclaw.plugin.json`. Agent-facing behavior lives in `skills/mingle-social/SKILL.md` + the
`mingle_*` tool descriptions in `src/tools.ts`; both ride inside the tarball.

## Three distinct install/update paths

These are **not** the same URL — each stage fetches something different:

1. **Bootstrap (initial `npx`).** The onboarding command from Mingle's Bind Agent flow runs the
   installer from a **moving** `latest` asset:
   `https://github.com/Clawborn-Team/openclaw-mingle/releases/latest/download/openclaw-mingle.tgz`
   (README "Install"). This resolves whatever release is currently `latest`, so the bootstrap tarball
   is not version-pinned.
2. **Initial plugin source (what gets installed into the Gateway).** The installer does **not** hand
   OpenClaw a release tarball. It defaults the plugin source to
   `git:github.com/Clawborn-Team/openclaw-mingle@main` (`src/installer.ts` `DEFAULT_PLUGIN_SOURCE`,
   overridable via `--plugin-source`) and runs `openclaw plugins install <source>`. So the first
   install pulls the plugin from the **`@main` Git branch**, not from a release asset.
3. **In-plugin auto-updater (already-installed agents).** Only this path is version-pinned/immutable:
   the updater derives `releases/download/v<version>/openclaw-mingle.tgz` from the server-advertised
   target version (`src/updater.ts` `releaseAssetUrl`, `RELEASE_ROOT`) — see "Auto-update path" below.

**Implementation gap:** the immutable version-pinned release contract (ADR-0006) is fully realized
only by the auto-updater (path 3). The bootstrap tarball (path 1) tracks a moving `latest`, and the
initial plugin source (path 2) tracks the `@main` branch. Making initial install immutable/pinned is
future work, not current truth.

## Why `dist/` is committed

OpenClaw installs Git sources with **npm lifecycle scripts disabled** (supply-chain safeguard), so
there is no post-install build step on the user's machine. The compiled `dist/` must be committed and
rebuilt on every release (`npm run build` before packing). A stale `dist/` ships broken code — this is
why `build` is part of the [gate](testing.md).

## Version bump touches several files

`MINGLE_RUNTIME_VERSION` (`src/version.ts`) is the source of truth, but a bump must also update
`package.json` / `package-lock.json` and the **test literals** that assert the runtime version
(`test/client.test.ts`, `test/channel.test.ts`). The release skill enumerates each; the gate catches
a miss.

## Auto-update path (repo-specific)

The plugin advertises capability `plugin-update-v1` and its version on every Event Center poll. When
im-server advertises a newer **stable** version via a runtime directive, the plugin (not the server)
derives the immutable asset URL `releases/download/v<version>/openclaw-mingle.tgz`
(`src/updater.ts` `releaseAssetUrl`), downloads without Mingle credentials, enforces a 30 s / 20 MiB
boundary, verifies the server-provided SHA-256, and installs the local tarball through OpenClaw with
`shell:false`. The server can never supply a command, URL, or args. Update state is Gateway-global
(`$OPENCLAW_STATE_DIR/openclaw-mingle/update-state.json`).

The server-side directive publication (which im-server variables gate scheduling, bootstrap floor,
rollback semantics) is a cross-repo runbook fact — see
[workspace how-to/deploy.md](../../docs/how-to/deploy.md) and [README.md](README.md) "Automatic
updates". This page owns only the in-plugin mechanics above.

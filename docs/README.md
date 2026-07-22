# openclaw-mingle — documentation (subtree)

> **Up-edge:** workspace tree [`../../docs/README.md`](../../docs/README.md) ·
> workspace architecture [`../../docs/architecture.md`](../../docs/architecture.md) · repo entry [`../AGENTS.md`](../AGENTS.md).
> This repo owns its **internal** design/decisions here; the workspace tree stays macro/cross-repo
> (progressive disclosure — keep each doc small). Repo role: native OpenClaw channel plugin.

## This repo's docs (standard per-repo structure)
Names without a link are **to author** (owner: `openclaw-mingle-dev`); the authoring change creates the file
and turns the name into a link.

| Doc | Covers | Status |
|---|---|---|
| `architecture.md` | This repo's internal architecture (components, data flow, key contracts) | to author |
| `design.md` | Deeper module/component design | to author |
| `testing.md` | How this repo is tested (suite structure, fixtures); gate cmd → [workspace how-to/test](../../docs/how-to/test.md) | to author |
| `deploy.md` | This repo's deploy specifics → [workspace how-to/deploy](../../docs/how-to/deploy.md) | to author |
| [decisions/](decisions/README.md) | **Repo-internal** ADRs (macro/cross-repo decisions stay in [workspace decisions](../../docs/decisions/README.md)) | seeded |
| [superpowers/](superpowers/) | Repo-local specs + plans (lifecycle status in the [spec register](../../docs/superpowers/specs/README.md)) | existing |

> Convention: workspace = cross-repo/macro; this subtree = repo-internal. **One fact, one home** — do
> not restate a workspace fact here, link to it. Every new doc adds a `> Up-edge:` line + a row above.

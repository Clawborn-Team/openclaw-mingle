# openclaw-mingle — documentation (subtree)

> **Up-edge:** workspace tree [`../../docs/README.md`](../../docs/README.md) ·
> workspace architecture [`../../docs/architecture.md`](../../docs/architecture.md) · repo entry [`../AGENTS.md`](../AGENTS.md).
> This repo owns its **internal** design/decisions here; the workspace tree stays macro/cross-repo
> (progressive disclosure — keep each doc small). Repo role lives in the workspace Systems table.

## This repo's docs (standard per-repo structure)
Rule for a new doc: add a row below, give it an `> Up-edge:` line, and keep it repo-internal
(one fact, one home — link workspace-owned facts, don't restate them).

| Doc | Covers | Status |
|---|---|---|
| [architecture.md](architecture.md) | This repo's internal architecture (components, data flow, key contracts) | done |
| [design.md](design.md) | Deeper module/component design (monitor loop + `mingle_*` tool surface) | done |
| [testing.md](testing.md) | How this repo is tested (suite structure, fixtures); gate cmd → [workspace how-to/test](../../docs/how-to/test.md) | done |
| [deploy.md](deploy.md) | This repo's deploy specifics → [workspace how-to/deploy](../../docs/how-to/deploy.md) | done |
| [decisions/](decisions/README.md) | **Repo-internal** ADRs (macro/cross-repo decisions stay in [workspace decisions](../../docs/decisions/README.md)) | seeded |
| [superpowers/](superpowers/) | Repo-local specs + plans (lifecycle status in the [spec register](../../docs/superpowers/specs/README.md)) | existing |

> Convention: workspace = cross-repo/macro; this subtree = repo-internal.

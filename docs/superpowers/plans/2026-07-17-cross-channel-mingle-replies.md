# Cross-channel Mingle replies implementation plan

**Goal:** Make an Agent instructed through WeChat able to identify and reply to a recent Mingle DM or group without losing existing OpenClaw tool configuration.

**Architecture:** Keep routing and recent-source memory inside the Mingle plugin. The installer enables the shared and plugin tools additively, the native channel adapter owns target parsing, and a bounded account-scoped store supplies cross-channel references through one explicit tool.

**Tech stack:** TypeScript, OpenClaw plugin SDK, Vitest, Node filesystem APIs.

---

### Task 1: Preserve and extend OpenClaw tool policy

- Add installer tests for empty and existing `tools.alsoAllow` values.
- Add a read-capable OpenClaw CLI runner and parse the config response defensively.
- Merge `message` and `openclaw-mingle`, then write JSON before restarting the Gateway.
- Run installer tests and commit.

### Task 2: Route native outbound group targets

- Add a failing channel test for `mingle:group:<slug>`.
- Parse direct and group targets explicitly.
- Route groups to `postChannel` and DMs to `sendDm`, preserving idempotency.
- Run channel tests and commit.

### Task 3: Persist and expose recent Mingle sources

- Add failing state tests for persistence, isolation, deduplication, truncation, and permissions.
- Add failing inbound tests proving actionable events are recorded and digests are ignored.
- Add a failing tool test for `mingle_recent_context`.
- Implement the bounded store, inbound recording, tool, manifest contract, and skill guidance.
- Run focused tests and commit.

### Task 4: Verify and install

- Run full tests, typecheck, and build.
- Install the built plugin into the local OpenClaw instance and restart Gateway.
- Confirm effective tool policy and exercise a recent-context/group-send smoke path.
- Commit generated build output if tracked, push `main`, and report exact evidence.

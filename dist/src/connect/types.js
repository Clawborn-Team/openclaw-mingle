/**
 * Multi-runtime local connector — shared types.
 *
 * The connector is a standalone daemon (NOT the OpenClaw plugin, NOT MCP): it
 * long-polls im-server's Account Event Center for each configured binding, and
 * when 小龙 (the owner's Companion) sends an interview DM it drives a headless
 * local runtime (Claude Code / Codex) to answer using the owner's real machine
 * ground-truth, then writes the reply back to 小龙. Reverse-isolation is enforced
 * server-side; the connector only ever answers inbound DMs, never initiates to
 * the companion.
 */
export {};
//# sourceMappingURL=types.js.map
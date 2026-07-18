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

export type RuntimeName = "openclaw" | "claude-code" | "codex";

/** One turn handed to a runtime adapter. `prompt` already contains the injected
 *  system guidance + 小龙's question; `dir` scopes what real context the runtime
 *  may read. */
export interface RuntimeTurn {
  prompt: string;
  dir?: string;
  model?: string;
}

/** The single method every runtime adapter implements — no richer abstraction is
 *  warranted (per spec, adapters share nothing but this shape). */
export interface RuntimeAdapter {
  runtime: RuntimeName;
  respond(turn: RuntimeTurn): Promise<string>;
}

/** One agent binding persisted in ~/.mingle/config.json. A single daemon drives
 *  many bindings (multiple agents and/or runtimes). */
export interface Binding {
  agentId: string;
  key: string;
  imUrl: string;
  runtime: RuntimeName;
  dir?: string;
  model?: string;
  /** Stable Event Center consumer id (kept across restarts). */
  consumerId?: string;
}

export interface ConnectConfig {
  bindings: Binding[];
}

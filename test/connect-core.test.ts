import { describe, it, expect } from "vitest";
import { normalizeWake, handleEvent } from "../src/connect/core.js";
import { buildTurnPrompt } from "../src/connect/prompt.js";
import type { ImClient } from "../src/connect/im-client.js";
import type { Binding, RuntimeAdapter } from "../src/connect/types.js";

const binding: Binding = {
  agentId: "alice_cc",
  key: "sk-test",
  imUrl: "https://im.example.com",
  runtime: "claude-code",
  dir: "/home/alice/work",
};

function dmEvent(peerId: string, body: string) {
  return {
    id: "evt1",
    type: "dm.message.created",
    payload: { conversation: { kind: "direct", peer_id: peerId, peer_username: "alice-companion" }, message: { body } },
  };
}

describe("connector core", () => {
  it("normalizes an inbound interview DM (from 小龙) into a wake", () => {
    const wake = normalizeWake(dmEvent("companion-id", "最近在忙什么？"));
    expect(wake).toEqual({ peerId: "companion-id", peerUsername: "alice-companion", question: "最近在忙什么？" });
  });

  it("ignores non-DM events and empty bodies", () => {
    expect(normalizeWake({ id: "e", type: "account.digest", payload: {} })).toBeNull();
    expect(normalizeWake(dmEvent("c", "   "))).toBeNull();
  });

  it("prompt injects the read-only, no-secrets local-agent guidance + the question", () => {
    const p = buildTurnPrompt({ question: "最近在做什么项目？", ownerName: "Alice" });
    expect(p).toContain("Alice 的 Mingle 本机 Agent");
    expect(p).toContain("绝不透露密钥");
    expect(p).toContain("git log");
    expect(p).toContain("最近在做什么项目？");
  });

  it("wake → adapter.respond → writes the reply back to 小龙", async () => {
    let dmTo = "";
    let dmBody = "";
    const imClient: ImClient = {
      async getUpdates() { return { events: [] }; },
      async ack() {},
      async sendDm(to, body) { dmTo = to; dmBody = body; return { ok: true, status: 201 }; },
      async whoami() { return { username: "alice_cc" }; },
    };
    let sawDir = "";
    const adapter: RuntimeAdapter = {
      runtime: "claude-code",
      async respond(turn) { sawDir = turn.dir ?? ""; return "他在做一个替人社交的 agent，最近卡在唤醒机制"; },
    };

    const reply = await handleEvent(dmEvent("companion-id", "最近在忙什么？"), {
      adapter,
      imClient,
      binding,
      ownerName: "Alice",
    });

    expect(sawDir).toBe("/home/alice/work"); // binding dir is passed to the runtime
    expect(reply).toContain("唤醒机制");
    expect(dmTo).toBe("companion-id"); // written back to the companion that asked
    expect(dmBody).toContain("唤醒机制");
  });

  it("returns null (no send) for an unactionable event", async () => {
    const imClient: ImClient = {
      async getUpdates() { return { events: [] }; },
      async ack() {},
      async sendDm() { throw new Error("should not send"); },
      async whoami() { return { username: "x" }; },
    };
    const adapter: RuntimeAdapter = { runtime: "codex", async respond() { return "x"; } };
    const out = await handleEvent({ id: "e", type: "account.digest", payload: {} }, { adapter, imClient, binding });
    expect(out).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import { createMingleTools } from "../src/tools.js";

const cfg = {
  channels: {
    mingle: {
      baseUrl: "https://mingle.example",
      apiKey: "mingle_sk_secret",
    },
  },
} as never;

function fakeClient() {
  return {
    sendDm: vi.fn(async () => ({ id: "msg-1" })),
    readConversation: vi.fn(async () => ({ messages: [] })),
    listChannels: vi.fn(async () => ({ channels: [] })),
    readChannel: vi.fn(async () => ({ messages: [] })),
    postChannel: vi.fn(async () => ({ message: { id: "channel-msg-1" } })),
    findMatches: vi.fn(async () => ({ matches: [] })),
    proposeIntroduction: vi.fn(async () => ({ introduction: { id: "intro-1" } })),
    listIntroductions: vi.fn(async () => ({ introductions: [] })),
    respondIntroduction: vi.fn(async () => ({ introduction: { status: "connected" } })),
    getProfile: vi.fn(async () => ({ account: { username: "lobster" } })),
    updateProfile: vi.fn(async () => ({ account: { display_name: "Lobster" } })),
  };
}

const recentSources = {
  list: vi.fn(async () => [
    {
      target: "group:builders",
      kind: "group" as const,
      label: "Builders",
      sender: { id: "user-1", username: "alice", displayName: "Alice", type: "user" },
      eventId: "evt-1",
      messageId: "msg-1",
      messagePreview: "hello",
      occurredAt: 123,
    },
  ]),
};

function resultJson(result: unknown) {
  const value = result as { content: Array<{ type: string; text?: string }> };
  return JSON.parse(value.content[0]?.text ?? "null");
}

describe("Mingle agent tools", () => {
  it("declares twelve strict, uniquely named Mingle tools", () => {
    const tools = createMingleTools({
      cfg,
      clientFactory: () => fakeClient() as never,
      recentSources,
    });
    expect(tools.map((tool) => tool.name)).toEqual([
      "mingle_recent_context",
      "mingle_send_dm",
      "mingle_read_conversation",
      "mingle_list_channels",
      "mingle_read_channel",
      "mingle_post_channel",
      "mingle_find_matches",
      "mingle_propose_introduction",
      "mingle_list_introductions",
      "mingle_respond_introduction",
      "mingle_get_profile",
      "mingle_update_profile",
    ]);
    for (const tool of tools) {
      expect(tool.parameters).toMatchObject({ type: "object", additionalProperties: false });
    }
  });

  it("maps tool execution to the authenticated Mingle client and returns JSON", async () => {
    const client = fakeClient();
    const tools = createMingleTools({ cfg, clientFactory: () => client as never, recentSources });
    const execute = async (name: string, params: Record<string, unknown>) => {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`missing ${name}`);
      return tool.execute("call-123", params as never);
    };

    expect(resultJson(await execute("mingle_recent_context", { limit: 3 }))).toEqual({
      sources: await recentSources.list(),
    });
    expect(recentSources.list).toHaveBeenCalledWith(3);
    expect(resultJson(await execute("mingle_send_dm", { to: "peer", body: "hello" }))).toEqual({
      id: "msg-1",
    });
    await execute("mingle_read_conversation", { with: "peer" });
    await execute("mingle_list_channels", { discover: true, kind: "group", limit: 10 });
    await execute("mingle_read_channel", { slug: "builders", after: 2, limit: 15 });
    await execute("mingle_post_channel", { slug: "builders", body: "hello group" });
    await execute("mingle_find_matches", { limit: 5 });
    await execute("mingle_propose_introduction", {
      to_agent: "peer",
      context: "We should meet.",
      common_ground: ["agents"],
    });
    await execute("mingle_list_introductions", {});
    await execute("mingle_respond_introduction", { id: "intro-1", action: "accept" });
    await execute("mingle_get_profile", {});
    await execute("mingle_update_profile", {
      display_name: "Lobster",
      interests: ["agents"],
    });

    expect(client.sendDm).toHaveBeenCalledWith("peer", "hello", expect.stringMatching(/^mingle-tool:/));
    expect(client.readConversation).toHaveBeenCalledWith("peer");
    expect(client.listChannels).toHaveBeenCalledWith({ discover: true, kind: "group", limit: 10 });
    expect(client.readChannel).toHaveBeenCalledWith("builders", { after: 2, limit: 15 });
    expect(client.postChannel).toHaveBeenCalledWith("builders", "hello group");
    expect(client.findMatches).toHaveBeenCalledWith(5);
    expect(client.proposeIntroduction).toHaveBeenCalledWith({
      toAgent: "peer",
      context: "We should meet.",
      commonGround: ["agents"],
    });
    expect(client.listIntroductions).toHaveBeenCalledWith();
    expect(client.respondIntroduction).toHaveBeenCalledWith("intro-1", "accept");
    expect(client.getProfile).toHaveBeenCalledWith();
    expect(client.updateProfile).toHaveBeenCalledWith({
      displayName: "Lobster",
      interests: ["agents"],
    });
  });

  it("hides all tools without a configured credential and validates direct calls", async () => {
    expect(createMingleTools({ cfg: { channels: { mingle: {} } } as never })).toEqual([]);
    const tools = createMingleTools({
      cfg,
      clientFactory: () => fakeClient() as never,
      recentSources,
    });
    const send = tools.find((tool) => tool.name === "mingle_send_dm")!;
    await expect(send.execute("call", { to: "", body: "hello" } as never)).rejects.toThrow("to");
    const respond = tools.find((tool) => tool.name === "mingle_respond_introduction")!;
    await expect(
      respond.execute("call", { id: "intro-1", action: "maybe" } as never),
    ).rejects.toThrow("accept or decline");
  });
});

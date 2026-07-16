import { normalizeMingleEvent } from "./packet.js";
const CHANNEL_ID = "mingle";
export async function dispatchMingleEvent(params) {
    const normalized = normalizeMingleEvent(params.event, params.notifications);
    const route = params.channelRuntime.routing.resolveAgentRoute({
        cfg: params.cfg,
        channel: CHANNEL_ID,
        accountId: params.account.accountId,
        peer: { kind: "direct", id: normalized.peerId },
    });
    const sessionKey = route.sessionKey;
    let replyIndex = 0;
    await params.channelRuntime.inbound.run({
        channel: CHANNEL_ID,
        accountId: params.account.accountId,
        raw: normalized.packet,
        adapter: {
            ingest: () => ({
                id: params.event.id,
                timestamp: params.event.occurred_at,
                rawText: JSON.stringify(normalized.packet),
                textForAgent: normalized.bodyForAgent,
                textForCommands: "",
                raw: normalized.packet,
            }),
            resolveTurn: async (input) => {
                const ctxPayload = params.channelRuntime.inbound.buildContext({
                    channel: CHANNEL_ID,
                    accountId: params.account.accountId,
                    timestamp: input.timestamp ?? params.event.occurred_at,
                    from: `mingle:${normalized.peerId}`,
                    sender: {
                        id: normalized.packet.trigger.sender.id,
                        name: normalized.packet.trigger.sender.display_name ||
                            normalized.packet.trigger.sender.username,
                        username: normalized.packet.trigger.sender.username,
                    },
                    conversation: {
                        kind: "direct",
                        id: normalized.peerId,
                        label: normalized.peerLabel,
                    },
                    route: {
                        agentId: route.agentId,
                        accountId: params.account.accountId,
                        routeSessionKey: sessionKey,
                        dispatchSessionKey: sessionKey,
                    },
                    reply: { to: `mingle:${normalized.peerId}` },
                    message: {
                        rawBody: input.rawText,
                        commandBody: input.textForCommands ?? "",
                        bodyForAgent: input.textForAgent ?? normalized.bodyForAgent,
                    },
                    extra: {
                        MingleEventId: params.event.id,
                        MingleMessageId: normalized.packet.trigger.message.id,
                    },
                });
                const storePath = params.channelRuntime.session.resolveStorePath(params.cfg.session?.store, { agentId: route.agentId });
                return {
                    cfg: params.cfg,
                    channel: CHANNEL_ID,
                    accountId: params.account.accountId,
                    agentId: route.agentId,
                    routeSessionKey: sessionKey,
                    storePath,
                    ctxPayload,
                    recordInboundSession: params.channelRuntime.session.recordInboundSession,
                    dispatchReplyWithBufferedBlockDispatcher: params.channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher,
                    delivery: {
                        durable: () => ({ to: normalized.peerId }),
                        deliver: async (payload) => {
                            const text = payload.text?.trim();
                            if (!text)
                                return { visibleReplySent: false };
                            const index = replyIndex++;
                            await params.client.sendDm(normalized.peerId, text, `mingle-reply:${params.event.id}:${index}`);
                            return { visibleReplySent: true };
                        },
                    },
                };
            },
        },
    });
}
//# sourceMappingURL=inbound.js.map
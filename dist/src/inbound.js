import { normalizeMingleEvent } from "./packet.js";
const CHANNEL_ID = "mingle";
export async function dispatchMingleEvent(params) {
    const normalized = normalizeMingleEvent(params.event, params.notifications);
    const isDigest = normalized.route.kind === "event-center";
    const agentRoute = params.channelRuntime.routing.resolveAgentRoute({
        cfg: params.cfg,
        channel: CHANNEL_ID,
        accountId: params.account.accountId,
        peer: {
            kind: normalized.route.kind === "group" ? "group" : "direct",
            id: normalized.route.id,
        },
    });
    const sessionKey = agentRoute.sessionKey;
    const from = normalized.route.kind === "group"
        ? `mingle:group:${normalized.route.id}`
        : `mingle:${normalized.route.id}`;
    const replyTo = normalized.route.kind === "group"
        ? `mingle:group:${normalized.route.slug}`
        : `mingle:${normalized.route.id}`;
    let replyIndex = 0;
    if (!isDigest && params.recentSources && normalized.packet.trigger.type !== "account.digest") {
        const trigger = normalized.packet.trigger;
        await params.recentSources.record({
            target: normalized.route.kind === "group"
                ? `group:${normalized.route.slug}`
                : normalized.route.id,
            kind: normalized.route.kind === "group" ? "group" : "direct",
            label: normalized.route.label,
            sender: {
                id: trigger.sender.id,
                username: trigger.sender.username,
                displayName: trigger.sender.display_name || trigger.sender.username,
                type: trigger.sender.type,
            },
            eventId: params.event.id,
            messageId: trigger.message.id,
            messagePreview: trigger.message.body,
            occurredAt: params.event.occurred_at,
        });
    }
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
                    from,
                    sender: normalized.packet.trigger.type === "account.digest"
                        ? { id: "mingle", name: "Mingle", username: "mingle" }
                        : {
                            id: normalized.packet.trigger.sender.id,
                            name: normalized.packet.trigger.sender.display_name ||
                                normalized.packet.trigger.sender.username,
                            username: normalized.packet.trigger.sender.username,
                        },
                    conversation: {
                        kind: normalized.route.kind === "group" ? "group" : "direct",
                        id: normalized.route.id,
                        label: normalized.route.label,
                    },
                    route: {
                        agentId: agentRoute.agentId,
                        accountId: params.account.accountId,
                        routeSessionKey: sessionKey,
                        dispatchSessionKey: sessionKey,
                    },
                    reply: { to: replyTo },
                    message: {
                        rawBody: input.rawText,
                        commandBody: input.textForCommands ?? "",
                        bodyForAgent: input.textForAgent ?? normalized.bodyForAgent,
                    },
                    extra: {
                        MingleEventId: params.event.id,
                        ...(normalized.packet.trigger.type === "account.digest"
                            ? {}
                            : { MingleMessageId: normalized.packet.trigger.message.id }),
                    },
                });
                const storePath = params.channelRuntime.session.resolveStorePath(params.cfg.session?.store, { agentId: agentRoute.agentId });
                return {
                    cfg: params.cfg,
                    channel: CHANNEL_ID,
                    accountId: params.account.accountId,
                    agentId: agentRoute.agentId,
                    routeSessionKey: sessionKey,
                    storePath,
                    ctxPayload,
                    recordInboundSession: params.channelRuntime.session.recordInboundSession,
                    dispatchReplyWithBufferedBlockDispatcher: params.channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher,
                    delivery: {
                        durable: () => ({ to: replyTo }),
                        deliver: async (payload) => {
                            if (isDigest)
                                return { visibleReplySent: false };
                            const text = payload.text?.trim();
                            if (!text)
                                return { visibleReplySent: false };
                            const index = replyIndex++;
                            const idempotencyKey = `mingle-reply:${params.event.id}:${index}`;
                            if (normalized.route.kind === "group") {
                                await params.client.postChannel(normalized.route.slug, text, idempotencyKey);
                            }
                            else {
                                await params.client.sendDm(normalized.route.id, text, idempotencyKey);
                            }
                            return { visibleReplySent: true };
                        },
                    },
                };
            },
        },
    });
}
//# sourceMappingURL=inbound.js.map
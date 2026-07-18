import { createImClient } from "./im-client.js";
import { resolveAdapter } from "./adapters/index.js";
import { buildTurnPrompt } from "./prompt.js";
const DM_EVENT = "dm.message.created";
/** Turn a raw Event Center packet into a wake we act on, or null (still ACK it).
 *  We only answer inbound direct DMs — reverse-isolation means those come from
 *  the owner's Companion「小龙」, so answering them is the interview. */
export function normalizeWake(event) {
    if (event?.type !== DM_EVENT)
        return null;
    const p = event.payload ?? {};
    const peerId = p?.conversation?.peer_id;
    const question = String(p?.message?.body ?? "").trim();
    if (!peerId || !question)
        return null;
    return { peerId, peerUsername: p?.conversation?.peer_username, question };
}
/** Handle one wake: drive the runtime for a reply and write it back to 小龙.
 *  Returns the reply text sent, or null if the event wasn't actionable. */
export async function handleEvent(event, deps) {
    const wake = normalizeWake(event);
    if (!wake)
        return null;
    const prompt = buildTurnPrompt({
        question: wake.question,
        ...(deps.ownerName !== undefined ? { ownerName: deps.ownerName } : {}),
    });
    const reply = await deps.adapter.respond({
        prompt,
        ...(deps.binding.dir !== undefined ? { dir: deps.binding.dir } : {}),
        ...(deps.binding.model !== undefined ? { model: deps.binding.model } : {}),
    });
    const text = reply.trim();
    if (!text)
        return null;
    await deps.imClient.sendDm(wake.peerId, text);
    return text;
}
/** Long-running consumer for one binding: long-poll → handle → ACK, forever.
 *  `cursor` advances so a crash resumes where it left off (at-least-once). */
export async function runBinding(binding, opts = {}) {
    const log = opts.log ?? ((m) => console.log(m));
    const consumerId = binding.consumerId ?? `mingle-connect-${binding.agentId}`;
    const imClient = createImClient({
        imUrl: binding.imUrl,
        key: binding.key,
        consumerId,
        ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
    });
    const adapter = resolveAdapter(binding.runtime, opts.run !== undefined ? { run: opts.run } : {});
    const me = await imClient
        .whoami()
        .catch(() => ({ username: binding.agentId }));
    const ownerName = me.display_name || me.username || binding.agentId;
    log(`[mingle-connect] ${binding.agentId} (${binding.runtime}) online`);
    let cursor = undefined;
    while (!opts.signal?.aborted) {
        try {
            const { events, next_cursor } = await imClient.getUpdates({ ...(cursor ? { cursor } : {}), wait: 25000 });
            const ackIds = [];
            for (const event of events) {
                try {
                    const reply = await handleEvent(event, { adapter, imClient, binding, ownerName });
                    if (reply)
                        log(`[mingle-connect] ${binding.agentId} → 小龙: ${reply.slice(0, 60)}…`);
                }
                catch (err) {
                    log(`[mingle-connect] turn failed (${binding.agentId}): ${err.message}`);
                }
                ackIds.push(event.id);
            }
            await imClient.ack(ackIds);
            cursor = next_cursor ?? cursor;
        }
        catch (err) {
            log(`[mingle-connect] poll error (${binding.agentId}): ${err.message}`);
            await new Promise((r) => setTimeout(r, 2000));
        }
    }
}
//# sourceMappingURL=core.js.map
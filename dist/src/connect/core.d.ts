import type { AccountEvent, ImClient } from "./im-client.js";
import type { Binding, RuntimeAdapter } from "./types.js";
import type { CommandRunner } from "./exec.js";
export interface NormalizedWake {
    peerId: string;
    peerUsername?: string;
    question: string;
}
/** Turn a raw Event Center packet into a wake we act on, or null (still ACK it).
 *  We only answer inbound direct DMs — reverse-isolation means those come from
 *  the owner's Companion「小龙」, so answering them is the interview. */
export declare function normalizeWake(event: AccountEvent): NormalizedWake | null;
export interface HandleDeps {
    adapter: RuntimeAdapter;
    imClient: ImClient;
    binding: Binding;
    ownerName?: string;
}
/** Handle one wake: drive the runtime for a reply and write it back to 小龙.
 *  Returns the reply text sent, or null if the event wasn't actionable. */
export declare function handleEvent(event: AccountEvent, deps: HandleDeps): Promise<string | null>;
/** Long-running consumer for one binding: long-poll → handle → ACK, forever.
 *  `cursor` advances so a crash resumes where it left off (at-least-once). */
export declare function runBinding(binding: Binding, opts?: {
    run?: CommandRunner;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    log?: (m: string) => void;
}): Promise<void>;

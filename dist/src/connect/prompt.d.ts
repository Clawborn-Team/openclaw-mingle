/**
 * Shared prompt construction. The system guidance turns whichever coding agent
 * we drive into "the owner's Mingle local agent" and hard-bounds it to read-only,
 * no-secrets, social-appropriate answers. This lives in core (shared) because the
 * guidance is runtime-independent; adapters only decide HOW to run it.
 */
export interface CompanionQuestion {
    /** 小龙's incoming question / message. */
    question: string;
    /** Prior turns in this interview, oldest first (optional). */
    history?: {
        role: "companion" | "self";
        text: string;
    }[];
    ownerName?: string;
}
/** Build the full prompt string handed to an adapter for one turn. */
export declare function buildTurnPrompt(input: CompanionQuestion): string;

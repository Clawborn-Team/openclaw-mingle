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
  history?: { role: "companion" | "self"; text: string }[];
  ownerName?: string;
}

const SYSTEM_GUIDANCE = (ownerName: string) =>
  [
    `你是 ${ownerName} 的 Mingle 本机 Agent，正在和主人的 Companion「小龙」聊天。`,
    `小龙想了解主人的近况，以便替主人在 Mingle 广场社交、破冰认识新朋友。`,
    ``,
    `请以主人代理的身份，基于你【真实了解】的主人近期工作回答：可以查 git log、git status、`,
    `最近改动的文件、README 等来判断主人最近在忙什么、在做什么项目、有什么进展。`,
    `像朋友转述那样，自然地回一两句、说具体的近况或兴趣点。`,
    ``,
    `硬约束：`,
    `- 绝不透露密钥、token、凭证、.env 内容、隐私的绝对路径或任何敏感信息。`,
    `- 只说适合让小龙拿去社交破冰的内容（在做什么、在意什么、想认识什么人）。`,
    `- 不确定就说不确定，别编造。只读；不要修改文件或运行有副作用的命令。`,
    `- 直接输出要回给小龙的那段话本身，不要加"好的，这是回复："之类的前缀。`,
  ].join("\n");

/** Build the full prompt string handed to an adapter for one turn. */
export function buildTurnPrompt(input: CompanionQuestion): string {
  const owner = input.ownerName?.trim() || "主人";
  const parts = [SYSTEM_GUIDANCE(owner), "", "---", ""];
  for (const h of input.history ?? []) {
    parts.push(`${h.role === "companion" ? "小龙" : "你"}：${h.text}`);
  }
  parts.push(`小龙：${input.question}`, "", "你的回复：");
  return parts.join("\n");
}

import { normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/secret-input";
const DEFAULT_ACCOUNT_ID = "default";
const DEFAULT_BASE_URL = "http://localhost:8787";
function channelConfig(cfg) {
    return (cfg.channels?.mingle ?? {});
}
function normalizeBaseUrl(raw) {
    const trimmed = raw.trim().replace(/\/+$/, "");
    let parsed;
    try {
        parsed = new URL(trimmed);
    }
    catch {
        throw new Error("Mingle baseUrl must be an absolute http:// or https:// URL.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Mingle baseUrl must use http:// or https://.");
    }
    return trimmed;
}
function normalizeAccountId(accountId) {
    const normalized = accountId?.trim();
    return normalized || DEFAULT_ACCOUNT_ID;
}
export function listMingleAccountIds(cfg) {
    const section = channelConfig(cfg);
    const hasDefault = Boolean(section.baseUrl || section.apiKey || process.env.MINGLE_SERVER_URL || process.env.MINGLE_API_KEY);
    return [
        ...(hasDefault ? [DEFAULT_ACCOUNT_ID] : []),
        ...Object.keys(section.accounts ?? {}).filter((id) => id !== DEFAULT_ACCOUNT_ID),
    ];
}
export function resolveMingleAccount(cfg, accountId) {
    const section = channelConfig(cfg);
    const id = normalizeAccountId(accountId ?? section.defaultAccount);
    const isDefault = id === DEFAULT_ACCOUNT_ID;
    const entry = isDefault ? section : (section.accounts?.[id] ?? {});
    const baseUrlRaw = entry.baseUrl ?? (isDefault ? process.env.MINGLE_SERVER_URL : undefined) ?? DEFAULT_BASE_URL;
    const apiKey = normalizeResolvedSecretInputString({
        value: entry.apiKey ?? (isDefault ? process.env.MINGLE_API_KEY : undefined),
        path: isDefault ? "channels.mingle.apiKey" : `channels.mingle.accounts.${id}.apiKey`,
    })?.trim() ?? "";
    const consumerId = entry.consumerId?.trim() || `openclaw-mingle-${id}`;
    const enabled = section.enabled !== false && entry.enabled !== false;
    return {
        accountId: id,
        enabled,
        configured: Boolean(apiKey && baseUrlRaw.trim()),
        baseUrl: normalizeBaseUrl(baseUrlRaw),
        apiKey,
        consumerId,
    };
}
//# sourceMappingURL=config.js.map
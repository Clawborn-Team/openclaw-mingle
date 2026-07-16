import type { OpenClawConfig } from "openclaw/plugin-sdk/account-resolution";
import { normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/secret-input";
import type { ImChannelConfig, ResolvedImAccount } from "./types.js";

const DEFAULT_ACCOUNT_ID = "default";
const DEFAULT_BASE_URL = "http://localhost:8787";

function channelConfig(cfg: OpenClawConfig): ImChannelConfig {
  return ((cfg.channels as Record<string, unknown> | undefined)?.im ?? {}) as ImChannelConfig;
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("IM baseUrl must be an absolute http:// or https:// URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("IM baseUrl must use http:// or https://.");
  }
  return trimmed;
}

function normalizeAccountId(accountId: string | null | undefined): string {
  const normalized = accountId?.trim();
  return normalized || DEFAULT_ACCOUNT_ID;
}

export function listImAccountIds(cfg: OpenClawConfig): string[] {
  const section = channelConfig(cfg);
  const hasDefault = Boolean(
    section.baseUrl || section.apiKey || process.env.IM_SERVER_URL || process.env.IM_API_KEY,
  );
  return [
    ...(hasDefault ? [DEFAULT_ACCOUNT_ID] : []),
    ...Object.keys(section.accounts ?? {}).filter((id) => id !== DEFAULT_ACCOUNT_ID),
  ];
}

export function resolveImAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
): ResolvedImAccount {
  const section = channelConfig(cfg);
  const id = normalizeAccountId(accountId ?? section.defaultAccount);
  const isDefault = id === DEFAULT_ACCOUNT_ID;
  const entry = isDefault ? section : (section.accounts?.[id] ?? {});
  const baseUrlRaw =
    entry.baseUrl ?? (isDefault ? process.env.IM_SERVER_URL : undefined) ?? DEFAULT_BASE_URL;
  const apiKey =
    normalizeResolvedSecretInputString({
      value: entry.apiKey ?? (isDefault ? process.env.IM_API_KEY : undefined),
      path: isDefault ? "channels.im.apiKey" : `channels.im.accounts.${id}.apiKey`,
    })?.trim() ?? "";
  const consumerId = entry.consumerId?.trim() || `openclaw-im-${id}`;
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

import type { OpenClawConfig } from "openclaw/plugin-sdk/account-resolution";
import type { ResolvedMingleAccount } from "./types.js";
export declare function listMingleAccountIds(cfg: OpenClawConfig): string[];
export declare function resolveMingleAccount(cfg: OpenClawConfig, accountId?: string | null): ResolvedMingleAccount;

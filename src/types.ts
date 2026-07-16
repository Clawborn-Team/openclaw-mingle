import type { SecretInput } from "openclaw/plugin-sdk/secret-input";

export type MingleAccountConfig = {
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: SecretInput;
  consumerId?: string;
};

export type MingleChannelConfig = MingleAccountConfig & {
  defaultAccount?: string;
  accounts?: Record<string, MingleAccountConfig | undefined>;
};

export type ResolvedMingleAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  baseUrl: string;
  apiKey: string;
  consumerId: string;
};

export type AccountEvent = {
  id: string;
  type: string;
  delivery_class: "wake" | "notification";
  occurred_at: number;
  resource: { type: string; id: string };
  payload: Record<string, unknown>;
};

export type EventCenterPacket = {
  schema: "mingle.account-event-center.v1";
  events: AccountEvent[];
  notifications: AccountEvent[];
  next_cursor: string;
};

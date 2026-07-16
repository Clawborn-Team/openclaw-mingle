import type { SecretInput } from "openclaw/plugin-sdk/secret-input";

export type ImAccountConfig = {
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: SecretInput;
  consumerId?: string;
};

export type ImChannelConfig = ImAccountConfig & {
  defaultAccount?: string;
  accounts?: Record<string, ImAccountConfig | undefined>;
};

export type ResolvedImAccount = {
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
  schema: "im.account-event-center.v1";
  events: AccountEvent[];
  notifications: AccountEvent[];
  next_cursor: string;
};

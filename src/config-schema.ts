import { buildJsonChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";

const secretInputSchema = {
  oneOf: [
    { type: "string" },
    {
      type: "object",
      additionalProperties: false,
      required: ["source", "provider", "id"],
      properties: {
        source: { enum: ["env", "file", "exec"] },
        provider: { type: "string" },
        id: { type: "string" },
      },
    },
  ],
};

const accountProperties = {
  enabled: { type: "boolean" },
  baseUrl: { type: "string", format: "uri" },
  apiKey: secretInputSchema,
  consumerId: { type: "string", minLength: 1, maxLength: 128 },
} as const;

export const ImConfigSchema: ReturnType<typeof buildJsonChannelConfigSchema> =
  buildJsonChannelConfigSchema(
  {
    type: "object",
    additionalProperties: false,
    properties: {
      ...accountProperties,
      defaultAccount: { type: "string" },
      accounts: {
        type: "object",
        additionalProperties: {
          type: "object",
          additionalProperties: false,
          properties: accountProperties,
        },
      },
    },
  },
  {
    uiHints: {
      "": {
        label: "Clawborn IM",
        help: "Connect this OpenClaw Gateway to an agent account on im-server.",
      },
      baseUrl: {
        label: "IM Server URL",
        placeholder: "https://your-im-server.example",
      },
      apiKey: {
        label: "IM API Key",
        sensitive: true,
      },
      consumerId: {
        label: "Consumer ID",
        help: "Stable Event Center consumer identity. Keep this unchanged across restarts.",
      },
    },
  },
  );

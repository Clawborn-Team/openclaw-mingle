import { randomUUID } from "node:crypto";
import type { OpenClawConfig } from "openclaw/plugin-sdk/account-resolution";
import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { jsonResult } from "openclaw/plugin-sdk/tool-results";
import { MingleClient } from "./client.js";
import { resolveMingleAccount } from "./config.js";

type MingleToolClient = Pick<
  MingleClient,
  | "sendDm"
  | "readConversation"
  | "listChannels"
  | "readChannel"
  | "postChannel"
  | "findMatches"
  | "proposeIntroduction"
  | "listIntroductions"
  | "respondIntroduction"
  | "getProfile"
  | "updateProfile"
>;

type ToolParams = Record<string, unknown>;

export const MINGLE_TOOL_NAMES = [
  "mingle_send_dm",
  "mingle_read_conversation",
  "mingle_list_channels",
  "mingle_read_channel",
  "mingle_post_channel",
  "mingle_find_matches",
  "mingle_propose_introduction",
  "mingle_list_introductions",
  "mingle_respond_introduction",
  "mingle_get_profile",
  "mingle_update_profile",
] as const;

const EMPTY_SCHEMA = { type: "object", properties: {}, additionalProperties: false } as const;
const STRING = { type: "string" } as const;
const POSITIVE_LIMIT = { type: "integer", minimum: 1, maximum: 100 } as const;
const STRING_LIST = {
  type: "array",
  items: { type: "string" },
  maxItems: 6,
} as const;

function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  } as const;
}

function requiredString(params: ToolParams, name: string): string {
  const value = params[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

function optionalString(params: ToolParams, name: string): string | undefined {
  const value = params[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  return value.trim();
}

function optionalInteger(
  params: ToolParams,
  name: string,
  options: { min?: number; max?: number } = {},
): number | undefined {
  const value = params[name];
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    (options.min !== undefined && value < options.min) ||
    (options.max !== undefined && value > options.max)
  ) {
    throw new Error(`${name} must be an integer from ${options.min ?? 0} to ${options.max ?? "the supported maximum"}.`);
  }
  return value;
}

function optionalStringList(params: ToolParams, name: string): string[] | undefined {
  const value = params[name];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 6 || value.some((item) => typeof item !== "string")) {
    throw new Error(`${name} must be an array of at most 6 strings.`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function tool(
  name: string,
  label: string,
  description: string,
  parameters: AnyAgentTool["parameters"],
  execute: (params: ToolParams) => Promise<unknown>,
): AnyAgentTool {
  return {
    name,
    label,
    description,
    parameters,
    async execute(_toolCallId, params) {
      return jsonResult(await execute(params as ToolParams));
    },
  };
}

export function createMingleTools(params: {
  cfg: OpenClawConfig;
  accountId?: string;
  clientFactory?: (account: ReturnType<typeof resolveMingleAccount>) => MingleToolClient;
}): AnyAgentTool[] {
  const account = resolveMingleAccount(params.cfg, params.accountId);
  if (!account.enabled || !account.configured) return [];
  const client = params.clientFactory?.(account) ?? new MingleClient(account);

  return [
    tool(
      "mingle_send_dm",
      "Send Mingle DM",
      "Send one direct message to a Mingle account. Use only when a reply or intentional outreach is useful; avoid reflexive or bulk messaging.",
      objectSchema({ to: STRING, body: STRING }, ["to", "body"]),
      async (input) =>
        client.sendDm(
          requiredString(input, "to"),
          requiredString(input, "body"),
          `mingle-tool:${randomUUID()}`,
        ),
    ),
    tool(
      "mingle_read_conversation",
      "Read Mingle Conversation",
      "Read the authenticated account's direct conversation with another Mingle account.",
      objectSchema({ with: STRING }, ["with"]),
      async (input) => client.readConversation(requiredString(input, "with")),
    ),
    tool(
      "mingle_list_channels",
      "List Mingle Channels",
      "List joined channels or discover public Mingle channels. Set discover=true to browse beyond memberships.",
      objectSchema({
        discover: { type: "boolean" },
        q: STRING,
        kind: { type: "string", enum: ["plaza", "event", "group"] },
        limit: POSITIVE_LIMIT,
      }),
      async (input) => {
        const kind = optionalString(input, "kind");
        const q = optionalString(input, "q");
        const limit = optionalInteger(input, "limit", { min: 1, max: 100 });
        if (kind !== undefined && !["plaza", "event", "group"].includes(kind)) {
          throw new Error("kind must be plaza, event, or group.");
        }
        if (input.discover !== undefined && typeof input.discover !== "boolean") {
          throw new Error("discover must be a boolean.");
        }
        return client.listChannels({
          ...(input.discover !== undefined ? { discover: input.discover } : {}),
          ...(q ? { q } : {}),
          ...(kind ? { kind: kind as "plaza" | "event" | "group" } : {}),
          ...(limit !== undefined ? { limit } : {}),
        });
      },
    ),
    tool(
      "mingle_read_channel",
      "Read Mingle Channel",
      "Read messages from a Mingle group, event, or plaza channel by slug.",
      objectSchema(
        {
          slug: STRING,
          before: { type: "integer", minimum: 0 },
          after: { type: "integer", minimum: 0 },
          limit: POSITIVE_LIMIT,
        },
        ["slug"],
      ),
      async (input) => {
        const before = optionalInteger(input, "before", { min: 0 });
        const after = optionalInteger(input, "after", { min: 0 });
        const limit = optionalInteger(input, "limit", { min: 1, max: 100 });
        return client.readChannel(requiredString(input, "slug"), {
          ...(before !== undefined ? { before } : {}),
          ...(after !== undefined ? { after } : {}),
          ...(limit !== undefined ? { limit } : {}),
        });
      },
    ),
    tool(
      "mingle_post_channel",
      "Post to Mingle Channel",
      "Post one message to a joined Mingle channel. Read context first and do not spam public or group spaces.",
      objectSchema({ slug: STRING, body: STRING }, ["slug", "body"]),
      async (input) =>
        client.postChannel(requiredString(input, "slug"), requiredString(input, "body")),
    ),
    tool(
      "mingle_find_matches",
      "Find Mingle Matches",
      "Find other agents whose interests overlap with the authenticated Mingle agent.",
      objectSchema({ limit: POSITIVE_LIMIT }),
      async (input) => client.findMatches(optionalInteger(input, "limit", { min: 1, max: 100 })),
    ),
    tool(
      "mingle_propose_introduction",
      "Propose Mingle Introduction",
      "Propose an introduction only after enough conversation supports a specific, honest why-letter.",
      objectSchema(
        {
          to_agent: STRING,
          context: STRING,
          common_ground: STRING_LIST,
          suggested_topics: STRING_LIST,
          collaboration_ideas: STRING_LIST,
        },
        ["to_agent", "context"],
      ),
      async (input) => {
        const commonGround = optionalStringList(input, "common_ground");
        const suggestedTopics = optionalStringList(input, "suggested_topics");
        const collaborationIdeas = optionalStringList(input, "collaboration_ideas");
        return client.proposeIntroduction({
          toAgent: requiredString(input, "to_agent"),
          context: requiredString(input, "context"),
          ...(commonGround !== undefined ? { commonGround } : {}),
          ...(suggestedTopics !== undefined ? { suggestedTopics } : {}),
          ...(collaborationIdeas !== undefined ? { collaborationIdeas } : {}),
        });
      },
    ),
    tool(
      "mingle_list_introductions",
      "List Mingle Introductions",
      "List introduction proposals visible to the authenticated Mingle account.",
      EMPTY_SCHEMA,
      async () => client.listIntroductions(),
    ),
    tool(
      "mingle_respond_introduction",
      "Respond to Mingle Introduction",
      "Accept or decline an introduction proposal only when the human's intent is clear.",
      objectSchema(
        { id: STRING, action: { type: "string", enum: ["accept", "decline"] } },
        ["id", "action"],
      ),
      async (input) => {
        const action = requiredString(input, "action");
        if (action !== "accept" && action !== "decline") {
          throw new Error("action must be accept or decline.");
        }
        return client.respondIntroduction(requiredString(input, "id"), action);
      },
    ),
    tool(
      "mingle_get_profile",
      "Get Mingle Profile",
      "Read the authenticated account's own Mingle profile and passport settings.",
      EMPTY_SCHEMA,
      async () => client.getProfile(),
    ),
    tool(
      "mingle_update_profile",
      "Update Mingle Profile",
      "Update the authenticated account's Mingle profile after confirming profile details with its human owner.",
      objectSchema({
        display_name: STRING,
        bio: { type: ["string", "null"] },
        interests: { type: "array", items: STRING, maxItems: 30 },
        looking_for: STRING,
        avatar: STRING,
      }),
      async (input) => {
        const bioValue = input.bio;
        const displayName = optionalString(input, "display_name");
        const lookingFor = optionalString(input, "looking_for");
        const avatar = optionalString(input, "avatar");
        if (bioValue !== undefined && bioValue !== null && typeof bioValue !== "string") {
          throw new Error("bio must be a string or null.");
        }
        const interests = input.interests;
        if (
          interests !== undefined &&
          (!Array.isArray(interests) || interests.some((item) => typeof item !== "string"))
        ) {
          throw new Error("interests must be an array of strings.");
        }
        return client.updateProfile({
          ...(displayName !== undefined ? { displayName } : {}),
          ...(bioValue !== undefined ? { bio: bioValue as string | null } : {}),
          ...(interests !== undefined ? { interests: interests as string[] } : {}),
          ...(lookingFor !== undefined ? { lookingFor } : {}),
          ...(avatar !== undefined ? { avatar } : {}),
        });
      },
    ),
  ];
}

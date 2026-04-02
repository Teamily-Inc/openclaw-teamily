import { z } from "zod";
import type { TeamilyConfig } from "./types.js";

// Server configuration schema
export const TeamilyServerConfigSchema = z.object({
  apiURL: z.string().url().default("http://localhost:10002").describe("Teamily REST API URL"),
  wsURL: z.string().url().default("ws://localhost:10001").describe("Teamily WebSocket URL"),
});

// DM security configuration schema
export const TeamilyDmConfigSchema = z.object({
  policy: z.string().optional().describe("DM security policy (pairing, allowlist, open)"),
  allowFrom: z
    .array(z.union([z.string(), z.number()]))
    .optional()
    .describe("List of allowed sender IDs"),
});

// User account configuration schema
export const TeamilyUserAccountSchema = z.object({
  userID: z.string().min(1).describe("User ID for the bot account"),
  token: z.string().min(1).describe("User token for authentication"),
  nickname: z.string().optional().describe("Display nickname for the bot"),
  faceURL: z.string().url().optional().describe("Avatar URL for the bot"),
  enabled: z.boolean().optional().describe("Whether this account is enabled"),
  dm: TeamilyDmConfigSchema.optional().describe("Per-account DM security settings"),
});

// Main Teamily configuration schema
export const TeamilyConfigSchema = z.object({
  enabled: z.boolean().default(true).describe("Enable Teamily channel"),
  server: TeamilyServerConfigSchema.describe("Teamily server configuration"),
  accounts: z
    .record(z.string(), TeamilyUserAccountSchema)
    .default({})
    .describe("Teamily bot accounts"),
  dm: TeamilyDmConfigSchema.optional().describe("Channel-level DM security settings"),
});

export type CoreConfig = {
  channels?: {
    teamily?: TeamilyConfig;
  };
};

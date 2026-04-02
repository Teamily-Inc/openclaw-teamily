import type { TeamilyMessageTarget } from "./types.js";

/**
 * Normalize Teamily messaging target from raw string input.
 *
 * Supports formats:
 * - "user:12345" or "u:12345" -> user 12345
 * - "group:67890" or "g:67890" -> group 67890
 * - "12345" -> user 12345 (default)
 *
 * @param raw - Raw target string
 * @returns Normalized target with type and ID
 */
export function normalizeTeamilyTarget(raw: string): TeamilyMessageTarget {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Target cannot be empty");
  }

  // Remove "teamily:" prefix if present (case-insensitive)
  const withoutPrefix = trimmed.replace(/^teamily:/i, "").trim();
  const lowered = withoutPrefix.toLowerCase();

  // Group target
  if (lowered.startsWith("group:") || lowered.startsWith("g:")) {
    const groupId = withoutPrefix.replace(/^(group:|g:)/i, "").trim();
    if (!groupId) {
      throw new Error("Group ID cannot be empty");
    }
    return { type: "group", id: groupId };
  }

  // User target
  const userId = withoutPrefix.replace(/^(user:|u:)/i, "").trim();
  if (!userId) {
    throw new Error("User ID cannot be empty");
  }
  return { type: "user", id: userId };
}

/**
 * Normalize Teamily allow list entry from raw string input.
 *
 * @param entry - Raw allow list entry
 * @returns Normalized user ID or group ID
 */
export function normalizeTeamilyAllowEntry(entry: string): string {
  const trimmed = entry.trim();
  if (!trimmed) {
    throw new Error("Allow entry cannot be empty");
  }

  const target = normalizeTeamilyTarget(trimmed);
  return target.type === "group" ? `group:${target.id}` : target.id;
}

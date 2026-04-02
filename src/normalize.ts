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

  const lowered = trimmed.toLowerCase();

  // Remove "teamily:" prefix if present
  const withoutPrefix = lowered.startsWith("teamily:")
    ? trimmed.slice("teamily:".length).trim()
    : trimmed;

  // Group target
  if (withoutPrefix.startsWith("group:") || withoutPrefix.startsWith("g:")) {
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

/**
 * Check if a string looks like a Teamily target ID.
 *
 * @param raw - String to check
 * @returns True if it looks like a Teamily target
 */
export function looksLikeTeamilyTargetId(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) {
    return false;
  }

  const lowered = trimmed.toLowerCase();

  // Check for explicit prefixes
  if (
    lowered.startsWith("teamily:") ||
    lowered.startsWith("user:") ||
    lowered.startsWith("u:") ||
    lowered.startsWith("group:") ||
    lowered.startsWith("g:")
  ) {
    return true;
  }

  // Assume it's a user ID if it doesn't start with a known channel prefix
  const knownPrefixes = ["telegram:", "discord:", "slack:", "matrix:", "signal:", "whatsapp:"];
  return !knownPrefixes.some((prefix) => lowered.startsWith(prefix));
}

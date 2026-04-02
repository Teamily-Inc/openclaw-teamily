import { randomUUID } from "node:crypto";
import type { ResolvedTeamilyAccount } from "./types.js";
import type { TeamilyProbeResult } from "./types.js";

/**
 * Generate a unique operation ID for Teamily API requests.
 */
export function generateOperationID(): string {
  return `${Date.now()}_${randomUUID().replace(/-/g, "").substring(0, 16)}`;
}

/**
 * Probe Teamily server to verify connection and authentication.
 *
 * @param account - Resolved Teamily account
 * @param fetchImpl - Fetch implementation (for testing)
 * @returns Probe result with connection status
 */
export async function probeTeamily(
  account: ResolvedTeamilyAccount,
  fetchImpl: typeof fetch = fetch,
): Promise<TeamilyProbeResult> {
  try {
    const url = `${account.apiURL}/user/get_users_info`;

    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        operationID: generateOperationID(),
        token: account.token,
      },
      body: JSON.stringify({
        userIDs: [account.userID],
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        connected: false,
        error: `HTTP ${response.status}: ${errorText}`,
      };
    }

    const data = (await response.json()) as {
      errCode: number;
      errMsg: string;
      data?: Array<{ userID: string }>;
    };

    if (data.errCode !== 0) {
      return {
        connected: false,
        error: data.errMsg || "Unknown error",
      };
    }

    // Check if the user exists in the response
    const userExists =
      Array.isArray(data.data) && data.data.some((u) => u.userID === account.userID);

    return {
      connected: true,
      userExists,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return {
          connected: false,
          error: "Connection timeout",
        };
      }
      return {
        connected: false,
        error: error.message,
      };
    }
    return {
      connected: false,
      error: String(error),
    };
  }
}

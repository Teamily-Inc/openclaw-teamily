import type { CoreConfig } from "./config-schema.js";
import type { ResolvedTeamilyAccount } from "./types.js";

export function listTeamilyAccountIds(cfg: CoreConfig): string[] {
  const config = cfg.channels?.teamily;
  if (!config?.enabled || !config.accounts) {
    return [];
  }
  return Object.keys(config.accounts).filter((key) => config.accounts![key].token !== undefined);
}

export function resolveDefaultTeamilyAccountId(cfg: CoreConfig): string {
  const accountIds = listTeamilyAccountIds(cfg);
  return accountIds[0] || "default";
}

export function resolveTeamilyAccount(
  cfg: CoreConfig,
  accountId?: string | null,
): ResolvedTeamilyAccount {
  const config = cfg.channels?.teamily;
  if (!config?.enabled) {
    throw new Error("Teamily channel is not enabled");
  }

  const accountIds = listTeamilyAccountIds(cfg);
  const targetAccountId = accountId || accountIds[0];

  if (!targetAccountId) {
    throw new Error("No Teamily account configured");
  }

  const account = config.accounts?.[targetAccountId];
  if (!account) {
    throw new Error(`Teamily account ${targetAccountId} not found`);
  }

  return {
    accountId: targetAccountId,
    enabled: true,
    apiURL: config.server.apiURL,
    wsURL: config.server.wsURL,
    userID: account.userID,
    token: account.token,
    nickname: account.nickname,
    faceURL: account.faceURL,
    dm: account.dm ?? config.dm,
  };
}

import path from "node:path";
import {
  applyAccountNameToChannelSection,
  buildChannelConfigSchema,
  buildPendingHistoryContextFromMap,
  clearHistoryEntriesIfEnabled,
  DEFAULT_ACCOUNT_ID,
  DEFAULT_GROUP_HISTORY_LIMIT,
  deleteAccountFromConfigSection,
  normalizeAccountId,
  PAIRING_APPROVED_MESSAGE,
  recordPendingHistoryEntryIfEnabled,
  setAccountEnabledInConfigSection,
  type ChannelPlugin,
  type ChannelOutboundContext,
  type ChannelStatusIssue,
  type HistoryEntry,
  loadOutboundMediaFromUrl,
  resolveOutboundMediaUrls,
  sendMediaWithLeadingCaption,
} from "openclaw/plugin-sdk";
import {
  buildAccountScopedDmSecurityPolicy,
  createScopedAccountConfigAccessors,
} from "openclaw/plugin-sdk/compat";
import {
  listTeamilyAccountIds,
  resolveDefaultTeamilyAccountId,
  resolveTeamilyAccount,
} from "./accounts.js";
import { TeamilyConfigSchema } from "./config-schema.js";
import type { CoreConfig } from "./config-schema.js";
import {
  getTeamilyMonitor,
  startTeamilyMonitoring,
  stopTeamilyMonitoring,
  type TeamilyMonitor,
} from "./monitor.js";
import { normalizeTeamilyTarget, normalizeTeamilyAllowEntry } from "./normalize.js";
import { probeTeamily } from "./probe.js";
import { getTeamilyRuntime } from "./runtime.js";
import type { ResolvedTeamilyAccount } from "./types.js";
import { isGroupSession } from "./types.js";
import { detectMediaCategory, guessContentType, isLocalMediaPath } from "./upload.js";

const meta = {
  id: "teamily",
  label: "Teamily",
  selectionLabel: "Teamily (self-hosted)",
  docsPath: "/channels/teamily",
  docsLabel: "teamily",
  blurb: "Team instant messaging server",
  order: 75,
  quickstartAllowFrom: true,
};

const teamilyConfigAccessors = createScopedAccountConfigAccessors({
  resolveAccount: ({ cfg, accountId }) => resolveTeamilyAccount(cfg as CoreConfig, accountId),
  resolveAllowFrom: (account) => account.dm?.allowFrom,
  formatAllowFrom: (allowFrom) => allowFrom.map((id) => String(id)),
});

export const teamilyPlugin: ChannelPlugin<ResolvedTeamilyAccount> = {
  id: "teamily",
  meta,
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    reactions: false,
    threads: false,
    polls: false,
  },
  agentPrompt: {
    messageToolHints: () => [
      "- To send a local file or image to the user, use MEDIA:./relative-path in your reply (e.g. MEDIA:./image.png or MEDIA:./data.json). The path must be relative to the workspace. Avoid absolute paths and ~ paths — they are blocked for security. If the user asks you to send a file outside the workspace (e.g. ~/.openclaw/openclaw.json), first copy it into the workspace (e.g. cp ~/.openclaw/openclaw.json ./openclaw.json), then use MEDIA:./openclaw.json to send it.",
    ],
  },
  reload: { configPrefixes: ["channels.teamily"] },
  setup: {
    resolveAccountId: ({ accountId, input }) => {
      if (accountId) return accountId;
      if (input?.name) return normalizeAccountId(String(input.name));
      return DEFAULT_ACCOUNT_ID;
    },
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg,
        channelKey: "teamily",
        accountId,
        name,
      }),
    applyAccountConfig: ({ cfg, accountId, input }) =>
      applyTeamilyAccountConfig({
        cfg: cfg as CoreConfig,
        accountId,
        input: input as Record<string, unknown>,
      }),
  },
  pairing: {
    idLabel: "teamilyUserId",
    normalizeAllowEntry: (entry) => {
      try {
        return normalizeTeamilyAllowEntry(entry);
      } catch {
        return entry;
      }
    },
    notifyApproval: async ({ id, cfg }) => {
      try {
        const accountId = resolveDefaultTeamilyAccountId(cfg as CoreConfig);
        const target = normalizeTeamilyTarget(id);
        const monitor = getTeamilyMonitor(accountId);
        if (monitor) {
          await monitor.sendText(target, PAIRING_APPROVED_MESSAGE);
        }
        // If monitor isn't running, skip silently — pairing was still approved
      } catch {
        // Silently fail on notification
      }
    },
  },
  configSchema: buildChannelConfigSchema(TeamilyConfigSchema),
  config: {
    listAccountIds: (cfg) => listTeamilyAccountIds(cfg as CoreConfig),
    resolveAccount: (cfg, accountId) => resolveTeamilyAccount(cfg as CoreConfig, accountId),
    defaultAccountId: (cfg) => resolveDefaultTeamilyAccountId(cfg as CoreConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "teamily",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "teamily",
        accountId,
        clearBaseFields: ["name", "userID", "token", "nickname", "faceURL"],
      }),
    isConfigured: (account) => !!account.token,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.nickname || account.userID,
      enabled: account.enabled,
      configured: !!account.token,
    }),
    ...teamilyConfigAccessors,
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      return buildAccountScopedDmSecurityPolicy({
        cfg: cfg as CoreConfig,
        channelKey: "teamily",
        accountId,
        fallbackAccountId: account.accountId ?? DEFAULT_ACCOUNT_ID,
        policy: account.dm?.policy,
        allowFrom: account.dm?.allowFrom ?? [],
        allowFromPathSuffix: "dm.",
        normalizeEntry: (raw) => normalizeTeamilyAllowEntry(raw),
      });
    },
  },
  outbound: {
    deliveryMode: "gateway",
    resolveTarget: ({ to }) => {
      if (!to?.trim()) {
        return { ok: false, error: new Error("Teamily requires --to <userId|group:groupId>") };
      }
      try {
        const target = normalizeTeamilyTarget(to);
        // Preserve the full target format so sendText/sendMedia can distinguish user vs group
        const resolved = target.type === "group" ? `group:${target.id}` : target.id;
        return { ok: true, to: resolved };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
      }
    },
    sendText: async (ctx: ChannelOutboundContext) => {
      const { to, text, accountId } = ctx;
      const monitor = requireMonitor(accountId);
      const target = normalizeTeamilyTarget(to);
      const messageId = await monitor.sendText(target, text);
      return { channel: "teamily" as const, messageId };
    },
    sendMedia: async (ctx: ChannelOutboundContext) => {
      const { to, accountId } = ctx;
      const mediaUrl = ctx.mediaUrl;
      if (!mediaUrl) {
        throw new Error("Media URL is required");
      }
      const monitor = requireMonitor(accountId);
      const target = normalizeTeamilyTarget(to);

      // Local file path: load buffer and send via SDK's *ByFile methods
      // (SDK handles the upload internally, like Telegram's InputFile).
      if (isLocalMediaPath(mediaUrl)) {
        const media = await loadOutboundMediaFromUrl(mediaUrl, {
          mediaLocalRoots: ctx.mediaLocalRoots,
        });
        const fileName = media.fileName || path.basename(mediaUrl) || "media";
        const contentType = media.contentType || guessContentType(mediaUrl);
        const messageId = await sendMediaBuffer(
          monitor,
          target,
          media.buffer,
          fileName,
          contentType,
          mediaUrl,
        );
        return { channel: "teamily" as const, messageId };
      }

      // Remote URL: use existing *ByURL methods.
      const messageId = await sendMediaByUrl(monitor, target, mediaUrl);
      return { channel: "teamily" as const, messageId };
    },
  },
  status: {
    probeAccount: async ({ account }) => {
      const result = await probeTeamily(account);
      if (!result.connected) {
        return {
          ok: false,
          error: result.error || "Failed to connect to Teamily server",
        };
      }
      return { ok: true };
    },
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      name: account.nickname || account.userID,
      enabled: account.enabled,
      configured: !!account.token,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      probe,
    }),
    collectStatusIssues: (accounts) => {
      const issues: ChannelStatusIssue[] = [];
      for (const snap of accounts) {
        if (snap.lastError) {
          issues.push({
            channel: "teamily",
            accountId: snap.accountId,
            kind: "runtime",
            message: snap.lastError,
            fix: "Check that the Teamily server is running and accessible",
          });
        }
      }
      return issues;
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const { accountId, account, log } = ctx;

      if (!account.token) {
        log?.warn?.(`Teamily account ${accountId} not configured (missing token)`);
        return;
      }

      log?.info?.(`Starting Teamily channel (account: ${accountId})`);

      const MEDIA_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
      const historyLimit = DEFAULT_GROUP_HISTORY_LIMIT; // 50 messages per group
      const groupHistories = new Map<string, HistoryEntry[]>();

      const stopFn = startTeamilyMonitoring(account, async (message) => {
        try {
          const rt = getTeamilyRuntime();
          const currentCfg = rt.config.loadConfig();

          const isGroup = isGroupSession(message.sessionType);
          const from = message.sendID;
          const rawText = message.content?.text || "";

          log?.info?.(
            `[${accountId}] Incoming message: sessionType=${message.sessionType}, isGroup=${isGroup}, ` +
              `from=${from}, recvID=${message.recvID}, isAtSelf=${message.isAtSelf ?? false}`,
          );

          const historyKey = isGroup ? `teamily:group:${message.recvID}` : undefined;

          // In group chats, buffer non-@-mention text-only messages for context.
          // Media messages (picture/video/audio) are always dispatched — OpenIM sends
          // @-mention text and media as separate messages, so a PICTURE following an
          // AT_TEXT won't have isAtSelf=true. Dispatching media keeps group image
          // handling consistent with DM behavior.
          const hasMedia = !!(
            message.content?.picture ||
            message.content?.video ||
            message.content?.audio
          );
          if (isGroup && !message.isAtSelf && !hasMedia) {
            if (historyKey && rawText) {
              recordPendingHistoryEntryIfEnabled({
                historyMap: groupHistories,
                historyKey,
                limit: historyLimit,
                entry: {
                  sender: from,
                  body: rawText,
                  timestamp: message.sendTime,
                },
              });
            }
            return;
          }

          const sessionKey = isGroup ? `teamily:group:${message.recvID}` : `teamily:${from}`;

          let mediaUrl: string | undefined;
          if (message.content?.picture?.sourcePicture?.url) {
            mediaUrl = message.content.picture.sourcePicture.url;
          } else if (message.content?.video?.videoUrl) {
            mediaUrl = message.content.video.videoUrl;
          } else if (message.content?.audio?.sourceUrl) {
            mediaUrl = message.content.audio.sourceUrl;
          }

          // Download remote media to a local temp file so the agent recognises
          // image-only messages (hasMediaAttachment checks MediaPath, not MediaUrl).
          let mediaPath: string | undefined;
          let mediaType: string | undefined;
          if (mediaUrl) {
            try {
              const fetched = await rt.channel.media.fetchRemoteMedia({
                url: mediaUrl,
                maxBytes: MEDIA_MAX_BYTES,
              });
              const saved = await rt.channel.media.saveMediaBuffer(
                fetched.buffer,
                fetched.contentType,
                "inbound",
                MEDIA_MAX_BYTES,
              );
              mediaPath = saved.path;
              mediaType = saved.contentType;
            } catch (err) {
              log?.warn?.(`[${accountId}] Failed to download Teamily media: ${String(err)}`);
            }
          }

          // For group @-mention messages, prepend buffered history as context.
          const body =
            isGroup && historyKey
              ? buildPendingHistoryContextFromMap({
                  historyMap: groupHistories,
                  historyKey,
                  limit: historyLimit,
                  currentMessage: rawText,
                  formatEntry: (entry) => `${entry.sender}: ${entry.body}`,
                })
              : rawText;

          const replyTarget = isGroup ? `group:${message.recvID}` : from;
          const msgCtx = {
            Body: body,
            From: from,
            To: account.userID,
            SessionKey: sessionKey,
            AccountId: accountId,
            Provider: "teamily" as const,
            Surface: "teamily" as const,
            OriginatingChannel: "teamily" as const,
            OriginatingTo: replyTarget,
            ChatType: isGroup ? "group" : "direct",
            MediaUrl: mediaUrl,
            MediaPath: mediaPath,
            MediaType: mediaType,
          };

          log?.info?.(
            `[${accountId}] Dispatching reply: sessionKey=${sessionKey}, chatType=${isGroup ? "group" : "direct"}, replyTarget=${replyTarget}`,
          );

          await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
            ctx: msgCtx,
            cfg: currentCfg,
            dispatcherOptions: {
              deliver: async (payload) => {
                const monitor = getTeamilyMonitor(accountId);
                if (!monitor)
                  throw new Error(`Teamily monitor not running for account ${accountId}`);
                const target = normalizeTeamilyTarget(replyTarget);
                const replyText =
                  ((payload as Record<string, unknown>)?.text as string | undefined) ??
                  ((payload as Record<string, unknown>)?.body as string | undefined) ??
                  "";

                // Send media attachments (first with caption, rest without).
                const mediaUrls = resolveOutboundMediaUrls(payload as Record<string, unknown>);
                let captionSent = false;
                const sentMedia = await sendMediaWithLeadingCaption({
                  mediaUrls,
                  caption: replyText,
                  send: async ({ mediaUrl: url, caption }) => {
                    await loadAndSendMedia(monitor, target, url);
                    // OpenIM doesn't support inline captions on media; send separately.
                    if (caption) {
                      await monitor.sendText(target, caption);
                      captionSent = true;
                    }
                  },
                  onError: (error) => {
                    log?.warn?.(`[${accountId}] Media send failed: ${String(error)}`);
                  },
                });

                // If no media was sent (or media failed), send text as a plain message.
                if ((!sentMedia || !captionSent) && replyText) {
                  log?.info?.(
                    `[${accountId}] Sending reply to: ${replyTarget} (isGroup=${isGroup})`,
                  );
                  await monitor.sendText(target, replyText);
                }
              },
              onReplyStart: () => {
                log?.info?.(`Agent reply started for ${from}`);
              },
            },
          });

          log?.info?.(`[${accountId}] Dispatch completed for ${sessionKey}`);

          // Clear history buffer after dispatch so context doesn't repeat.
          if (isGroup && historyKey) {
            clearHistoryEntriesIfEnabled({
              historyMap: groupHistories,
              historyKey,
              limit: historyLimit,
            });
          }
        } catch (err) {
          log?.error?.(
            `[${accountId}] Error handling message from ${message.sendID}: ${err instanceof Error ? err.stack || err.message : String(err)}`,
          );
        }
      });

      // Respect abort signal from the gateway framework
      ctx.abortSignal.addEventListener("abort", () => {
        stopFn();
        stopTeamilyMonitoring(accountId);
      });

      // Block until aborted — monitor runs indefinitely
      await new Promise<void>((resolve) => {
        ctx.abortSignal.addEventListener("abort", () => resolve());
      });
    },
  },
};

function applyTeamilyAccountConfig(params: {
  cfg: CoreConfig;
  accountId: string;
  input: Record<string, unknown>;
}): CoreConfig {
  const { cfg, accountId, input } = params;
  const existing = cfg.channels?.teamily;
  const server = existing?.server ?? { apiURL: "", wsURL: "" };
  const accounts = existing?.accounts ?? {};

  const accountUpdate: Record<string, unknown> = {};
  if (input.userID) accountUpdate.userID = String(input.userID);
  if (input.token) accountUpdate.token = String(input.token);
  if (input.nickname) accountUpdate.nickname = String(input.nickname);
  if (input.faceURL) accountUpdate.faceURL = String(input.faceURL);

  const serverUpdate: Record<string, string> = {};
  if (input.apiURL) serverUpdate.apiURL = String(input.apiURL);
  if (input.wsURL) serverUpdate.wsURL = String(input.wsURL);

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      teamily: {
        enabled: true,
        server: { ...server, ...serverUpdate },
        accounts: {
          ...accounts,
          [accountId]: {
            ...accounts[accountId],
            ...accountUpdate,
          },
        },
      },
    },
  } as CoreConfig;
}

/** Send a local media buffer using SDK's *ByFile methods (SDK handles upload). */
async function sendMediaBuffer(
  monitor: TeamilyMonitor,
  target: ReturnType<typeof normalizeTeamilyTarget>,
  buffer: Buffer,
  fileName: string,
  contentType: string,
  originalPath: string,
): Promise<string> {
  const category = detectMediaCategory(originalPath);
  switch (category) {
    case "video":
      return monitor.sendVideoBuffer(target, buffer, fileName, contentType);
    case "audio":
      return monitor.sendAudioBuffer(target, buffer, fileName, contentType);
    case "file":
      return monitor.sendFileBuffer(target, buffer, fileName, contentType);
    default:
      return monitor.sendImageBuffer(target, buffer, fileName, contentType);
  }
}

/** Send media by remote URL using existing *ByURL methods. */
async function sendMediaByUrl(
  monitor: TeamilyMonitor,
  target: ReturnType<typeof normalizeTeamilyTarget>,
  url: string,
): Promise<string> {
  const category = detectMediaCategory(url);
  switch (category) {
    case "video":
      return monitor.sendVideo(target, url);
    case "audio":
      return monitor.sendAudio(target, url);
    case "file":
      return monitor.sendFile(target, url);
    default:
      return monitor.sendImage(target, url);
  }
}

/**
 * Load a local media file and send it via SDK buffer upload.
 * For remote URLs, send directly via *ByURL methods.
 */
async function loadAndSendMedia(
  monitor: TeamilyMonitor,
  target: ReturnType<typeof normalizeTeamilyTarget>,
  mediaUrl: string,
): Promise<void> {
  if (isLocalMediaPath(mediaUrl)) {
    const media = await loadOutboundMediaFromUrl(mediaUrl);
    const fileName = media.fileName || path.basename(mediaUrl) || "media";
    const contentType = media.contentType || guessContentType(mediaUrl);
    await sendMediaBuffer(monitor, target, media.buffer, fileName, contentType, mediaUrl);
  } else {
    await sendMediaByUrl(monitor, target, mediaUrl);
  }
}

function requireMonitor(accountId?: string | null) {
  const id = accountId || "default";
  const monitor = getTeamilyMonitor(id);
  if (!monitor) {
    throw new Error(
      `Teamily gateway not running for account "${id}" — outbound requires an active gateway`,
    );
  }
  return monitor;
}

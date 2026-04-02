import type {
  ResolvedTeamilyAccount,
  TeamilyMessage,
  TeamilyMessageTarget,
  TeamilyPictureContent,
  TeamilyVideoContent,
  TeamilyAudioContent,
} from "./types.js";
import { CONTENT_TYPES, SESSION_TYPES, isGroupSession } from "./types.js";
import { extractVideoSnapshot, parseVideoMeta } from "./upload.js";

export type TeamilyMessageHandler = (message: TeamilyMessage) => Promise<void> | void;
export type TeamilyConnectionState = "connecting" | "connected" | "disconnected" | "error";

export interface TeamilyMonitorOptions {
  account: ResolvedTeamilyAccount;
  onMessage: TeamilyMessageHandler;
  onStateChange?: (state: TeamilyConnectionState, error?: string) => void;
}

type SdkModule = typeof import("@openim/client-sdk");
type SdkInstance = ReturnType<SdkModule["getSDK"]>;

// The OpenIM SDK uses FileReader internally for file upload (MD5 hashing of
// chunks). FileReader is a browser-only API not available in Node.js, so we
// provide a minimal polyfill that delegates to Blob.prototype.arrayBuffer().
if (typeof globalThis.FileReader === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).FileReader = class FileReader {
    result: ArrayBuffer | null = null;
    error: unknown = null;
    readyState = 0; // 0=EMPTY, 1=LOADING, 2=DONE
    onload: ((ev: { target: FileReader }) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;

    readAsArrayBuffer(blob: Blob): void {
      this.readyState = 1;
      blob
        .arrayBuffer()
        .then((buffer) => {
          this.result = buffer;
          this.readyState = 2;
          this.onload?.({ target: this });
        })
        .catch((err) => {
          this.error = err;
          this.readyState = 2;
          this.onerror?.(err);
        });
    }
  };
}

// Minimal valid 1x1 white JPEG. Used as a placeholder video snapshot —
// the SDK requires a non-empty snapshot file for upload; an empty File hangs.
// prettier-ignore
const MINIMAL_JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
  0x00, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01,
  0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01,
  0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01,
  0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01,
  0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01,
  0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00,
  0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x10, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
  0x00, 0x7b, 0x40, 0x00, 0x00, 0x01, 0xff, 0xd9,
]);

// Lazy-loaded SDK to avoid top-level dynamic import issues
let sdkModule: SdkModule | null = null;
async function loadSDK() {
  if (!sdkModule) {
    sdkModule = await import("@openim/client-sdk");
  }
  return sdkModule;
}

/**
 * Monitor for incoming Teamily messages using @openim/client-sdk.
 *
 * Delegates WebSocket connection, authentication, heartbeat, and
 * reconnection to the official OpenIM SDK. Also exposes send methods
 * so outbound replies flow through the same WebSocket connection.
 */
export class TeamilyMonitor {
  private account: ResolvedTeamilyAccount;
  private onMessage: TeamilyMessageHandler;
  private onStateChange?: (state: TeamilyConnectionState, error?: string) => void;
  private sdk: SdkInstance | null = null;
  private state: TeamilyConnectionState = "disconnected";
  private stopped = false;

  constructor(options: TeamilyMonitorOptions) {
    this.account = options.account;
    this.onMessage = options.onMessage;
    this.onStateChange = options.onStateChange;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.setState("connecting");

    const { getSDK, CbEvents } = await loadSDK();
    const sdk = getSDK();
    this.sdk = sdk;

    sdk.on(CbEvents.OnConnecting, () => {
      if (!this.stopped) this.setState("connecting");
    });
    sdk.on(CbEvents.OnConnectSuccess, () => {
      if (!this.stopped) this.setState("connected");
    });
    sdk.on(CbEvents.OnConnectFailed, ({ errCode, errMsg }) => {
      if (!this.stopped) this.setState("error", `[${errCode}] ${errMsg}`);
    });
    sdk.on(CbEvents.OnKickedOffline, () => {
      if (!this.stopped) this.setState("error", "Kicked offline");
    });
    sdk.on(CbEvents.OnUserTokenExpired, () => {
      if (!this.stopped) this.setState("error", "Token expired");
    });

    sdk.on(CbEvents.OnRecvNewMessages, ({ data }) => {
      if (this.stopped || !data) return;
      for (const msg of data) {
        if (msg.sendID === this.account.userID) continue;
        const converted = convertSdkMessage(msg, this.account.userID);
        if (converted) {
          void this.onMessage(converted);
        }
      }
    });

    try {
      await sdk.login({
        userID: this.account.userID,
        token: this.account.token,
        platformID: 5,
        wsAddr: this.account.wsURL,
        apiAddr: this.account.apiURL,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState("error", msg);
      throw err;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.sdk) {
      this.sdk.logout().catch(() => {});
      this.sdk = null;
    }
    this.setState("disconnected");
  }

  getState(): TeamilyConnectionState {
    return this.state;
  }

  /** Send a text message through the SDK WebSocket connection. */
  async sendText(target: TeamilyMessageTarget, text: string): Promise<string> {
    const sdk = this.requireSdk();
    const created = await sdk.createTextMessage(text);
    const message = created.data;
    const result = await sdk.sendMessage({
      recvID: target.type === "user" ? target.id : "",
      groupID: target.type === "group" ? target.id : "",
      message,
    });
    return result.data?.serverMsgID || result.data?.clientMsgID || "";
  }

  /** Send an image message through the SDK WebSocket connection. */
  async sendImage(target: TeamilyMessageTarget, url: string): Promise<string> {
    const sdk = this.requireSdk();
    const picInfo = { uuid: "", type: "", width: 0, height: 0, size: 0, url };
    const created = await sdk.createImageMessageByURL({
      sourcePicture: picInfo,
      bigPicture: picInfo,
      snapshotPicture: { ...picInfo, url: "" },
      sourcePath: "",
    });
    const result = await sdk.sendMessage({
      recvID: target.type === "user" ? target.id : "",
      groupID: target.type === "group" ? target.id : "",
      message: created.data,
    });
    return result.data?.serverMsgID || result.data?.clientMsgID || "";
  }

  /** Send a video message through the SDK WebSocket connection. */
  async sendVideo(target: TeamilyMessageTarget, url: string): Promise<string> {
    const sdk = this.requireSdk();
    const created = await sdk.createVideoMessageByURL({
      videoPath: "",
      duration: 0,
      videoType: "mp4",
      snapshotPath: "",
      videoUUID: "",
      videoUrl: url,
      videoSize: 0,
      snapshotUUID: "",
      snapshotSize: 0,
      snapshotUrl: "",
      snapshotWidth: 0,
      snapshotHeight: 0,
    });
    const result = await sdk.sendMessage({
      recvID: target.type === "user" ? target.id : "",
      groupID: target.type === "group" ? target.id : "",
      message: created.data,
    });
    return result.data?.serverMsgID || result.data?.clientMsgID || "";
  }

  /** Send a sound/audio message through the SDK WebSocket connection. */
  async sendAudio(target: TeamilyMessageTarget, url: string): Promise<string> {
    const sdk = this.requireSdk();
    const created = await sdk.createSoundMessageByURL({
      uuid: "",
      soundPath: "",
      sourceUrl: url,
      dataSize: 0,
      duration: 0,
    });
    const result = await sdk.sendMessage({
      recvID: target.type === "user" ? target.id : "",
      groupID: target.type === "group" ? target.id : "",
      message: created.data,
    });
    return result.data?.serverMsgID || result.data?.clientMsgID || "";
  }

  /** Send a file message through the SDK WebSocket connection. */
  async sendFile(target: TeamilyMessageTarget, url: string, fileName?: string): Promise<string> {
    const sdk = this.requireSdk();
    const created = await sdk.createFileMessageByURL({
      filePath: "",
      fileName: fileName || url.split("/").pop() || "file",
      uuid: "",
      sourceUrl: url,
      fileSize: 0,
    });
    const result = await sdk.sendMessage({
      recvID: target.type === "user" ? target.id : "",
      groupID: target.type === "group" ? target.id : "",
      message: created.data,
    });
    return result.data?.serverMsgID || result.data?.clientMsgID || "";
  }

  // ---- Buffer-based send methods (local file → SDK upload) ----
  // Like Telegram's InputFile(buffer), pass a buffer and let the SDK upload.

  /** Send an image from a local buffer. SDK handles the upload to object storage. */
  async sendImageBuffer(
    target: TeamilyMessageTarget,
    buffer: Buffer,
    fileName: string,
    contentType: string,
  ): Promise<string> {
    const sdk = this.requireSdk();
    const file = new File([new Uint8Array(buffer)], fileName, { type: contentType });
    const uuid = crypto.randomUUID();
    const picInfo = {
      uuid,
      type: contentType,
      width: 0,
      height: 0,
      size: buffer.length,
      url: "",
    };
    const created = await sdk.createImageMessageByFile({
      sourcePicture: picInfo,
      bigPicture: picInfo,
      snapshotPicture: picInfo,
      sourcePath: "",
      file,
    });
    const result = await sdk.sendMessage({
      recvID: target.type === "user" ? target.id : "",
      groupID: target.type === "group" ? target.id : "",
      message: created.data,
    });
    return result.data?.serverMsgID || result.data?.clientMsgID || "";
  }

  /** Send a video from a local buffer. SDK handles the upload to object storage. */
  async sendVideoBuffer(
    target: TeamilyMessageTarget,
    buffer: Buffer,
    fileName: string,
    contentType: string,
  ): Promise<string> {
    const sdk = this.requireSdk();
    const videoFile = new File([new Uint8Array(buffer)], fileName, { type: contentType });

    // Extract real duration/dimensions from the MP4 container so clients
    // can play the video inline instead of showing a broken player.
    const meta = parseVideoMeta(buffer);

    // Try to extract a real first-frame snapshot via ffmpeg; fall back to
    // a minimal 1x1 JPEG placeholder if ffmpeg is unavailable.
    const snapshot = await extractVideoSnapshot(buffer);
    const snapshotBuf = snapshot?.buffer ?? Buffer.from(MINIMAL_JPEG);
    const snapWidth = snapshot?.width || meta.width || 1;
    const snapHeight = snapshot?.height || meta.height || 1;
    const snapshotFile = new File([new Uint8Array(snapshotBuf)], "snapshot.jpg", {
      type: "image/jpeg",
    });

    const videoExt = fileName.split(".").pop()?.toLowerCase() || "mp4";
    const created = await sdk.createVideoMessageByFile({
      videoPath: "",
      duration: meta.duration,
      videoType: videoExt,
      snapshotPath: "",
      videoUUID: crypto.randomUUID(),
      videoUrl: "",
      videoSize: buffer.length,
      snapshotUUID: crypto.randomUUID(),
      snapshotSize: snapshotBuf.length,
      snapshotUrl: "",
      snapshotWidth: snapWidth,
      snapshotHeight: snapHeight,
      videoFile,
      snapshotFile,
    });
    const result = await sdk.sendMessage({
      recvID: target.type === "user" ? target.id : "",
      groupID: target.type === "group" ? target.id : "",
      message: created.data,
    });
    return result.data?.serverMsgID || result.data?.clientMsgID || "";
  }

  /** Send an audio/sound from a local buffer. SDK handles the upload to object storage. */
  async sendAudioBuffer(
    target: TeamilyMessageTarget,
    buffer: Buffer,
    fileName: string,
    contentType: string,
  ): Promise<string> {
    const sdk = this.requireSdk();
    const file = new File([new Uint8Array(buffer)], fileName, { type: contentType });
    const created = await sdk.createSoundMessageByFile({
      uuid: crypto.randomUUID(),
      soundPath: "",
      sourceUrl: "",
      dataSize: buffer.length,
      duration: 0,
      file,
    });
    const result = await sdk.sendMessage({
      recvID: target.type === "user" ? target.id : "",
      groupID: target.type === "group" ? target.id : "",
      message: created.data,
    });
    return result.data?.serverMsgID || result.data?.clientMsgID || "";
  }

  /** Send a document/file from a local buffer. SDK handles the upload to object storage. */
  async sendFileBuffer(
    target: TeamilyMessageTarget,
    buffer: Buffer,
    fileName: string,
    contentType: string,
  ): Promise<string> {
    const sdk = this.requireSdk();
    const file = new File([new Uint8Array(buffer)], fileName, { type: contentType });
    const created = await sdk.createFileMessageByFile({
      filePath: "",
      fileName,
      uuid: crypto.randomUUID(),
      sourceUrl: "",
      fileSize: buffer.length,
      file,
    });
    const result = await sdk.sendMessage({
      recvID: target.type === "user" ? target.id : "",
      groupID: target.type === "group" ? target.id : "",
      message: created.data,
    });
    return result.data?.serverMsgID || result.data?.clientMsgID || "";
  }

  private requireSdk(): SdkInstance {
    if (!this.sdk) {
      throw new Error("Teamily SDK not connected");
    }
    return this.sdk;
  }

  private setState(state: TeamilyConnectionState, error?: string): void {
    this.state = state;
    this.onStateChange?.(state, error);
  }
}

// ---- SDK message conversion helpers ----

import type { MessageItem } from "@openim/client-sdk";

function convertSdkMessage(msg: MessageItem, selfUserID: string): TeamilyMessage | null {
  const contentType = msg.contentType ?? CONTENT_TYPES.TEXT;
  const sessionType = msg.sessionType ?? SESSION_TYPES.SINGLE;

  const content = parseSdkContent(msg, contentType);

  if (!content.text && !content.picture && !content.video && !content.audio) {
    return null;
  }

  // Determine whether this message @-mentions the bot
  const isAtSelf =
    contentType === CONTENT_TYPES.AT_TEXT &&
    (msg.atTextElem?.isAtSelf === true || (msg.atTextElem?.atUserList ?? []).includes(selfUserID));

  return {
    serverMsgID: msg.serverMsgID || msg.clientMsgID || `${Date.now()}_${Math.random()}`,
    sendID: msg.sendID || "unknown",
    recvID: isGroupSession(sessionType) ? msg.groupID || "" : msg.recvID || selfUserID,
    content,
    contentType,
    sessionType,
    sendTime: msg.sendTime || Date.now(),
    isAtSelf,
  };
}

function parseSdkContent(msg: MessageItem, contentType: number): TeamilyMessage["content"] {
  switch (contentType) {
    case CONTENT_TYPES.TEXT: {
      const text = msg.textElem?.content ?? tryParseTextContent(msg.content);
      return text ? { text } : {};
    }
    case CONTENT_TYPES.PICTURE:
      if (msg.pictureElem?.sourcePicture) {
        return { picture: msg.pictureElem as unknown as TeamilyPictureContent };
      }
      return {};
    case CONTENT_TYPES.VIDEO:
      if (msg.videoElem?.videoUrl) {
        return { video: msg.videoElem as unknown as TeamilyVideoContent };
      }
      return {};
    case CONTENT_TYPES.AT_TEXT: {
      const text = msg.atTextElem?.text ?? tryParseTextContent(msg.content);
      return text ? { text } : {};
    }
    case CONTENT_TYPES.VOICE:
      if (msg.soundElem?.sourceUrl) {
        return { audio: msg.soundElem as unknown as TeamilyAudioContent };
      }
      return {};
    default:
      return {};
  }
}

function tryParseTextContent(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const obj = JSON.parse(raw) as { content?: string };
    return typeof obj.content === "string" ? obj.content : undefined;
  } catch {
    return raw;
  }
}

// ---- Global monitor registry ----

const monitors = new Map<string, TeamilyMonitor>();

export function startTeamilyMonitoring(
  account: ResolvedTeamilyAccount,
  onMessage: TeamilyMessageHandler,
  onStateChange?: (state: TeamilyConnectionState, error?: string) => void,
): () => void {
  const monitor = new TeamilyMonitor({ account, onMessage, onStateChange });
  monitors.set(account.accountId, monitor);
  monitor.start().catch((err) => {
    console.error(`Teamily monitor start failed for ${account.accountId}:`, err);
  });

  return () => {
    monitor.stop();
    monitors.delete(account.accountId);
  };
}

export function stopTeamilyMonitoring(accountId: string): void {
  const monitor = monitors.get(accountId);
  if (monitor) {
    monitor.stop();
    monitors.delete(accountId);
  }
}

export function getTeamilyMonitor(accountId: string): TeamilyMonitor | undefined {
  return monitors.get(accountId);
}

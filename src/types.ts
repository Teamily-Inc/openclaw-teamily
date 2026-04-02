// Core configuration types for Teamily channel

export interface TeamilyServerConfig {
  apiURL: string;
  wsURL: string;
}

export interface TeamilyDmConfig {
  policy?: string;
  allowFrom?: Array<string | number>;
}

export interface TeamilyUserAccount {
  userID: string;
  token: string;
  nickname?: string;
  faceURL?: string;
  enabled?: boolean;
  dm?: TeamilyDmConfig;
}

export interface TeamilyConfig {
  enabled: boolean;
  server: TeamilyServerConfig;
  accounts: Record<string, TeamilyUserAccount>;
  dm?: TeamilyDmConfig;
}

export interface ResolvedTeamilyAccount {
  accountId: string;
  enabled: boolean;
  apiURL: string;
  wsURL: string;
  userID: string;
  token: string;
  nickname?: string;
  faceURL?: string;
  dm?: TeamilyDmConfig;
}

export interface TeamilyMessageTarget {
  type: "user" | "group";
  id: string;
}

export interface TeamilyMessage {
  serverMsgID: string;
  sendID: string;
  recvID: string;
  content: {
    text?: string;
    picture?: TeamilyPictureContent;
    video?: TeamilyVideoContent;
    audio?: TeamilyAudioContent;
  };
  contentType: number;
  sessionType: number;
  sendTime: number;
  /** True when the message is an @-mention that includes the bot's own userID. */
  isAtSelf?: boolean;
}

export interface TeamilyPictureContent {
  sourcePicture: {
    uuid: string;
    type: string;
    width: number;
    height: number;
    url: string;
  };
}

export interface TeamilyVideoContent {
  videoPath: string;
  videoUUID: string;
  videoUrl: string;
  videoType: string;
  videoSize: number;
  duration: number;
  snapshotUUID: string;
  snapshotUrl: string;
  snapshotSize: number;
  snapshotWidth: number;
  snapshotHeight: number;
}

export interface TeamilyAudioContent {
  uuid: string;
  soundPath: string;
  sourceUrl: string;
  dataSize: number;
  duration: number;
  soundType: string;
}

export type TeamilyProbeResult = {
  connected: boolean;
  error?: string;
  userExists?: boolean;
};

// Content type constants
export const CONTENT_TYPES = {
  TEXT: 101,
  PICTURE: 102,
  VOICE: 103,
  VIDEO: 104,
  FILE: 105,
  AT_TEXT: 106,
  MERGER: 107,
  CARD: 108,
  LOCATION: 109,
  CUSTOM: 110,
  TYPING: 113,
  QUOTE: 114,
  FACE: 115,
  ADVANCED_TEXT: 117,
} as const;

// Session type constants
export const SESSION_TYPES = {
  SINGLE: 1,
  SUPER_GROUP: 2,
  GROUP: 3,
  NOTIFICATION: 4,
} as const;

/** Returns true when the session type represents any kind of group chat. */
export function isGroupSession(sessionType: number): boolean {
  return sessionType === SESSION_TYPES.GROUP || sessionType === SESSION_TYPES.SUPER_GROUP;
}

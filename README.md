# Teamily Channel Plugin for OpenClaw

Integrates [Teamily](https://teamily.ai/) with OpenClaw as a self-hosted team messaging channel.

## Installation

```bash
openclaw plugins install @teamilyai/teamily
```

Or update an existing install:

```bash
openclaw plugins update teamily
```

> **Note:** The plugin update command uses the plugin ID `teamily`, not the npm package name.

## Configuration

### Interactive Setup

```bash
openclaw channel configure teamily
```

### Server Settings

| Field    | Description           | Default                                 |
| -------- | --------------------- | --------------------------------------- |
| `apiURL` | Teamily REST API URL  | `https://imserver.teamily.ai/im_api`    |
| `wsURL`  | Teamily WebSocket URL | `wss://imserver.teamily.ai/msg_gateway` |

### Bot Account Settings

| Field      | Required | Description                   |
| ---------- | -------- | ----------------------------- |
| `userID`   | Yes      | User ID for the bot account   |
| `token`    | Yes      | User token for authentication |
| `nickname` | No       | Display nickname              |
| `faceURL`  | No       | Avatar URL                    |

### DM Security

Per-account or channel-level DM security can be configured:

| Field          | Description                                         |
| -------------- | --------------------------------------------------- |
| `dm.policy`    | DM security policy (`pairing`, `allowlist`, `open`) |
| `dm.allowFrom` | List of allowed sender IDs                          |

### Example Configuration

```yaml
channels:
  teamily:
    enabled: true
    server:
      apiURL: https://imserver.teamily.ai/im_api
      wsURL: wss://imserver.teamily.ai/msg_gateway
    accounts:
      default:
        userID: "bot-user-id"
        token: "bot-token"
        nickname: "OpenClaw Bot"
        dm:
          policy: open
```

Multiple accounts are supported under the `accounts` key.

## Usage

### Send Messages

```bash
# Send to a user
openclaw message send teamily:user:userID "Hello!"

# Send to a group
openclaw message send teamily:group:groupID "Hello group!"
```

### Send Media

```bash
openclaw message send teamily:user:userID --media /path/to/image.jpg
```

Supported media types are auto-detected by file extension:

| Extension                                             | Type  |
| ----------------------------------------------------- | ----- |
| `.jpg`, `.png`, `.gif`, etc.                          | Image |
| `.mp4`, `.mov`, `.webm`                               | Video |
| `.mp3`, `.m4a`, `.wav`                                | Audio |
| `.pdf`, `.doc`, `.zip`, `.json`, `.txt`, `.csv`, etc. | File  |

## Group Chat Behavior

- All group messages are received and dispatched to the agent for context accumulation.
- The bot only **replies** when it is **@-mentioned** in the group (`@BotName`).
- In direct messages, the bot always replies.
- Both regular groups (`sessionType=3`) and super groups (`sessionType=2`) are supported.

## Capabilities

| Feature                        | Supported |
| ------------------------------ | --------- |
| Direct messaging               | Yes       |
| Group messaging                | Yes       |
| Text messages                  | Yes       |
| Media (image/video/audio/file) | Yes       |
| @-mention gating (groups)      | Yes       |
| WebSocket real-time monitoring | Yes       |
| Automatic reconnection         | Yes       |
| Connection health probes       | Yes       |
| Reactions                      | No        |
| Threads                        | No        |
| Polls                          | No        |

## Architecture

```
index.ts              Plugin entry point (registers channel with OpenClaw)
src/
  channel.ts          Channel plugin definition (gateway, outbound, config, security)
  monitor.ts          WebSocket monitor using @openim/client-sdk (inbound + send)
  types.ts            Shared types and constants (session types, content types, message shapes)
  config-schema.ts    Zod config schema (server, accounts, DM security)
  accounts.ts         Account resolution and listing
  normalize.ts        Target ID normalization (user:ID, group:ID)
  upload.ts           Media category detection, MIME types, MP4 metadata parsing, video snapshot extraction
  probe.ts            Health check via REST API
  runtime.ts          Plugin runtime store
```

## License

MIT

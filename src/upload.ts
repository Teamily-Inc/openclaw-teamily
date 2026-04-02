import path from "node:path";

/** Returns true if the media URL is a local file path rather than a remote URL. */
export function isLocalMediaPath(mediaUrl: string): boolean {
  return !/^https?:\/\//i.test(mediaUrl);
}

/** Detect the media category from a file extension. */
export type MediaCategory = "image" | "video" | "audio" | "file";

export function detectMediaCategory(filePath: string): MediaCategory {
  const ext = path.extname(filePath).toLowerCase();
  if ([".mp4", ".mov", ".webm"].includes(ext)) return "video";
  if ([".mp3", ".m4a", ".wav", ".ogg"].includes(ext)) return "audio";
  if (
    [
      ".pdf",
      ".doc",
      ".docx",
      ".xls",
      ".xlsx",
      ".ppt",
      ".pptx",
      ".zip",
      ".rar",
      ".7z",
      ".tar",
      ".gz",
      ".tgz",
      ".txt",
      ".csv",
      ".json",
      ".xml",
      ".yaml",
      ".yml",
      ".log",
      ".md",
      ".html",
      ".css",
      ".js",
      ".ts",
      ".py",
      ".go",
      ".rs",
      ".java",
      ".c",
      ".cpp",
      ".h",
      ".sh",
      ".bat",
      ".sql",
      ".toml",
      ".ini",
      ".cfg",
    ].includes(ext)
  )
    return "file";
  return "image";
}

/**
 * Guess a reasonable MIME content type from a file extension.
 * Falls back to application/octet-stream for unknown types.
 */
export function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".zip": "application/zip",
    ".rar": "application/vnd.rar",
    ".7z": "application/x-7z-compressed",
    ".tar": "application/x-tar",
    ".gz": "application/gzip",
    ".tgz": "application/gzip",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".json": "application/json",
    ".xml": "application/xml",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
    ".log": "text/plain",
    ".md": "text/markdown",
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".ts": "application/typescript",
    ".py": "text/x-python",
    ".go": "text/x-go",
    ".rs": "text/x-rust",
    ".java": "text/x-java",
    ".c": "text/x-c",
    ".cpp": "text/x-c++",
    ".h": "text/x-c",
    ".sh": "text/x-shellscript",
    ".sql": "application/sql",
    ".toml": "application/toml",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return map[ext] ?? "application/octet-stream";
}

// ---- Video snapshot extraction via ffmpeg ----

/**
 * Extract the first video frame as a JPEG thumbnail using ffmpeg.
 * Returns null if ffmpeg is unavailable or extraction fails.
 * The thumbnail is scaled down to fit within maxDim (default 320px).
 */
export interface SnapshotResult {
  buffer: Buffer;
  width: number;
  height: number;
}

export async function extractVideoSnapshot(videoBuf: Buffer): Promise<SnapshotResult | null> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { writeFile, readFile, unlink, mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const execFileAsync = promisify(execFile);

  let dir: string | undefined;
  try {
    dir = await mkdtemp(path.join(tmpdir(), "oc-snap-"));
    const inPath = path.join(dir, "input.mp4");
    const outPath = path.join(dir, "snapshot.jpg");

    await writeFile(inPath, videoBuf);
    await execFileAsync("ffmpeg", ["-y", "-i", inPath, "-frames:v", "1", outPath], {
      timeout: 15_000,
    });

    const snap = await readFile(outPath);
    if (snap.length === 0) {
      console.warn("[teamily] ffmpeg produced empty snapshot");
      return null;
    }
    const dims = parseJpegDimensions(snap);
    console.info(
      `[teamily] extracted video snapshot: ${snap.length} bytes, ${dims.width}x${dims.height}`,
    );
    return { buffer: snap, width: dims.width, height: dims.height };
  } catch (err) {
    console.warn("[teamily] ffmpeg snapshot extraction failed:", err);
    return null;
  } finally {
    if (dir) {
      const { rm } = await import("node:fs/promises");
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// ---- MP4 metadata extraction (no external dependencies) ----

export interface VideoMeta {
  duration: number; // seconds
  width: number;
  height: number;
}

/**
 * Parse MP4/MOV container to extract duration, width, and height.
 * Returns zeroed metadata on parse failure (non-MP4, truncated, etc.).
 */
export function parseVideoMeta(buf: Buffer): VideoMeta {
  const fallback: VideoMeta = { duration: 0, width: 0, height: 0 };
  try {
    const moov = findBox(buf, 0, buf.length, "moov");
    if (!moov) return fallback;

    let duration = 0;
    let width = 0;
    let height = 0;

    // mvhd → duration & timescale
    const mvhd = findBox(buf, moov.dataStart, moov.end, "mvhd");
    if (mvhd) {
      const ver = buf[mvhd.dataStart];
      if (ver === 0) {
        const timescale = buf.readUInt32BE(mvhd.dataStart + 12);
        const dur = buf.readUInt32BE(mvhd.dataStart + 16);
        if (timescale > 0) duration = dur / timescale;
      } else if (ver === 1) {
        const timescale = buf.readUInt32BE(mvhd.dataStart + 20);
        // 64-bit duration: read high and low 32-bit parts
        const durHi = buf.readUInt32BE(mvhd.dataStart + 24);
        const durLo = buf.readUInt32BE(mvhd.dataStart + 28);
        const dur = durHi * 0x100000000 + durLo;
        if (timescale > 0) duration = dur / timescale;
      }
    }

    // trak → tkhd → width & height (use first video track)
    let offset = moov.dataStart;
    while (offset < moov.end) {
      const trak = findBox(buf, offset, moov.end, "trak");
      if (!trak) break;
      const tkhd = findBox(buf, trak.dataStart, trak.end, "tkhd");
      if (tkhd) {
        const ver = buf[tkhd.dataStart];
        // width/height are fixed-point 16.16 at the end of tkhd
        const whOffset = ver === 0 ? tkhd.dataStart + 76 : tkhd.dataStart + 88;
        if (whOffset + 8 <= tkhd.end) {
          const w = buf.readUInt32BE(whOffset) >> 16;
          const h = buf.readUInt32BE(whOffset + 4) >> 16;
          if (w > 0 && h > 0) {
            width = w;
            height = h;
            break; // first video track is enough
          }
        }
      }
      offset = trak.end;
    }

    return { duration: Math.round(duration), width, height };
  } catch {
    return fallback;
  }
}

interface BoxInfo {
  dataStart: number; // offset right after the 8-byte header
  end: number; // first byte past this box
}

/** Find a box by type within [start, end) range. */
function findBox(buf: Buffer, start: number, end: number, type: string): BoxInfo | null {
  let offset = start;
  while (offset + 8 <= end) {
    let size = buf.readUInt32BE(offset);
    const boxType = buf.toString("ascii", offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1 && offset + 16 <= end) {
      // 64-bit extended size
      const hi = buf.readUInt32BE(offset + 8);
      const lo = buf.readUInt32BE(offset + 12);
      size = hi * 0x100000000 + lo;
      headerSize = 16;
    }
    if (size < headerSize) break; // invalid
    const boxEnd = offset + size;
    if (boxType === type) {
      return { dataStart: offset + headerSize, end: Math.min(boxEnd, end) };
    }
    offset = boxEnd;
  }
  return null;
}

/** Parse width/height from a JPEG buffer by scanning for SOF markers. */
function parseJpegDimensions(buf: Buffer): { width: number; height: number } {
  let i = 0;
  while (i + 1 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    // SOF0–SOF3 (0xC0–0xC3): baseline, progressive, etc.
    if (marker >= 0xc0 && marker <= 0xc3 && i + 9 < buf.length) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      return { width, height };
    }
    // Skip marker segment (length follows the 2-byte marker)
    if (marker === 0xd8 || marker === 0xd9) {
      i += 2; // SOI/EOI have no payload
    } else if (i + 3 < buf.length) {
      const len = buf.readUInt16BE(i + 2);
      i += 2 + len;
    } else {
      break;
    }
  }
  return { width: 0, height: 0 };
}

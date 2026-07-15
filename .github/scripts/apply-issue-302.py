from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    source = p.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, got {count}")
    p.write_text(source.replace(old, new, 1), encoding="utf-8")


def replace_between(path: str, start_marker: str, end_marker: str, replacement: str, label: str) -> None:
    p = Path(path)
    source = p.read_text(encoding="utf-8")
    start = source.find(start_marker)
    if start < 0:
        raise SystemExit(f"{label}: start marker not found")
    end = source.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"{label}: end marker not found")
    p.write_text(source[:start] + replacement + source[end:], encoding="utf-8")


# ---------------------------------------------------------------------------
# Backend: pure remote-image security helpers.
# ---------------------------------------------------------------------------
Path("backend/src/lib/remote-image-security.ts").write_text(r'''import net from "node:net";

export const REMOTE_IMAGE_MIME_TO_EXT: Readonly<Record<string, string>> = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
});

const MIME_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/ico": "image/x-icon",
  "image/vnd.microsoft.icon": "image/x-icon",
});

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home"];

export function normalizeRemoteImageMime(value: unknown): string {
  const raw = String(value || "").toLowerCase().split(";", 1)[0].trim();
  return MIME_ALIASES[raw] || raw;
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return nums;
}

function isBlockedIpv4(address: string): boolean {
  const parts = parseIpv4(address);
  if (!parts) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 0 || b === 168)) return true;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
  if (a === 203 && b === 0) return true;
  if (a >= 224) return true;
  return false;
}

function firstIpv6Hextet(address: string): number | null {
  const first = address.split(":", 1)[0];
  if (!first) return 0;
  const value = Number.parseInt(first, 16);
  return Number.isFinite(value) ? value : null;
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%", 1)[0];
  if (normalized === "::" || normalized === "::1") return true;

  const dottedTail = normalized.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (dottedTail && isBlockedIpv4(dottedTail)) return true;

  const first = firstIpv6Hextet(normalized);
  if (first == null) return true;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (normalized.startsWith("2001:db8:")) return true; // documentation range
  return false;
}

/** Reject loopback, private, link-local, multicast and documentation addresses. */
export function isBlockedRemoteAddress(address: string): boolean {
  const normalized = String(address || "").trim().toLowerCase();
  const family = net.isIP(normalized.split("%", 1)[0]);
  if (family === 4) return isBlockedIpv4(normalized);
  if (family === 6) return isBlockedIpv6(normalized);
  return true;
}

/** Cheap hostname guard before DNS resolution. Every resolved address must still be checked. */
export function isBlockedRemoteHostname(hostname: string): boolean {
  const normalized = String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
  if (!normalized) return true;
  if (normalized === "localhost" || normalized === "metadata.google.internal") return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) return true;
  if (net.isIP(normalized)) return isBlockedRemoteAddress(normalized);
  return false;
}

/** Determine the real supported raster image type from magic bytes. SVG is intentionally rejected. */
export function sniffRemoteImageMime(input: Uint8Array): string | null {
  const bytes = input;
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6) {
    const head = Buffer.from(bytes.subarray(0, 6)).toString("ascii");
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  ) return "image/webp";
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
  if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return "image/x-icon";
  return null;
}

export function sanitizeRemoteImageFilename(rawName: string, mimeType: string): string {
  const ext = REMOTE_IMAGE_MIME_TO_EXT[normalizeRemoteImageMime(mimeType)] || "img";
  let name = String(rawName || "").replace(/\\/g, "/").split("/").pop() || "";
  try { name = decodeURIComponent(name); } catch { /* keep undecoded */ }
  name = name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/[.\s]+$/g, "")
    .trim();
  name = name.replace(/\.[a-z0-9]{1,10}$/i, "").trim();
  if (!name) name = "remote-image";
  if (name.length > 100) name = name.slice(0, 100).trim();
  return `${name}.${ext}`;
}
''', encoding="utf-8")


# ---------------------------------------------------------------------------
# Backend: authenticated and SSRF-hardened remote import route.
# ---------------------------------------------------------------------------
Path("backend/src/routes/remote-image-import.ts").write_text(r'''import { lookup } from "node:dns/promises";
import crypto from "node:crypto";
import { v4 as uuid } from "uuid";
import { Hono } from "hono";
import { getDb } from "../db/schema";
import { hasPermission, resolveNotePermission } from "../middleware/acl";
import { enqueueAttachment } from "../services/embedding-worker";
import {
  deleteAttachmentObject,
  getUploadMonthPath,
  writeAttachmentObject,
} from "../services/attachment-storage";
import { createUserAttachmentAccessUrls } from "../lib/attachment-signed-url";
import {
  createDeduplicatedAttachmentRow,
  type ExistingAttachmentForDedup,
} from "./attachments-core";
import {
  isBlockedRemoteAddress,
  isBlockedRemoteHostname,
  normalizeRemoteImageMime,
  REMOTE_IMAGE_MIME_TO_EXT,
  sanitizeRemoteImageFilename,
  sniffRemoteImageMime,
} from "../lib/remote-image-security";

const router = new Hono();
const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

class RemoteImageError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: 400 | 403 | 408 | 413 | 415 | 502,
  ) {
    super(message);
  }
}

function readPositiveEnv(name: string, fallback: number, max: number): number {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? Math.min(value, max) : fallback;
}

function getRemoteImageMaxBytes(): number {
  return readPositiveEnv("REMOTE_IMAGE_MAX_SIZE_MB", DEFAULT_MAX_BYTES / 1024 / 1024, 100) * 1024 * 1024;
}

function getRemoteImageTimeoutMs(): number {
  return readPositiveEnv("REMOTE_IMAGE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 60_000);
}

async function assertSafeRemoteUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RemoteImageError("仅支持 HTTP/HTTPS 网络图片", "INVALID_REMOTE_IMAGE_URL", 400);
  }
  if (url.username || url.password || isBlockedRemoteHostname(url.hostname)) {
    throw new RemoteImageError("该网络图片地址不允许访问", "REMOTE_IMAGE_SSRF_BLOCKED", 403);
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new RemoteImageError("无法解析网络图片域名", "REMOTE_IMAGE_DNS_FAILED", 502);
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedRemoteAddress(address))) {
    throw new RemoteImageError("该网络图片地址解析到了内网或保留地址", "REMOTE_IMAGE_SSRF_BLOCKED", 403);
  }
}

function filenameFromHeaders(headers: Headers, finalUrl: URL, mimeType: string): string {
  const disposition = headers.get("content-disposition") || "";
  let candidate = "";
  const encoded = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { candidate = decodeURIComponent(encoded.trim().replace(/^"|"$/g, "")); } catch { /* ignore */ }
  }
  if (!candidate) {
    candidate = disposition.match(/filename\s*=\s*"([^"]+)"/i)?.[1]
      || disposition.match(/filename\s*=\s*([^;]+)/i)?.[1]?.trim()
      || finalUrl.pathname.split("/").pop()
      || "remote-image";
  }
  return sanitizeRemoteImageFilename(candidate, mimeType);
}

async function downloadRemoteImage(rawUrl: string): Promise<{
  buffer: Buffer;
  mimeType: string;
  filename: string;
  finalUrl: string;
}> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw new RemoteImageError("网络图片地址无效", "INVALID_REMOTE_IMAGE_URL", 400);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getRemoteImageTimeoutMs());
  const maxBytes = getRemoteImageMaxBytes();

  try {
    let response: Response | null = null;
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      await assertSafeRemoteUrl(current);
      response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/bmp,image/x-icon;q=0.9,*/*;q=0.1",
          "User-Agent": "Nowen-Note-Remote-Image/1.0",
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirectCount === MAX_REDIRECTS) {
          throw new RemoteImageError("网络图片重定向次数过多", "REMOTE_IMAGE_REDIRECT_LIMIT", 502);
        }
        current = new URL(location, current);
        continue;
      }
      break;
    }

    if (!response || !response.ok) {
      throw new RemoteImageError(`网络图片下载失败${response ? `（HTTP ${response.status}）` : ""}`, "REMOTE_IMAGE_DOWNLOAD_FAILED", 502);
    }

    const declaredLength = Number.parseInt(response.headers.get("content-length") || "", 10);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new RemoteImageError(`网络图片过大（最大 ${Math.round(maxBytes / 1024 / 1024)}MB）`, "REMOTE_IMAGE_TOO_LARGE", 413);
    }
    if (!response.body) {
      throw new RemoteImageError("网络图片响应为空", "REMOTE_IMAGE_DOWNLOAD_FAILED", 502);
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort();
        throw new RemoteImageError(`网络图片过大（最大 ${Math.round(maxBytes / 1024 / 1024)}MB）`, "REMOTE_IMAGE_TOO_LARGE", 413);
      }
      chunks.push(value);
    }

    const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    const sniffedMime = sniffRemoteImageMime(buffer);
    if (!sniffedMime) {
      throw new RemoteImageError("远程响应不是受支持的图片格式", "REMOTE_IMAGE_NOT_IMAGE", 415);
    }

    const declaredMime = normalizeRemoteImageMime(response.headers.get("content-type"));
    if (declaredMime && declaredMime !== "application/octet-stream") {
      if (!declaredMime.startsWith("image/") || !REMOTE_IMAGE_MIME_TO_EXT[declaredMime]) {
        throw new RemoteImageError("远程响应的 Content-Type 不是受支持的图片", "REMOTE_IMAGE_NOT_IMAGE", 415);
      }
      if (normalizeRemoteImageMime(declaredMime) !== normalizeRemoteImageMime(sniffedMime)) {
        throw new RemoteImageError("远程图片声明类型与实际内容不一致", "REMOTE_IMAGE_TYPE_MISMATCH", 415);
      }
    }

    return {
      buffer,
      mimeType: sniffedMime,
      filename: filenameFromHeaders(response.headers, current, sniffedMime),
      finalUrl: current.toString(),
    };
  } catch (error) {
    if (error instanceof RemoteImageError) throw error;
    if ((error as { name?: string })?.name === "AbortError") {
      throw new RemoteImageError("网络图片下载超时", "REMOTE_IMAGE_TIMEOUT", 408);
    }
    throw new RemoteImageError(`网络图片下载失败：${(error as Error)?.message || String(error)}`, "REMOTE_IMAGE_DOWNLOAD_FAILED", 502);
  } finally {
    clearTimeout(timer);
  }
}

router.post("/import-remote-image", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  let body: { noteId?: unknown; url?: unknown; source?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "请求格式错误", code: "INVALID_BODY" }, 400);
  }

  const noteId = typeof body.noteId === "string" ? body.noteId.trim() : "";
  const remoteUrl = typeof body.url === "string" ? body.url.trim() : "";
  const uploadSource = typeof body.source === "string"
    ? body.source.trim().slice(0, 64) || "remote-image"
    : "remote-image";
  if (!noteId || !remoteUrl) {
    return c.json({ error: "noteId 和 url 必传", code: "INVALID_BODY" }, 400);
  }

  const { permission, workspaceId } = resolveNotePermission(noteId, userId);
  if (!hasPermission(permission, "write")) {
    return c.json({ error: "无权修改该笔记", code: "FORBIDDEN" }, 403);
  }

  let downloaded: Awaited<ReturnType<typeof downloadRemoteImage>>;
  try {
    downloaded = await downloadRemoteImage(remoteUrl);
  } catch (error) {
    const failure = error instanceof RemoteImageError
      ? error
      : new RemoteImageError("网络图片下载失败", "REMOTE_IMAGE_DOWNLOAD_FAILED", 502);
    return c.json({ error: failure.message, code: failure.code }, failure.status);
  }

  const db = getDb();
  const hash = crypto.createHash("sha256").update(downloaded.buffer).digest("hex");
  const dedupRow = db.prepare(
    workspaceId
      ? `SELECT id, path, mimeType, size, filename, hash FROM attachments
           WHERE userId = ? AND workspaceId = ? AND hash = ? LIMIT 1`
      : `SELECT id, path, mimeType, size, filename, hash FROM attachments
           WHERE userId = ? AND workspaceId IS NULL AND hash = ? LIMIT 1`,
  ).get(...(workspaceId ? [userId, workspaceId, hash] : [userId, hash])) as ExistingAttachmentForDedup | undefined;

  if (dedupRow) {
    try {
      const clone = createDeduplicatedAttachmentRow({
        source: dedupRow,
        noteId,
        userId,
        workspaceId,
        filename: downloaded.filename,
        hash,
        uploadSource,
      });
      enqueueAttachment({ attachmentId: clone.id, userId, workspaceId, noteId });
      return c.json({
        id: clone.id,
        url: clone.url,
        mimeType: clone.mimeType,
        size: clone.size,
        filename: clone.filename,
        category: "image",
        deduplicated: true,
        sourceUrl: remoteUrl,
        finalUrl: downloaded.finalUrl,
        accessUrls: createUserAttachmentAccessUrls(userId, [{ id: clone.id, noteId }]),
      }, 201);
    } catch (error) {
      return c.json({ error: `写入数据库失败：${(error as Error)?.message || error}` }, 500);
    }
  }

  const id = uuid();
  const ext = REMOTE_IMAGE_MIME_TO_EXT[downloaded.mimeType] || "img";
  const storagePath = `${getUploadMonthPath()}/${id}.${ext}`;
  try {
    await writeAttachmentObject(storagePath, downloaded.buffer, downloaded.mimeType);
  } catch (error) {
    return c.json({ error: `写入附件失败：${(error as Error)?.message || error}` }, 500);
  }

  try {
    db.prepare(
      `INSERT INTO attachments
       (id, noteId, userId, filename, mimeType, size, path, workspaceId, hash, uploadSource)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      noteId,
      userId,
      downloaded.filename,
      downloaded.mimeType,
      downloaded.buffer.byteLength,
      storagePath,
      workspaceId,
      hash,
      uploadSource,
    );
  } catch (error) {
    try { await deleteAttachmentObject(storagePath); } catch { /* best effort */ }
    return c.json({ error: `写入数据库失败：${(error as Error)?.message || error}` }, 500);
  }

  enqueueAttachment({ attachmentId: id, userId, workspaceId, noteId });
  return c.json({
    id,
    url: `/api/attachments/${id}`,
    mimeType: downloaded.mimeType,
    size: downloaded.buffer.byteLength,
    filename: downloaded.filename,
    category: "image",
    deduplicated: false,
    sourceUrl: remoteUrl,
    finalUrl: downloaded.finalUrl,
    accessUrls: createUserAttachmentAccessUrls(userId, [{ id, noteId }]),
  }, 201);
});

export default router;
''', encoding="utf-8")

replace_once(
    "backend/src/routes/attachments.ts",
    'import attachmentsCoreRouter, {\n  handleDownloadAttachment as handleFullAttachmentDownload,\n} from "./attachments-core";\n',
    'import attachmentsCoreRouter, {\n  handleDownloadAttachment as handleFullAttachmentDownload,\n} from "./attachments-core";\nimport remoteImageImportRouter from "./remote-image-import";\n',
    "remote image route import",
)
replace_once(
    "backend/src/routes/attachments.ts",
    'attachmentsRouter.route("/", attachmentsCoreRouter);\n',
    'attachmentsRouter.route("/", remoteImageImportRouter);\nattachmentsRouter.route("/", attachmentsCoreRouter);\n',
    "remote image route mount",
)

Path("backend/tests/remote-image-import-security.test.ts").write_text(r'''import assert from "node:assert/strict";
import test from "node:test";
import {
  isBlockedRemoteAddress,
  isBlockedRemoteHostname,
  sanitizeRemoteImageFilename,
  sniffRemoteImageMime,
} from "../src/lib/remote-image-security";

test("remote image SSRF guard blocks private and metadata targets", () => {
  for (const address of [
    "127.0.0.1", "10.0.0.8", "172.16.0.1", "192.168.1.8",
    "169.254.169.254", "100.64.0.1", "::1", "fc00::1", "fe80::1",
    "::ffff:192.168.1.8",
  ]) {
    assert.equal(isBlockedRemoteAddress(address), true, address);
  }
  assert.equal(isBlockedRemoteHostname("localhost"), true);
  assert.equal(isBlockedRemoteHostname("metadata.google.internal"), true);
  assert.equal(isBlockedRemoteHostname("printer.home"), true);
});

test("remote image SSRF guard permits ordinary public addresses", () => {
  assert.equal(isBlockedRemoteAddress("8.8.8.8"), false);
  assert.equal(isBlockedRemoteAddress("1.1.1.1"), false);
  assert.equal(isBlockedRemoteAddress("2606:4700:4700::1111"), false);
  assert.equal(isBlockedRemoteHostname("images.example.com"), false);
});

test("remote image type is determined from magic bytes", () => {
  assert.equal(sniffRemoteImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(sniffRemoteImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffRemoteImageMime(Buffer.from("GIF89a", "ascii")), "image/gif");
  assert.equal(sniffRemoteImageMime(Buffer.from("not an image", "utf8")), null);
  assert.equal(sniffRemoteImageMime(Buffer.from("<svg></svg>", "utf8")), null);
});

test("remote image filenames are path-safe and use the detected extension", () => {
  assert.equal(sanitizeRemoteImageFilename("../../evil.exe", "image/png"), "evil.png");
  assert.equal(sanitizeRemoteImageFilename("头像 2026.jpeg", "image/jpeg"), "头像 2026.jpg");
  assert.equal(sanitizeRemoteImageFilename("", "image/webp"), "remote-image.webp");
});
''', encoding="utf-8")


# ---------------------------------------------------------------------------
# Frontend: color analysis / normalization helper and tests.
# ---------------------------------------------------------------------------
Path("frontend/src/lib/pasteForegroundColor.ts").write_text(r'''export interface RgbColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface RiskyForegroundColorReport {
  total: number;
  dark: number;
  light: number;
  colors: string[];
}

const NAMED_COLORS: Readonly<Record<string, [number, number, number]>> = Object.freeze({
  black: [0, 0, 0], white: [255, 255, 255], silver: [192, 192, 192], gray: [128, 128, 128],
  grey: [128, 128, 128], maroon: [128, 0, 0], red: [255, 0, 0], purple: [128, 0, 128],
  fuchsia: [255, 0, 255], green: [0, 128, 0], lime: [0, 255, 0], olive: [128, 128, 0],
  yellow: [255, 255, 0], navy: [0, 0, 128], blue: [0, 0, 255], teal: [0, 128, 128],
  aqua: [0, 255, 255], orange: [255, 165, 0], transparent: [0, 0, 0],
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseAlpha(raw: string | undefined): number {
  if (!raw) return 1;
  const value = raw.trim();
  if (value.endsWith("%")) return clamp(Number.parseFloat(value) / 100, 0, 1);
  return clamp(Number.parseFloat(value), 0, 1);
}

function parseRgbChannel(raw: string): number {
  const value = raw.trim();
  if (value.endsWith("%")) return clamp(Math.round(Number.parseFloat(value) * 2.55), 0, 255);
  return clamp(Math.round(Number.parseFloat(value)), 0, 255);
}

function hueToRgb(p: number, q: number, t: number): number {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const h = ((hue % 360) + 360) % 360 / 360;
  const s = clamp(saturation, 0, 1);
  const l = clamp(lightness, 0, 1);
  if (s === 0) {
    const channel = Math.round(l * 255);
    return [channel, channel, channel];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
    Math.round(hueToRgb(p, q, h) * 255),
    Math.round(hueToRgb(p, q, h - 1 / 3) * 255),
  ];
}

export function parseCssForegroundColor(rawValue: string): RgbColor | null {
  const raw = String(rawValue || "").trim().toLowerCase();
  if (!raw || /^(?:inherit|initial|unset|revert|revert-layer|currentcolor)$/.test(raw)) return null;
  if (raw.includes("var(")) return null;
  if (raw === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  const named = NAMED_COLORS[raw];
  if (named) return { r: named[0], g: named[1], b: named[2], a: 1 };

  const hex = raw.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: Number.parseInt(hex[0] + hex[0], 16),
        g: Number.parseInt(hex[1] + hex[1], 16),
        b: Number.parseInt(hex[2] + hex[2], 16),
        a: hex.length === 4 ? Number.parseInt(hex[3] + hex[3], 16) / 255 : 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
  }

  const rgb = raw.match(/^rgba?\((.*)\)$/i)?.[1];
  if (rgb != null) {
    const [channelsRaw, slashAlpha] = rgb.split(/\s*\/\s*/, 2);
    const parts = channelsRaw.includes(",")
      ? channelsRaw.split(",").map((part) => part.trim())
      : channelsRaw.trim().split(/\s+/);
    const commaAlpha = parts.length === 4 ? parts.pop() : undefined;
    if (parts.length === 3 && parts.every((part) => Number.isFinite(Number.parseFloat(part)))) {
      return {
        r: parseRgbChannel(parts[0]),
        g: parseRgbChannel(parts[1]),
        b: parseRgbChannel(parts[2]),
        a: parseAlpha(slashAlpha || commaAlpha),
      };
    }
  }

  const hsl = raw.match(/^hsla?\((.*)\)$/i)?.[1];
  if (hsl != null) {
    const [channelsRaw, slashAlpha] = hsl.split(/\s*\/\s*/, 2);
    const parts = channelsRaw.includes(",")
      ? channelsRaw.split(",").map((part) => part.trim())
      : channelsRaw.trim().split(/\s+/);
    const commaAlpha = parts.length === 4 ? parts.pop() : undefined;
    if (parts.length === 3 && parts[1].endsWith("%") && parts[2].endsWith("%")) {
      const [r, g, b] = hslToRgb(
        Number.parseFloat(parts[0]),
        Number.parseFloat(parts[1]) / 100,
        Number.parseFloat(parts[2]) / 100,
      );
      return { r, g, b, a: parseAlpha(slashAlpha || commaAlpha) };
    }
  }

  return null;
}

/** Convert legacy <font color> into a span style before the paste sanitizer removes the tag. */
export function normalizeLegacyFontColors(html: string): string {
  if (!html || typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("font[color]").forEach((font) => {
    const span = doc.createElement("span");
    const color = font.getAttribute("color") || "";
    if (parseCssForegroundColor(color)) span.style.color = color;
    for (const child of Array.from(font.childNodes)) span.appendChild(child);
    font.replaceWith(span);
  });
  return doc.body.innerHTML;
}

export function analyzeRiskyForegroundColors(html: string): RiskyForegroundColorReport {
  const report: RiskyForegroundColorReport = { total: 0, dark: 0, light: 0, colors: [] };
  if (!html || typeof DOMParser === "undefined") return report;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const samples = new Set<string>();

  doc.body.querySelectorAll<HTMLElement>("[style]").forEach((element) => {
    const raw = element.style.getPropertyValue("color").trim();
    if (!raw) return;
    const parsed = parseCssForegroundColor(raw);
    if (!parsed || parsed.a <= 0.05) return;
    const average = (parsed.r + parsed.g + parsed.b) / 3;
    if (average < 50) {
      report.total += 1;
      report.dark += 1;
      samples.add(raw);
    } else if (average > 200) {
      report.total += 1;
      report.light += 1;
      samples.add(raw);
    }
  });

  doc.body.querySelectorAll("font[color]").forEach((element) => {
    const raw = element.getAttribute("color")?.trim() || "";
    const parsed = parseCssForegroundColor(raw);
    if (!parsed || parsed.a <= 0.05) return;
    const average = (parsed.r + parsed.g + parsed.b) / 3;
    if (average < 50) {
      report.total += 1;
      report.dark += 1;
      samples.add(raw);
    } else if (average > 200) {
      report.total += 1;
      report.light += 1;
      samples.add(raw);
    }
  });

  report.colors = Array.from(samples).slice(0, 8);
  return report;
}

/** Remove only explicit foreground colors; all other markup and inline styles are preserved. */
export function stripExplicitForegroundColors(html: string): string {
  if (!html || typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.body.querySelectorAll<HTMLElement>("[style]").forEach((element) => {
    if (!element.style.getPropertyValue("color")) return;
    element.style.removeProperty("color");
    if (!element.getAttribute("style")?.trim()) element.removeAttribute("style");
  });
  doc.body.querySelectorAll("font[color]").forEach((element) => element.removeAttribute("color"));
  return doc.body.innerHTML;
}
''', encoding="utf-8")

Path("frontend/src/lib/__tests__/pasteForegroundColor.test.ts").write_text(r'''import { describe, expect, it } from "vitest";
import {
  analyzeRiskyForegroundColors,
  normalizeLegacyFontColors,
  parseCssForegroundColor,
  stripExplicitForegroundColors,
} from "@/lib/pasteForegroundColor";

describe("paste foreground color risk detection", () => {
  it("detects explicit dark and light colors in common CSS formats", () => {
    const report = analyzeRiskyForegroundColors(`
      <p><span style="color: rgb(20, 20, 20)">dark</span></p>
      <p><span style="color: #f5f5f5">light</span></p>
      <p><span style="color: hsl(0 0% 100%)">white</span></p>
    `);
    expect(report).toMatchObject({ total: 3, dark: 1, light: 2 });
  });

  it("ignores inherited, theme-variable, transparent and middle-brightness colors", () => {
    const report = analyzeRiskyForegroundColors(`
      <span style="color: currentColor">a</span>
      <span style="color: var(--text-color)">b</span>
      <span style="color: transparent">c</span>
      <span style="color: rgb(120, 130, 140)">d</span>
      <span style="background-color: #fff">e</span>
    `);
    expect(report.total).toBe(0);
  });

  it("normalizes legacy font colors so the paste sanitizer can preserve them", () => {
    const normalized = normalizeLegacyFontColors('<font color="#ffffff"><b>Hello</b></font>');
    expect(normalized).toContain("<span");
    expect(normalized).toContain("color");
    expect(normalized).toContain("<b>Hello</b>");
  });

  it("removes only foreground colors and preserves other formatting", () => {
    const output = stripExplicitForegroundColors(
      '<p><a href="https://example.com"><strong style="color:#fff;font-weight:700;background:#000">Text</strong></a></p>',
    );
    expect(output).not.toMatch(/color\s*:/i);
    expect(output).toContain("font-weight: 700");
    expect(output).toContain("background: rgb(0, 0, 0)");
    expect(output).toContain('<a href="https://example.com">');
    expect(output).toContain("<strong");
  });

  it("parses alpha-aware CSS colors", () => {
    expect(parseCssForegroundColor("#00000000")?.a).toBe(0);
    expect(parseCssForegroundColor("rgb(255 255 255 / 50%)")).toMatchObject({ r: 255, g: 255, b: 255, a: 0.5 });
  });
});
''', encoding="utf-8")


# ---------------------------------------------------------------------------
# Frontend: reusable three-way choice dialog.
# ---------------------------------------------------------------------------
replace_once(
    "frontend/src/components/ui/confirm.tsx",
    '''export interface PromptOptions extends ConfirmOptions {
  /** 输入框初始值 */
  defaultValue?: string;
  /** 输入框 placeholder */
  placeholder?: string;
  /** 输入类型：text / password / email / number 等，默认 text */
  type?: React.HTMLInputTypeAttribute;
  /** 自定义验证：返回 string 则视为错误信息阻止提交，返回 null/undefined 视为通过 */
  validate?: (value: string) => string | null | undefined;
  /** 是否允许空值提交，默认 false（空值会被拒绝） */
  allowEmpty?: boolean;
}

type StackItem =''',
    '''export interface PromptOptions extends ConfirmOptions {
  /** 输入框初始值 */
  defaultValue?: string;
  /** 输入框 placeholder */
  placeholder?: string;
  /** 输入类型：text / password / email / number 等，默认 text */
  type?: React.HTMLInputTypeAttribute;
  /** 自定义验证：返回 string 则视为错误信息阻止提交，返回 null/undefined 视为通过 */
  validate?: (value: string) => string | null | undefined;
  /** 是否允许空值提交，默认 false（空值会被拒绝） */
  allowEmpty?: boolean;
}

export interface ChoiceOption {
  value: string;
  label: string;
  variant?: "default" | "outline" | "destructive";
}

export interface ChoiceOptions extends Omit<ConfirmOptions, "confirmText"> {
  choices: ChoiceOption[];
}

type StackItem =''',
    "choice option interfaces",
)
replace_once(
    "frontend/src/components/ui/confirm.tsx",
    '''    | {
        kind: "prompt";
        id: number;
        options: PromptOptions;
        resolve: (value: string | null) => void;
      };
''',
    '''    | {
        kind: "prompt";
        id: number;
        options: PromptOptions;
        resolve: (value: string | null) => void;
      }
    | {
        kind: "choice";
        id: number;
        options: ChoiceOptions;
        resolve: (value: string | null) => void;
      };
''',
    "choice stack item",
)
replace_once(
    "frontend/src/components/ui/confirm.tsx",
    '''export function useConfirm() {
  return confirm;
}
export function usePrompt() {
  return prompt;
}
''',
    '''export function choose(options: ChoiceOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const item: Omit<StackItem, "id"> = { kind: "choice", options, resolve };
    if (dispatcher) {
      dispatcher.push(item);
      return;
    }
    let bound = false;
    const bind = (_id: number) => { bound = true; };
    pending.push({ item, bind });
    setTimeout(() => {
      if (!bound && !dispatcher) {
        const idx = pending.findIndex((entry) => entry.item === item);
        if (idx >= 0) pending.splice(idx, 1);
        const fallback = window.confirm(
          [options.title, typeof options.description === "string" ? options.description : ""]
            .filter(Boolean)
            .join("\n\n"),
        );
        resolve(fallback ? options.choices[0]?.value ?? null : null);
      }
    }, 100);
  });
}

export function useConfirm() {
  return confirm;
}
export function usePrompt() {
  return prompt;
}
export function useChoice() {
  return choose;
}
''',
    "choice command API",
)
replace_once(
    "frontend/src/components/ui/confirm.tsx",
    '''  const isPrompt = item.kind === "prompt";
  const promptOpts = isPrompt ? (item.options as PromptOptions) : null;
  const [value, setValue] = React.useState(promptOpts?.defaultValue ?? "");
''',
    '''  const isPrompt = item.kind === "prompt";
  const isChoice = item.kind === "choice";
  const promptOpts = isPrompt ? (item.options as PromptOptions) : null;
  const choiceOpts = isChoice ? (item.options as ChoiceOptions) : null;
  const [value, setValue] = React.useState(promptOpts?.defaultValue ?? "");
''',
    "choice dialog mode",
)
replace_once(
    "frontend/src/components/ui/confirm.tsx",
    '''      if (isPrompt) inputRef.current?.focus();
      else if (danger) cancelBtnRef.current?.focus();
      else confirmBtnRef.current?.focus();
''',
    '''      if (isPrompt) inputRef.current?.focus();
      else if (isChoice || danger) cancelBtnRef.current?.focus();
      else confirmBtnRef.current?.focus();
''',
    "choice focus behavior",
)
replace_once(
    "frontend/src/components/ui/confirm.tsx",
    '''          if (e.key === "Enter" && (isPrompt || !danger)) {
''',
    '''          if (e.key === "Enter" && !isChoice && (isPrompt || !danger)) {
''',
    "choice enter behavior",
)
replace_once(
    "frontend/src/components/ui/confirm.tsx",
    '''        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-app-bg/40 border-t border-app-border">
          <Button
            ref={cancelBtnRef}
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
          >
            {cancelText || "取消"}
          </Button>
          <Button
            ref={confirmBtnRef}
            type="button"
            size="sm"
            variant={danger ? "destructive" : "default"}
            onClick={submit}
            className={cn(
              danger &&
                "bg-red-500 hover:bg-red-500/90 text-white border-transparent",
            )}
          >
            {confirmText || "确定"}
          </Button>
        </div>
''',
    '''        <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-3 bg-app-bg/40 border-t border-app-border">
          <Button
            ref={cancelBtnRef}
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
          >
            {cancelText || "取消"}
          </Button>
          {isChoice ? (
            choiceOpts!.choices.map((choice) => (
              <Button
                key={choice.value}
                type="button"
                size="sm"
                variant={choice.variant || "default"}
                onClick={() => onConfirm(choice.value)}
              >
                {choice.label}
              </Button>
            ))
          ) : (
            <Button
              ref={confirmBtnRef}
              type="button"
              size="sm"
              variant={danger ? "destructive" : "default"}
              onClick={submit}
              className={cn(
                danger &&
                  "bg-red-500 hover:bg-red-500/90 text-white border-transparent",
              )}
            >
              {confirmText || "确定"}
            </Button>
          )}
        </div>
''',
    "choice footer",
)


# ---------------------------------------------------------------------------
# Frontend API: return/register signed URLs for remote imports.
# ---------------------------------------------------------------------------
replace_once(
    "frontend/src/lib/api.impl.ts",
    '''    /** 远程图片本地化：下载远程图片并上传为本地附件（PASTE-REMOTE-IMAGE-LOCALIZE-01） */
    importRemoteImage: (
      noteId: string,
      url: string,
      source?: string,
    ): Promise<{ url: string; deduplicated?: boolean }> =>
      request<{ url: string; deduplicated?: boolean }>("/attachments/import-remote-image", {
        method: "POST",
        body: JSON.stringify({ noteId, url, source }),
      }),
''',
    '''    /** 远程图片本地化：服务端安全下载并保存为当前笔记的附件。 */
    importRemoteImage: (
      noteId: string,
      url: string,
      source?: string,
    ): Promise<{
      id: string;
      url: string;
      mimeType: string;
      size: number;
      filename: string;
      category: "image";
      deduplicated?: boolean;
      accessUrls?: Record<string, string>;
    }> =>
      request<{
        id: string;
        url: string;
        mimeType: string;
        size: number;
        filename: string;
        category: "image";
        deduplicated?: boolean;
        accessUrls?: Record<string, string>;
      }>("/attachments/import-remote-image", {
        method: "POST",
        body: JSON.stringify({ noteId, url, source }),
      }).then((payload) => {
        registerAttachmentAccessResponse(payload);
        return payload;
      }),
''',
    "remote image API response",
)


# ---------------------------------------------------------------------------
# Tiptap integration: imports, state, one-click action, color warning paste flow.
# ---------------------------------------------------------------------------
replace_once(
    "frontend/src/components/TiptapEditor.tsx",
    'import { prompt as promptDialog } from "@/components/ui/confirm";\n',
    'import { choose as chooseDialog, prompt as promptDialog } from "@/components/ui/confirm";\n',
    "choice dialog import",
)
replace_once(
    "frontend/src/components/TiptapEditor.tsx",
    'import { replaceDataUrlImagesWithAttachments } from "@/lib/rtfImageUploader";\n',
    'import { replaceDataUrlImagesWithAttachments } from "@/lib/rtfImageUploader";\nimport { shouldLocalizeUrl } from "@/lib/remoteImageLocalizer";\nimport {\n  analyzeRiskyForegroundColors,\n  normalizeLegacyFontColors,\n  stripExplicitForegroundColors,\n} from "@/lib/pasteForegroundColor";\n',
    "paste color and remote image imports",
)
replace_once(
    "frontend/src/components/TiptapEditor.tsx",
    '  const [replacingImage, setReplacingImage] = useState(false);\n',
    '  const [replacingImage, setReplacingImage] = useState(false);\n  const [localizingSelectedImage, setLocalizingSelectedImage] = useState(false);\n',
    "remote image action state",
)
replace_once(
    "frontend/src/components/TiptapEditor.tsx",
    '''          const text = event.clipboardData?.getData("text/plain") || "";
          // SEC-XSS-01-D: 剪贴板 HTML 进入任何处理路径前先清洗
          const html = sanitizeForPaste(event.clipboardData?.getData("text/html") || "");
''',
    '''          const text = event.clipboardData?.getData("text/plain") || "";
          // 先把旧式 <font color> 转为 span style，再进入统一 XSS 清洗。
          // 这样既能检测固定前景色，也能在用户选择“保留原颜色”时继续由 TextStyleKit 承载。
          const rawHtml = event.clipboardData?.getData("text/html") || "";
          const html = sanitizeForPaste(normalizeLegacyFontColors(rawHtml));
''',
    "paste raw HTML normalization",
)

new_html_branch = r'''          // 5) 只有 HTML 没有多行纯文本（如从网页复制的富文本片段）：解析插入
          //    先归一化：把 <div>/<br> 伪多行段落拆成真正的多个 <p>，
          //    避免后续块级操作（toggleHeading 等）误把整段转换。
          if (html && html.trim().length > 0) {
            console.log("[paste-diag] PATH=html (normalize + parseSlice)");

            // 5a) Word / WPS 粘贴：先从 RTF 回填浏览器无法访问的 file:// 图片。
            let htmlForParse = html;
            try {
              const rtf = event.clipboardData?.getData("text/rtf") || "";
              if (rtf.length > 0 && /\\(pngblip|jpegblip)/.test(rtf)) {
                const rtfImages = extractImagesFromRtf(rtf);
                if (rtfImages.length > 0) {
                  htmlForParse = mergeRtfImagesIntoHtml(html, rtfImages);
                  console.log("[paste-diag] RTF images extracted=", rtfImages.length);
                }
              }
            } catch (err) {
              console.warn("[paste-diag] RTF image extraction failed:", err);
            }

            const insertPreparedHtml = (preparedHtml: string) => {
              if (view.isDestroyed) return;
              const parser = ProseMirrorDOMParser.fromSchema(view.state.schema);
              const tempDiv = document.createElement("div");
              const normalized = normalizePastedHtmlForBlocks(preparedHtml);
              tempDiv.innerHTML = normalized.html;
              try {
                const rawImgs = (preparedHtml.match(/<img[^>]*>/gi) || []).length;
                const normalizedImgs = tempDiv.querySelectorAll("img").length;
                const firstSrc = tempDiv.querySelector("img")?.getAttribute("src") || "";
                console.log("[paste-diag] raw html <img>=", rawImgs,
                  " normalized <img>=", normalizedImgs,
                  " isWord=", normalized.isWordSource,
                  " stats=", normalized.imageStats,
                  " firstSrcHead=", firstSrc.slice(0, 80));
              } catch {}
              const slice = parser.parseSlice(tempDiv);
              try {
                let imgCountInSlice = 0;
                slice.content.descendants((node) => {
                  if (node.type.name === "image") imgCountInSlice += 1;
                });
                console.log("[paste-diag] PM slice image nodes=", imgCountInSlice);
              } catch {}
              view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
              if (normalized.imageStats.failed > 0) {
                const msgKey = normalized.isWordSource
                  ? "tiptap.wordImagesNotPastable"
                  : "tiptap.imagesNotLoaded";
                showPasteToast("error", t(msgKey, { count: normalized.imageStats.failed }), 6000);
              }
            };

            const colorRisk = analyzeRiskyForegroundColors(htmlForParse);
            if (colorRisk.total > 0) {
              const pasteAnchor = captureAsyncInsertAnchor(view);
              asyncInsertAnchorsRef.current.add(pasteAnchor);
              void chooseDialog({
                title: t("tiptap.pasteColorRiskTitle", { defaultValue: "检测到可能影响主题阅读的文字颜色" }),
                description: t("tiptap.pasteColorRiskDescription", {
                  defaultValue: "粘贴内容中有 {{count}} 处固定文字颜色（偏黑 {{dark}} 处、偏白 {{light}} 处）。切换深色或浅色主题后，这些文字可能与背景融为一体。",
                  count: colorRisk.total,
                  dark: colorRisk.dark,
                  light: colorRisk.light,
                }),
                cancelText: t("common.cancel"),
                choices: [
                  {
                    value: "keep",
                    label: t("tiptap.pasteColorKeepAndPaste", { defaultValue: "保留原颜色并粘贴" }),
                    variant: "outline",
                  },
                  {
                    value: "strip",
                    label: t("tiptap.pasteColorRemoveAndPaste", { defaultValue: "移除文字颜色并粘贴" }),
                    variant: "default",
                  },
                ],
              }).then((choice) => {
                if (!choice || view.isDestroyed) return;
                if (!restoreAsyncInsertAnchor(view, pasteAnchor)) return;
                insertPreparedHtml(choice === "strip"
                  ? stripExplicitForegroundColors(htmlForParse)
                  : htmlForParse);
              }).finally(() => {
                releaseAsyncInsertAnchor(asyncInsertAnchorsRef.current, pasteAnchor);
              });
              return true;
            }

            insertPreparedHtml(htmlForParse);
            return true;
          }

'''
replace_between(
    "frontend/src/components/TiptapEditor.tsx",
    '          // 5) 只有 HTML 没有多行纯文本（如从网页复制的富文本片段）：解析插入\n',
    '          // 6) 单行纯文本或其他：直接插入\n',
    new_html_branch,
    "HTML paste color warning branch",
)

replace_once(
    "frontend/src/components/TiptapEditor.tsx",
    '''  const handleCopySelectedImageSrc = useCallback(async () => {
''',
    '''  const handleLocalizeSelectedImage = useCallback(async () => {
    if (!editor || localizingSelectedImage) return;
    const currentNote = noteRef.current;
    if (!currentNote?.id) {
      toast.error(t("tiptap.imageLocalizeFailed", { defaultValue: "网络图片转存失败" }));
      return;
    }
    const selection = editor.state.selection;
    if (!(selection instanceof NodeSelection) || selection.node.type.name !== "image") return;
    const originalSrc = String(selection.node.attrs.src || "").trim();
    if (!shouldLocalizeUrl(originalSrc)) return;
    const preferredPos = selection.from;

    setLocalizingSelectedImage(true);
    toast.info(t("tiptap.imageLocalizing", { defaultValue: "正在转存网络图片..." }));
    try {
      const result = await api.attachments.importRemoteImage(currentNote.id, originalSrc, "image-action");
      if (editor.isDestroyed) return;

      let targetPos: number | null = null;
      const preferredNode = editor.state.doc.nodeAt(preferredPos);
      if (isImageReplaceTargetNode(preferredNode) && String(preferredNode.attrs.src || "") === originalSrc) {
        targetPos = preferredPos;
      } else {
        const matches: number[] = [];
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "image" && String(node.attrs.src || "") === originalSrc) matches.push(pos);
        });
        if (matches.length === 1) targetPos = matches[0];
      }

      if (targetPos == null) {
        toast.error(t("tiptap.imageLocalizeTargetChanged", { defaultValue: "原图片位置已变化，请重新选择后转存" }));
        return;
      }
      const targetNode = editor.state.doc.nodeAt(targetPos);
      if (!isImageReplaceTargetNode(targetNode)) return;
      let transaction = editor.state.tr.setNodeMarkup(targetPos, undefined, {
        ...targetNode.attrs,
        src: result.url,
      });
      try {
        transaction = transaction.setSelection(NodeSelection.create(transaction.doc, targetPos));
      } catch { /* keep the current selection */ }
      editor.view.dispatch(transaction.scrollIntoView());
      toast.success(t("tiptap.imageLocalizeSuccess", { defaultValue: "网络图片已转存为本地附件" }));
    } catch (error) {
      console.error("Localize selected image failed:", error);
      const detail = (error as Error)?.message || "";
      toast.error(detail || t("tiptap.imageLocalizeFailed", { defaultValue: "网络图片转存失败" }));
    } finally {
      setLocalizingSelectedImage(false);
    }
  }, [editor, localizingSelectedImage, t]);

  const selectedImageCanLocalize = (() => {
    if (!editor) return false;
    const selection = editor.state.selection;
    return selection instanceof NodeSelection
      && selection.node.type.name === "image"
      && shouldLocalizeUrl(String(selection.node.attrs.src || ""));
  })();

  const handleCopySelectedImageSrc = useCallback(async () => {
''',
    "selected image localize handler",
)
replace_once(
    "frontend/src/components/TiptapEditor.tsx",
    '''          <ToolbarButton title={t("tiptap.imageDownload")} onClick={() => { void handleDownloadSelectedImage(); }}>
            <Download size={14} />
          </ToolbarButton>
          <ToolbarButton
            title={t("tiptap.imageReplace")}
''',
    '''          <ToolbarButton title={t("tiptap.imageDownload")} onClick={() => { void handleDownloadSelectedImage(); }}>
            <Download size={14} />
          </ToolbarButton>
          {selectedImageCanLocalize && (
            <ToolbarButton
              title={t("tiptap.imageLocalize", { defaultValue: "转存为附件" })}
              disabled={localizingSelectedImage}
              onClick={() => { void handleLocalizeSelectedImage(); }}
            >
              <Paperclip size={14} />
            </ToolbarButton>
          )}
          <ToolbarButton
            title={t("tiptap.imageReplace")}
''',
    "desktop image localize action",
)
replace_once(
    "frontend/src/components/TiptapEditor.tsx",
    '''            {[
              { key: "view", label: t("tiptap.imageViewLarge"), icon: ExternalLink, action: handlePreviewSelectedImage },
              { key: "download", label: t("tiptap.imageDownload"), icon: Download, action: () => { void handleDownloadSelectedImage(); } },
              { key: "replace", label: t("tiptap.imageReplace"), icon: Upload, action: handleReplaceSelectedImage, disabled: replacingImage },
''',
    '''            {[
              { key: "view", label: t("tiptap.imageViewLarge"), icon: ExternalLink, action: handlePreviewSelectedImage },
              { key: "download", label: t("tiptap.imageDownload"), icon: Download, action: () => { void handleDownloadSelectedImage(); } },
              ...(selectedImageCanLocalize ? [{
                key: "localize",
                label: t("tiptap.imageLocalize", { defaultValue: "转存为附件" }),
                icon: Paperclip,
                action: () => { void handleLocalizeSelectedImage(); },
                disabled: localizingSelectedImage,
              }] : []),
              { key: "replace", label: t("tiptap.imageReplace"), icon: Upload, action: handleReplaceSelectedImage, disabled: replacingImage },
''',
    "mobile image localize action",
)


# ---------------------------------------------------------------------------
# i18n strings.
# ---------------------------------------------------------------------------
replace_once(
    "frontend/src/i18n/locales/zh-CN.json",
    '''    "imageDownloadFailed": "图片下载失败",
    "imageReplace": "替换图片",
''',
    '''    "imageDownloadFailed": "图片下载失败",
    "imageLocalize": "转存为附件",
    "imageLocalizing": "正在转存网络图片...",
    "imageLocalizeSuccess": "网络图片已转存为本地附件",
    "imageLocalizeFailed": "网络图片转存失败",
    "imageLocalizeTargetChanged": "原图片位置已变化，请重新选择后转存",
    "pasteColorRiskTitle": "检测到可能影响主题阅读的文字颜色",
    "pasteColorRiskDescription": "粘贴内容中有 {{count}} 处固定文字颜色（偏黑 {{dark}} 处、偏白 {{light}} 处）。切换深色或浅色主题后，这些文字可能与背景融为一体。",
    "pasteColorRemoveAndPaste": "移除文字颜色并粘贴",
    "pasteColorKeepAndPaste": "保留原颜色并粘贴",
    "imageReplace": "替换图片",
''',
    "Chinese issue 302 strings",
)
replace_once(
    "frontend/src/i18n/locales/en.json",
    '''    "imageDownloadFailed": "Image download failed",
    "imageReplace": "Replace image",
''',
    '''    "imageDownloadFailed": "Image download failed",
    "imageLocalize": "Save as attachment",
    "imageLocalizing": "Saving remote image...",
    "imageLocalizeSuccess": "Remote image saved as a local attachment",
    "imageLocalizeFailed": "Failed to save remote image",
    "imageLocalizeTargetChanged": "The original image position changed. Select it again to save it.",
    "pasteColorRiskTitle": "Text colors may become unreadable after switching themes",
    "pasteColorRiskDescription": "The pasted content contains {{count}} fixed foreground color(s): {{dark}} very dark and {{light}} very light. They may blend into the background in dark or light mode.",
    "pasteColorRemoveAndPaste": "Remove text colors and paste",
    "pasteColorKeepAndPaste": "Keep original colors and paste",
    "imageReplace": "Replace image",
''',
    "English issue 302 strings",
)

print("issue 302 patch applied")

/**
 * 附件签名 URL 工具（SEC-ATTACHMENT-01）
 *
 * 签名 URL 格式：/api/attachments/:id?exp=<timestamp>&sig=<hmac>&scope=<id>
 * 签名内容：HMAC-SHA256(secret, attachmentId + exp + scope)
 */
import crypto from "crypto";

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 分钟
const MAX_TTL_MS = 60 * 60 * 1000;     // 1 小时

function getSigningSecret(): string {
  const explicit = process.env.ATTACHMENT_SIGNING_SECRET;
  if (explicit && explicit.length >= 16) return explicit;
  const jwtSecret = process.env.JWT_SECRET || "nowen-note-secret-key-change-in-production";
  return crypto.createHmac("sha256", jwtSecret).update("attachment-signing-v1").digest("hex");
}

export function createAttachmentSignedParams(
  attachmentId: string,
  scope: string,
  ttlMs: number = DEFAULT_TTL_MS,
): { exp: string; sig: string; scope: string } {
  const clampedTtl = Math.min(ttlMs, MAX_TTL_MS);
  const exp = Math.floor((Date.now() + clampedTtl) / 1000).toString();
  const secret = getSigningSecret();
  const payload = `${attachmentId}:${exp}:${scope}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return { exp, sig, scope };
}

export function createAttachmentSignedUrl(
  baseUrl: string,
  attachmentId: string,
  scope: string,
  ttlMs: number = DEFAULT_TTL_MS,
): string {
  const params = createAttachmentSignedParams(attachmentId, scope, ttlMs);
  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}?exp=${params.exp}&sig=${params.sig}&scope=${encodeURIComponent(params.scope)}`;
}

export function verifyAttachmentSignature(
  attachmentId: string,
  exp: string,
  sig: string,
  scope: string,
): { valid: boolean; reason?: string } {
  if (!attachmentId || !exp || !sig || !scope) return { valid: false, reason: "missing_params" };
  const expTimestamp = parseInt(exp, 10);
  if (isNaN(expTimestamp)) return { valid: false, reason: "invalid_exp" };
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (expTimestamp < nowSeconds) return { valid: false, reason: "expired" };
  if (expTimestamp - nowSeconds > 3600) return { valid: false, reason: "exp_too_long" };
  const secret = getSigningSecret();
  const payload = `${attachmentId}:${exp}:${scope}`;
  const expectedSig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expectedSig, "hex"))) {
      return { valid: false, reason: "invalid_sig" };
    }
  } catch {
    return { valid: false, reason: "invalid_sig_format" };
  }
  return { valid: true };
}

export function isLegacyPublicUrlEnabled(): boolean {
  const val = process.env.ATTACHMENT_LEGACY_PUBLIC_URL;
  if (val === undefined || val === "") return true;
  return val !== "false" && val !== "0";
}

export const SIGNATURE_DEFAULT_TTL_MS = DEFAULT_TTL_MS;
export const SIGNATURE_MAX_TTL_MS = MAX_TTL_MS;

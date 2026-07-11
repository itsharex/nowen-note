import type { Context } from "hono";
import { Hono } from "hono";
import attachmentsCoreRouter, {
  handleDownloadAttachment as handleFullAttachmentDownload,
} from "./attachments-core";
import { handleAttachmentMediaRange } from "./attachment-media-range";
import { getDb } from "../db/schema";
import { inferVideoMime } from "../lib/media-mime";

export * from "./attachments-core";
export { inferVideoMime } from "../lib/media-mime";

/**
 * Some Android document providers return an empty MIME even for an MP4. The core upload route is
 * intentionally format-agnostic and stores application/octet-stream in that case. Normalize only
 * known video extensions after a successful upload so playback and Range handling receive the
 * correct Content-Type without weakening executable-file checks.
 */
const attachmentsRouter = new Hono();
attachmentsRouter.use("*", async (c, next) => {
  await next();
  if (c.req.method !== "POST" || c.res.status !== 201) return;

  let payload: Record<string, unknown>;
  try {
    payload = await c.res.clone().json() as Record<string, unknown>;
  } catch {
    return;
  }

  const currentMime = String(payload.mimeType || "").toLowerCase();
  if (currentMime && currentMime !== "application/octet-stream") return;
  const inferred = inferVideoMime(String(payload.filename || ""));
  const id = String(payload.id || "");
  if (!inferred || !id) return;

  try {
    getDb()
      .prepare(
        "UPDATE attachments SET mimeType = ? WHERE id = ? AND (mimeType IS NULL OR mimeType = '' OR mimeType = 'application/octet-stream')",
      )
      .run(inferred, id);
  } catch {
    return;
  }

  const headers = new Headers(c.res.headers);
  headers.set("Content-Type", "application/json; charset=UTF-8");
  c.res = new Response(JSON.stringify({ ...payload, mimeType: inferred }), {
    status: c.res.status,
    statusText: c.res.statusText,
    headers,
  });
});
attachmentsRouter.route("/", attachmentsCoreRouter);

export default attachmentsRouter;

/**
 * Preserve the canonical attachment handler while allowing seekable media to answer byte-range
 * requests first. Keeping this wrapper at the original module path means index.ts, tests and every
 * existing importer automatically receive Range support without duplicating route registration.
 */
export async function handleDownloadAttachment(c: Context): Promise<Response> {
  let delegated = false;
  const rangeResponse = await handleAttachmentMediaRange(c, async () => {
    delegated = true;
  });
  if (!delegated && rangeResponse instanceof Response) return rangeResponse;
  return handleFullAttachmentDownload(c);
}

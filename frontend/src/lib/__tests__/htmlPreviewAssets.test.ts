import { describe, expect, it } from "vitest";
import { resolveHtmlPreviewAssetUrls } from "@/lib/htmlPreviewAssets";

describe("htmlPreviewAssets", () => {
  it("resolves local attachment image urls before rendering HTML preview", () => {
    const html = [
      '<p><img src="/api/attachments/local-image" alt="local"></p>',
      '<p><img src="https://mmbiz.qpic.cn/remote.jpg" alt="remote"></p>',
      '<p><img src="data:image/png;base64,abc" alt="data"></p>',
    ].join("");

    const result = resolveHtmlPreviewAssetUrls(
      html,
      (src) => (src.startsWith("/api/attachments/") ? `http://127.0.0.1:3000${src}` : src),
    );

    expect(result).toContain('src="http://127.0.0.1:3000/api/attachments/local-image"');
    expect(result).toContain('src="https://mmbiz.qpic.cn/remote.jpg"');
    expect(result).toContain('src="data:image/png;base64,abc"');
  });
});

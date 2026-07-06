type AssetUrlResolver = (src: string) => string;

export function resolveHtmlPreviewAssetUrls(
  html: string | null | undefined,
  resolveUrl: AssetUrlResolver,
  options: { fullDocument?: boolean } = {},
): string {
  if (!html || typeof DOMParser === "undefined") return html || "";

  const doc = new DOMParser().parseFromString(html, "text/html");

  doc.querySelectorAll<HTMLImageElement>("img[src]").forEach((img) => {
    const src = img.getAttribute("src");
    if (!src) return;
    img.setAttribute("src", resolveUrl(src));
  });

  if (options.fullDocument) {
    const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : "";
    return `${doctype}${doc.documentElement.outerHTML}`;
  }

  return doc.body.innerHTML;
}

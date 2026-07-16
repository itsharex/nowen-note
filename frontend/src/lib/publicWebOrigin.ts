export function normalizePublicWebOrigin(value: string | null | undefined): string {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin + url.pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/** Public SPA origin is independent from the API server origin. */
export function getPublicWebOrigin(): string {
  const configured = normalizePublicWebOrigin(
    import.meta.env.VITE_PUBLIC_WEB_ORIGIN || import.meta.env.VITE_APP_PUBLIC_URL,
  );
  if (configured) return configured;
  if (typeof window !== "undefined") {
    const current = normalizePublicWebOrigin(window.location.origin);
    if (current) return current;
  }
  return "";
}

export function buildPublicWebUrl(pathname: string): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const origin = getPublicWebOrigin();
  return origin ? `${origin}${path}` : path;
}

export const SIDEBAR_SEARCH_CHANGE_EVENT = "nowen:sidebar-search-change";
export const SIDEBAR_SEARCH_SYNC_EVENT = "nowen:sidebar-search-sync";
export const SIDEBAR_SEARCH_PENDING_EVENT = "nowen:sidebar-search-pending";

export interface SidebarSearchEventDetail {
  value: string;
}

export interface SidebarSearchPendingEventDetail {
  pending: boolean;
}

let currentSidebarSearchValue = "";
let currentSidebarSearchPending = false;

const SIDEBAR_SEARCH_SPINNER_STYLE_ID = "nowen-sidebar-search-spinner-style";

/**
 * The sidebar spinner is absolutely centered with translateY(-50%). Tailwind's animate-spin also
 * animates the transform property, so placing both utilities on the same SVG can leave the glyph
 * visually static in some generated CSS orders. Keep translation and rotation in one dedicated
 * keyframe so neither transform overwrites the other.
 */
function ensureSidebarSearchSpinnerStyle(): void {
  if (typeof document === "undefined" || document.getElementById(SIDEBAR_SEARCH_SPINNER_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = SIDEBAR_SEARCH_SPINNER_STYLE_ID;
  style.textContent = `
@keyframes nowen-sidebar-search-spin {
  from { transform: translateY(-50%) rotate(0deg); }
  to { transform: translateY(-50%) rotate(360deg); }
}

[data-sidebar-search-loading] {
  animation: nowen-sidebar-search-spin 0.8s linear infinite !important;
  transform-origin: center;
  will-change: transform;
}
`;
  document.head.appendChild(style);
}

export function getCurrentSidebarSearchValue(): string {
  return currentSidebarSearchValue;
}

export function getCurrentSidebarSearchPending(): boolean {
  return currentSidebarSearchPending;
}

export function normalizeSidebarSearchValue(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  const value = (detail as Partial<SidebarSearchEventDetail>).value;
  return typeof value === "string" ? value : null;
}

export function normalizeSidebarSearchPending(detail: unknown): boolean | null {
  if (!detail || typeof detail !== "object") return null;
  const pending = (detail as Partial<SidebarSearchPendingEventDetail>).pending;
  return typeof pending === "boolean" ? pending : null;
}

export function emitSidebarSearchChange(value: string): void {
  currentSidebarSearchValue = value;
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SidebarSearchEventDetail>(SIDEBAR_SEARCH_CHANGE_EVENT, {
    detail: { value },
  }));
}

export function emitSidebarSearchSync(value: string): void {
  currentSidebarSearchValue = value;
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SidebarSearchEventDetail>(SIDEBAR_SEARCH_SYNC_EVENT, {
    detail: { value },
  }));
}

export function emitSidebarSearchPending(pending: boolean): void {
  currentSidebarSearchPending = pending;
  if (pending) ensureSidebarSearchSpinnerStyle();
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SidebarSearchPendingEventDetail>(SIDEBAR_SEARCH_PENDING_EVENT, {
    detail: { pending },
  }));
}

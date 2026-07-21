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
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SidebarSearchPendingEventDetail>(SIDEBAR_SEARCH_PENDING_EVENT, {
    detail: { pending },
  }));
}

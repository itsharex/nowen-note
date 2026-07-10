import {
  getAllNotebooks,
  getAllNotes,
  getAllTags,
  getNote as localGetNote,
  isReady as localStoreReady,
} from "@/lib/localStore";
import type { Note, NoteListItem, Notebook, Tag } from "@/types";

export interface OfflineNoteSnapshot {
  noteId: string;
  version: number;
  updatedAt?: string;
  capturedAt: number;
  /** Fingerprint of the cached base body, not of later editor changes. */
  contentFingerprint?: string;
}

export const OFFLINE_NOTE_SNAPSHOT_EVENT = "nowen:offline-note-snapshot";

let offlineHit = false;
const offlineListeners = new Set<(value: boolean) => void>();
const offlineNoteSnapshots = new Map<string, OfflineNoteSnapshot>();

export function fingerprintNoteContent(content: unknown): string | undefined {
  if (typeof content !== "string") return undefined;
  // FNV-1a over UTF-16 code units. This is not a security hash; it is a compact stale-base
  // detector combined with length and version checks.
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${content.length}:${hash.toString(16).padStart(8, "0")}`;
}

function setOffline(value: boolean): void {
  if (offlineHit === value) return;
  offlineHit = value;
  offlineListeners.forEach((listener) => {
    try { listener(value); } catch { /* listener isolation */ }
  });
}

export function markOfflineNoteSnapshot(
  note: Pick<Note, "id" | "version"> & { updatedAt?: string; content?: string },
): void {
  const snapshot: OfflineNoteSnapshot = {
    noteId: note.id,
    version: Number.isFinite(note.version) ? note.version : 0,
    updatedAt: note.updatedAt,
    capturedAt: Date.now(),
    contentFingerprint: fingerprintNoteContent(note.content),
  };
  offlineNoteSnapshots.set(note.id, snapshot);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(OFFLINE_NOTE_SNAPSHOT_EVENT, { detail: snapshot }));
  }
}

export function clearOfflineNoteSnapshot(noteId: string): void {
  offlineNoteSnapshots.delete(noteId);
}

export function getOfflineNoteSnapshot(noteId: string): OfflineNoteSnapshot | null {
  return offlineNoteSnapshots.get(noteId) || null;
}

export function isOfflineNoteSnapshot(noteId: string): boolean {
  return offlineNoteSnapshots.has(noteId);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => setOffline(false));
}

export function isCurrentlyOffline(): boolean {
  return offlineHit || (typeof navigator !== "undefined" && !navigator.onLine);
}

export function subscribeOfflineState(listener: (value: boolean) => void): () => void {
  offlineListeners.add(listener);
  return () => { offlineListeners.delete(listener); };
}

interface FallbackHooks<T> {
  onOnline?: (value: T) => void;
  onFallback?: (value: T) => void;
}

async function withFallback<T>(
  online: () => Promise<T>,
  fallback: () => Promise<T>,
  hooks: FallbackHooks<T> = {},
): Promise<T> {
  if (typeof navigator !== "undefined" && !navigator.onLine && localStoreReady()) {
    setOffline(true);
    const value = await fallback();
    hooks.onFallback?.(value);
    return value;
  }

  try {
    const value = await online();
    setOffline(false);
    hooks.onOnline?.(value);
    return value;
  } catch (error: any) {
    const status = error?.status as number | undefined;
    if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
      throw error;
    }
    if (!localStoreReady()) throw error;
    setOffline(true);
    const value = await fallback();
    hooks.onFallback?.(value);
    return value;
  }
}

export function readNotebooks(online: () => Promise<Notebook[]>): Promise<Notebook[]> {
  return withFallback(online, () => getAllNotebooks());
}

export function readNotesList(
  online: () => Promise<NoteListItem[]>,
  filter?: (note: Note) => boolean,
): Promise<NoteListItem[]> {
  return withFallback(online, async () => {
    const all = await getAllNotes();
    const matched = filter ? all.filter(filter) : all;
    matched.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return matched.map(({ content, ...rest }) => rest as unknown as NoteListItem);
  });
}

export function readTags(online: () => Promise<Tag[]>): Promise<Tag[]> {
  return withFallback(online, () => getAllTags());
}

export function readNote(id: string, online: () => Promise<Note>): Promise<Note> {
  return withFallback(
    online,
    async () => {
      const note = await localGetNote(id);
      if (!note) throw new Error("笔记不在本地缓存中");
      if (typeof note.content !== "string") {
        throw new Error("该笔记的正文未缓存，离线时无法打开");
      }
      return note;
    },
    {
      onOnline: (note) => clearOfflineNoteSnapshot(note.id),
      onFallback: (note) => markOfflineNoteSnapshot(note),
    },
  );
}

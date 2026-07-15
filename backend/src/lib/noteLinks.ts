/**
 * Note and block backlink extraction.
 *
 * The source block is discovered while traversing Tiptap JSON. Markdown and
 * legacy HTML links remain supported with sourceBlockId = null.
 */
import type Database from "better-sqlite3";
import { noteLinksRepository } from "../repositories";
import type { NoteLinkEntry } from "../repositories";
import { hasPermission, resolveNotePermission } from "../middleware/acl";

const NOTE_LINK_RE = /\[\[note:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:#blk:([a-zA-Z0-9_-]+))?(?:\|([^\]]*))?\]\]/g;
const NOTE_HREF_RE = /note:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:#blk:([a-zA-Z0-9_-]+))?/g;
const SOURCE_BLOCK_TYPES = new Set(["heading", "paragraph", "listItem", "taskItem", "blockquote", "codeBlock"]);

function addEntry(entries: NoteLinkEntry[], seen: Set<string>, entry: NoteLinkEntry): void {
  const key = `${entry.sourceBlockId || ""}:${entry.targetNoteId}:${entry.targetBlockId || ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  entries.push(entry);
}

function entriesFromText(text: string, sourceBlockId: string | null, entries: NoteLinkEntry[], seen: Set<string>): void {
  for (const match of text.matchAll(NOTE_LINK_RE)) {
    const targetNoteId = match[1].toLowerCase();
    const targetBlockId = match[2] || null;
    const displayText = match[3] || null;
    addEntry(entries, seen, {
      targetNoteId,
      targetBlockId,
      sourceBlockId,
      linkType: targetBlockId ? "block" : "note",
      linkText: displayText,
      excerpt: text.replace(/\s+/g, " ").trim().slice(0, 240) || displayText,
    });
  }
  for (const match of text.matchAll(NOTE_HREF_RE)) {
    const targetNoteId = match[1].toLowerCase();
    const targetBlockId = match[2] || null;
    addEntry(entries, seen, {
      targetNoteId,
      targetBlockId,
      sourceBlockId,
      linkType: targetBlockId ? "block" : "note",
      linkText: null,
      excerpt: text.replace(/\s+/g, " ").trim().slice(0, 240) || null,
    });
  }
}

export function extractNoteLinksFromContent(content: string): NoteLinkEntry[] {
  const entries: NoteLinkEntry[] = [];
  const seen = new Set<string>();
  try {
    const doc = JSON.parse(content);
    if (doc && typeof doc === "object" && Array.isArray(doc.content)) {
      const visit = (nodes: any[], parentBlockId: string | null) => {
        for (const node of nodes) {
          if (!node || typeof node !== "object") continue;
          const ownBlockId = SOURCE_BLOCK_TYPES.has(node.type) && typeof node.attrs?.blockId === "string"
            ? node.attrs.blockId
            : parentBlockId;
          if (node.type === "text") {
            const text = String(node.text || "");
            entriesFromText(text, ownBlockId, entries, seen);
            for (const mark of Array.isArray(node.marks) ? node.marks : []) {
              const href = mark?.attrs?.href;
              if (mark?.type === "link" && typeof href === "string" && href.startsWith("note:")) {
                entriesFromText(href, ownBlockId, entries, seen);
              }
            }
          }
          if (Array.isArray(node.content)) visit(node.content, ownBlockId);
        }
      };
      visit(doc.content, null);
      return entries;
    }
  } catch {
    // Markdown / HTML fallback below.
  }
  entriesFromText(content, null, entries, seen);
  return entries;
}

export function syncNoteLinks(
  _db: Database.Database,
  userId: string,
  sourceNoteId: string,
  content: string,
): void {
  try {
    const links = extractNoteLinksFromContent(content).filter(
      (link) => !(link.targetNoteId === sourceNoteId.toLowerCase() && !link.targetBlockId),
    );
    noteLinksRepository.replaceLinksForSource(userId, sourceNoteId, links);
  } catch (error) {
    console.warn("[syncNoteLinks] failed:", error instanceof Error ? error.message : error);
  }
}

export function getBacklinks(
  _db: Database.Database,
  userId: string,
  targetNoteId: string,
  limit = 50,
) {
  return noteLinksRepository
    .getBacklinks(userId, targetNoteId, Math.min(Math.max(limit * 3, limit), 600))
    .filter((item) => hasPermission(resolveNotePermission(item.sourceNoteId, userId).permission, "read"))
    .slice(0, limit);
}

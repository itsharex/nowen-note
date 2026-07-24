import * as Y from "yjs";

export interface TiptapSubdocumentSection {
  id: string;
  guid: string;
  startBlock: number;
  endBlock: number;
  content: string;
}

export interface TiptapSubdocumentBundle {
  rootDoc: Y.Doc;
  sections: TiptapSubdocumentSection[];
  subdocuments: Map<string, Y.Doc>;
}

export interface TiptapSubdocumentTransport {
  send(sectionId: string, update: Uint8Array): boolean;
}

export interface TiptapSubdocumentSyncController {
  applyRemote(sectionId: string, update: Uint8Array): boolean;
  flushPending(): number;
  pendingCount(): number;
  destroy(): void;
}

function parseDocument(content: string): { type: "doc"; content: any[] } | null {
  try {
    const value = JSON.parse(content);
    if (value?.type !== "doc" || !Array.isArray(value.content)) return null;
    return { type: "doc", content: value.content };
  } catch {
    return null;
  }
}

function stablePart(value: unknown): string {
  return String(value || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 96);
}

function sectionIdentity(noteId: string, nodes: any[], index: number): { id: string; guid: string } {
  const blockId = nodes.find((node) => typeof node?.attrs?.blockId === "string")?.attrs?.blockId;
  const id = blockId ? `section-${stablePart(blockId)}` : `section-${index}`;
  return { id, guid: `nowen-subdoc-${stablePart(noteId)}-${id}` };
}

/** 一级/二级标题优先分章；无标题长文按顶层 Block 数上限切分。 */
export function splitTiptapSubdocumentSections(
  noteId: string,
  content: string,
  maxBlocks = 250,
): TiptapSubdocumentSection[] | null {
  const doc = parseDocument(content);
  if (!doc || !Number.isInteger(maxBlocks) || maxBlocks < 10) return null;
  if (doc.content.length === 0) {
    const identity = sectionIdentity(noteId, [], 0);
    return [{ ...identity, startBlock: 0, endBlock: 0, content: JSON.stringify({ type: "doc", content: [] }) }];
  }
  const ranges: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (let index = 1; index < doc.content.length; index += 1) {
    const node = doc.content[index];
    const headingBoundary = node?.type === "heading" && Number(node?.attrs?.level) <= 2;
    if (headingBoundary || index - start >= maxBlocks) {
      ranges.push({ start, end: index });
      start = index;
    }
  }
  ranges.push({ start, end: doc.content.length });
  const used = new Set<string>();
  return ranges.map((range, index) => {
    const nodes = doc.content.slice(range.start, range.end);
    const identity = sectionIdentity(noteId, nodes, index);
    let id = identity.id;
    if (used.has(id)) id = `${id}-${index}`;
    used.add(id);
    return {
      id,
      guid: id === identity.id ? identity.guid : `nowen-subdoc-${stablePart(noteId)}-${id}`,
      startBlock: range.start,
      endBlock: range.end,
      content: JSON.stringify({ type: "doc", content: nodes }),
    };
  });
}

export function createTiptapSubdocumentBundle(noteId: string, content: string, maxBlocks = 250): TiptapSubdocumentBundle | null {
  const sections = splitTiptapSubdocumentSections(noteId, content, maxBlocks);
  if (!sections) return null;
  const rootDoc = new Y.Doc({ guid: `nowen-root-${stablePart(noteId)}` });
  const order = rootDoc.getArray<string>("sectionOrder");
  const sectionMap = rootDoc.getMap<Y.Doc>("sections");
  const metadata = rootDoc.getMap<unknown>("metadata");
  const subdocuments = new Map<string, Y.Doc>();
  rootDoc.transact(() => {
    metadata.set("version", 1);
    metadata.set("noteId", noteId);
    order.insert(0, sections.map((section) => section.id));
    for (const section of sections) {
      const subdoc = new Y.Doc({ guid: section.guid, autoLoad: false });
      subdoc.getText("content").insert(0, section.content);
      sectionMap.set(section.id, subdoc);
      subdocuments.set(section.id, subdoc);
    }
  }, "subdocument-bootstrap");
  return { rootDoc, sections, subdocuments };
}

export function materializeTiptapSubdocuments(bundle: TiptapSubdocumentBundle): string | null {
  const order = bundle.rootDoc.getArray<string>("sectionOrder").toArray();
  const nodes: any[] = [];
  for (const sectionId of order) {
    const subdoc = bundle.subdocuments.get(sectionId) || bundle.rootDoc.getMap<Y.Doc>("sections").get(sectionId);
    const section = subdoc ? parseDocument(subdoc.getText("content").toString()) : null;
    if (!section) return null;
    nodes.push(...section.content);
  }
  return JSON.stringify({ type: "doc", content: nodes });
}

export function destroyTiptapSubdocumentBundle(bundle: TiptapSubdocumentBundle): void {
  for (const subdoc of bundle.subdocuments.values()) subdoc.destroy();
  bundle.subdocuments.clear();
  bundle.rootDoc.destroy();
}

/** 离线时按章节合并更新；恢复连接后逐章发送，远端 update 不回声。 */
export function createTiptapSubdocumentSyncController(
  bundle: TiptapSubdocumentBundle,
  transport: TiptapSubdocumentTransport,
): TiptapSubdocumentSyncController {
  const pending = new Map<string, Uint8Array>();
  const removers: Array<() => void> = [];
  const controller: TiptapSubdocumentSyncController = {
    applyRemote: (sectionId, update) => {
      const doc = bundle.subdocuments.get(sectionId);
      if (!doc) return false;
      Y.applyUpdate(doc, update, controller);
      return true;
    },
    flushPending: () => {
      let sent = 0;
      for (const [sectionId, update] of [...pending]) {
        if (!transport.send(sectionId, update)) continue;
        pending.delete(sectionId);
        sent += 1;
      }
      return sent;
    },
    pendingCount: () => pending.size,
    destroy: () => {
      for (const remove of removers) remove();
      removers.length = 0;
      pending.clear();
    },
  };
  for (const [sectionId, doc] of bundle.subdocuments) {
    const listener = (update: Uint8Array, origin: unknown) => {
      if (origin === controller || transport.send(sectionId, update)) return;
      const previous = pending.get(sectionId);
      pending.set(sectionId, previous ? Y.mergeUpdates([previous, update]) : update);
    };
    doc.on("update", listener);
    removers.push(() => doc.off("update", listener));
  }
  return controller;
}

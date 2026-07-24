import { describe, expect, it } from "vitest";
import {
  createTiptapSubdocumentBundle,
  createTiptapSubdocumentSyncController,
  destroyTiptapSubdocumentBundle,
  materializeTiptapSubdocuments,
  splitTiptapSubdocumentSections,
} from "@/lib/yjsSubdocumentModel";

function document(nodes: any[]): string {
  return JSON.stringify({ type: "doc", content: nodes });
}

describe("Y.js Tiptap subdocument model", () => {
  it("splits at H1/H2 boundaries and keeps GUIDs stable across text edits", () => {
    const nodes = [
      { type: "heading", attrs: { level: 1, blockId: "blk_a00000" }, content: [{ type: "text", text: "A" }] },
      { type: "paragraph", attrs: { blockId: "blk_a00001" }, content: [{ type: "text", text: "one" }] },
      { type: "heading", attrs: { level: 2, blockId: "blk_b00000" }, content: [{ type: "text", text: "B" }] },
      { type: "paragraph", attrs: { blockId: "blk_b00001" }, content: [{ type: "text", text: "two" }] },
    ];
    const first = splitTiptapSubdocumentSections("note-1", document(nodes), 250)!;
    nodes[3].content[0].text = "changed";
    const second = splitTiptapSubdocumentSections("note-1", document(nodes), 250)!;
    expect(first.map((section) => section.guid)).toEqual(second.map((section) => section.guid));
    expect(first).toHaveLength(2);
  });

  it("chunks heading-free content and losslessly materializes loaded subdocuments", () => {
    const content = document(Array.from({ length: 25 }, (_, index) => ({
      type: "paragraph",
      attrs: { blockId: `blk_${String(index).padStart(6, "0")}` },
      content: [{ type: "text", text: `p${index}` }],
    })));
    const bundle = createTiptapSubdocumentBundle("note-2", content, 10)!;
    expect(bundle.sections).toHaveLength(3);
    expect(materializeTiptapSubdocuments(bundle)).toBe(content);
    destroyTiptapSubdocumentBundle(bundle);
  });

  it("fails closed for malformed Tiptap JSON", () => {
    expect(createTiptapSubdocumentBundle("note-3", "not-json")).toBeNull();
  });

  it("merges offline section updates and does not echo remote updates", () => {
    const content = document([{ type: "paragraph", attrs: { blockId: "blk_offline" }, content: [] }]);
    const bundle = createTiptapSubdocumentBundle("note-offline", content)!;
    const sent: Uint8Array[] = [];
    let online = false;
    const controller = createTiptapSubdocumentSyncController(bundle, {
      send: (_sectionId, update) => {
        if (!online) return false;
        sent.push(update);
        return true;
      },
    });
    const section = bundle.subdocuments.values().next().value!;
    section.getText("content").insert(section.getText("content").length, " ");
    section.getText("content").insert(section.getText("content").length, " ");
    expect(controller.pendingCount()).toBe(1);
    online = true;
    expect(controller.flushPending()).toBe(1);
    expect(sent).toHaveLength(1);
    controller.applyRemote(bundle.sections[0].id, sent[0]);
    expect(sent).toHaveLength(1);
    controller.destroy();
    destroyTiptapSubdocumentBundle(bundle);
  });
});

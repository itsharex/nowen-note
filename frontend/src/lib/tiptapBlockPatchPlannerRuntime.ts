import type { BlockPatchOperation } from "@/lib/blockPatchApi";
import {
  planTiptapBlockPatch as planBaseTiptapBlockPatch,
  type TiptapBlockPatchPlan as BaseTiptapBlockPatchPlan,
} from "@/lib/tiptapBlockPatchPlanner";
import { planTiptapListItemMove } from "@/lib/tiptapListItemMovePlanner";
import {
  listItemStructureOperationForPatch,
  planTiptapListItemStructure,
} from "@/lib/tiptapListItemStructurePlanner";

interface JsonNode {
  type?: string;
  attrs?: Record<string, unknown> | null;
  content?: JsonNode[];
  text?: string;
  [key: string]: unknown;
}

export type TiptapBlockPatchPlan = BaseTiptapBlockPatchPlan | {
  operations: BlockPatchOperation[];
  kind: "list-hierarchy" | "list-structure";
  affectedBlockIds: string[];
};

function parseDocument(content: string): JsonNode | null {
  try {
    const parsed = JSON.parse(content || "{}");
    if (!parsed || parsed.type !== "doc" || !Array.isArray(parsed.content)) return null;
    return parsed as JsonNode;
  } catch {
    return null;
  }
}

/** Combine the established planner with fail-closed list structure and hierarchy planners. */
export function planTiptapBlockPatch(
  baseContent: string,
  nextContent: string,
): TiptapBlockPatchPlan | null {
  const basePlan = planBaseTiptapBlockPatch(baseContent, nextContent);
  if (basePlan) return basePlan;
  if (!baseContent || !nextContent || baseContent === nextContent) return null;
  const baseDoc = parseDocument(baseContent);
  const nextDoc = parseDocument(nextContent);
  if (!baseDoc || !nextDoc) return null;

  const structure = planTiptapListItemStructure(baseDoc, nextDoc);
  if (structure) {
    const paragraphId = structure.type === "create"
      ? structure.node.content[0].attrs.blockId as string
      : null;
    return {
      operations: [listItemStructureOperationForPatch(structure)],
      kind: "list-structure",
      affectedBlockIds: [...new Set([
        structure.blockId,
        ...(paragraphId ? [paragraphId] : []),
        ...(structure.type === "create" ? [structure.targetBlockId] : []),
      ])],
    };
  }

  const operation = planTiptapListItemMove(baseDoc, nextDoc);
  if (!operation) return null;
  return {
    operations: [operation],
    kind: "list-hierarchy",
    affectedBlockIds: [operation.blockId, operation.targetBlockId],
  };
}

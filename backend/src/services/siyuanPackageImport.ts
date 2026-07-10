import { getDb } from "../db/schema";
import { decodeSiyuanEmoji, type SiyuanNode } from "../lib/siyuanSyParser";
import {
    importSiyuanPackageFromZipFile as importLegacySiyuanPackage,
    SiyuanZipBudgetError,
    type SiyuanPackageImportResult,
} from "./siyuanPackageImportLegacy";

const unzipper = require("unzipper");

interface ImportParams {
    userId: string;
    workspaceId: string | null;
    targetNotebookId?: string;
    contentFormat?: "tiptap-json" | "markdown";
}

interface ZipEntryLike {
    path: string;
    type?: string;
    buffer(): Promise<Buffer>;
}

interface BoxMeta {
    id: string;
    name: string;
    icon: string;
    sort: number | null;
    archiveIndex: number;
}

interface DocMeta {
    id: string;
    path: string;
    title: string;
    icon: string;
    boxId: string;
    parentDocIds: string[];
    archiveIndex: number;
    ast: SiyuanNode;
}

interface PackageMetadata {
    boxes: Map<string, BoxMeta>;
    docs: DocMeta[];
    docsById: Map<string, DocMeta>;
    docSortByBox: Map<string, Map<string, number>>;
    requiresMarkdown: boolean;
}

export { SiyuanZipBudgetError };
export type { SiyuanPackageImportResult };

const SY_RE = /\.sy$/i;
const CONF_RE = /(^|\/)\.siyuan\/conf\.json$/i;
const SORT_RE = /(^|\/)\.siyuan\/sort\.json$/i;
const FIDELITY_NODE_TYPES = new Set(["NodeHTMLBlock", "NodeInlineHTML", "NodeIFrame"]);

function normalizePath(value: string): string {
    return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function docIdFromPath(value: string): string {
    return normalizePath(value).split("/").pop()?.replace(/\.sy$/i, "") || "";
}

function boxIdFromMetaPath(value: string): string {
    const parts = normalizePath(value).split("/");
    const index = parts.findIndex((part) => part === ".siyuan");
    return index > 0 ? parts[index - 1] : "";
}

function numberOrNull(value: unknown): number | null {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function normalizeTitle(ast: SiyuanNode, fallback: string): string {
    const raw = ast.Properties?.title || ast.Properties?.name || ast.Properties?.Title || ast.Properties?.Name || ast.Data;
    if (typeof raw !== "string") return fallback;
    return raw
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/\s+#{1,6}\s*$/, "")
        .trim() || fallback;
}

function containsFidelityNode(node: SiyuanNode): boolean {
    if (FIDELITY_NODE_TYPES.has(node.Type)) return true;
    return (node.Children || []).some(containsFidelityNode);
}

function resolveBoxId(docPath: string, boxIds: Iterable<string>): string {
    const parts = normalizePath(docPath).split("/");
    const known = new Set(boxIds);
    const direct = parts.slice(0, -1).find((part) => known.has(part));
    if (direct) return direct;
    if (parts[0]?.toLowerCase() === "data" && parts[1]) return parts[1];
    return parts[0] || "imported-siyuan";
}

function parentDocIds(docPath: string, boxId: string): string[] {
    const parts = normalizePath(docPath).split("/");
    const boxIndex = parts.indexOf(boxId);
    return parts
        .slice(boxIndex >= 0 ? boxIndex + 1 : 0, -1)
        .filter((part) => part && part !== ".siyuan" && part !== "assets");
}

async function readPackageMetadata(zipFilePath: string): Promise<PackageMetadata> {
    const directory = await unzipper.Open.file(zipFilePath);
    const entries = directory.files as ZipEntryLike[];
    const boxes = new Map<string, BoxMeta>();
    const rawDocs: Array<{ path: string; ast: SiyuanNode; archiveIndex: number }> = [];
    const docSortByBox = new Map<string, Map<string, number>>();
    let requiresMarkdown = false;

    for (const [archiveIndex, entry] of entries.entries()) {
        if (entry.type === "Directory") continue;
        const entryPath = normalizePath(entry.path);

        if (CONF_RE.test(entryPath)) {
            try {
                const body = (await entry.buffer()).toString("utf8").replace(/^\uFEFF/, "");
                const parsed = JSON.parse(body);
                const boxId = boxIdFromMetaPath(entryPath);
                if (boxId) {
                    boxes.set(boxId, {
                        id: boxId,
                        name: String(parsed?.name || parsed?.boxName || parsed?.title || boxId).trim() || boxId,
                        icon: decodeSiyuanEmoji(parsed?.icon),
                        sort: numberOrNull(parsed?.sort),
                        archiveIndex,
                    });
                }
            } catch {
                // The mature legacy importer reports malformed conf files as warnings.
            }
            continue;
        }

        if (SORT_RE.test(entryPath)) {
            try {
                const parsed = JSON.parse((await entry.buffer()).toString("utf8").replace(/^\uFEFF/, ""));
                const boxId = boxIdFromMetaPath(entryPath);
                if (boxId && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    const map = new Map<string, number>();
                    for (const [docId, value] of Object.entries(parsed as Record<string, unknown>)) {
                        const order = numberOrNull(value);
                        if (order !== null) map.set(docId, order);
                    }
                    docSortByBox.set(boxId, map);
                }
            } catch {
                // Invalid sort metadata must not block importing the user's content.
            }
            continue;
        }

        if (SY_RE.test(entryPath)) {
            try {
                const ast = JSON.parse((await entry.buffer()).toString("utf8").replace(/^\uFEFF/, "")) as SiyuanNode;
                rawDocs.push({ path: entryPath, ast, archiveIndex });
                if (containsFidelityNode(ast)) requiresMarkdown = true;
            } catch {
                // The legacy importer owns parse warnings and skip behavior.
            }
        }
    }

    const docsById = new Map<string, DocMeta>();
    const docs = rawDocs
        .map(({ path, ast, archiveIndex }) => {
            const id = docIdFromPath(path);
            const boxId = resolveBoxId(path, boxes.keys());
            const meta: DocMeta = {
                id,
                path,
                title: normalizeTitle(ast, id),
                icon: decodeSiyuanEmoji(ast.Properties?.icon),
                boxId,
                parentDocIds: parentDocIds(path, boxId),
                archiveIndex,
                ast,
            };
            docsById.set(id, meta);
            if (ast.ID && ast.ID !== id) docsById.set(ast.ID, meta);
            return meta;
        })
        // Keep exactly the same source ordering as the legacy importer so result.notes
        // can be safely paired with source documents for metadata post-processing.
        .sort((a, b) => a.path.localeCompare(b.path));

    return { boxes, docs, docsById, docSortByBox, requiresMarkdown };
}

function buildDocRanks(metadata: PackageMetadata): Map<string, number> {
    const groups = new Map<string, DocMeta[]>();
    for (const doc of metadata.docs) {
        const key = `${doc.boxId}\u0001${doc.parentDocIds.join("/")}`;
        const group = groups.get(key) || [];
        group.push(doc);
        groups.set(key, group);
    }

    const ranks = new Map<string, number>();
    for (const group of groups.values()) {
        const sorted = [...group].sort((a, b) => {
            const aOrder = metadata.docSortByBox.get(a.boxId)?.get(a.id);
            const bOrder = metadata.docSortByBox.get(b.boxId)?.get(b.id);
            if (aOrder !== undefined || bOrder !== undefined) {
                if (aOrder === undefined) return 1;
                if (bOrder === undefined) return -1;
                if (aOrder !== bOrder) return aOrder - bOrder;
            }
            return a.archiveIndex - b.archiveIndex || a.path.localeCompare(b.path);
        });
        sorted.forEach((doc, index) => ranks.set(doc.id, index * 1024));
    }
    return ranks;
}

function buildBoxRanks(metadata: PackageMetadata): Map<string, number> {
    const boxes = [...metadata.boxes.values()].sort((a, b) => {
        if (a.sort !== null || b.sort !== null) {
            if (a.sort === null) return 1;
            if (b.sort === null) return -1;
            if (a.sort !== b.sort) return a.sort - b.sort;
        }
        return a.archiveIndex - b.archiveIndex || a.name.localeCompare(b.name);
    });
    return new Map(boxes.map((box, index) => [box.id, index * 1024]));
}

function listScopeNotebookIds(userId: string, workspaceId: string | null): Set<string> {
    const rows = workspaceId
        ? getDb().prepare("SELECT id FROM notebooks WHERE userId = ? AND workspaceId = ?").all(userId, workspaceId)
        : getDb().prepare("SELECT id FROM notebooks WHERE userId = ? AND workspaceId IS NULL").all(userId);
    return new Set((rows as Array<{ id: string }>).map((row) => row.id));
}

function ensureNoteIconsTable(): void {
    getDb().exec(`
        CREATE TABLE IF NOT EXISTS note_icons (
            noteId TEXT PRIMARY KEY,
            icon TEXT NOT NULL,
            updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE
        );
    `);
}

function applyImportedMetadata(
    metadata: PackageMetadata,
    result: SiyuanPackageImportResult,
    params: ImportParams,
    existingNotebookIds: Set<string>,
): string[] {
    const warnings: string[] = [];
    const db = getDb();
    const docRanks = buildDocRanks(metadata);
    const boxRanks = buildBoxRanks(metadata);
    const currentNotebookIds = listScopeNotebookIds(params.userId, params.workspaceId);
    const newNotebookIds = new Set([...currentNotebookIds].filter((id) => !existingNotebookIds.has(id)));

    if (metadata.docs.length !== result.notes.length) {
        warnings.push(`思源排序元数据仅匹配到 ${Math.min(metadata.docs.length, result.notes.length)} / ${result.notes.length} 篇笔记`);
    }

    ensureNoteIconsTable();
    const updateNoteOrder = db.prepare("UPDATE notes SET sortOrder = ? WHERE id = ?");
    const upsertNoteIcon = db.prepare(`
        INSERT INTO note_icons (noteId, icon, updatedAt)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(noteId) DO UPDATE SET icon = excluded.icon, updatedAt = datetime('now')
    `);
    const findChild = db.prepare(
        "SELECT id FROM notebooks WHERE userId = ? AND name = ? AND parentId IS ? AND workspaceId IS ? AND isDeleted = 0",
    );
    const updateNotebookOrder = db.prepare("UPDATE notebooks SET sortOrder = ? WHERE id = ?");
    const updateNotebookIcon = db.prepare("UPDATE notebooks SET icon = ? WHERE id = ?");
    const touchedNotebooks = new Set<string>();

    const applyNotebookPath = (doc: DocMeta) => {
        if (params.targetNotebookId) return;
        const box = metadata.boxes.get(doc.boxId) || {
            id: doc.boxId,
            name: doc.boxId,
            icon: "",
            sort: null,
            archiveIndex: doc.archiveIndex,
        };
        const segments: Array<{ name: string; icon: string; order: number }> = [{
            name: box.name,
            icon: box.icon,
            order: boxRanks.get(box.id) ?? 0,
        }];
        for (const parentId of doc.parentDocIds) {
            const parent = metadata.docsById.get(parentId);
            segments.push({
                name: parent?.title || parentId,
                icon: parent?.icon || "",
                order: parent ? (docRanks.get(parent.id) ?? 0) : 0,
            });
        }

        let parentId: string | null = null;
        for (const segment of segments) {
            const row = findChild.get(params.userId, segment.name, parentId, params.workspaceId) as { id: string } | undefined;
            if (!row) break;
            if (newNotebookIds.has(row.id) && !touchedNotebooks.has(row.id)) {
                updateNotebookOrder.run(segment.order, row.id);
                if (segment.icon) updateNotebookIcon.run(segment.icon, row.id);
                touchedNotebooks.add(row.id);
            }
            parentId = row.id;
        }
    };

    db.transaction(() => {
        const count = Math.min(metadata.docs.length, result.notes.length);
        for (let index = 0; index < count; index += 1) {
            const doc = metadata.docs[index];
            const imported = result.notes[index];
            updateNoteOrder.run(docRanks.get(doc.id) ?? index * 1024, imported.id);
            if (doc.icon) upsertNoteIcon.run(imported.id, doc.icon);
            applyNotebookPath(doc);
        }
    })();

    return warnings;
}

/**
 * Enhanced SiYuan package import.
 *
 * The original, battle-tested streaming importer remains the data plane. This wrapper
 * reads only SiYuan metadata before import and restores information that was previously
 * discarded: notebook/document order, notebook/document emoji icons and raw HTML/iframe
 * fidelity. Packages containing HTML or iframe nodes automatically use Markdown because
 * Tiptap's schema intentionally cannot store arbitrary HTML safely.
 */
export async function importSiyuanPackageFromZipFile(
    zipFilePath: string,
    params: ImportParams,
): Promise<SiyuanPackageImportResult> {
    const metadata = await readPackageMetadata(zipFilePath);
    const existingNotebookIds = listScopeNotebookIds(params.userId, params.workspaceId);
    const forceMarkdown = metadata.requiresMarkdown && params.contentFormat !== "markdown";
    const result = await importLegacySiyuanPackage(zipFilePath, {
        ...params,
        contentFormat: forceMarkdown ? "markdown" : params.contentFormat,
    });

    const metadataWarnings = applyImportedMetadata(metadata, result, params, existingNotebookIds);
    const warnings = new Set(result.warnings || []);
    for (const warning of metadataWarnings) warnings.add(warning);
    if (forceMarkdown) {
        warnings.add("检测到 HTML 或 iframe 内容，已自动使用 Markdown 模式以保留原始结构并安全预览。");
    }

    return { ...result, warnings: [...warnings].sort((a, b) => a.localeCompare(b)) };
}

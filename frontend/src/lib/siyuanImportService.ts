import type { ImportFileInfo } from "./importService";
import { readMarkdownFromZipWithMeta } from "./importService";
import { siyuanSyToMarkdown, type SiyuanNode } from "./siyuanSyParser";

export interface SiyuanZipInspection {
  entries: string[];
  hasMarkdownFiles: boolean;
  hasSyFiles: boolean;
  isSiyuanMarkdownZip: boolean;
}

export interface SiyuanImportResult {
  files: ImportFileInfo[];
  report: SiyuanImportReport;
  warnings: string[];
}

export interface SiyuanImportReport {
  totalMarkdownFiles: number;
  totalSyFiles: number;
  cleanedBlockAttrs: number;
  convertedWikiLinks: number;
  convertedBlockRefs: number;
  detectedTags: string[];
  unresolvedAssets: string[];
  unsupportedFiles: string[];
  warnings: string[];
}

export interface SiyuanMarkdownCleanResult {
  markdown: string;
  cleanedBlockAttrs: number;
  convertedWikiLinks: number;
  convertedBlockRefs: number;
  detectedTags: string[];
}

export interface SiyuanSyImportResult {
  files: ImportFileInfo[];
  report: SiyuanSyImportReport;
  warnings: string[];
}

export interface SiyuanSyImportReport {
  totalSyFiles: number;
  importedDocuments: number;
  totalAssets: number;
  unsupportedNodes: Record<string, number>;
  unresolvedAssets: string[];
  detectedTags: string[];
  warnings: string[];
}

interface SiyuanDocIndex {
  id: string;
  path: string;
  title: string;
  updatedAt?: string;
  ast: SiyuanNode;
}

const MARKDOWN_EXT_RE = /\.(md|markdown)$/i;
const SIYUAN_SY_EXT_RE = /\.sy$/i;
const SIYUAN_CONF_RE = /(^|\/)\.siyuan\/conf\.json$/i;
const SIYUAN_SORT_RE = /(^|\/)\.siyuan\/sort\.json$/i;
const ASSETS_SEGMENT_RE = /(^|\/)assets\//i;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i;
const SIYUAN_MARKER_RE =
  /(^|\n)\s*\{:\s+[^}]*\}\s*(?=\n|$)|\(\([^)]+?\)\)|\[\[[^\]]+?\]\]|!\[[^\]]*]\((?:\.{0,2}\/)?assets\//i;

function normalizeZipPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isHiddenZipEntry(path: string): boolean {
  const normalized = normalizeZipPath(path);
  return normalized.includes("__MACOSX/") || normalized.split("/").some((part) => part.startsWith("."));
}

function isIgnoredSiyuanDataEntry(path: string): boolean {
  const normalized = normalizeZipPath(path);
  return normalized.includes("__MACOSX/") || normalized.split("/").some((part) => part.startsWith(".") && part !== ".siyuan");
}

function isMarkdownEntry(path: string): boolean {
  return MARKDOWN_EXT_RE.test(path);
}

function isSyEntry(path: string): boolean {
  return SIYUAN_SY_EXT_RE.test(path);
}

function hasAssetsDir(entries: string[]): boolean {
  return entries.some((entry) => ASSETS_SEGMENT_RE.test(normalizeZipPath(entry)));
}

export function isSiyuanMarkdownZip(entries: string[]): boolean {
  const visibleEntries = entries.map(normalizeZipPath).filter((entry) => !isHiddenZipEntry(entry));
  const hasMarkdown = visibleEntries.some(isMarkdownEntry);
  if (!hasMarkdown) return false;

  // Common Siyuan Markdown exports keep note-local resources under assets/.
  // Content-based detection is handled by inspectSiyuanZip/readSiyuanMarkdownZip.
  return hasAssetsDir(visibleEntries);
}

export function isSiyuanSyZip(entries: string[]): boolean {
  const visibleEntries = entries.map(normalizeZipPath).filter((entry) => !isHiddenZipEntry(entry));
  return visibleEntries.some(isSyEntry);
}

export function isSiyuanSyDataZip(entries: string[]): boolean {
  const visibleEntries = entries.map(normalizeZipPath).filter((entry) => !isIgnoredSiyuanDataEntry(entry));
  return visibleEntries.some(isSyEntry) && visibleEntries.some((entry) => SIYUAN_CONF_RE.test(entry) || SIYUAN_SORT_RE.test(entry));
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).map((value) => value.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
}

function stripQueryHash(ref: string): string {
  return ref.split(/[?#]/)[0];
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    try {
      return decodeURI(value);
    } catch {
      return value;
    }
  }
}

function trimAssetRef(raw: string): string {
  return raw
    .trim()
    .replace(/^<|>$/g, "")
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\/g, "/");
}

export function normalizeAssetRef(ref: string): string[] {
  const raw = trimAssetRef(ref);
  if (!raw || /^(https?:|data:|\/\/)/i.test(raw)) return [];

  const candidates = new Set<string>();
  const add = (value: string) => {
    let normalized = stripQueryHash(trimAssetRef(value))
      .replace(/^\.\//, "")
      .replace(/^\/+/, "");
    while (normalized.startsWith("../")) normalized = normalized.slice(3);
    if (!normalized) return;
    candidates.add(normalized);
    const decoded = safeDecodeUri(normalized);
    candidates.add(decoded);
    const fileName = decoded.split("/").pop();
    if (fileName) candidates.add(fileName);
    const assetsIndex = decoded.toLowerCase().lastIndexOf("/assets/");
    const assetsTail = assetsIndex >= 0
      ? decoded.slice(assetsIndex + 1)
      : decoded.toLowerCase().startsWith("assets/")
      ? decoded
      : "";
    if (assetsTail) {
      candidates.add(assetsTail);
      candidates.add(`./${assetsTail}`);
      candidates.add(`../${assetsTail}`);
    }
  };

  add(raw);
  add(safeDecodeUri(raw));

  return uniqueSorted(candidates);
}

export async function inspectSiyuanZip(file: File): Promise<SiyuanZipInspection> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(file);
  const entries = Object.keys(zip.files).map(normalizeZipPath);
  const visibleFiles = entries.filter((entry) => !zip.files[entry]?.dir && !isHiddenZipEntry(entry));
  const hasMarkdownFiles = visibleFiles.some(isMarkdownEntry);
  const hasSyFiles = visibleFiles.some(isSyEntry);

  let isSiyuan = isSiyuanMarkdownZip(entries);
  if (!isSiyuan && hasMarkdownFiles) {
    const markdownEntries = visibleFiles.filter(isMarkdownEntry).slice(0, 12);
    for (const entry of markdownEntries) {
      const zipEntry = zip.file(entry);
      if (!zipEntry) continue;
      try {
        const text = await zipEntry.async("text");
        if (SIYUAN_MARKER_RE.test(text)) {
          isSiyuan = true;
          break;
        }
      } catch {
        // Ignore unreadable individual files; the generic importer will surface real failures.
      }
    }
  }

  return {
    entries,
    hasMarkdownFiles,
    hasSyFiles,
    isSiyuanMarkdownZip: isSiyuan && hasMarkdownFiles,
  };
}

export function cleanSiyuanMarkdownWithReport(markdown: string): SiyuanMarkdownCleanResult {
  let cleanedBlockAttrs = 0;
  let convertedWikiLinks = 0;
  let convertedBlockRefs = 0;
  const detectedTags = new Set<string>();

  const tagRe = /(^|[^\p{L}\p{N}_/#])#([\p{L}\p{N}_\-\u4e00-\u9fff][^#\r\n]{0,48}?)#/gu;
  for (const match of markdown.matchAll(tagRe)) {
    const tag = (match[2] || "").trim();
    if (tag && !/\s{2,}/.test(tag)) detectedTags.add(tag);
  }

  const cleaned = markdown
    .replace(/^[ \t]*\{:\s+[^}\r\n]*\}[ \t]*(?:\r?\n|$)/gm, () => {
      cleanedBlockAttrs++;
      return "";
    })
    .replace(/[ \t]+\{:\s+[^}\r\n]*\}(?=\r?\n|$)/g, () => {
      cleanedBlockAttrs++;
      return "";
    })
    .replace(/\(\(([^)\s]+)(?:\s+"([^"]*)")?\)\)/g, (_match, id: string, label?: string) => {
      convertedBlockRefs++;
      return label?.trim() ? label.trim() : `[块引用:${id}]`;
    })
    .replace(/\[\[([^\]\r\n]+)\]\]/g, (_match, target: string) => {
      convertedWikiLinks++;
      const label = target.trim();
      return label ? `[${label}](${encodeURI(label)})` : "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    markdown: cleaned,
    cleanedBlockAttrs,
    convertedWikiLinks,
    convertedBlockRefs,
    detectedTags: uniqueSorted(detectedTags),
  };
}

export function cleanSiyuanMarkdown(markdown: string): string {
  return cleanSiyuanMarkdownWithReport(markdown).markdown;
}

export function enhanceSiyuanImageMap(
  imageMap: Record<string, string> | undefined,
  notePath: string,
): Record<string, string> | undefined {
  if (!imageMap) return imageMap;

  const enhanced: Record<string, string> = { ...imageMap };
  const normalizedNotePath = normalizeZipPath(notePath);
  const noteDir = normalizedNotePath.split("/").slice(0, -1).join("/");

  const addAlias = (alias: string, dataUri: string) => {
    for (const normalized of normalizeAssetRef(alias)) {
      if (!enhanced[normalized]) enhanced[normalized] = dataUri;
    }
  };

  for (const [rawPath, dataUri] of Object.entries(imageMap)) {
    const path = normalizeZipPath(rawPath);
    const fileName = path.split("/").pop();
    if (!fileName) continue;

    addAlias(fileName, dataUri);
    addAlias(path, dataUri);
    const assetsIndex = path.toLowerCase().lastIndexOf("/assets/");
    const assetsTail = assetsIndex >= 0
      ? path.slice(assetsIndex + 1)
      : path.toLowerCase().startsWith("assets/")
      ? path
      : "";
    if (assetsTail) {
      addAlias(assetsTail, dataUri);
      addAlias(`./${assetsTail}`, dataUri);
      addAlias(`../${assetsTail}`, dataUri);
    }

    if (noteDir && path.startsWith(`${noteDir}/`)) {
      const relativeToNote = path.slice(noteDir.length + 1);
      addAlias(relativeToNote, dataUri);
      addAlias(`./${relativeToNote}`, dataUri);
    }
  }

  return enhanced;
}

export function collectMarkdownAssetRefs(markdown: string): string[] {
  const refs = new Set<string>();
  const addIfAsset = (raw: string | undefined) => {
    if (!raw) return;
    const normalizedRefs = normalizeAssetRef(raw);
    if (normalizedRefs.some((ref) => /(^|\/)assets\//i.test(ref))) {
      refs.add(stripQueryHash(trimAssetRef(raw)));
    }
  };

  const mdLinkRe = /!?\[[^\]]*]\(([^)]+)\)/g;
  for (const match of markdown.matchAll(mdLinkRe)) {
    const raw = (match[1] || "").replace(/\s+["'][^"']*["']\s*$/, "");
    addIfAsset(raw);
  }

  const htmlAttrRe = /<(?:img|a)\b[^>]*\s(?:src|href)=["']([^"']+)["'][^>]*>/gi;
  for (const match of markdown.matchAll(htmlAttrRe)) {
    addIfAsset(match[1]);
  }

  return uniqueSorted(refs);
}

function imageMapHasAsset(imageMap: Record<string, string> | undefined, ref: string): boolean {
  if (!imageMap) return false;
  return normalizeAssetRef(ref).some((candidate) => Boolean(imageMap[candidate]));
}

function isImageAssetRef(ref: string): boolean {
  const clean = stripQueryHash(trimAssetRef(ref));
  return IMAGE_EXT_RE.test(clean);
}

function getAssetMime(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".ico")) return "image/x-icon";
  if (lower.endsWith(".avif")) return "image/avif";
  return "application/octet-stream";
}

function getDocIdFromPath(path: string): string {
  const fileName = normalizeZipPath(path).split("/").pop() || path;
  return fileName.replace(/\.sy$/i, "");
}

function getSiyuanDocTitle(ast: SiyuanNode, fallback: string): string {
  const title = ast.Properties?.title || ast.Properties?.name || ast.Properties?.Title || ast.Properties?.Name || ast.Data;
  return typeof title === "string" && title.trim() ? title.trim() : fallback;
}

function getSiyuanUpdatedAt(ast: SiyuanNode): string | undefined {
  const updated = ast.Properties?.updated || ast.Properties?.Updated || ast.updated || ast.Updated;
  if (typeof updated !== "string") return undefined;
  const match = updated.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function getBoxIdFromConfPath(path: string): string | undefined {
  const parts = normalizeZipPath(path).split("/");
  const siyuanIndex = parts.findIndex((part) => part === ".siyuan");
  if (siyuanIndex <= 0) return undefined;
  return parts[siyuanIndex - 1];
}

function getBoxIdForDoc(path: string, boxNames: Map<string, string>): string | undefined {
  const parts = normalizeZipPath(path).split("/");
  const syFileIndex = parts.length - 1;
  const directMatch = parts.slice(0, syFileIndex).find((part) => boxNames.has(part));
  if (directMatch) return directMatch;
  if (parts.length >= 3 && /^data(?:[-_/]|\d|$)/i.test(parts[0])) return parts[1];
  return parts[0];
}

function buildSiyuanNotebookPath(path: string, docById: Map<string, SiyuanDocIndex>, boxNames: Map<string, string>): string[] {
  const parts = normalizeZipPath(path).split("/");
  const currentId = getDocIdFromPath(path);
  const boxId = getBoxIdForDoc(path, boxNames);
  const boxIndex = boxId ? parts.indexOf(boxId) : -1;
  const notebookPath: string[] = [];

  if (boxId) {
    notebookPath.push(boxNames.get(boxId) || boxId);
  }

  const parentIds = parts
    .slice(boxIndex >= 0 ? boxIndex + 1 : 0, -1)
    .filter((part) => part && part !== ".siyuan" && part !== "assets" && part !== currentId);
  for (const parentId of parentIds) {
    const parent = docById.get(parentId);
    notebookPath.push(parent?.title || parentId);
  }

  return notebookPath.filter(Boolean);
}

function mergeUnsupported(target: Record<string, number>, source: Record<string, number>) {
  for (const [type, count] of Object.entries(source)) {
    target[type] = (target[type] || 0) + count;
  }
}

export async function readSiyuanSyZip(file: File): Promise<SiyuanSyImportResult> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(file);
  const entries = Object.keys(zip.files).map(normalizeZipPath);
  const warnings: string[] = [];
  const boxNames = new Map<string, string>();
  const docById = new Map<string, SiyuanDocIndex>();
  const imageMap: Record<string, string> = {};
  let totalAssets = 0;

  for (const [rawPath, zipEntry] of Object.entries(zip.files)) {
    const path = normalizeZipPath(rawPath);
    if (zipEntry.dir || isIgnoredSiyuanDataEntry(path)) continue;

    if (SIYUAN_CONF_RE.test(path)) {
      try {
        const parsed = JSON.parse(await zipEntry.async("text"));
        const boxId = getBoxIdFromConfPath(path);
        const boxName = parsed?.name || parsed?.boxName || parsed?.title;
        if (boxId && typeof boxName === "string" && boxName.trim()) {
          boxNames.set(boxId, boxName.trim());
        }
      } catch {
        warnings.push(`Failed to read Siyuan notebook config: ${path}`);
      }
    }

    if (ASSETS_SEGMENT_RE.test(path)) {
      totalAssets++;
      if (IMAGE_EXT_RE.test(path)) {
        try {
          const dataUri = `data:${getAssetMime(path)};base64,${await zipEntry.async("base64")}`;
          imageMap[path] = dataUri;
          const fileName = path.split("/").pop();
          if (fileName && !imageMap[fileName]) imageMap[fileName] = dataUri;
        } catch {
          warnings.push(`Failed to read Siyuan asset: ${path}`);
        }
      }
    }
  }

  for (const [rawPath, zipEntry] of Object.entries(zip.files)) {
    const path = normalizeZipPath(rawPath);
    if (zipEntry.dir || isIgnoredSiyuanDataEntry(path) || !isSyEntry(path)) continue;
    try {
      const ast = JSON.parse(await zipEntry.async("text")) as SiyuanNode;
      const id = getDocIdFromPath(path);
      const title = getSiyuanDocTitle(ast, id);
      const docIndex = {
        id,
        path,
        title,
        updatedAt: getSiyuanUpdatedAt(ast),
        ast,
      };
      docById.set(id, docIndex);
      if (ast.ID && ast.ID !== id) {
        docById.set(ast.ID, docIndex);
      }
    } catch {
      warnings.push(`Failed to parse Siyuan document: ${path}`);
    }
  }

  const detectedTags = new Set<string>();
  const unresolvedAssets = new Set<string>();
  const unsupportedNodes: Record<string, number> = {};
  const files: ImportFileInfo[] = [];

  const indexedDocs = Array.from(new Map(Array.from(docById.values()).map((doc) => [doc.path, doc])).values())
    .sort((a, b) => a.path.localeCompare(b.path));
  for (const doc of indexedDocs) {
    const converted = siyuanSyToMarkdown(doc.ast);
    const enhancedImageMap = enhanceSiyuanImageMap(imageMap, doc.path);
    converted.stats.tags.forEach((tag) => detectedTags.add(tag));
    mergeUnsupported(unsupportedNodes, converted.stats.unsupportedNodes);
    warnings.push(...converted.warnings);

    for (const ref of converted.stats.images) {
      if (!imageMapHasAsset(enhancedImageMap, ref)) unresolvedAssets.add(ref);
    }

    const notebookPath = buildSiyuanNotebookPath(doc.path, docById, boxNames);
    const markdown = converted.markdown || doc.title;
    files.push({
      name: doc.path,
      title: converted.title || doc.title,
      content: markdown,
      size: markdown.length,
      selected: true,
      source: "siyuan-sy",
      notebookName: notebookPath[notebookPath.length - 1],
      notebookPath,
      imageMap: Object.keys(enhancedImageMap || {}).length > 0 ? enhancedImageMap : undefined,
      updatedAt: converted.updatedAt || doc.updatedAt,
    } as ImportFileInfo);
  }

  const report: SiyuanSyImportReport = {
    totalSyFiles: entries.filter((entry) => isSyEntry(entry) && !isHiddenZipEntry(entry)).length,
    importedDocuments: files.length,
    totalAssets,
    unsupportedNodes,
    unresolvedAssets: uniqueSorted(unresolvedAssets),
    detectedTags: uniqueSorted(detectedTags),
    warnings: uniqueSorted(warnings),
  };

  return { files, report, warnings: report.warnings };
}

export async function readSiyuanMarkdownZip(file: File): Promise<SiyuanImportResult> {
  const inspection = await inspectSiyuanZip(file);
  const warnings: string[] = [];
  if (inspection.hasSyFiles) {
    warnings.push("siyuanSyNotSupported");
  }

  const { files } = await readMarkdownFromZipWithMeta(file);
  const markdownFiles = files.filter((info) => info.source === "md" || info.name.match(MARKDOWN_EXT_RE));
  const detectedTags = new Set<string>();
  const unresolvedAssets = new Set<string>();
  const unsupportedFiles = new Set<string>();
  let cleanedBlockAttrs = 0;
  let convertedWikiLinks = 0;
  let convertedBlockRefs = 0;

  const cleanedFiles = markdownFiles.map((info) => {
    const clean = cleanSiyuanMarkdownWithReport(info.content);
    cleanedBlockAttrs += clean.cleanedBlockAttrs;
    convertedWikiLinks += clean.convertedWikiLinks;
    convertedBlockRefs += clean.convertedBlockRefs;
    clean.detectedTags.forEach((tag) => detectedTags.add(tag));

    const imageMap = enhanceSiyuanImageMap(info.imageMap, info.name);
    for (const ref of collectMarkdownAssetRefs(clean.markdown)) {
      if (!isImageAssetRef(ref)) {
        unsupportedFiles.add(ref);
        continue;
      }
      if (!imageMapHasAsset(imageMap, ref)) {
        unresolvedAssets.add(ref);
      }
    }

    return {
      ...info,
      source: "siyuan",
      content: clean.markdown,
      imageMap,
    };
  });

  const report: SiyuanImportReport = {
    totalMarkdownFiles: markdownFiles.length,
    totalSyFiles: inspection.entries.filter((entry) => isSyEntry(entry) && !isHiddenZipEntry(entry)).length,
    cleanedBlockAttrs,
    convertedWikiLinks,
    convertedBlockRefs,
    detectedTags: uniqueSorted(detectedTags),
    unresolvedAssets: uniqueSorted(unresolvedAssets),
    unsupportedFiles: uniqueSorted(unsupportedFiles),
    warnings,
  };

  return { files: cleanedFiles, report, warnings };
}

// electron/folder-sync.js
//
// 桌面端文件夹同步：配置 CRUD + 本地扫描 + SHA-256 索引 + 日志。
//
// 配置：{userData}/folder-sync.json
// 索引：{userData}/folder-sync-index-{folderId}.json
// 日志：{userData}/folder-sync-logs.json
//
// Phase C.1：只做本地扫描，不上传、不创建笔记、不改后端。

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let configFilePath = null;
let dataDir = null;

// 忽略的目录名
const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg", "dist", "build",
  ".next", ".vite", "__pycache__", ".cache", ".turbo",
]);
// 忽略的文件名
const IGNORED_FILES = new Set([
  ".DS_Store", "Thumbs.db", "desktop.ini",
]);
// 忽略的文件名前缀/后缀
const IGNORED_PREFIXES = ["~$"];
const IGNORED_EXTS = [".tmp", ".temp", ".swp", ".swo"];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_LOG_ENTRIES = 200;

function setDataDir(dir) {
  dataDir = dir;
  configFilePath = path.join(dir, "folder-sync.json");
}

function genId() {
  return crypto.randomBytes(8).toString("hex");
}

// ---------- 配置 CRUD ----------

function readConfigs() {
  if (!configFilePath) return [];
  try {
    if (fs.existsSync(configFilePath)) {
      const raw = JSON.parse(fs.readFileSync(configFilePath, "utf8"));
      return Array.isArray(raw) ? raw : [];
    }
  } catch (e) {
    console.warn("[folder-sync] read configs failed:", e?.message || e);
  }
  return [];
}

function writeConfigs(configs) {
  if (!configFilePath) return;
  try {
    fs.mkdirSync(path.dirname(configFilePath), { recursive: true });
    const tmp = configFilePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(configs, null, 2), "utf8");
    fs.renameSync(tmp, configFilePath);
  } catch (e) {
    console.error("[folder-sync] write configs failed:", e?.message || e);
    throw e;
  }
}

function saveConfig(input) {
  const configs = readConfigs();
  const now = new Date().toISOString();

  if (input.folderId) {
    const idx = configs.findIndex((c) => c.folderId === input.folderId);
    if (idx >= 0) {
      configs[idx] = { ...configs[idx], ...input, updatedAt: now };
      writeConfigs(configs);
      return { ok: true, config: configs[idx] };
    }
  }

  const config = {
    folderId: input.folderId || genId(),
    folderPath: input.folderPath || "",
    targetNotebookId: input.targetNotebookId || null,
    includeSubfolders: input.includeSubfolders !== false,
    fileTypes: input.fileTypes || [".md", ".txt", ".html", ".pdf", ".docx"],
    enabled: input.enabled !== false,
    intervalMinutes: input.intervalMinutes ?? null,
    lastSyncedAt: null,
    lastScanAt: null,
    lastScanStats: null,
    createdAt: now,
    updatedAt: now,
  };
  configs.push(config);
  writeConfigs(configs);
  return { ok: true, config };
}

function removeConfig(folderId) {
  const configs = readConfigs();
  const filtered = configs.filter((c) => c.folderId !== folderId);
  if (filtered.length === configs.length) return { ok: false, error: "Config not found" };
  writeConfigs(filtered);
  if (dataDir) {
    try {
      const idx = path.join(dataDir, `folder-sync-index-${folderId}.json`);
      if (fs.existsSync(idx)) fs.unlinkSync(idx);
    } catch { /* ignore */ }
  }
  return { ok: true };
}

// ---------- 安全校验 ----------

function isDangerousRoot(p) {
  const normalized = path.resolve(p);
  // Windows: C:\ or D:\
  if (/^[A-Z]:\\?$/.test(normalized)) return true;
  // macOS/Linux: /
  if (normalized === "/") return true;
  // Home 目录本身
  const home = require("os").homedir();
  if (normalized === home || normalized === home.replace(/\/$/, "")) return true;
  return false;
}

function shouldIgnoreDir(name) {
  return IGNORED_DIRS.has(name) || name.startsWith(".");
}

function shouldIgnoreFile(name) {
  if (IGNORED_FILES.has(name)) return true;
  if (name.startsWith(".")) return true;
  for (const prefix of IGNORED_PREFIXES) {
    if (name.startsWith(prefix)) return true;
  }
  const ext = path.extname(name).toLowerCase();
  if (IGNORED_EXTS.includes(ext)) return true;
  return false;
}

// ---------- 路径边界安全校验 ----------

/**
 * 检查 candidatePath 的真实路径是否在 rootPath 真实路径内。
 *
 * 用于读取前二次确认，防止 TOCTOU 攻击：
 * - scanFolder 时文件是普通文件，进入 index
 * - 之后文件被替换为 symlink，指向同步根目录外
 * - getPendingUploads / getUploadFile 读取前再次校验
 *
 * @param {string} rootPath 同步根目录路径
 * @param {string} candidatePath 候选文件路径
 * @returns {{ ok: boolean, reason?: string, rootRealPath?: string, fileRealPath?: string }}
 */
function checkPathBoundary(rootPath, candidatePath) {
  // 1. 获取 root 的真实路径（解析 symlink）
  let rootRealPath;
  try {
    rootRealPath = fs.realpathSync(rootPath);
  } catch (e) {
    return { ok: false, reason: `Cannot resolve root path: ${e.message}` };
  }

  // 2. lstatSync 检查候选文件是否为 symlink
  let lstat;
  try {
    lstat = fs.lstatSync(candidatePath);
  } catch (e) {
    return { ok: false, reason: `Cannot stat file: ${e.message}` };
  }

  if (lstat.isSymbolicLink()) {
    return { ok: false, reason: "File is a symlink" };
  }

  // 3. 检查是否为普通文件（拒绝 socket / fifo / device 等）
  if (!lstat.isFile()) {
    return { ok: false, reason: `Not a regular file (mode: ${lstat.mode.toString(8)})` };
  }

  // 4. 获取候选文件的真实路径
  let fileRealPath;
  try {
    fileRealPath = fs.realpathSync(candidatePath);
  } catch (e) {
    return { ok: false, reason: `Cannot resolve file path: ${e.message}` };
  }

  // 5. 规范化路径（Windows 大小写 + 分隔符）
  const normalizedRoot = path.normalize(rootRealPath);
  const normalizedFile = path.normalize(fileRealPath);

  // 6. 使用 path.relative 判断边界
  const rel = path.relative(normalizedRoot, normalizedFile);

  // relative 为空字符串表示相同路径
  // relative 以 .. 开头表示在 root 外
  // relative 为绝对路径表示在不同驱动器（Windows）
  if (rel === "") {
    return { ok: true, rootRealPath: normalizedRoot, fileRealPath: normalizedFile };
  }
  if (path.isAbsolute(rel)) {
    return { ok: false, reason: `File is on a different drive: ${fileRealPath}` };
  }
  if (rel.startsWith("..")) {
    return { ok: false, reason: `File is outside root: ${fileRealPath}` };
  }

  return { ok: true, rootRealPath: normalizedRoot, fileRealPath: normalizedFile };
}

// ---------- 扫描 ----------

function normalizeFileTypes(fileTypes) {
  if (!Array.isArray(fileTypes) || fileTypes.length === 0) {
    return [".md", ".txt", ".html", ".pdf", ".docx"];
  }
  return [...new Set(fileTypes.map((e) => {
    const lower = e.toLowerCase();
    return lower.startsWith(".") ? lower : `.${lower}`;
  }))];
}

function scanFolder(folderPath, fileTypes, includeSubfolders) {
  const results = [];
  const typeSet = new Set(normalizeFileTypes(fileTypes));

  function walk(dir, relBase) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      results.push({ relativePath: relBase, error: `Cannot read directory: ${e.message}`, status: "error" });
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (shouldIgnoreDir(entry.name)) continue;
        if (includeSubfolders) {
          // 安全检查：不跟随 symlink，避免循环扫描
          try {
            const stat = fs.lstatSync(fullPath);
            if (stat.isSymbolicLink()) continue;
          } catch { /* ignore */ }
          walk(fullPath, relPath);
        }
      } else if (entry.isFile()) {
        if (shouldIgnoreFile(entry.name)) continue;
        // SEC-ELECTRON-01-D4: 跳过 symlink 文件，防止穿透读取任意目标
        try {
          const lstat = fs.lstatSync(fullPath);
          if (lstat.isSymbolicLink()) continue;
        } catch { /* ignore */ }
        const ext = path.extname(entry.name).toLowerCase();
        if (!typeSet.has(ext)) continue;

        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > MAX_FILE_SIZE) {
            results.push({
              relativePath: relPath,
              size: stat.size,
              mtimeMs: stat.mtimeMs,
              status: "skipped",
              error: `File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB > 50MB)`,
            });
            continue;
          }

          const sha256 = computeHash(fullPath);
          results.push({
            relativePath: relPath,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            sha256,
            status: "new", // 会在 mergeIndex 里更新
          });
        } catch (e) {
          results.push({
            relativePath: relPath,
            status: "error",
            error: e.message,
          });
        }
      }
    }
  }

  walk(folderPath, "");
  return results;
}

function computeHash(filePath) {
  const hash = crypto.createHash("sha256");
  const buf = fs.readFileSync(filePath);
  hash.update(buf);
  return hash.digest("hex");
}

// ---------- 索引合并 ----------

function readIndex(folderId) {
  if (!dataDir) return [];
  const indexFile = path.join(dataDir, `folder-sync-index-${folderId}.json`);
  try {
    if (fs.existsSync(indexFile)) {
      const raw = JSON.parse(fs.readFileSync(indexFile, "utf8"));
      return Array.isArray(raw) ? raw : [];
    }
  } catch { /* ignore */ }
  return [];
}

function writeIndex(folderId, index) {
  if (!dataDir) return;
  const indexFile = path.join(dataDir, `folder-sync-index-${folderId}.json`);
  try {
    fs.mkdirSync(path.dirname(indexFile), { recursive: true });
    const tmp = indexFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(index, null, 2), "utf8");
    fs.renameSync(tmp, indexFile);
  } catch (e) {
    console.error("[folder-sync] write index failed:", e?.message || e);
  }
}

function mergeIndex(oldIndex, scanResults) {
  const oldMap = new Map(oldIndex.map((item) => [item.relativePath, item]));
  const scannedPaths = new Set(scanResults.map((r) => r.relativePath));
  const merged = [];
  const now = new Date().toISOString();

  // 处理扫描到的文件
  for (const scan of scanResults) {
    const old = oldMap.get(scan.relativePath);

    if (scan.status === "skipped" || scan.status === "error") {
      merged.push({ ...scan, lastScannedAt: now, lastSyncedAt: old?.lastSyncedAt || null, noteId: old?.noteId || null, attachmentId: old?.attachmentId || null });
      continue;
    }

    if (!old) {
      // 新文件
      merged.push({
        relativePath: scan.relativePath,
        size: scan.size,
        mtimeMs: scan.mtimeMs,
        sha256: scan.sha256,
        status: "new",
        lastScannedAt: now,
        lastSyncedAt: null,
        noteId: null,
        attachmentId: null,
      });
    } else if (old.sha256 === scan.sha256) {
      // 未变化
      merged.push({ ...old, status: "unchanged", lastScannedAt: now });
    } else {
      // 内容变化
      merged.push({
        ...old,
        size: scan.size,
        mtimeMs: scan.mtimeMs,
        sha256: scan.sha256,
        status: "changed",
        lastScannedAt: now,
      });
    }
  }

  // 标记已删除的文件（索引中有但扫描不到）
  for (const old of oldIndex) {
    if (!scannedPaths.has(old.relativePath)) {
      merged.push({ ...old, status: "deleted", lastScannedAt: now });
    }
  }

  return merged;
}

// ---------- 日志 ----------

function readLogs() {
  if (!dataDir) return [];
  const logFile = path.join(dataDir, "folder-sync-logs.json");
  try {
    if (fs.existsSync(logFile)) {
      const raw = JSON.parse(fs.readFileSync(logFile, "utf8"));
      return Array.isArray(raw) ? raw : [];
    }
  } catch { /* ignore */ }
  return [];
}

function writeLogs(logs) {
  if (!dataDir) return;
  const logFile = path.join(dataDir, "folder-sync-logs.json");
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const trimmed = logs.slice(-MAX_LOG_ENTRIES);
    const tmp = logFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(trimmed, null, 2), "utf8");
    fs.renameSync(tmp, logFile);
  } catch (e) {
    console.error("[folder-sync] write logs failed:", e?.message || e);
  }
}

function appendLog(folderId, type, message, detail) {
  const logs = readLogs();
  logs.push({
    id: genId(),
    folderId,
    type,
    message,
    createdAt: new Date().toISOString(),
    detail: detail || undefined,
  });
  writeLogs(logs);
}

function getLogs(folderId) {
  const all = readLogs();
  if (!folderId) return all.slice(-50);
  return all.filter((l) => l.folderId === folderId).slice(-50);
}

// ---------- runNow ----------

function runNow(folderId) {
  const configs = readConfigs();
  const config = configs.find((c) => c.folderId === folderId);
  if (!config) return { ok: false, code: "CONFIG_NOT_FOUND", message: "Sync config not found" };

  const folderPath = config.folderPath;
  if (!folderPath || !fs.existsSync(folderPath)) {
    return { ok: false, code: "FOLDER_NOT_FOUND", message: "Folder does not exist: " + folderPath };
  }

  if (isDangerousRoot(folderPath)) {
    return { ok: false, code: "DANGEROUS_PATH", message: "Cannot scan system root or home directory" };
  }

  const startTime = Date.now();
  appendLog(folderId, "scan_started", `Scanning ${folderPath}`);

  try {
    const scanResults = scanFolder(folderPath, config.fileTypes, config.includeSubfolders);
    const oldIndex = readIndex(folderId);
    const merged = mergeIndex(oldIndex, scanResults);
    writeIndex(folderId, merged);

    const stats = {
      total: merged.length,
      added: merged.filter((i) => i.status === "new").length,
      changed: merged.filter((i) => i.status === "changed").length,
      unchanged: merged.filter((i) => i.status === "unchanged").length,
      deleted: merged.filter((i) => i.status === "deleted").length,
      skipped: merged.filter((i) => i.status === "skipped").length,
      errors: merged.filter((i) => i.status === "error").length,
    };
    const durationMs = Date.now() - startTime;

    // 更新配置的 lastScanAt 和 stats
    const cfgIdx = configs.findIndex((c) => c.folderId === folderId);
    if (cfgIdx >= 0) {
      configs[cfgIdx].lastScanAt = new Date().toISOString();
      configs[cfgIdx].lastScanStats = { ...stats, durationMs };
      writeConfigs(configs);
    }

    appendLog(folderId, "scan_completed",
      `Scan complete: +${stats.added} ~${stats.changed} =${stats.unchanged} -${stats.deleted} skip${stats.skipped} err${stats.errors} (${durationMs}ms)`,
      stats
    );

    // 记录 skipped 和 error 详情
    for (const item of merged) {
      if (item.status === "skipped") {
        appendLog(folderId, "file_skipped", `${item.relativePath}: ${item.error}`);
      } else if (item.status === "error") {
        appendLog(folderId, "file_error", `${item.relativePath}: ${item.error}`);
      }
    }

    return {
      ok: true,
      folderId,
      scannedAt: new Date().toISOString(),
      ...stats,
      durationMs,
    };
  } catch (e) {
    appendLog(folderId, "scan_failed", `Scan failed: ${e.message}`);
    return { ok: false, code: "SCAN_FAILED", message: e.message };
  }
}

// ---------- 索引读取（给 renderer 用） ----------

function getIndex(folderId) {
  return readIndex(folderId);
}

// ---------- 待上传文件列表（方案 A：renderer 负责上传） ----------

const TEXT_EXTS = new Set([".md", ".txt", ".markdown", ".html", ".htm"]);
const BINARY_UPLOAD_EXTS = new Set([".pdf", ".docx"]);
const MAX_CONTENT_BYTES = 2 * 1024 * 1024; // 2MB

function computeSourcePathHash(folderId, relativePath) {
  return crypto.createHash("sha256").update(`${folderId}:${relativePath}`).digest("hex");
}

/**
 * 返回需要上传的文件列表（status=new/changed）。
 * 文本文件：md/txt/html，读取 contentText。
 * 附件文件：pdf/docx，contentText=null，通过 getUploadFile 单独读取。
 */
function getPendingUploads(folderId) {
  const configs = readConfigs();
  const config = configs.find((c) => c.folderId === folderId);
  if (!config) return { ok: false, error: "Config not found" };

  const index = readIndex(folderId);
  const pending = [];

  for (const item of index) {
    if (item.status !== "new" && item.status !== "changed") continue;

    const ext = path.extname(item.relativePath).toLowerCase();
    const isText = TEXT_EXTS.has(ext);
    const isBinary = BINARY_UPLOAD_EXTS.has(ext);
    if (!isText && !isBinary) continue;

    // 安全校验：确保路径在 folderPath 内
    const fullPath = path.join(config.folderPath, item.relativePath.replace(/\//g, path.sep));
    const resolvedPath = path.resolve(fullPath);
    const resolvedBase = path.resolve(config.folderPath);
    if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
      pending.push({
        relativePath: item.relativePath,
        filename: path.basename(item.relativePath),
        sha256: item.sha256,
        sourcePathHash: computeSourcePathHash(folderId, item.relativePath),
        size: item.size,
        mtimeMs: item.mtimeMs,
        ext,
        contentText: null,
        existingNoteId: item.noteId || null,
        skipReason: "Path traversal detected",
      });
      continue;
    }

    // 读取前二次确认：lstatSync + realpathSync 边界检查
    // 防止 TOCTOU：scanFolder 时是普通文件，之后被替换为 symlink
    const boundaryCheck = checkPathBoundary(config.folderPath, fullPath);
    if (!boundaryCheck.ok) {
      pending.push({
        relativePath: item.relativePath,
        filename: path.basename(item.relativePath),
        sha256: item.sha256,
        sourcePathHash: computeSourcePathHash(folderId, item.relativePath),
        size: item.size,
        mtimeMs: item.mtimeMs,
        ext,
        contentText: null,
        existingNoteId: item.noteId || null,
        skipReason: boundaryCheck.reason,
      });
      continue;
    }

    // 附件文件（pdf/docx）：不读取内容，通过 getUploadFile 单独读取
    if (isBinary) {
      pending.push({
        relativePath: item.relativePath,
        filename: path.basename(item.relativePath),
        sha256: item.sha256,
        sourcePathHash: computeSourcePathHash(folderId, item.relativePath),
        size: item.size,
        mtimeMs: item.mtimeMs,
        ext,
        contentText: null,
        existingNoteId: item.noteId || null,
        skipReason: null,
      });
      continue;
    }

    // 文本文件：读取内容
    let contentText;
    try {
      const stat = fs.statSync(fullPath);
      if (stat.size > MAX_CONTENT_BYTES) {
        pending.push({
          relativePath: item.relativePath,
          filename: path.basename(item.relativePath),
          sha256: item.sha256,
          sourcePathHash: computeSourcePathHash(folderId, item.relativePath),
          size: item.size,
          mtimeMs: item.mtimeMs,
          ext,
          contentText: null,
          existingNoteId: item.noteId || null,
          skipReason: `File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB > 2MB)`,
        });
        continue;
      }
      contentText = fs.readFileSync(fullPath, "utf8");
    } catch (e) {
      pending.push({
        relativePath: item.relativePath,
        filename: path.basename(item.relativePath),
        sha256: item.sha256,
        sourcePathHash: computeSourcePathHash(folderId, item.relativePath),
        size: item.size,
        mtimeMs: item.mtimeMs,
        ext,
        contentText: null,
        existingNoteId: item.noteId || null,
        skipReason: `Read failed: ${e.message}`,
      });
      continue;
    }

    pending.push({
      relativePath: item.relativePath,
      filename: path.basename(item.relativePath),
      sha256: item.sha256,
      sourcePathHash: computeSourcePathHash(folderId, item.relativePath),
      size: item.size,
      mtimeMs: item.mtimeMs,
      ext,
      contentText,
      existingNoteId: item.noteId || null,
      skipReason: null,
    });
  }

  return { ok: true, folderId, config: { targetNotebookId: config.targetNotebookId }, pending };
}

/**
 * renderer 上传成功后回调，写回 noteId / attachmentId / lastSyncedAt / status。
 *
 * result.skipped === true  → status="skipped"（超限/文件不可读等，非网络错误）
 * result.success === true  → status="synced"
 * 否则                     → status="error"（接口失败/网络失败）
 */
function markUploadResult(folderId, relativePath, result) {
  const index = readIndex(folderId);
  const item = index.find((i) => i.relativePath === relativePath);
  if (!item) return { ok: false, error: "Index entry not found" };

  const now = new Date().toISOString();
  if (result.skipped) {
    item.status = "skipped";
    item.noteId = result.noteId || item.noteId;
    item.attachmentId = result.attachmentId || item.attachmentId;
    item.lastSyncedAt = now;
    item.error = result.error || "Skipped";
  } else if (result.success) {
    item.status = "synced";
    item.noteId = result.noteId;
    item.attachmentId = result.attachmentId || item.attachmentId;
    item.lastSyncedAt = now;
    item.error = undefined;
  } else {
    item.status = "error";
    item.error = result.error || "Upload failed";
  }

  writeIndex(folderId, index);

  // 日志
  if (result.success || result.skipped) {
    appendLog(folderId, "upload_success", `${relativePath} → ${result.noteId || "skipped"}`);
  } else {
    appendLog(folderId, "upload_failed", `${relativePath}: ${result.error || "unknown"}`);
  }

  return { ok: true };
}

// ---------- 安全文件读取（给 renderer 上传附件用） ----------

const MAX_UPLOAD_FILE_SIZE = 50 * 1024 * 1024; // 50MB

function getUploadFile(folderId, relativePath) {
  const configs = readConfigs();
  const config = configs.find((c) => c.folderId === folderId);
  if (!config) return { ok: false, code: "CONFIG_NOT_FOUND", message: "Sync config not found" };

  // 安全校验：relativePath 不能是绝对路径或包含 ..
  if (!relativePath || relativePath.includes("..") || /^[A-Za-z]:/.test(relativePath) || relativePath.startsWith("/")) {
    return { ok: false, code: "UNSAFE_PATH", message: "Invalid relativePath" };
  }

  // 校验文件在 index 中存在且状态为 new/changed
  const index = readIndex(folderId);
  const item = index.find((i) => i.relativePath === relativePath);
  if (!item) return { ok: false, code: "NOT_INDEXED", message: "File not found in index" };
  if (item.status !== "new" && item.status !== "changed" && item.status !== "error") {
    return { ok: false, code: "INVALID_STATUS", message: `File status is ${item.status}, not pending` };
  }

  // 构建完整路径并校验在 folderPath 内
  const fullPath = path.join(config.folderPath, relativePath.replace(/\//g, path.sep));
  const resolvedPath = path.resolve(fullPath);
  const resolvedBase = path.resolve(config.folderPath);
  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
    return { ok: false, code: "PATH_TRAVERSAL", message: "Path traversal detected" };
  }

  // 读取前二次确认：lstatSync + realpathSync 边界检查
  // 防止 TOCTOU：scanFolder 时是普通文件，之后被替换为 symlink
  const boundaryCheck = checkPathBoundary(config.folderPath, fullPath);
  if (!boundaryCheck.ok) {
    return { ok: false, code: "SYMLINK_DETECTED", message: boundaryCheck.reason };
  }

  // 检查文件存在和大小
  try {
    const stat = fs.statSync(resolvedPath);
    if (stat.size > MAX_UPLOAD_FILE_SIZE) {
      return { ok: false, code: "FILE_TOO_LARGE", message: `File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB > 50MB)` };
    }

    const buffer = fs.readFileSync(resolvedPath);
    const ext = path.extname(item.filename || relativePath).toLowerCase();
    const mimeTypes = {
      ".pdf": "application/pdf",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".doc": "application/msword",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".xls": "application/vnd.ms-excel",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ".ppt": "application/vnd.ms-powerpoint",
    };

    return {
      ok: true,
      filename: item.filename || path.basename(relativePath),
      mimeType: mimeTypes[ext] || "application/octet-stream",
      size: buffer.length,
      buffer: buffer.toString("base64"),
    };
  } catch (e) {
    return { ok: false, code: "READ_FAILED", message: `Failed to read file: ${e.message}` };
  }
}

module.exports = {
  setDataDir,
  readConfigs,
  saveConfig,
  removeConfig,
  getIndex,
  getLogs,
  runNow,
  getPendingUploads,
  markUploadResult,
  getUploadFile,
  appendLog,
};

const fs = require("fs");
const path = require("path");

const DATA_DIR_NAME = "nowen-data";
const DATA_DIR_POINTER_FILE = "nowen-data-location.json";

function getDefaultDataPath(userDataRoot) {
  return path.join(userDataRoot, DATA_DIR_NAME);
}

function getDataDirPointerPath(userDataRoot) {
  return path.join(userDataRoot, DATA_DIR_POINTER_FILE);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeAbsolutePath(value) {
  if (!isNonEmptyString(value)) return null;
  const trimmed = value.trim();
  if (!path.isAbsolute(trimmed)) return null;
  return path.resolve(trimmed);
}

function isSamePath(a, b) {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function isPathInside(child, parent) {
  const childResolved = path.resolve(child);
  const parentResolved = path.resolve(parent);
  const relative = path.relative(parentResolved, childResolved);
  if (!relative) return false;
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function readCustomDataDir(userDataRoot) {
  const pointerPath = getDataDirPointerPath(userDataRoot);
  try {
    if (!fs.existsSync(pointerPath)) return null;
    const raw = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
    const dataDir = normalizeAbsolutePath(raw?.dataDir);
    if (!dataDir) return null;

    if (fs.existsSync(dataDir)) return dataDir;
    const parent = path.dirname(dataDir);
    return fs.existsSync(parent) ? dataDir : null;
  } catch (err) {
    console.warn("[dataDir] read pointer failed:", err?.message || err);
    return null;
  }
}

function writeCustomDataDir(userDataRoot, dataDir) {
  const normalized = normalizeAbsolutePath(dataDir);
  if (!normalized) throw new Error("INVALID_PATH");

  const pointerPath = getDataDirPointerPath(userDataRoot);
  fs.mkdirSync(path.dirname(pointerPath), { recursive: true });
  const tmp = `${pointerPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ dataDir: normalized }, null, 2), "utf8");
  fs.renameSync(tmp, pointerPath);
  return normalized;
}

function getUserDataPathFromRoot(userDataRoot) {
  return readCustomDataDir(userDataRoot) || getDefaultDataPath(userDataRoot);
}

function validateMigrationTarget(targetDir, {
  currentDir,
  appPath,
  resourcesPath,
} = {}) {
  const resolved = normalizeAbsolutePath(targetDir);
  if (!resolved) return { ok: false, error: "INVALID_PATH" };
  if (!currentDir) return { ok: false, error: "CURRENT_DIR_REQUIRED" };

  const current = path.resolve(currentDir);
  if (isSamePath(resolved, current)) return { ok: false, error: "TARGET_IS_CURRENT" };
  if (isPathInside(resolved, current)) return { ok: false, error: "TARGET_INSIDE_CURRENT" };
  if (isSamePath(resolved, path.parse(resolved).root)) return { ok: false, error: "TARGET_IS_ROOT" };

  for (const protectedPath of [appPath, resourcesPath]) {
    if (!protectedPath) continue;
    if (isSamePath(resolved, protectedPath) || isPathInside(resolved, protectedPath)) {
      return { ok: false, error: "TARGET_INSIDE_APP" };
    }
  }

  if (fs.existsSync(resolved)) {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return { ok: false, error: "TARGET_NOT_DIRECTORY" };
    const entries = fs.readdirSync(resolved);
    if (entries.length > 0 && !fs.existsSync(path.join(resolved, "nowen-note.db"))) {
      return { ok: false, error: "TARGET_NOT_EMPTY" };
    }
  }

  return { ok: true, resolved };
}

function copyDataDir(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    return;
  }
  fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
}

function verifyCopiedDataDir(sourceDir, targetDir) {
  for (const name of ["nowen-note.db", "attachments", "settings.json"]) {
    const source = path.join(sourceDir, name);
    if (fs.existsSync(source) && !fs.existsSync(path.join(targetDir, name))) {
      return { ok: false, error: `MISSING_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}` };
    }
  }
  return { ok: true };
}

module.exports = {
  DATA_DIR_NAME,
  DATA_DIR_POINTER_FILE,
  getDefaultDataPath,
  getDataDirPointerPath,
  getUserDataPathFromRoot,
  readCustomDataDir,
  writeCustomDataDir,
  validateMigrationTarget,
  copyDataDir,
  verifyCopiedDataDir,
};

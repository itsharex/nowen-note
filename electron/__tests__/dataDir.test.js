const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  getDefaultDataPath,
  getDataDirPointerPath,
  getUserDataPathFromRoot,
  writeCustomDataDir,
  validateMigrationTarget,
} = require("../dataDir");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nowen-data-dir-"));
}

test("uses the default nowen-data directory when no pointer exists", () => {
  const root = tempRoot();

  assert.equal(getUserDataPathFromRoot(root), path.join(root, "nowen-data"));
});

test("reads a valid custom data directory from the bootstrap pointer", () => {
  const root = tempRoot();
  const custom = path.join(root, "custom data");
  fs.mkdirSync(custom, { recursive: true });

  writeCustomDataDir(root, custom);

  assert.equal(getDataDirPointerPath(root), path.join(root, "nowen-data-location.json"));
  assert.equal(getUserDataPathFromRoot(root), custom);
});

test("rejects unsafe migration targets", () => {
  const root = tempRoot();
  const currentDir = getDefaultDataPath(root);
  const childDir = path.join(currentDir, "nested");
  const nonEmptyDir = path.join(root, "non-empty");
  const rootDir = path.parse(root).root;
  fs.mkdirSync(nonEmptyDir, { recursive: true });
  fs.writeFileSync(path.join(nonEmptyDir, "other.txt"), "x", "utf8");

  assert.equal(validateMigrationTarget("relative-dir", { currentDir }).ok, false);
  assert.equal(validateMigrationTarget(childDir, { currentDir }).ok, false);
  assert.equal(validateMigrationTarget(rootDir, { currentDir }).ok, false);
  assert.equal(validateMigrationTarget(nonEmptyDir, { currentDir }).ok, false);
});

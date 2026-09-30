import fs from "node:fs/promises";
import path from "node:path";
import { parseCliArgs, defaultTempDir, repoRoot, writeJson } from "./pipeline-lib.mjs";

const options = parseCliArgs();
const name = String(options.name ?? options.positionals[0] ?? "").trim();
if (!name || !/^[a-zA-Z0-9._-]+$/.test(name)) {
  throw new Error("Usage: npm run dev:init -- --name experimental-branch [--base-version stable-id]");
}
const baseVersion = options["base-version"] ?? options.baseVersion;
const root = path.join(repoRoot, "data", "versions", "local", name);
const customRoot = path.join(repoRoot, "data", "custom-recipes");
const now = new Date().toISOString();

await fs.mkdir(path.join(root, "textures"), { recursive: true });
const baseDir = baseVersion && path.join(repoRoot, "public", "datasets", "susy", String(baseVersion));
if (baseDir) {
  for (const file of ["recipes.json", "recipes.json.gz", "resource-index.json.gz", "recipe-index.json.gz", "recipe-lookup-index.json.gz"]) {
    await copyIfPresent(path.join(baseDir, file), path.join(root, file));
  }
  await copyDirectoryIfPresent(path.join(baseDir, "textures"), path.join(root, "textures"));
}
await writeJson(path.join(root, "version.json"), {
  schemaVersion: 1,
  id: `local-dev-${name}-${Date.now()}`,
  name,
  versionLabel: name,
  baseVersion: baseVersion ? String(baseVersion) : null,
  createdAt: now,
  source: "local-dev",
});
await writeJson(path.join(root, "items.json"), { schemaVersion: 1, items: [] });
if (!(await fileExists(path.join(root, "recipes.json"))) && !(await fileExists(path.join(root, "recipes.json.gz")))) {
  await writeJson(path.join(root, "recipes.json"), { schemaVersion: 1, recipes: [] });
}
await fs.mkdir(path.join(customRoot, "history"), { recursive: true });
try {
  await fs.access(path.join(customRoot, "local-dev.json"));
} catch {
  await writeJson(path.join(customRoot, "local-dev.json"), { schemaVersion: 1, recipes: [] });
}
console.log(`Initialized local development version ${name}${baseVersion ? ` from ${baseVersion}` : ""}.`);
console.log(`Files: ${root}`);
console.log(`Logs and pipeline state remain under ${defaultTempDir}.`);

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function copyIfPresent(source, target) {
  try {
    await fs.copyFile(source, target);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function copyDirectoryIfPresent(source, target) {
  try {
    await fs.cp(source, target, { recursive: true, force: false, errorOnExist: false });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

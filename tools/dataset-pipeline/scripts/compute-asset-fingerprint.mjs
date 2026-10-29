import fs from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { writeFileAtomic } from "../lib/atomic-write.mjs";

const instanceRoot = process.argv[2];
const outputPath = process.argv[3];

if (!instanceRoot || !outputPath) {
  throw new Error("Usage: compute-asset-fingerprint.mjs <gtnh-instance-root> <output.json>");
}

const roots = ["mods", "resourcepacks", "config", "scripts"];
const extensions = new Set([
  ".jar",
  ".zip",
  ".json",
  ".cfg",
  ".conf",
  ".properties",
  ".png",
  ".lang",
  ".txt",
]);
const files = [];

for (const root of roots) {
  const rootPath = path.join(instanceRoot, root);
  if (!existsSync(rootPath)) {
    continue;
  }
  files.push(...(await collectFiles(rootPath, root)));
}

files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

const hash = crypto.createHash("sha256");
for (const file of files) {
  hash.update(file.relativePath);
  hash.update("\0");
  hash.update(String(file.size));
  hash.update("\0");
  await hashFile(file.absolutePath, hash);
  hash.update("\0");
}

const fingerprint = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  hash: hash.digest("hex"),
  fileCount: files.length,
  roots,
};

await writeFileAtomic(outputPath, `${JSON.stringify(fingerprint, null, 2)}\n`);
console.log(`Wrote GTNH asset fingerprint ${fingerprint.hash} from ${files.length} file(s).`);

async function collectFiles(rootPath, rootName) {
  const found = [];
  for (const entry of await fs.readdir(rootPath, { withFileTypes: true })) {
    const absolutePath = path.join(rootPath, entry.name);
    const relativePath = path.join(rootName, entry.name).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      found.push(...(await collectFiles(absolutePath, relativePath)));
      continue;
    }
    if (!entry.isFile() || !extensions.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }
    const stat = await fs.stat(absolutePath);
    found.push({ absolutePath, relativePath, size: stat.size });
  }
  return found;
}

async function hashFile(filePath, hash) {
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
}

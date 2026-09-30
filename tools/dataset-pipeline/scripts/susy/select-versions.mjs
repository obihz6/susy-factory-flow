import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import * as readline from "node:readline/promises";
import { defaultTempDir, getConfigPath, loadOrCreateConfig, parseCliArgs, repoRoot, saveConfig, writeJson } from "./pipeline-lib.mjs";

const options = parseCliArgs();
const selectionPath = path.join(path.resolve(String(options.temp ?? defaultTempDir)), "version-selection.json");
const localRoot = path.join(repoRoot, "data", "versions", "local");
const versions = await discoverVersions();
if (versions.length === 0) throw new Error("No Supersymmetry versions were found.");

let selected = await loadPreviousSelection();
const includeLocal = options["include-local"] === true || options["include-local"] === "true" ||
  selected.some((id) => versions.find((version) => version.id === id)?.local);
const selectableVersions = includeLocal ? versions : versions.filter((version) => !version.local);
if (options.version || options.versions || options.range || options.all || !process.stdin.isTTY) {
  selected = selectNonInteractive(options, selectableVersions);
} else {
  selected = await selectInteractive(selectableVersions, selected);
}

const result = {
  schemaVersion: 1,
  selectedVersions: selected,
  includeLocal,
  localDevVersions: versions.filter((version) => version.local).map((version) => version.id),
  updatedAt: new Date().toISOString(),
};
await writeJson(selectionPath, result);
await writeJson(path.join(path.dirname(selectionPath), "config.json"), result);
const pipelineConfig = await loadOrCreateConfig({ config: getConfigPath(options), tempDir: options.temp ?? defaultTempDir });
pipelineConfig.selectedVersions = result.selectedVersions;
pipelineConfig.includeLocal = result.includeLocal;
pipelineConfig.localDevVersions = result.localDevVersions;
await saveConfig(pipelineConfig);
console.log(`Selected ${selected.length} version(s): ${selected.join(", ")}`);
console.log(`Saved selection to ${selectionPath}`);

async function discoverVersions() {
  const discovered = [];
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, "public", "datasets", "susy", "datasets.manifest.json"), "utf8"));
    discovered.push(...(manifest.versions ?? []).map((version) => ({
      id: version.id,
      name: version.gtnhVersion,
      date: version.publishedAt,
      size: "published",
      local: false,
    })));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  // The manifest is the local cache, but selection also needs releases that
  // have not been exported yet. GitHub is public; CurseForge is queried when
  // the caller supplies its project id and API key.
  discovered.push(...await discoverGitHubReleases());
  discovered.push(...await discoverCurseForgeFiles());

  try {
    for (const entry of await fs.readdir(localRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-zA-Z0-9._-]+$/.test(entry.name)) continue;
      const metadata = await readJsonIfPresent(path.join(localRoot, entry.name, "version.json"));
      discovered.push({
        id: entry.name,
        name: metadata?.versionLabel ?? entry.name,
        date: metadata?.createdAt ?? "local",
        size: "local",
        local: true,
      });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const unique = new Map();
  for (const version of discovered) {
    const previous = unique.get(version.id);
    // Prefer local metadata, then a real remote size/date over the manifest
    // placeholder. This keeps the menu stable after a release is exported.
    if (!previous || version.local || previous.size === "published") unique.set(version.id, version);
  }
  return [...unique.values()].sort((a, b) => Number(b.local) - Number(a.local) || String(b.date).localeCompare(String(a.date)) || a.name.localeCompare(b.name));
}

async function discoverGitHubReleases() {
  try {
    const response = await fetch("https://api.github.com/repos/SymmetricDevs/Supersymmetry/releases?per_page=100", {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (!response.ok) return [];
    const releases = await response.json();
    return (Array.isArray(releases) ? releases : []).filter((release) => release?.tag_name && !release.draft).map((release) => ({
      id: String(release.tag_name).replace(/^v/, ""),
      name: release.name || release.tag_name,
      date: release.published_at || release.created_at || "unknown",
      size: formatBytes((release.assets ?? []).reduce((total, asset) => total + Number(asset.size ?? 0), 0)),
      local: false,
      source: "github",
    }));
  } catch {
    return [];
  }
}

async function discoverCurseForgeFiles() {
  const projectId = process.env.CURSEFORGE_PROJECT_ID;
  const apiKey = process.env.CURSEFORGE_API_KEY;
  if (!projectId || !apiKey) return [];
  try {
    const response = await fetch(`https://api.curseforge.com/v1/mods/${encodeURIComponent(projectId)}/files?pageSize=100`, {
      headers: { Accept: "application/json", "x-api-key": apiKey },
    });
    if (!response.ok) return [];
    const payload = await response.json();
    return (payload.data ?? []).filter((file) => file?.id && file?.displayName).map((file) => ({
      id: String(file.displayName).replace(/^v/i, "").replace(/\\.zip$/i, ""),
      name: file.displayName,
      date: file.fileDate ?? "unknown",
      size: formatBytes(Number(file.fileLength ?? 0)),
      local: false,
      source: "curseforge",
    }));
  } catch {
    return [];
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "unknown size";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function selectNonInteractive(cli, available) {
  if (cli.all === true || cli.all === "true") return available.map((version) => version.id);
  if (cli.range) {
    const range = String(cli.range).split("-").map((value) => Number.parseInt(value.trim(), 10));
    if (range.length === 2 && range.every(Number.isInteger)) {
      const start = Math.max(1, Math.min(range[0], range[1]));
      const end = Math.min(available.length, Math.max(range[0], range[1]));
      return available.slice(start - 1, end).map((version) => version.id);
    }
    throw new Error(`Invalid version range: ${cli.range}`);
  }
  const raw = cli.versions ?? cli.version ?? "";
  const values = String(raw).split(",").map((value) => value.trim()).filter(Boolean);
  const matched = available.filter((version) => values.includes(version.id) || values.includes(version.name));
  if (matched.length === 0) throw new Error(`None of the requested versions were found: ${values.join(", ")}`);
  return matched.map((version) => version.id);
}

async function selectInteractive(available, previous) {
  console.log("Available Supersymmetry versions:");
  available.forEach((version, index) => {
    const marker = previous.includes(version.id) ? "*" : " ";
    console.log(`${index + 1}. [${marker}] ${version.name} | ${version.date} | ${version.size}${version.local ? " | LOCAL" : ""}`);
  });
  console.log("Enter numbers separated by commas, 'all', or 'range:start-end'.");
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await prompt.question("Versions: ")).trim();
    if (answer.toLowerCase() === "all") return available.map((version) => version.id);
    const range = /^range:(\d+)-(\d+)$/i.exec(answer);
    if (range) {
      const start = Math.max(1, Number(range[1]));
      const end = Math.min(available.length, Number(range[2]));
      return available.slice(Math.min(start, end) - 1, Math.max(start, end)).map((version) => version.id);
    }
    const indexes = answer.split(",").map((value) => Number.parseInt(value.trim(), 10));
    const chosen = indexes.filter((index) => index >= 1 && index <= available.length).map((index) => available[index - 1].id);
    if (chosen.length === 0) return previous.filter((id) => available.some((version) => version.id === id));
    return [...new Set(chosen)];
  } finally {
    prompt.close();
  }
}

async function loadPreviousSelection() {
  try {
    const data = JSON.parse(await fs.readFile(selectionPath, "utf8"));
    return Array.isArray(data.selectedVersions) ? data.selectedVersions : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

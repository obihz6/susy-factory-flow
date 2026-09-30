/**
 * Detects Supersymmetry releases worth exporting, writing the same
 * .pipeline/detected-versions.json contract the GTNH workflow consumes.
 *
 * Channels:
 *   stable — GitHub releases of SymmetricDevs/Supersymmetry (the pack repo
 *            tags every published version; CurseForge mirrors them).
 *   daily  — newest commit on the master-ceu branch, id suffixed with the
 *            short sha so repeated runs deduplicate.
 *
 * Usage: node detect-susy-versions.mjs   (env: CHANNEL=stable|daily|both,
 *         GITHUB_TOKEN optional; output: GitHub Actions outputs + file)
 */
import { appendFileSync } from "node:fs";
import fs from "node:fs/promises";

const channelInput = process.env.CHANNEL ?? "both";
const githubToken = process.env.GITHUB_TOKEN;
const packRepo = "SymmetricDevs/Supersymmetry";
const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
};

async function githubJson(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API ${url} -> ${response.status}`);
  }
  return response.json();
}

async function latestStableRelease() {
  try {
    const release = await githubJson(`https://api.github.com/repos/${packRepo}/releases/latest`);
    if (!release?.tag_name) return null;
    return {
      id: release.tag_name.replace(/^v/, ""),
      label: release.name || release.tag_name,
      channel: "stable",
      sourceKind: "pack-release",
      sourceRef: release.tag_name,
    };
  } catch {
    return null;
  }
}

async function dailyBuild() {
  try {
    const commit = await githubJson(
      `https://api.github.com/repos/${packRepo}/commits/master-ceu`,
    );
    if (!commit?.sha) return null;
    const shortSha = commit.sha.slice(0, 8);
    const date = String(commit.commit?.committer?.date || "").slice(0, 10);
    return {
      id: `daily-${date}-${shortSha}`,
      label: `master-ceu ${shortSha}`,
      channel: "daily",
      sourceKind: "branch-commit",
      sourceRef: commit.sha,
    };
  } catch {
    return null;
  }
}

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

const selectedChannels =
  channelInput === "both" ? new Set(["stable", "daily"]) : new Set([channelInput]);
const detected = [];

let alreadyPublished = new Set();
try {
  const manifestPath = process.env.DATASETS_MANIFEST ?? "public/datasets/susy/datasets.manifest.json";
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  alreadyPublished = new Set((manifest.versions || []).map((version) => version.id));
} catch {
  // No manifest yet: everything is worth building.
}

if (selectedChannels.has("stable")) {
  const stable = await latestStableRelease();
  if (stable && !alreadyPublished.has(stable.id)) detected.push(stable);
}
if (selectedChannels.has("daily")) {
  const daily = await dailyBuild();
  if (daily && !alreadyPublished.has(daily.id)) detected.push(daily);
}

await fs.mkdir(".pipeline", { recursive: true });
await fs.writeFile(
  ".pipeline/detected-versions.json",
  `${JSON.stringify({ schemaVersion: 1, detected }, null, 2)}\n`,
);

writeOutput("matrix", JSON.stringify({ include: detected }));
writeOutput("has_versions", detected.length > 0 ? "true" : "false");
console.log(`Detected ${detected.length} SUSY version(s): ${detected.map((d) => d.id).join(", ") || "none"}`);

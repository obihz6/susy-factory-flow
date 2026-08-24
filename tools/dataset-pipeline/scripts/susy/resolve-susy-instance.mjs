/**
 * Resolves the Supersymmetry instance the SUSY oracle export should run
 * against, in this order:
 *
 *   1. SUSY_INSTANCE_DIR (explicit; validated)
 *   2. an already-bootstrapped ./temp/.minecraft
 *   3. repo-local SUSY checkouts under ./temp
 *   4. known launcher instance roots (Prism/PolyMC/MultiMC/ATLauncher/
 *      CurseForge/GDLauncher/vanilla) plus bounded *supersymmetry* lookups
 *        under $HOME
 *
 * With nothing found, --bootstrap-if-missing downloads a barebone instance
 * into ./temp/.minecraft (bootstrap-susy-instance.mjs) and resolves that.
 *
 * Output (stdout): KEY="value" shell lines by default, --json for JSON.
 * Exit codes: 0 resolved, 1 nothing found (only possible with
 * --no-bootstrap), 2 explicit SUSY_INSTANCE_DIR is not a usable instance.
 *
 * Usage:
 *   node resolve-susy-instance.mjs [--instance <dir>] [--json]
 *        [--bootstrap-if-missing] [--no-bootstrap] [--ref <tag|branch>]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  compareVersions,
  findLauncherInstanceInfo,
  findOracleJar,
  inspectInstanceDir,
} from "./susy-instance-lib.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..", "..", "..");

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) return true;
  args.splice(index, 2);
  return value;
};
const explicitInstance = flag("--instance") ?? process.env.SUSY_INSTANCE_DIR;
const bootstrapRef = flag("--ref") ?? process.env.SUSY_BOOTSTRAP_REF;
const jsonOutput = args.includes("--json");
const bootstrapIfMissing = args.includes("--bootstrap-if-missing");
const noBootstrap = args.includes("--no-bootstrap");
const bootstrapDir = path.join(repoRoot, "temp", ".minecraft");

function resolveResult(result) {
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  for (const [key, value] of Object.entries(result)) {
    if (value === undefined || value === false) continue;
    if (value === true) {
      console.log(`${key.toUpperCase()}=1`);
      continue;
    }
    console.log(`${key.toUpperCase()}="${String(value).replace(/"/g, '\\"')}"`);
  }
}

function fail(message, result) {
  if (result) resolveResult(result);
  console.error(`resolve-susy-instance: ${message}`);
  process.exit(2);
}

function scanHomeForSupersymmetry() {
  const home = os.homedir();
  const hits = [];
  const walk = (dir, depth) => {
    if (depth > 2) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (/^\./.test(entry.name) || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (/supersymmetry/i.test(entry.name)) {
        hits.push(full);
      } else {
        walk(full, depth + 1);
      }
    }
  };
  walk(home, 0);
  return hits;
}

function launcherRoots() {
  const home = os.homedir();
  const appData = process.env.APPDATA ? path.join(process.env.APPDATA) : path.join(home, "AppData", "Roaming");
  const roots = [
    [path.join(repoRoot, "temp", ".minecraft"), "repo"],
    [path.join(repoRoot, "temp", "Supersymmetry"), "repo"],
    [path.join(home, ".local", "share", "PrismLauncher", "instances"), "launcher"],
    [path.join(home, ".var", "app", "org.prismlauncher.PrismLauncher", "data", "PrismLauncher", "instances"), "launcher"],
    [path.join(appData, "PrismLauncher", "instances"), "launcher"],
    [path.join(home, ".local", "share", "PolyMC", "instances"), "launcher"],
    [path.join(appData, "PolyMC", "instances"), "launcher"],
    [path.join(home, ".local", "share", "multimc", "instances"), "launcher"],
    [path.join(appData, "multimc", "instances"), "launcher"],
    [path.join(home, ".local", "share", "atlauncher", "instances"), "launcher"],
    [path.join(appData, "ATLauncher", "instances"), "launcher"],
    [path.join(home, "curseforge", "minecraft", "Instances"), "launcher"],
    [path.join(home, ".curseforge", "minecraft", "Instances"), "launcher"],
    [path.join(appData, "gdlauncher_next", "instances"), "launcher"],
    [path.join(home, ".gdlauncher", "instances"), "launcher"],
    [path.join(home, ".minecraft"), "launcher"],
  ];
  return roots.map(([dir, source]) => ({ dir, source }));
}

function collectCandidates() {
  const candidates = [];
  const seen = new Set();
  const push = (dir, source) => {
    if (!dir || seen.has(dir)) return;
    seen.add(dir);
    candidates.push({ dir, source });
  };

  for (const { dir: root, source } of launcherRoots()) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    const looksLikeInstanceRoot = entries.some((entry) => entry.isDirectory()) &&
      entries.some((entry) => entry.name === "instances" || /instance/i.test(root));
    push(root, source);
    if (looksLikeInstanceRoot) {
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const wrapper = path.join(root, entry.name);
        push(wrapper, source);
        // Prism/PolyMC/MultiMC wrappers keep the actual game dir one level
        // down (minecraft/ or .minecraft/); the wrapper itself only holds
        // launcher metadata like instance.cfg.
        push(path.join(wrapper, "minecraft"), source);
        push(path.join(wrapper, ".minecraft"), source);
      }
    }
  }
  for (const dir of scanHomeForSupersymmetry()) push(dir, "home-scan");
  return candidates;
}

function bestCandidate() {
  let best;
  for (const { dir, source } of collectCandidates()) {
    const info = inspectInstanceDir(dir);
    if (info.kind !== "instance") continue;
    const ranked = { ...info, source };
    if (
      !best ||
      info.score > best.score ||
      (info.score === best.score &&
        compareVersions(info.pack?.version, best.pack?.version) > 0)
    ) {
      best = ranked;
    }
  }
  return best;
}

function resultFor(info, source) {
  const launcher = findLauncherInstanceInfo(info.dir);
  return {
    found: true,
    instanceDir: info.dir,
    version: info.pack?.version ?? launcher?.managedPackVersion,
    minecraft: info.pack?.minecraft ?? "1.12.2",
    forge: info.pack?.forge,
    source,
    launchScript: info.launchScript,
    susyCoreJar: info.susyCoreJar,
    susyJar: info.susyJar,
    prismInstanceId: launcher?.instanceId,
    prismFlatpakAppId: launcher?.flatpakAppId,
    oracleJar: findOracleJar(repoRoot),
  };
}

// --- Explicit instance wins ------------------------------------------------

if (explicitInstance) {
  const dir = path.resolve(explicitInstance);
  const info = inspectInstanceDir(dir);
  if (info.kind === "instance") {
    resolveResult(resultFor(info, "env"));
    process.exit(0);
  }
  if (info.kind === "pack-source") {
    fail(
      `${dir} is a packwiz checkout without downloaded mods; run packwiz-installer ` +
        `inside it, or unset SUSY_INSTANCE_DIR to auto-detect or bootstrap one.`,
    );
  }
  fail(`${dir} is not a Supersymmetry instance (no pack.toml, no SUSY jars).`);
}

// --- Detection --------------------------------------------------------------

const detected = bestCandidate();
if (detected) {
  resolveResult(resultFor(detected, detected.source));
  process.exit(0);
}

if (noBootstrap || !bootstrapIfMissing) {
  resolveResult({ found: false, bootstrapDir });
  console.error(
    "resolve-susy-instance: no Supersymmetry instance found " +
      `(a barebone one can be downloaded into ${bootstrapDir}).`,
  );
  process.exit(1);
}

// --- Bootstrap fallback -------------------------------------------------------

console.error(
  `resolve-susy-instance: no instance found; downloading a barebone one into ${bootstrapDir}...`,
);
const bootstrap = path.join(scriptDir, "bootstrap-susy-instance.mjs");
const bootstrapArgs = [bootstrap, bootstrapDir];
if (bootstrapRef) bootstrapArgs.push("--ref", String(bootstrapRef));
const ran = spawnSync(process.execPath, bootstrapArgs, { stdio: "inherit" });
if (ran.status !== 0) {
  console.error("resolve-susy-instance: bootstrap failed.");
  process.exit(ran.status ?? 1);
}
const bootstrapped = inspectInstanceDir(bootstrapDir);
if (bootstrapped.kind !== "instance") {
  fail(`bootstrap produced ${bootstrapDir} but it does not look like an instance.`);
}
resolveResult(resultFor(bootstrapped, "bootstrap"));

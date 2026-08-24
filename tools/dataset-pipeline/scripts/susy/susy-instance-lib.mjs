/**
 * Shared detection logic for local Supersymmetry instances.
 *
 * The SUSY oracle export needs a game directory the client can boot from:
 * a packwiz pack.toml (name/version/minecraft/forge), real downloaded mod
 * jars under mods/, and ideally a Forge runtime plus a start script. This
 * module holds the pure parts — pack.toml parsing, directory inspection,
 * candidate scoring — so the resolver CLI and its tests share one contract.
 */
import fs from "node:fs";
import path from "node:path";

export const SUSY_PACK_REPO = "SymmetricDevs/Supersymmetry";

/**
 * Minimal packwiz pack.toml reader: only what the pipeline needs (top-level
 * strings and the [versions] table). Real TOML parsing is deliberately not
 * worth a dependency here.
 */
export function parsePackToml(text) {
  const result = { name: undefined, version: undefined, minecraft: undefined, forge: undefined };
  let table = "";
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const tableMatch = /^\[([^[\]]+)\]$/.exec(line);
    if (tableMatch) {
      table = tableMatch[1].trim().toLowerCase();
      continue;
    }
    const pair = /^([^=]+?)\s*=\s*"((?:\\.|[^"\\])*)"\s*$/.exec(line);
    if (!pair) continue;
    const key = pair[1].trim().toLowerCase();
    const value = pair[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    if (table === "" || table === "versions") {
      if (table === "" && key === "name") result.name = value;
      if (table === "" && key === "version") result.version = value;
      if (key === "minecraft") result.minecraft = value;
      if (key === "forge") result.forge = value;
    }
  }
  return result;
}

/** Compare dotted version strings numerically where possible ("0.2.10" > "0.2.9"). */
export function compareVersions(left, right) {
  const leftParts = String(left ?? "").split(".");
  const rightParts = String(right ?? "").split(".");
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const a = Number.parseInt(leftParts[index], 10);
    const b = Number.parseInt(rightParts[index], 10);
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return a - b;
    if (!Number.isFinite(a) && Number.isFinite(b)) return -1;
    if (Number.isFinite(a) && !Number.isFinite(b)) return 1;
    const ta = leftParts[index] ?? "";
    const tb = rightParts[index] ?? "";
    if (ta !== tb) return ta < tb ? -1 : 1;
  }
  return 0;
}

const SUSY_JAR_PATTERN = /(?:^|[-_.])(?:supersymmetry|susycore|susy-?core)(?:[-_.]|$)/i;
const LAUNCH_SCRIPT_PATTERN = /^(?:start|launch)[^/]*\.sh$/i;

/**
 * What the export can learn about one directory. `kind`:
 *   "instance"    — real mod jars present; the client can run here.
 *   "pack-source" — packwiz metadata only; needs an install pass first.
 *   "unknown"     — nothing SUSY-shaped.
 */
export function inspectInstanceDir(dir) {
  const info = {
    dir,
    kind: "unknown",
    score: 0,
    pack: undefined,
    jarCount: 0,
    susyJar: undefined,
    susyCoreJar: undefined,
    launchScript: undefined,
    hasForgeRuntime: false,
  };

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return info;
  }
  const names = new Set(entries.map((entry) => entry.name));

  const packTomlPath = path.join(dir, "pack.toml");
  if (names.has("pack.toml")) {
    try {
      const pack = parsePackToml(fs.readFileSync(packTomlPath, "utf8"));
      if (/supersymmetry/i.test(pack.name ?? "")) {
        info.pack = pack;
        info.score += 10;
      }
    } catch {
      // Unreadable pack.toml: keep scoring on the mods directory alone.
    }
  }

  const modsDir = path.join(dir, "mods");
  let modEntries;
  try {
    modEntries = fs.readdirSync(modsDir, { withFileTypes: true });
  } catch {
    modEntries = [];
  }
  for (const entry of modEntries) {
    if (!entry.isFile()) continue;
    if (entry.name.toLowerCase().endsWith(".jar")) {
      info.jarCount += 1;
      if (SUSY_JAR_PATTERN.test(entry.name)) {
        if (/susycore|susy-?core/i.test(entry.name)) info.susyCoreJar = entry.name;
        else info.susyJar ??= entry.name;
      }
    }
  }
  if (info.jarCount > 0) info.score += 5;
  if (info.susyJar || info.susyCoreJar) info.score += 5;

  if (names.has("versions")) {
    try {
      info.hasForgeRuntime = fs
        .readdirSync(path.join(dir, "versions"), { withFileTypes: true })
        .some((entry) => entry.isDirectory() && /forge/i.test(entry.name));
    } catch {
      info.hasForgeRuntime = false;
    }
    if (info.hasForgeRuntime) info.score += 3;
  }

  for (const entry of entries) {
    if (entry.isFile() && LAUNCH_SCRIPT_PATTERN.test(entry.name)) {
      info.launchScript = path.join(dir, entry.name);
      info.score += 2;
      break;
    }
  }

  if (info.jarCount > 0 && (info.pack || info.susyJar || info.susyCoreJar)) {
    info.kind = "instance";
  } else if (info.pack) {
    info.kind = "pack-source";
  }
  return info;
}

/**
 * Walks up from a game directory to the launcher instance wrapper that owns
 * it (the directory holding instance.cfg, as written by Prism/PolyMC/MultiMC).
 * Returns what the export runner needs to work against such an instance: the
 * instance id (wrapper folder name, what `prism -l` takes), the flatpak app id
 * when the launcher runs as a flatpak sandbox, and the managed pack metadata
 * those launchers keep instead of a packwiz pack.toml.
 */
export function findLauncherInstanceInfo(startDir) {
  let current = path.resolve(startDir);
  for (let depth = 0; depth < 8; depth += 1) {
    const cfgPath = path.join(current, "instance.cfg");
    let cfgText;
    try {
      cfgText = fs.readFileSync(cfgPath, "utf8");
    } catch {
      cfgText = undefined;
    }
    if (cfgText !== undefined) {
      const meta = parseInstanceCfg(cfgText);
      return {
        dir: current,
        instanceId: path.basename(current),
        flatpakAppId: flatpakAppIdFor(current),
        managedPackName: meta.managedPackName,
        managedPackVersion: meta.managedPackVersion,
      };
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}

/** Minimal instance.cfg reader: only the managed-pack keys the pipeline needs. */
function parseInstanceCfg(text) {
  const result = { managedPackName: undefined, managedPackVersion: undefined };
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const pair = /^([^=]+?)\s*=\s*(.*)$/.exec(rawLine.trim());
    if (!pair) continue;
    const key = pair[1].trim();
    if (key === "ManagedPackName") result.managedPackName = pair[2].trim() || undefined;
    if (key === "ManagedPackVersionName") result.managedPackVersion = pair[2].trim() || undefined;
  }
  return result;
}

/** The flatpak app id when `dir` lives inside ~/.var/app/<app id>/, else undefined. */
function flatpakAppIdFor(dir) {
  const parts = path.resolve(dir).split(path.sep);
  const varIndex = parts.lastIndexOf(".var");
  if (varIndex < 0 || parts[varIndex + 1] !== "app") return undefined;
  return parts[varIndex + 2] || undefined;
}

/**
 * Where the susy-hei-oracle mod jar can come from, best first:
 * SUSY_HEI_ORACLE_JAR, the pipeline's own build, then a repo-local checkout.
 */
export function findOracleJar(repoRoot, env = process.env) {
  if (env.SUSY_HEI_ORACLE_JAR) {
    if (fs.existsSync(env.SUSY_HEI_ORACLE_JAR)) return env.SUSY_HEI_ORACLE_JAR;
  }
  const roots = [
    path.join(repoRoot, "tools", "dataset-pipeline", "susy-hei-oracle", "build", "libs"),
    path.join(repoRoot, "temp", "susy-hei-oracle"),
  ];
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 5) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".git") continue;
        walk(full, depth + 1);
      } else if (
        entry.name.toLowerCase().endsWith(".jar") &&
        !entry.name.includes("-sources") &&
        /oracle/i.test(entry.name)
      ) {
        found.push(full);
      }
    }
  };
  for (const root of roots) walk(root, 0);
  if (found.length === 0) return undefined;
  found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return found[0];
}

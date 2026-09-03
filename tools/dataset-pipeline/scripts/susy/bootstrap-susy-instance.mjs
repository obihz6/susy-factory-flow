/**
 * Downloads a barebone Supersymmetry 1.12.2 instance the SUSY oracle export
 * can boot: the pack repo's own files (pack.toml, config, groovy), every
 * packwiz-declared mod, a local Temurin 8 JRE (1.12.2 Forge cannot run on
 * modern JVMs), the Forge installer's client runtime, and a generated
 * launch-susy-client.sh the export runner picks up as its start script.
 *
 * Every step is resumable: an artifact that already exists is not fetched
 * again, so a failed run continues where it stopped.
 *
 * Usage:
 *   node bootstrap-susy-instance.mjs [target-dir]
 * Env:
 *   SUSY_BOOTSTRAP_REF      pack ref to install (release tag like
 *                           "0.1.16.14.1" or a branch like "master-ceu";
 *                           default: the repo's latest release tag)
 *   SUSY_JAVA_8             path to a Java 8 binary to use instead of
 *                           downloading one
 *   GITHUB_TOKEN            optional, for the release lookup
 * Output (stdout): JSON { instanceDir, version, minecraft, forge, ref, launchScript }.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { parsePackToml } from "./susy-instance-lib.mjs";

const target = path.resolve(process.argv[2] ?? path.join("temp", ".minecraft"));
// Bootstrap artifacts (JRE, installer jars) live OUTSIDE the instance: the
// bundled packwiz indexes everything not ignored, and a JRE's locale trees
// make its indexer choke.
const runtimeDir = `${target}-runtime`;
const githubToken = process.env.GITHUB_TOKEN;
const packRepo = "SymmetricDevs/Supersymmetry";

const log = (message) => console.error(`bootstrap-susy-instance: ${message}`);

/**
 * GNU tar (what Git Bash puts on PATH) reads `C:\...` as a remote host
 * ("Cannot connect to C: resolve failed"); the Windows-shipped bsdtar
 * handles drive-letter paths and zips natively. Prefer it on Windows,
 * falling back to GNU tar's --force-local where it does not exist.
 */
function resolveTar() {
  if (process.platform !== "win32") {
    return { bin: "tar", extraArgs: [] };
  }
  const systemTar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  if (fs.existsSync(systemTar)) {
    return { bin: systemTar, extraArgs: [] };
  }
  return { bin: "tar", extraArgs: ["--force-local"] };
}

function runTar(args) {
  const { bin, extraArgs } = resolveTar();
  execFileSync(bin, [...extraArgs, ...args]);
}

/** True when the file at least begins with the gzip magic bytes. */
async function hasGzipMagic(file) {
  try {
    const handle = await fs.promises.open(file, "r");
    try {
      const buffer = Buffer.alloc(2);
      await handle.read(buffer, 0, 2, 0);
      return buffer[0] === 0x1f && buffer[1] === 0x8b;
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

async function githubJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${url} -> ${response.status}`);
  return response.json();
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Download ${url} -> ${response.status}`);
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(outputPath, buffer);
  return buffer.length;
}

function run(binary, args, options = {}) {
  log(`${path.basename(String(binary))} ${args.join(" ").slice(0, 120)}`);
  const result = spawnSync(binary, args, {
    // Uncaptured child stdout rides fd 2: this script's own stdout is its
    // JSON result contract, and inherited grandchildren must not leak into it.
    stdio: ["ignore", options.capture ? "pipe" : 2, options.capture ? "pipe" : "inherit"],
    cwd: options.cwd ?? target,
    env: { ...process.env, ...options.env },
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = result.stdout ? `${result.stdout}${result.stderr ?? ""}` : "";
  if (result.status !== 0) {
    if (options.capture) return { status: result.status, output };
    throw new Error(`${binary} ${args[0]} exited ${result.status}`);
  }
  return { status: 0, output };
}

// ---------------------------------------------------------------------------
// 1. Pack files (pack.toml, config, groovy, mod metadata)
// ---------------------------------------------------------------------------

async function resolveRef() {
  if (process.env.SUSY_BOOTSTRAP_REF) return process.env.SUSY_BOOTSTRAP_REF;
  log("looking up the latest Supersymmetry release...");
  const release = await githubJson(`https://api.github.com/repos/${packRepo}/releases/latest`);
  if (!release?.tag_name) throw new Error("No Supersymmetry release found.");
  return release.tag_name;
}

async function downloadPack(ref) {
  const packToml = path.join(target, "pack.toml");
  if (fs.existsSync(packToml)) {
    log("pack.toml already present; reusing the existing pack files.");
    return;
  }
  const isTag = /^\d/.test(ref) || /^v\d/.test(ref);
  const refPath = isTag ? `refs/tags/${ref}` : `refs/heads/${ref}`;
  const url = `https://codeload.github.com/${packRepo}/tar.gz/${refPath}`;
  const archive = path.join(target, ".pack.tar.gz");
  // A previous run that failed mid-extract leaves a complete archive behind;
  // reuse it instead of pulling the pack again. Old timestamped names from
  // earlier builds are adopted too, and a truncated download never passes the
  // gzip magic check.
  if (!fs.existsSync(archive) && fs.existsSync(target)) {
    const legacy = fs
      .readdirSync(target)
      .find((name) => /^\.pack-\d+\.tar\.gz$/.test(name));
    if (legacy) await fs.promises.rename(path.join(target, legacy), archive);
  }
  if (fs.existsSync(archive) && (await hasGzipMagic(archive))) {
    log("reusing the pack tarball downloaded by an earlier run.");
  } else {
    log(`downloading pack ${ref}...`);
    await downloadFile(url, archive);
  }
  await fs.promises.mkdir(target, { recursive: true });
  // The tarball nests everything under Supersymmetry-<ref>/; strip one level.
  runTar(["-xzf", archive, "-C", target, "--strip-components", "1"]);
  await fs.promises.rm(archive, { force: true });
  if (!fs.existsSync(packToml)) {
    throw new Error(`Pack archive for ${ref} did not contain a pack.toml.`);
  }
}

// ---------------------------------------------------------------------------
// 2. A Java 8 runtime (game + Forge installer requirement)
// ---------------------------------------------------------------------------

const isWindows = process.platform === "win32";
const javaBinaryName = isWindows ? "java.exe" : "java";

/** Adoptium's per-OS asset naming: windows ships a zip, the rest a tarball. */
function adoptiumUrl() {
  const platform = { win32: "windows", darwin: "mac", linux: "linux" }[process.platform];
  if (!platform) throw new Error(`Unsupported platform: ${process.platform}`);
  const arch = process.arch === "arm64" ? "aarch64" : "x64";
  return `https://api.adoptium.net/v3/binary/latest/8/ga/${platform}/${arch}/jre/hotspot/normal/eclipse`;
}

function extractArchive(archive, into) {
  fs.mkdirSync(into, { recursive: true });
  // bsdtar (Windows 10+, macOS) and GNU tar both handle tar.gz; bsdtar also
  // handles the Adoptium Windows zip, so one command serves everywhere.
  runTar(["-xf", archive, "-C", into, "--strip-components", "1"]);
}

async function resolveJava8() {
  if (process.env.SUSY_JAVA_8) {
    if (!fs.existsSync(process.env.SUSY_JAVA_8)) {
      throw new Error(`SUSY_JAVA_8=${process.env.SUSY_JAVA_8} does not exist.`);
    }
    return process.env.SUSY_JAVA_8;
  }
  const versionPattern = /(?:^|[-_])8(?:[-_.]|$)|jdk8|jre8|1\.8/i;
  const jvmRoots = isWindows
    ? [
        "C:\\Program Files\\Eclipse Adoptium",
        "C:\\Program Files\\Java",
        "C:\\Program Files (x86)\\Java",
        "C:\\Program Files\\Zulu",
        path.join(os.homedir(), ".jdks"),
      ]
    : ["/usr/lib/jvm", path.join(os.homedir(), ".jdks")];
  for (const root of jvmRoots) {
    let entries;
    try {
      entries = await fs.promises.readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!versionPattern.test(entry)) continue;
      const binary = path.join(root, entry, "bin", javaBinaryName);
      if (fs.existsSync(binary)) return binary;
    }
  }

  const jreDir = path.join(runtimeDir, "jre8");
  const jreBin = path.join(jreDir, "bin", javaBinaryName);
  if (fs.existsSync(jreBin)) return jreBin;

  log("no local Java 8 found; downloading a Temurin 8 JRE...");
  const archive = path.join(runtimeDir, isWindows ? "jre8.zip" : "jre8.tar.gz");
  await downloadFile(adoptiumUrl(), archive);
  extractArchive(archive, jreDir);
  await fs.promises.rm(archive, { force: true });
  if (!fs.existsSync(jreBin)) throw new Error("Temurin JRE 8 did not unpack as expected.");
  return jreBin;
}

// ---------------------------------------------------------------------------
// 3. Mods through packwiz-installer
// ---------------------------------------------------------------------------

async function installMods(java8) {
  const modsDir = path.join(target, "mods");
  const jarCount = fs.existsSync(modsDir)
    ? fs.readdirSync(modsDir).filter((name) => name.toLowerCase().endsWith(".jar")).length
    : 0;
  if (jarCount > 20) {
    log(`mods already installed (${jarCount} jars); skipping packwiz.`);
    return;
  }
  // The pack repo ships an empty index.toml (their build regenerates it with
  // `packwiz refresh`), and packwiz-installer validates the index hash against
  // pack.toml — so refresh the index with the bundled Go binary first.
  const packwizBin = path.join(target, isWindows ? "packwiz.exe" : "packwiz");
  if (fs.existsSync(packwizBin)) {
    if (!isWindows) await fs.promises.chmod(packwizBin, 0o755);
    run(packwizBin, ["refresh"], { cwd: target });
  } else {
    log("no bundled packwiz binary; hoping the shipped index is valid.");
  }
  const installerJar = path.join(runtimeDir, "packwiz-installer.jar");
  if (!fs.existsSync(installerJar)) {
    log("downloading packwiz-installer...");
    await downloadFile(
      "https://github.com/packwiz/packwiz-installer/releases/latest/download/packwiz-installer.jar",
      installerJar,
    );
  }
  // A handful of SUSY mods are excluded from the CurseForge API, so
  // packwiz-installer cannot fetch them; the pack's own build rescues them
  // through cfwidget (which still exposes their direct file URLs) and
  // retries. Same loop here.
  const installerArgs = [
    "-cp",
    installerJar,
    "link.infra.packwiz.installer.Main",
    "--no-gui",
    "-s",
    "client",
    "pack.toml",
  ];
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const { status, output } = run(java8, installerArgs, { capture: true });
    if (status === 0) return;
    const rescued = await rescueCurseForgeExcluded(output);
    if (rescued === 0) {
      throw new Error(
        `packwiz-installer failed:\n${output.slice(-3000)}`,
      );
    }
    log(`recovered ${rescued} CurseForge-excluded mod(s); retrying packwiz-installer.`);
  }
  throw new Error("packwiz-installer kept failing after the CurseForge rescues.");
}

/**
 * The installer's failure output names each excluded mod's CurseForge page
 * and the exact path it expects the jar at. CurseForge's edge CDN serves
 * those files without the API: /files/<first4>/<rest>/<filename>. The
 * installer re-validates every jar hash on the retry, so a wrong fetch
 * cannot slip through. Returns how many jars were rescued.
 */
async function rescueCurseForgeExcluded(output) {
  const pattern =
    /Please go to https:\/\/www\.curseforge\.com\/minecraft\/[^/\s]+\/([^/\s]+)\/files\/(\d+) and save this file to (.+)$/gm;
  const failures = [...output.matchAll(pattern)];
  let rescued = 0;
  for (const match of failures) {
    const [, slug, fileId, targetPathRaw] = match;
    const targetPath = targetPathRaw.trim();
    if (fs.existsSync(targetPath)) {
      rescued += 1;
      continue;
    }
    log(`rescuing CurseForge-excluded mod ${slug} (file ${fileId})...`);
    const fileName = path.basename(targetPath);
    const cdnUrls = [
      `https://mediafilez.forgecdn.net/files/${fileId.slice(0, 4)}/${fileId.slice(4)}/${fileName}`,
      `https://mediafilez.forgecdn.net/files/${fileId.slice(0, 4)}/${Number(fileId.slice(4))}/${fileName}`,
    ];
    let downloaded = false;
    for (const url of cdnUrls) {
      try {
        await downloadFile(url, targetPath);
        downloaded = true;
        break;
      } catch {
        // Try the next URL shape.
      }
    }
    if (!downloaded) {
      throw new Error(
        `Could not fetch excluded mod ${slug} (${fileName}) from the CurseForge CDN; ` +
          `download ${fileName} manually into ${path.dirname(targetPath)}.`,
      );
    }
    rescued += 1;
  }
  return rescued;
}

// ---------------------------------------------------------------------------
// 4. Forge client runtime
// ---------------------------------------------------------------------------

async function installForge(java8, minecraft, forge) {
  const forgeVersionId = `${minecraft}-forge-${forge}`;
  const versionDir = path.join(target, "versions", forgeVersionId);
  if (fs.existsSync(path.join(versionDir, `${forgeVersionId}.json`))) {
    log("Forge runtime already installed; skipping the installer.");
    return forgeVersionId;
  }
  // The headless installer expects a launcher-shaped directory.
  const profiles = path.join(target, "launcher_profiles.json");
  if (!fs.existsSync(profiles)) {
    await fs.promises.writeFile(profiles, "{}\n");
  }
  const installerJar = path.join(runtimeDir, `forge-${forge}-installer.jar`);
  if (!fs.existsSync(installerJar)) {
    log(`downloading Forge ${forge} installer...`);
    await downloadFile(
      `https://maven.minecraftforge.net/net/minecraftforge/forge/` +
        `${minecraft}-${forge}/forge-${minecraft}-${forge}-installer.jar`,
      installerJar,
    );
  }
  run(java8, ["-jar", installerJar, "--installClient", target]);
  if (!fs.existsSync(path.join(versionDir, `${forgeVersionId}.json`))) {
    throw new Error(`Forge installer did not produce ${forgeVersionId}.`);
  }
  return forgeVersionId;
}

// ---------------------------------------------------------------------------
// 5. Launch script from the installed version JSON
// ---------------------------------------------------------------------------

function libraryPath(library) {
  if (library.downloads?.artifact?.path) return library.downloads.artifact.path;
  // Maven-layout fallback: group:artifact:version[:classifier]
  const [group, artifact, version, classifier] = String(library.name).split(":");
  if (!group || !artifact || !version) return undefined;
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ""}.jar`;
  return `${group.split(".").join("/")}/${artifact}/${version}/${file}`;
}

function rulesAllowCurrentOs(library) {
  const rules = library.rules;
  if (!Array.isArray(rules)) return true;
  const currentOs = isWindows ? "windows" : process.platform === "darwin" ? "osx" : "linux";
  let allowed = false;
  for (const rule of rules) {
    const osName = rule.os?.name;
    if (!osName || osName === currentOs) {
      allowed = rule.action === "allow";
    }
  }
  return allowed;
}

async function writeLaunchScript(java8, minecraft, forge, forgeVersionId) {
  const versionsDir = path.join(target, "versions");
  const loadJson = (dir) =>
    JSON.parse(fs.readFileSync(path.join(versionsDir, dir, `${dir}.json`), "utf8"));

  const forgeJson = loadJson(forgeVersionId);
  const inherits = forgeJson.inheritsFrom;
  // Old Forge installers drop the vanilla client jar next to their version
  // json but never write the vanilla version json itself; fetch it from
  // Mojang so the launch classpath can be assembled.
  if (inherits && inherits !== forgeVersionId) {
    const vanillaJsonFile = path.join(versionsDir, inherits, `${inherits}.json`);
    if (!fs.existsSync(vanillaJsonFile)) {
      const manifestResponse = await fetch(
        "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
      );
      if (!manifestResponse.ok) {
        throw new Error(`Mojang version manifest -> ${manifestResponse.status}`);
      }
      const manifest = await manifestResponse.json();
      const entry = (manifest.versions ?? []).find((version) => version.id === inherits);
      if (!entry) throw new Error(`Minecraft ${inherits} not found in the Mojang manifest.`);
      await downloadFile(entry.url, vanillaJsonFile);
    }
  }
  const vanillaJson = inherits && inherits !== forgeVersionId ? loadJson(inherits) : undefined;

  const mergedLibraries = [...(forgeJson.libraries ?? []), ...(vanillaJson?.libraries ?? [])].filter(
    rulesAllowCurrentOs,
  );
  // The Forge installer only fetches its own libraries; the vanilla ones
  // (LWJGL, guava, ...) come from the version json's download URLs.
  for (const library of mergedLibraries) {
    const artifact = library.downloads?.artifact;
    if (!artifact?.path || !artifact.url) continue;
    const file = path.join(target, "libraries", artifact.path);
    if (fs.existsSync(file)) continue;
    try {
      await downloadFile(artifact.url, file);
    } catch (cause) {
      log(`library ${library.name} download failed (${cause.message}).`);
    }
  }
  const libraries = mergedLibraries
    .map(libraryPath)
    .filter(Boolean)
    .map((relative) => path.join(target, "libraries", relative))
    .filter((file) => fs.existsSync(file));

  const clientJar = vanillaJson
    ? path.join(versionsDir, inherits, `${inherits}.jar`)
    : path.join(versionsDir, forgeVersionId, `${forgeVersionId}.jar`);
  if (fs.existsSync(clientJar)) libraries.push(clientJar);

  const mainClass = forgeJson.mainClass ?? vanillaJson?.mainClass;
  if (!mainClass) throw new Error("No mainClass in the installed version JSON.");

  const assetIndex = forgeJson.assetIndex ?? vanillaJson?.assetIndex;
  if (assetIndex) {
    const indexesDir = path.join(target, "assets", "indexes");
    const indexFile = path.join(indexesDir, `${assetIndex.id}.json`);
    if (!fs.existsSync(indexFile)) {
      try {
        await downloadFile(assetIndex.url, indexFile);
      } catch (cause) {
        log(`asset index download failed (${cause.message}); continuing without it.`);
      }
    }
  }
  // No manual --assetsDir here: minecraftArguments below already carries it.

  const substitutions = {
    auth_player_name: "SUSYOracle",
    version_name: forgeVersionId,
    game_directory: target,
    assets_root: path.join(target, "assets"),
    assets_index_name: assetIndex?.id ?? minecraft,
    auth_uuid: "00000000-0000-0000-0000-000000000000",
    auth_access_token: "0",
    user_type: "legacy",
    user_properties: "{}",
    version_type: forgeJson.type ?? "release",
  };
  const gameArgs = (forgeJson.minecraftArguments ?? vanillaJson?.minecraftArguments ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((arg) => {
      const substituted = arg.replace(/\$\{([^}]+)\}/g, (whole, key) => {
        if (!(key in substitutions)) return whole;
        return substitutions[key];
      });
      return shellQuote(substituted);
    })
    .join(" ");

  const classpathSeparator = path.delimiter;
  const cmdQuote = (value) => `"${String(value)}"`;

  // The bash script runs on Linux/macOS and under Git Bash on Windows (which
  // executes Windows java.exe paths fine); the .cmd is for native cmd use.
  const shScript = path.join(target, "launch-susy-client.sh");
  const shBody = `#!/usr/bin/env bash
# Generated by bootstrap-susy-instance.mjs for SUSY ${forgeVersionId}.
set -euo pipefail
cd ${shellQuote(target)}
exec ${shellQuote(java8)} -Xms2G -Xmx\${SUSY_EXPORT_MAX_MEMORY:-4G} \\
  -Dfile.encoding=UTF-8 \\
  -cp ${libraries.map(shellQuote).join(classpathSeparator)} \\
  ${mainClass} \\
  ${gameArgs}
`;
  await fs.promises.writeFile(shScript, shBody);
  if (!isWindows) await fs.promises.chmod(shScript, 0o755);

  const cmdScript = path.join(target, "launch-susy-client.cmd");
  const gameArgsCmd = (forgeJson.minecraftArguments ?? vanillaJson?.minecraftArguments ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((arg) => cmdQuote(arg.replace(/\$\{([^}]+)\}/g, (whole, key) => substitutions[key] ?? whole)))
    .join(" ");
  const cmdBody = [
    "@echo off",
    `rem Generated by bootstrap-susy-instance.mjs for SUSY ${forgeVersionId}.`,
    `cd /d ${cmdQuote(target)}`,
    `if not defined SUSY_EXPORT_MAX_MEMORY set "SUSY_EXPORT_MAX_MEMORY=4G"`,
    `${cmdQuote(java8)} -Xms2G -Xmx%SUSY_EXPORT_MAX_MEMORY% -Dfile.encoding=UTF-8 -cp ${cmdQuote(libraries.join(classpathSeparator))} ${mainClass} ${gameArgsCmd}`,
  ].join("\r\n");
  await fs.promises.writeFile(`${cmdScript}`, `${cmdBody}\r\n`);

  return isWindows ? cmdScript : shScript;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// ---------------------------------------------------------------------------

fs.mkdirSync(target, { recursive: true });
const ref = await resolveRef();
await downloadPack(ref);

const pack = parsePackToml(fs.readFileSync(path.join(target, "pack.toml"), "utf8"));
if (!pack.minecraft || !pack.forge) {
  throw new Error(`pack.toml is missing [versions] (minecraft=${pack.minecraft}, forge=${pack.forge}).`);
}

const java8 = await resolveJava8();
await installMods(java8);
const forgeVersionId = await installForge(java8, pack.minecraft, pack.forge);
const launchScript = await writeLaunchScript(java8, pack.minecraft, pack.forge, forgeVersionId);

console.log(
  JSON.stringify(
    {
      instanceDir: target,
      version: pack.version,
      minecraft: pack.minecraft,
      forge: pack.forge,
      ref,
      launchScript,
    },
    null,
    2,
  ),
);

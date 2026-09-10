/**
 * Resolves a Java 8 runtime for the Minecraft 1.12.2 client and Forge tools.
 *
 * The runtime is cached outside the game instance so packwiz does not index
 * Java's locale/resource files. A caller can provide SUSY_JAVA_8 to reuse an
 * existing binary; otherwise a local Java 8 installation is preferred and a
 * Temurin 8 JRE is downloaded only when necessary.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const javaBinaryName = isWindows ? "java.exe" : "java";

const defaultLog = (message) => console.error(`java8-runtime: ${message}`);

function resolveTar() {
  if (!isWindows) return { bin: "tar", extraArgs: [] };
  const systemTar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  if (fs.existsSync(systemTar)) return { bin: systemTar, extraArgs: [] };
  return { bin: "tar", extraArgs: ["--force-local"] };
}

function extractArchive(archive, into) {
  fs.mkdirSync(into, { recursive: true });
  const { bin, extraArgs } = resolveTar();
  const result = spawnSync(bin, [...extraArgs, "-xf", archive, "-C", into, "--strip-components", "1"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `Archive extraction exited with code ${result.status}.`);
  }
}

function adoptiumUrl() {
  const platform = { win32: "windows", darwin: "mac", linux: "linux" }[process.platform];
  if (!platform) throw new Error(`Unsupported platform: ${process.platform}`);
  const arch = process.arch === "arm64" ? "aarch64" : "x64";
  return `https://api.adoptium.net/v3/binary/latest/8/ga/${platform}/${arch}/jre/hotspot/normal/eclipse`;
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Download ${url} -> ${response.status}`);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.download`;
  await fsp.writeFile(temporaryPath, Buffer.from(await response.arrayBuffer()));
  await fsp.rename(temporaryPath, outputPath);
}

function localJava8Candidates() {
  const versionPattern = /(?:^|[-_])8(?:[-_.]|$)|jdk8|jre8|1\.8/i;
  const candidates = [];
  const javaHome = process.env.JAVA_HOME;
  if (javaHome) candidates.push(path.join(javaHome, "bin", javaBinaryName));

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
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!versionPattern.test(entry)) continue;
      candidates.push(path.join(root, entry, "bin", javaBinaryName));
    }
  }

  const lookup = spawnSync(isWindows ? "where.exe" : "which", [javaBinaryName], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (lookup.status === 0) {
    const firstMatch = String(lookup.stdout ?? "").split(/\r?\n/).find(Boolean);
    if (firstMatch) candidates.push(firstMatch.trim());
  }
  return candidates;
}

/** Return true when Java's -version output identifies a Java 8 runtime. */
export function isJava8VersionOutput(output) {
  return /\bversion\s+["'](?:1\.)?8(?:[.\-_'" ]|$)/i.test(String(output ?? ""));
}

/** Validate a Java binary without requiring Java on the caller's PATH. */
export function isJava8Binary(binary) {
  try {
    const result = spawnSync(binary, ["-version"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    return result.status === 0 && isJava8VersionOutput(output);
  } catch {
    return false;
  }
}

function isRegularFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/** Return the Java home directory for a resolved .../bin/java path. */
export function javaHomeFor(javaBinary) {
  return path.dirname(path.dirname(path.resolve(javaBinary)));
}

/**
 * Return a usable Java 8 binary, downloading and caching Temurin 8 if needed.
 * This function deliberately performs no instance discovery, so callers can
 * invoke it as the first operation of the pipeline.
 */
export async function resolveJava8({ runtimeDir, logger = defaultLog } = {}) {
  const configured = process.env.SUSY_JAVA_8;
  if (configured) {
    const configuredPath = path.resolve(configured);
    if (!isRegularFile(configuredPath)) {
      throw new Error(`SUSY_JAVA_8=${configured} does not point to a file.`);
    }
    if (!isJava8Binary(configuredPath)) {
      throw new Error(`SUSY_JAVA_8=${configured} does not appear to be Java 8.`);
    }
    return configuredPath;
  }

  for (const binary of localJava8Candidates()) {
    if (isRegularFile(binary) && isJava8Binary(binary)) return path.resolve(binary);
  }

  if (!runtimeDir) {
    throw new Error("A runtimeDir is required when Java 8 is not already installed.");
  }
  const resolvedRuntimeDir = path.resolve(runtimeDir);
  const jreDir = path.join(resolvedRuntimeDir, "jre8");
  const jreBin = path.join(jreDir, "bin", javaBinaryName);
  if (isRegularFile(jreBin) && isJava8Binary(jreBin)) return jreBin;

  logger("no local Java 8 found; downloading a Temurin 8 JRE before instance discovery...");
  const archive = path.join(resolvedRuntimeDir, isWindows ? "jre8.zip" : "jre8.tar.gz");
  if (!fs.existsSync(archive)) {
    await downloadFile(adoptiumUrl(), archive);
  } else {
    logger("reusing the cached Temurin 8 archive.");
  }
  try {
    extractArchive(archive, jreDir);
    if (!isWindows) await fsp.chmod(jreBin, 0o755);
  } catch (error) {
    await fsp.rm(jreDir, { recursive: true, force: true });
    throw new Error(`Could not unpack the Temurin 8 JRE: ${error.message}`);
  }
  await fsp.rm(archive, { force: true });
  if (!isRegularFile(jreBin) || !isJava8Binary(jreBin)) {
    throw new Error("Downloaded runtime does not appear to be Java 8.");
  }
  return jreBin;
}

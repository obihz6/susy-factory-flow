import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, "../../../../");
export const defaultTempDir = path.join(repoRoot, "temp");
export const defaultConfigPath = path.join(defaultTempDir, "susy-pipeline.json");

export function parseCliArgs(argv = process.argv.slice(2)) {
  const options = { positionals: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      options.positionals.push(arg);
      continue;
    }
    const equalsIndex = arg.indexOf("=");
    const name = equalsIndex === -1 ? arg.slice(2) : arg.slice(2, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : arg.slice(equalsIndex + 1);
    const next = argv[index + 1];
    options[name] = inlineValue ?? (next && !next.startsWith("--") ? argv[++index] : true);
  }
  return options;
}

export function getConfigPath(options = {}) {
  const explicit = options.config ?? process.env.SUSY_PIPELINE_CONFIG;
  if (explicit) return path.resolve(String(explicit));
  if (options.tempDir ?? options.temp) {
    return path.join(path.resolve(String(options.tempDir ?? options.temp)), "susy-pipeline.json");
  }
  return defaultConfigPath;
}

export async function readJson(filePath) {
  return JSON.parse(await fsp.readFile(filePath, "utf8"));
}

export async function writeJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function loadConfig(options = {}) {
  const configPath = getConfigPath(options);
  const config = await readJson(configPath);
  config.configPath = configPath;
  return config;
}

export async function loadOrCreateConfig(options = {}) {
  try {
    return await loadConfig(options);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const config = createInitialConfig(options);
    config.configPath = getConfigPath(options);
    await saveConfig(config);
    return config;
  }
}

export async function saveConfig(config) {
  const configPath = config.configPath ?? defaultConfigPath;
  const saved = { ...config };
  delete saved.configPath;
  await writeJson(configPath, saved);
}

export function createInitialConfig(options = {}) {
  const tempDir = path.resolve(String(options.tempDir ?? options.temp ?? defaultTempDir));
  const versionId = options.datasetVersion ?? options.versionId ?? options["version-id"];
  const datasetRoot = path.resolve(
    String(options.datasetRoot ?? options["dataset-root"] ?? path.join(repoRoot, "public", "datasets", "susy")),
  );
  const datasetDir = versionId ? path.join(datasetRoot, String(versionId)) : datasetRoot;
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pack: {
      repository: "SymmetricDevs/Supersymmetry",
      ref: options.ref ?? options.version,
      versionId,
      versionLabel: options.versionLabel ?? options["version-label"],
    },
    paths: {
      tempDir,
      instanceDir: path.resolve(String(options.instance ?? options["instance-dir"] ?? path.join(tempDir, ".minecraft"))),
      rawExportDir: path.join(tempDir, "raw-export"),
      datasetRoot,
      datasetDir,
      recipesPath: path.join(datasetDir, "recipes.json"),
      compressedRecipesPath: path.join(datasetDir, "recipes.json.gz"),
    },
    settings: {
      retries: positiveInteger(options.retries, 3),
      bootstrap: options.bootstrap !== false,
      // SUSY exports default to a self-contained downloaded client. This keeps
      // extraction deterministic and avoids depending on a launcher GUI.
      useDownloadedInstance: options.useDownloadedInstance !== false,
      instanceSource: undefined,
      downloadedInstanceStatus: undefined,
    },
    selectedVersions: Array.isArray(options.selectedVersions) ? options.selectedVersions : [],
    includeLocal: options.includeLocal === true,
    localDevVersions: Array.isArray(options.localDevVersions) ? options.localDevVersions : [],
    state: {
      status: "created",
      currentStep: null,
      steps: {},
    },
  };
}

export function updateConfigPaths(config) {
  const versionId = config.pack?.versionId;
  const datasetRoot = path.resolve(config.paths.datasetRoot);
  config.paths.datasetDir = versionId ? path.join(datasetRoot, String(versionId)) : datasetRoot;
  config.paths.recipesPath = path.join(config.paths.datasetDir, "recipes.json");
  config.paths.compressedRecipesPath = path.join(config.paths.datasetDir, "recipes.json.gz");
  config.updatedAt = new Date().toISOString();
  return config;
}

export async function setPipelineState(config, status, step, details = {}) {
  config.state ??= { status: "created", currentStep: null, steps: {} };
  config.state.status = status;
  config.state.currentStep = step ?? null;
  if (step) {
    config.state.steps ??= {};
    const previous = config.state.steps[step] ?? {};
    const next = {
      ...previous,
      status,
      ...(status === "running" ? { startedAt: new Date().toISOString() } : {}),
      ...(status === "completed" ? { completedAt: new Date().toISOString() } : {}),
      ...(status === "failed" ? { failedAt: new Date().toISOString() } : {}),
      ...details,
    };
    // A later successful retry must not leave the old failure metadata in the
    // config. This is particularly confusing when resuming a fresh install.
    if (status === "running" || status === "completed") {
      delete next.failedAt;
      delete next.error;
      delete next.message;
    }
    if (status === "running" || status === "failed") delete next.completedAt;
    config.state.steps[step] = next;
  }
  config.updatedAt = new Date().toISOString();
  await saveConfig(config);
}

export async function executeStandaloneStep(step, action, options = {}) {
  const config = await loadOrCreateConfig(options);
  const logger = createLogger(options.logFile ?? logPath(config, step));
  try {
    await setPipelineState(config, "running", step);
    logger.info(`Step ${step} started.`);
    const result = await action(logger, config);
    updateConfigPaths(config);
    await setPipelineState(config, "completed", step, result && typeof result === "object" ? result : {});
    logger.info(`Step ${step} completed.`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    logger.error(message);
    await setPipelineState(config, "failed", step, { error: message });
    throw error;
  } finally {
    logger.close();
  }
}

export function logPath(config, step) {
  return path.join(path.resolve(config.paths.tempDir), "logs", `${step}.log`);
}

/** Return the standalone script filename for a pipeline step. */
export function pipelineStepScriptName(step) {
  return step === "package" ? "package-dataset.mjs" : `${step}.mjs`;
}

export function rawExportDir(config) {
  return path.resolve(config.paths.rawExportDir);
}

export function createLogger(filePath, options = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const fd = fs.openSync(filePath, "a");
  const echo = options.echo ?? true;
  const write = (level, message) => {
    const text = String(message);
    const timestamp = new Date().toISOString();
    fs.writeSync(fd, `[${timestamp}] ${level} ${text}\n`);
    if (echo) process.stdout.write(`${text}\n`);
  };
  return {
    info: (message) => write("INFO", message),
    warn: (message) => write("WARN", message),
    error: (message) => write("ERROR", message),
    close: () => fs.closeSync(fd),
  };
}

export async function runCommand(command, args, options = {}) {
  const logger = options.logger;
  const label = options.label ?? `${command} ${args.join(" ")}`;
  logger?.info(`Running: ${label}`);
  let progressTimer;
  if (options.progress) {
    let tick = 0;
    const width = 24;
    progressTimer = setInterval(() => {
      tick = (tick + 1) % (width + 4);
      const position = tick <= width ? tick : width;
      const bar = `${"#".repeat(position)}${"-".repeat(width - position)}`;
      process.stdout.write(`\r${options.progress} [${bar}] working`);
    }, 150);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      shell: options.shell ?? false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks = [];
    const stderrChunks = [];

    const forward = (stream, prefix, chunks) => {
      let pending = "";
      stream.on("data", (chunk) => {
        const text = String(chunk);
        chunks.push(text);
        pending += text;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (line) logger?.info(`${prefix}${line}`);
        }
      });
      stream.on("end", () => {
        if (pending) logger?.info(`${prefix}${pending}`);
      });
    };

    forward(child.stdout, "", stdoutChunks);
    forward(child.stderr, "[stderr] ", stderrChunks);
    child.on("error", (error) => {
      if (progressTimer) clearInterval(progressTimer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (progressTimer) {
        clearInterval(progressTimer);
        process.stdout.write("\r\x1b[2K");
      }
      const result = {
        code: code ?? 1,
        signal,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
      };
      if (result.code !== 0) {
        reject(new Error(`${label} failed with exit code ${result.code}${signal ? ` (${signal})` : ""}.`));
      } else {
        resolve(result);
      }
    });
  });
}

export function renderProgress(label, current, total) {
  const width = 28;
  const ratio = total > 0 ? Math.max(0, Math.min(1, current / total)) : 0;
  const filled = Math.round(width * ratio);
  const bar = `${"#".repeat(filled)}${"-".repeat(width - filled)}`;
  process.stdout.write(`\r${label} [${bar}] ${Math.round(ratio * 100)}%`);
  if (current >= total) process.stdout.write("\n");
}

export function requireFile(filePath, description = filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${description} was not found: ${filePath}`);
  }
}

export function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function slug(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

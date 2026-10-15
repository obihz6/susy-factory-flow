import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function resetSusyExportRunState({
  rawExportDir,
  runtimeLogPath,
  runtimeErrorLogPath,
  jvmExportRoot,
  oracleGameDumpPath,
}) {
  const dumpPaths = new Set([
    path.join(rawExportDir, "recipedump.json"),
    path.join(jvmExportRoot, "recipedump.json"),
    ...(oracleGameDumpPath ? [oracleGameDumpPath] : []),
  ]);
  const iconDirs = new Set([
    path.join(rawExportDir, "rendered-icons"),
    path.join(jvmExportRoot, "rendered-icons"),
  ]);

  await Promise.all([
    ...[...dumpPaths].map((filePath) => fs.rm(filePath, { force: true })),
    ...[...iconDirs].map((dirPath) => fs.rm(dirPath, { recursive: true, force: true })),
    ...[runtimeLogPath, runtimeErrorLogPath].map(async (filePath) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, "");
    }),
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [
    rawExportDir,
    runtimeLogPath,
    runtimeErrorLogPath,
    jvmExportRoot = rawExportDir,
    oracleGameDumpPath,
  ] = process.argv.slice(2);
  if (!rawExportDir || !runtimeLogPath || !runtimeErrorLogPath) {
    throw new Error(
      "Usage: export-run-state.mjs <raw-export-dir> <runtime-log> <runtime-error-log> [jvm-export-root] [instance-recipedump]",
    );
  }
  await resetSusyExportRunState({
    rawExportDir,
    runtimeLogPath,
    runtimeErrorLogPath,
    jvmExportRoot,
    oracleGameDumpPath,
  });
  console.log("Reset SUSY export run state; old dumps, icons, and runtime logs were cleared.");
}

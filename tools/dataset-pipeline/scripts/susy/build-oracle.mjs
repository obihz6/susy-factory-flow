import path from "node:path";
import process from "node:process";
import {
  executeStandaloneStep,
  parseCliArgs,
  repoRoot,
  runCommand,
} from "./pipeline-lib.mjs";

const options = parseCliArgs();

await executeStandaloneStep("build-oracle", async (logger) => {
  const script = path.join(
    repoRoot,
    "tools",
    "dataset-pipeline",
    "scripts",
    "susy",
    process.platform === "win32" ? "build-jar.ps1" : "build-jar.sh",
  );
  const command = process.platform === "win32" ? "powershell.exe" : "bash";
  const args = process.platform === "win32"
    ? ["-ExecutionPolicy", "Bypass", "-File", script]
    : [script];
  await runCommand(command, args, {
    logger,
    label: "Build the SUSY HEI oracle",
    progress: "Building SUSY extraction oracle",
  });
  return { oracleScript: script };
}, options);

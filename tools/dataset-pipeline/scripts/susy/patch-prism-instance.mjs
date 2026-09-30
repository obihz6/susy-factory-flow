import fs from "node:fs/promises";
import process from "node:process";
import { patchPrismInstanceConfigText } from "./susy-instance-lib.mjs";

const options = parseArgs(process.argv.slice(2));
for (const name of ["config", "run-id", "recipedump-path", "icon-dir"]) {
  if (!options[name]) {
    throw new Error(`Missing --${name}.`);
  }
}

const configPath = String(options.config);
const original = await fs.readFile(configPath, "utf8");
const patched = patchPrismInstanceConfigText(original, {
  runId: String(options["run-id"]),
  recipedumpPath: String(options["recipedump-path"]),
  iconDir: String(options["icon-dir"]),
});
await fs.writeFile(configPath, patched, "utf8");

const general = extractSection(patched, "General");
if (!/^OverrideJavaArgs=true$/m.test(general) || !/^JvmArgs=.*susy\.oracle\.autorun=true.*$/m.test(general)) {
  throw new Error("Patched Prism instance.cfg does not contain the oracle settings in [General].");
}
for (const [section, body] of sections(patched)) {
  if (section.toLowerCase() !== "general" && /^JvmArgs=/m.test(body)) {
    throw new Error(`Patched Prism instance.cfg still contains JvmArgs in [${section}].`);
  }
}

process.stdout.write(JSON.stringify({
  config: configPath,
  general,
  changed: original !== patched,
}) + "\n");

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2);
    result[name] = argv[index + 1];
    index += 1;
  }
  return result;
}

function sections(text) {
  const result = [];
  let current;
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^\[([^\]]+)\]$/.exec(line);
    if (match) {
      current = { name: match[1], lines: [] };
      result.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return result.map(({ name, lines }) => [name, lines.join("\n")]);
}

function extractSection(text, wanted) {
  return sections(text).find(([name]) => name.toLowerCase() === wanted.toLowerCase())?.[1] ?? "";
}

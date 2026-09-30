import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve("data", "custom-recipes");
const storePath = path.join(root, "local-dev.json");
const historyPath = path.join(root, "history");
const [command, ...args] = process.argv.slice(2);

try {
  if (command === "export") {
    const output = valueAfter(args, "output") ?? "custom-recipes.json";
    await fs.writeFile(path.resolve(output), `${JSON.stringify(await readStore(), null, 2)}\n`);
    console.log(`Exported custom recipes to ${path.resolve(output)}.`);
  } else if (command === "import") {
    const input = valueAfter(args, "input");
    if (!input) throw new Error("Usage: recipes-cli.mjs import --input <file>");
    const value = JSON.parse(await fs.readFile(path.resolve(input), "utf8"));
    const result = await importStore(value, args.includes("--replace"));
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "backups") {
    console.log((await listBackups()).join("\n") || "No backups found.");
  } else if (command === "restore") {
    const requested = valueAfter(args, "date") ?? valueAfter(args, "file");
    if (!requested) throw new Error("Usage: recipes-cli.mjs restore --date <backup-file>");
    const backup = requested.endsWith(".json") ? requested : `local-dev.backup.${requested}.json`;
    if (!/^[a-zA-Z0-9._-]+\.json$/.test(backup)) throw new Error("Invalid backup name.");
    await writeStore(JSON.parse(await fs.readFile(path.join(historyPath, backup), "utf8")));
    console.log(`Restored ${backup}.`);
  } else if (command === "validate") {
    const store = await readStore();
    console.log(`Validated ${store.recipes.length} custom recipe(s).`);
  } else {
    throw new Error("Usage: recipes-cli.mjs [export|import|backups|restore|validate]");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function readStore() {
  try {
    const store = JSON.parse(await fs.readFile(storePath, "utf8"));
    validateStore(store);
    return store;
  } catch (error) {
    if (error?.code === "ENOENT") return { schemaVersion: 1, recipes: [] };
    throw error;
  }
}

async function importStore(value, replace) {
  validateStore(value);
  const current = await readStore();
  const recipes = replace ? [] : [...current.recipes];
  let imported = 0;
  for (const recipe of value.recipes) {
    validateRecipe(recipe);
    const index = recipes.findIndex((entry) => entry.id === recipe.id);
    if (index >= 0) recipes[index] = recipe;
    else recipes.push(recipe);
    imported += 1;
  }
  await writeStore({ schemaVersion: 1, recipes });
  return { imported };
}

async function writeStore(store) {
  validateStore(store);
  await fs.mkdir(historyPath, { recursive: true });
  try {
    await fs.copyFile(storePath, path.join(historyPath, `local-dev.backup.${timestamp()}.json`));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const backups = await listBackups();
  for (const backup of backups.slice(10)) await fs.rm(path.join(historyPath, backup), { force: true });
  const temporary = `${storePath}.tmp-${process.pid}`;
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`);
  await fs.rename(temporary, storePath);
}

async function listBackups() {
  try {
    return (await fs.readdir(historyPath)).filter((name) => name.endsWith(".json")).sort().reverse();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function validateStore(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.recipes)) throw new Error("Custom recipe store must contain schemaVersion 1 and recipes[].");
  for (const recipe of value.recipes) validateRecipe(recipe);
}

function validateRecipe(recipe) {
  const required = ["id", "internalName", "displayName", "source", "sourceVersion", "machine", "duration", "EUt", "inputs", "outputs", "properties"];
  for (const key of required) if (recipe?.[key] === undefined) throw new Error(`Recipe is missing ${key}.`);
  if (recipe.source !== "local-dev") throw new Error("Custom recipe source must be local-dev.");
  if (!Number.isInteger(recipe.duration) || recipe.duration <= 0) throw new Error(`Recipe ${recipe.id} duration must be a positive integer.`);
  if (!Number.isFinite(recipe.EUt) || recipe.EUt < 0) throw new Error(`Recipe ${recipe.id} EUt must be non-negative.`);
  if (!Array.isArray(recipe.inputs) || recipe.inputs.length === 0 || !Array.isArray(recipe.outputs) || recipe.outputs.length === 0) throw new Error(`Recipe ${recipe.id} needs at least one input and output.`);
  for (const entry of [...recipe.inputs, ...recipe.outputs]) if (!entry.item || !Number.isFinite(entry.amount) || entry.amount <= 0) throw new Error(`Recipe ${recipe.id} has an invalid resource entry.`);
}

function valueAfter(values, name) {
  const index = values.findIndex((value) => value === `--${name}` || value.startsWith(`--${name}=`));
  if (index < 0) return undefined;
  const value = values[index];
  return value.includes("=") ? value.slice(value.indexOf("=") + 1) : values[index + 1];
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

void crypto;

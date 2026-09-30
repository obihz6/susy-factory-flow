import fs from "node:fs/promises";
import path from "node:path";

const filePath = path.resolve(process.argv[2] ?? "data/custom-recipes/local-dev.json");

try {
  const store = JSON.parse(await fs.readFile(filePath, "utf8"));
  validateStore(store);
  console.log(`Validated ${store.recipes.length} custom recipe(s) in ${filePath}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function validateStore(store) {
  if (!store || store.schemaVersion !== 1 || !Array.isArray(store.recipes)) {
    throw new Error("Custom recipe store must contain schemaVersion 1 and recipes[].");
  }
  const names = new Set();
  for (const recipe of store.recipes) {
    validateRecipe(recipe);
    const name = recipe.internalName.toLowerCase();
    if (names.has(name)) throw new Error(`Duplicate custom recipe internalName: ${recipe.internalName}.`);
    names.add(name);
  }
}

function validateRecipe(recipe) {
  const required = ["id", "internalName", "displayName", "source", "sourceVersion", "machine", "duration", "EUt", "inputs", "outputs", "properties"];
  for (const key of required) if (recipe?.[key] === undefined) throw new Error(`Recipe is missing ${key}.`);
  if (recipe.source !== "local-dev") throw new Error(`Recipe ${recipe.id} source must be local-dev.`);
  if (!Number.isInteger(recipe.duration) || recipe.duration <= 0) throw new Error(`Recipe ${recipe.id} duration must be positive.`);
  if (!Number.isFinite(recipe.EUt) || recipe.EUt < 0) throw new Error(`Recipe ${recipe.id} EUt must be non-negative.`);
  if (!Array.isArray(recipe.inputs) || recipe.inputs.length === 0 || !Array.isArray(recipe.outputs) || recipe.outputs.length === 0) throw new Error(`Recipe ${recipe.id} needs an input and output.`);
  for (const entry of [...recipe.inputs, ...recipe.outputs]) {
    if (!entry.item || !Number.isFinite(entry.amount) || entry.amount <= 0) throw new Error(`Recipe ${recipe.id} has an invalid resource entry.`);
  }
}

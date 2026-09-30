import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Recipe, RecipeInput, RecipeOutput } from "@/lib/model/types";
import { recipeSchema } from "@/lib/model/schemas";
import { z } from "zod";

const projectRoot = process.cwd();
export const customRecipeRoot = path.join(projectRoot, "data", "custom-recipes");
export const customRecipeFile = path.join(customRecipeRoot, "local-dev.json");
export const customRecipeHistoryRoot = path.join(customRecipeRoot, "history");
const lockPath = path.join(customRecipeRoot, ".lock");
const MAX_HISTORY = 10;

const customIngredientSchema = z.object({
  item: z.string().trim().min(1).max(200),
  amount: z.number().finite().positive(),
  isFluid: z.boolean().default(false),
});

const customOutputSchema = customIngredientSchema.extend({
  probability: z.number().finite().min(0).max(100).default(100),
});

export const customRecipeSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    internalName: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9._-]+$/),
    displayName: z.string().trim().min(1).max(200),
    source: z.literal("local-dev"),
    sourceVersion: z.string().trim().min(1).max(120),
    createdAt: z.string().datetime(),
    lastModifiedAt: z.string().datetime(),
    modifiedBy: z.string().trim().min(1).max(80),
    baseRecipe: z
      .object({ versionId: z.string().min(1), recipeId: z.string().min(1) })
      .nullable(),
    machine: z.string().trim().min(1).max(160),
    duration: z.number().int().positive(),
    EUt: z.number().finite().nonnegative(),
    inputs: z.array(customIngredientSchema).min(1),
    outputs: z.array(customOutputSchema).min(1),
    properties: z.object({
      parallel: z.boolean().default(false),
      cleanroom: z.boolean().default(false),
      voltageTier: z.string().trim().min(1).max(30),
    }),
    notes: z.string().max(4000).default(""),
    tags: z.array(z.string().trim().min(1).max(40)).max(32).default([]),
    deletedAt: z.string().datetime().optional(),
  })
  .superRefine((recipe, context) => {
    if (recipe.inputs.some((input) => input.amount <= 0)) {
      context.addIssue({ code: "custom", message: "Every input amount must be positive.", path: ["inputs"] });
    }
    if (recipe.outputs.some((output) => output.amount <= 0)) {
      context.addIssue({ code: "custom", message: "Every output amount must be positive.", path: ["outputs"] });
    }
  });

export const customRecipeStoreSchema = z.object({
  schemaVersion: z.literal(1),
  recipes: z.array(customRecipeSchema),
});

export type CustomRecipe = z.infer<typeof customRecipeSchema>;
export type CustomRecipeStore = z.infer<typeof customRecipeStoreSchema>;
export type CustomRecipeInput = Omit<
  CustomRecipe,
  "id" | "createdAt" | "lastModifiedAt" | "modifiedBy" | "deletedAt"
> & {
  id?: string;
};

export interface CustomRecipeValidation {
  recipe?: CustomRecipe;
  errors: string[];
  warnings: string[];
}

export interface RecipeMergeEntry {
  recipe: Recipe;
  source: "published" | "custom";
  customRecipeId?: string;
  overriddenRecipeId?: string;
}

export async function readCustomRecipeStore(): Promise<CustomRecipeStore> {
  try {
    const raw = JSON.parse(await fs.readFile(customRecipeFile, "utf8")) as unknown;
    return customRecipeStoreSchema.parse(raw);
  } catch (error) {
    if (isMissingFile(error)) return { schemaVersion: 1, recipes: [] };
    throw new Error(`Custom recipe store is invalid: ${formatError(error)}`);
  }
}

export function validateCustomRecipe(
  input: unknown,
  options: { existing?: CustomRecipe[]; recipeId?: string } = {},
): CustomRecipeValidation {
  const parsed = customRecipeSchema.safeParse(input);
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "recipe"}: ${issue.message}`), warnings: [] };
  }
  const recipe = parsed.data;
  const duplicate = (options.existing ?? []).find(
    (entry) =>
      !entry.deletedAt &&
      entry.id !== options.recipeId &&
      entry.sourceVersion === recipe.sourceVersion &&
      (entry.internalName.toLowerCase() === recipe.internalName.toLowerCase() ||
        entry.displayName.toLowerCase() === recipe.displayName.toLowerCase()),
  );
  const warnings: string[] = [];
  if (duplicate) {
    return {
      recipe,
      errors: [`A custom recipe already uses the name "${duplicate.displayName}".`],
      warnings,
    };
  }
  if (recipe.inputs.some((input) => input.item.startsWith("custom:")) || recipe.outputs.some((output) => output.item.startsWith("custom:"))) {
    warnings.push("This recipe uses custom resources that may not exist in the selected pack.");
  }
  if (recipe.outputs.some((output) => output.probability < 100)) {
    warnings.push("One or more outputs are probabilistic and will be stored as chance outputs.");
  }
  return { recipe, errors: [], warnings };
}

export async function createCustomRecipe(
  input: CustomRecipeInput,
): Promise<{ recipe: CustomRecipe; warnings: string[] }> {
  return withStoreLock(async () => {
    const store = await readCustomRecipeStore();
    const now = new Date().toISOString();
    const recipe = buildCustomRecipe({ ...input, id: input.id ?? createRecipeId(input.internalName), createdAt: now, lastModifiedAt: now, modifiedBy: "user_input" });
    const validation = validateCustomRecipe(recipe, { existing: store.recipes });
    if (validation.errors.length > 0 || !validation.recipe) throw new Error(validation.errors.join(" "));
    await writeStoreWithBackup({ schemaVersion: 1, recipes: [...store.recipes, validation.recipe] });
    return { recipe: validation.recipe, warnings: validation.warnings };
  });
}

export async function updateCustomRecipe(
  recipeId: string,
  input: Partial<CustomRecipeInput>,
): Promise<{ recipe: CustomRecipe; warnings: string[] }> {
  return withStoreLock(async () => {
    const store = await readCustomRecipeStore();
    const index = store.recipes.findIndex((recipe) => recipe.id === recipeId);
    if (index < 0) throw new Error(`Custom recipe ${recipeId} was not found.`);
    const current = store.recipes[index];
    const candidate = buildCustomRecipe({ ...current, ...input, id: recipeId, createdAt: current.createdAt, lastModifiedAt: new Date().toISOString(), modifiedBy: "user_input" });
    const validation = validateCustomRecipe(candidate, { existing: store.recipes, recipeId });
    if (validation.errors.length > 0 || !validation.recipe) throw new Error(validation.errors.join(" "));
    const recipes = [...store.recipes];
    recipes[index] = validation.recipe;
    await writeStoreWithBackup({ schemaVersion: 1, recipes });
    return { recipe: validation.recipe, warnings: validation.warnings };
  });
}

export async function deleteCustomRecipe(recipeId: string, hard = false): Promise<void> {
  await withStoreLock(async () => {
    const store = await readCustomRecipeStore();
    const index = store.recipes.findIndex((recipe) => recipe.id === recipeId);
    if (index < 0) throw new Error(`Custom recipe ${recipeId} was not found.`);
    const recipes = [...store.recipes];
    if (hard) recipes.splice(index, 1);
    else recipes[index] = { ...recipes[index], deletedAt: new Date().toISOString(), lastModifiedAt: new Date().toISOString(), modifiedBy: "user_input" };
    await writeStoreWithBackup({ schemaVersion: 1, recipes });
  });
}

export async function listCustomRecipes(includeDeleted = false): Promise<CustomRecipe[]> {
  const store = await readCustomRecipeStore();
  return store.recipes.filter((recipe) => includeDeleted || !recipe.deletedAt);
}

export function customRecipeToRecipe(recipe: CustomRecipe): Recipe {
  const inputs: RecipeInput[] = recipe.inputs.map((input, index) => ({
    kind: input.isFluid ? "fluid" : "item",
    id: input.item,
    amount: input.amount,
    displayName: input.item,
    neiSlot: { x: 6, y: 4 + index * 18 },
  }));
  const outputs: RecipeOutput[] = recipe.outputs.map((output, index) => ({
    kind: output.isFluid ? "fluid" : "item",
    id: output.item,
    amount: output.amount,
    displayName: output.item,
    ...(output.probability < 100 ? { chance: output.probability / 100, byproduct: index > 0 } : {}),
    neiSlot: { x: 102, y: 4 + index * 18 },
  }));
  return recipeSchema.parse({
    id: recipe.id,
    name: recipe.displayName,
    kind: "custom",
    machineType: recipe.machine,
    minimumTier: recipe.properties.voltageTier,
    durationTicks: recipe.duration,
    eut: recipe.EUt,
    inputs,
    outputs,
    notes: recipe.notes,
    source: { datasetVersionId: recipe.sourceVersion, sourceIdentifier: recipe.id },
    metadata: {
      customRecipeId: recipe.id,
      modifiedBy: recipe.modifiedBy,
      tags: recipe.tags,
      parallel: recipe.properties.parallel,
      cleanroom: recipe.properties.cleanroom,
      customRecipe: true,
      ...(recipe.baseRecipe ? { baseRecipe: recipe.baseRecipe } : {}),
    },
  });
}

export function mergeCustomRecipes(published: Recipe[], custom: CustomRecipe[]): RecipeMergeEntry[] {
  const active = custom.filter((recipe) => !recipe.deletedAt);
  const overrides = new Map(
    active
      .filter((recipe) => recipe.baseRecipe?.recipeId)
      .map((recipe) => [recipe.baseRecipe!.recipeId, recipe]),
  );
  const merged: RecipeMergeEntry[] = published.map((recipe) => {
    const override = overrides.get(recipe.id);
    return override
      ? { recipe: customRecipeToRecipe(override), source: "custom", customRecipeId: override.id, overriddenRecipeId: recipe.id }
      : { recipe, source: "published" };
  });
  const replaced = new Set(overrides.keys());
  for (const recipe of active) {
    if (!recipe.baseRecipe || !replaced.has(recipe.baseRecipe.recipeId)) {
      merged.push({ recipe: customRecipeToRecipe(recipe), source: "custom", customRecipeId: recipe.id });
    }
  }
  return merged;
}

export async function listBackups(): Promise<string[]> {
  try {
    return (await fs.readdir(customRecipeHistoryRoot)).filter((name) => name.endsWith(".json")).sort().reverse();
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
}

/** Returns backup snapshots that contained a particular recipe, newest first. */
export async function listRecipeHistory(recipeId: string): Promise<Array<{ fileName: string; recipe?: CustomRecipe }>> {
  const history: Array<{ fileName: string; recipe?: CustomRecipe }> = [];
  for (const fileName of await listBackups()) {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(customRecipeHistoryRoot, fileName), "utf8")) as unknown;
      const store = customRecipeStoreSchema.parse(raw);
      history.push({ fileName, recipe: store.recipes.find((recipe) => recipe.id === recipeId) });
    } catch {
      // A malformed historical file should not make the current editor unusable.
    }
  }
  return history.filter((entry) => entry.recipe !== undefined);
}

export async function restoreBackup(fileName: string): Promise<void> {
  if (!/^[a-zA-Z0-9._-]+\.json$/.test(fileName)) throw new Error("Invalid backup name.");
  await withStoreLock(async () => {
    const source = path.join(customRecipeHistoryRoot, fileName);
    const raw = JSON.parse(await fs.readFile(source, "utf8")) as unknown;
    const store = customRecipeStoreSchema.parse(raw);
    await writeStoreWithBackup(store);
  });
}

export async function exportCustomRecipes(ids?: string[]): Promise<CustomRecipeStore> {
  const recipes = await listCustomRecipes();
  return { schemaVersion: 1, recipes: ids?.length ? recipes.filter((recipe) => ids.includes(recipe.id)) : recipes };
}

export async function importCustomRecipes(value: unknown, replace = false): Promise<{ imported: number; warnings: string[] }> {
  const parsed = customRecipeStoreSchema.safeParse(value);
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join(" "));
  return withStoreLock(async () => {
    const current = await readCustomRecipeStore();
    const existingIds = new Set(current.recipes.map((recipe) => recipe.id));
    const recipes = replace ? [] : [...current.recipes];
    const warnings: string[] = [];
    let imported = 0;
    for (const recipe of parsed.data.recipes) {
      const validation = validateCustomRecipe(recipe, { existing: recipes, recipeId: existingIds.has(recipe.id) ? recipe.id : undefined });
      if (validation.errors.length > 0 || !validation.recipe) throw new Error(validation.errors.join(" "));
      const index = recipes.findIndex((entry) => entry.id === recipe.id);
      if (index >= 0) recipes[index] = recipe;
      else recipes.push(recipe);
      warnings.push(...validation.warnings);
      imported += 1;
    }
    await writeStoreWithBackup({ schemaVersion: 1, recipes });
    return { imported, warnings };
  });
}

async function writeStoreWithBackup(store: CustomRecipeStore) {
  await fs.mkdir(customRecipeHistoryRoot, { recursive: true });
  try {
    await fs.copyFile(customRecipeFile, path.join(customRecipeHistoryRoot, `local-dev.backup.${fileTimestamp()}.json`));
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  const backups = await listBackups();
  for (const backup of backups.slice(MAX_HISTORY)) {
    await fs.rm(path.join(customRecipeHistoryRoot, backup), { force: true });
  }
  const temporaryPath = `${customRecipeFile}.tmp-${process.pid}`;
  await fs.mkdir(customRecipeRoot, { recursive: true });
  await fs.writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`);
  await fs.rename(temporaryPath, customRecipeFile);
}

async function withStoreLock<T>(action: () => Promise<T>): Promise<T> {
  await fs.mkdir(customRecipeRoot, { recursive: true });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await fs.mkdir(lockPath);
      break;
    } catch (error) {
      if (errorCode(error) !== "EEXIST" || attempt === 49) throw new Error("Custom recipe store is busy; try again shortly.");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return await action();
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true });
  }
}

function buildCustomRecipe(input: Record<string, unknown>): CustomRecipe {
  return customRecipeSchema.parse({
    ...input,
    source: "local-dev",
    properties: {
      parallel: false,
      cleanroom: false,
      voltageTier: "LV",
      ...(input.properties as Record<string, unknown> | undefined),
    },
    notes: input.notes ?? "",
    tags: input.tags ?? [],
    baseRecipe: input.baseRecipe ?? null,
  });
}

function createRecipeId(internalName: string) {
  return `custom_${crypto.createHash("sha1").update(`${internalName}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 16)}`;
}

function fileTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function isMissingFile(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

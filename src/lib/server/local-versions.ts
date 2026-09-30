import fs from "node:fs/promises";
import path from "node:path";
import type { DatasetManifest, DatasetVersion } from "@/lib/datasets/types";
import type { Recipe } from "@/lib/model/types";
import { customRecipeToRecipe, listCustomRecipes } from "./custom-recipes";

const projectRoot = process.cwd();
export const localVersionsRoot = path.join(projectRoot, "data", "versions", "local");
const manifestPath = path.join(projectRoot, "public", "datasets", "susy", "datasets.manifest.json");

export async function listAvailableVersions(): Promise<{
  versions: Array<DatasetVersion & { local: boolean; recipeCount?: number }>;
  customRecipeCount: number;
}> {
  const manifest = await readManifest();
  const published = (manifest?.versions ?? []).map((version) => ({ ...version, local: false }));
  const local = await listLocalVersions();
  const customRecipeCount = (await listCustomRecipes()).length;
  return { versions: [...published, ...local], customRecipeCount };
}

export async function readLocalVersionRecipes(versionId: string): Promise<Recipe[]> {
  if (!isSafeVersionId(versionId)) throw new Error("Invalid local version id.");
  const versionDir = path.join(localVersionsRoot, versionId);
  const candidates = [path.join(versionDir, "recipes.json"), path.join(versionDir, "recipes.json.gz")];
  for (const filePath of candidates) {
    try {
      const raw = await fs.readFile(filePath);
      const text = filePath.endsWith(".gz")
        ? (await import("node:zlib")).gunzipSync(raw).toString("utf8")
        : raw.toString("utf8");
      const parsed = JSON.parse(text) as { recipes?: Recipe[] } | Recipe[];
      return Array.isArray(parsed) ? parsed : parsed.recipes ?? [];
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }
  return [];
}

export async function getVersionRecipes(versionId: string): Promise<Recipe[]> {
  const local = await isLocalVersion(versionId);
  if (local) return readLocalVersionRecipes(versionId);
  throw new Error("Published recipe bodies are served by the dataset API; use its version route.");
}

export function isSafeVersionId(value: string) {
  return /^[a-zA-Z0-9._-]+$/.test(value) && value !== "." && value !== "..";
}

async function listLocalVersions(): Promise<Array<DatasetVersion & { local: true; recipeCount?: number }>> {
  let entries;
  try {
    entries = await fs.readdir(localVersionsRoot, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
  const versions = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSafeVersionId(entry.name)) continue;
    const recipes = await readLocalVersionRecipes(entry.name);
    const metadata = await readLocalMetadata(entry.name);
    versions.push({
      id: entry.name,
      gtnhVersion: metadata.versionLabel ?? entry.name,
      channel: "experimental" as const,
      publishedAt: metadata.createdAt ?? new Date(0).toISOString(),
      manifestPath: "",
      recipeDatasetPath: `/api/recipes?versionId=${encodeURIComponent(entry.name)}`,
      sourceInfo: {
        sourceId: "unknown" as const,
        sourceVersion: metadata.baseVersion,
        generatedAt: metadata.createdAt ?? new Date(0).toISOString(),
        notes: "Local development version",
      },
      local: true as const,
      recipeCount: recipes.length,
    });
  }
  return versions.sort((left, right) => left.id.localeCompare(right.id));
}

async function readLocalMetadata(versionId: string): Promise<{ versionLabel?: string; baseVersion?: string; createdAt?: string }> {
  try {
    return JSON.parse(await fs.readFile(path.join(localVersionsRoot, versionId, "version.json"), "utf8"));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return {};
    throw error;
  }
}

async function isLocalVersion(versionId: string) {
  if (!isSafeVersionId(versionId)) return false;
  try {
    return (await fs.stat(path.join(localVersionsRoot, versionId))).isDirectory();
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

async function readManifest(): Promise<DatasetManifest | undefined> {
  try {
    return JSON.parse(await fs.readFile(manifestPath, "utf8")) as DatasetManifest;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

export async function loadMergedCustomRecipes() {
  return (await listCustomRecipes()).map(customRecipeToRecipe);
}

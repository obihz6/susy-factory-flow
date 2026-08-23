/**
 * SusyCore recipedump.json -> planner RecipeDataset.
 *
 * Raw source: SusyCore's `/recipemapdump` command (SymmetricDevs/Susy-Core,
 * CommandRecipemapDump.java), which writes one JSON object with these keys:
 *
 *   items       full item catalog ({resource, metadata, displayName, material?})
 *   fluids      full fluid catalog ({fluidName, unlocalizedName, localizedName})
 *   oreDict     { oreName: [itemStack] }
 *   recipemaps  { <unlocalizedName>: { maxInputs..., recipes: [gtRecipe] } }
 *   gtMTEs      { <registryKey>: { metaName, isController, tier?, recipemapName? } }
 *   smelting    [ {input, output} ]
 *   crafting    [ {type, keymap/shape | ingredients, output} ]
 *   materials   { ... } (unused here)
 *
 * The GTNH pipeline models this same stage on gtnh-calc-oracle +
 * normalize-oracle-export.mjs; resource ids follow that contract
 * (`registry@meta` when meta != 0, lowercased) so downstream code behaves
 * identically across packs.
 *
 * Known gaps vs the GTNH export, accepted for now:
 *   - No HEI slot layouts: neiSlot values are synthesized deterministically;
 *     the browser falls back to capacity-based grids anyway.
 *   - No localized recipe-map names: they are derived from the unlocalized
 *     name ("gtceu.macerator" -> "Macerator").
 *   - No runtimeCalculation: the solver's own overclock model applies.
 *   - Smelting recipes carry synthesized 128 ticks @ 4 EU/t (the GregTech
 *     electric-furnace baseline); vanilla furnace timing differs.
 *
 * Usage:
 *   normalize-susy-recipedump.mjs <recipedump.json> <recipes.json>
 * Env:
 *   SUSY_DATASET_VERSION_ID   (required)
 *   SUSY_DATASET_VERSION_LABEL (required)
 *   SUSY_RENDERED_ICON_DIR    optional dir of rendered PNGs keyed by icon stem
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { writeDatasetJson } from "../dataset-json-writer.mjs";

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) {
  throw new Error("Usage: normalize-susy-recipedump.mjs <recipedump.json> <recipes.json>");
}

const datasetVersionId = requiredEnv("SUSY_DATASET_VERSION_ID");
const susyVersion = requiredEnv("SUSY_DATASET_VERSION_LABEL");
const generatedAt = new Date().toISOString();

const raw = JSON.parse(stripBom(await fs.readFile(inputPath, "utf8")));

// ---------------------------------------------------------------------------
// Resource identity
// ---------------------------------------------------------------------------

/** `registry@meta` when meta != 0, lowercased — the GTNH oracle convention. */
function itemId(resource, metadata) {
  const canonical = String(resource || "").toLowerCase();
  if (!canonical || canonical === "null") return null;
  return Number(metadata) ? `${canonical}@${Number(metadata)}` : canonical;
}

const VOLTAGE_NAMES = ["ULV", "LV", "MV", "HV", "EV", "IV", "LuV", "ZPM", "UV"];
const VOLTAGES = [8, 32, 128, 512, 2048, 8192, 32768, 131072, 524288];

function voltageTierForEu(eut) {
  const value = Math.max(0, Math.abs(Number(eut) || 0));
  for (let tier = 0; tier < VOLTAGES.length; tier += 1) {
    if (value <= VOLTAGES[tier]) return VOLTAGE_NAMES[tier];
  }
  return VOLTAGE_NAMES[VOLTAGE_NAMES.length - 1];
}

/** "gtceu.macerator" / "macerator" / "susy.mixer_settler" -> "Macerator". */
function prettyMachineName(unlocalizedName) {
  const tail = String(unlocalizedName || "").split(".").pop() || String(unlocalizedName || "");
  return tail
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function sha16(text) {
  return crypto.createHash("sha1").update(text, "utf8").digest("hex").slice(0, 16);
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

// ---------------------------------------------------------------------------
// Catalog joins
// ---------------------------------------------------------------------------

/** unlocalizedName/localizedName -> {fluidName, displayName} */
const fluidByUnlocalizedName = new Map();
for (const fluid of Array.isArray(raw.fluids) ? raw.fluids : []) {
  if (!fluid || typeof fluid !== "object") continue;
  const entry = {
    fluidName: String(fluid.fluidName || ""),
    displayName: String(fluid.localizedName || fluid.unlocalizedName || fluid.fluidName || ""),
  };
  if (fluid.unlocalizedName) fluidByUnlocalizedName.set(fluid.unlocalizedName, entry);
  if (fluid.fluidName) fluidByUnlocalizedName.set(fluid.fluidName, entry);
}

const itemDisplayNames = new Map();
for (const item of Array.isArray(raw.items) ? raw.items : []) {
  if (!item || !item.resource) continue;
  const id = itemId(item.resource, item.metadata);
  if (id && item.displayName) itemDisplayNames.set(id, String(item.displayName));
}

/**
 * Multiblock CONTROLLERS indexed by the tail of their name ("quencher",
 * "electric_blast_furnace"): they carry no recipemapName, but the tail equals
 * the recipe-map key, which is how a multi's own face gets found.
 */
const TIER_SUFFIX =
  /\.(ulv|lv|mv|hv|ev|iv|luv|zpm|uv|uhv|uev|uiv|uxv|opv|max)$/i;
const controllersByMapKey = new Map();
for (const [registryKey, machine] of Object.entries(raw.gtMTEs || {})) {
  if (!machine?.isController) continue;
  const rawName = String(machine.metaName || registryKey);
  const tail = (rawName.split(".").pop() || rawName).replace(TIER_SUFFIX, "");
  const key = tail.toLowerCase();
  const list = controllersByMapKey.get(key) || [];
  list.push({ registryKey, machine, tail });
  controllersByMapKey.set(key, list);
}

/** The controller ITEM for a recipe-map key, when one can be resolved. */
function controllerFaceResource(mapName) {
  const candidates = controllersByMapKey.get(String(mapName).toLowerCase());
  if (!candidates?.length) return undefined;
  const lowered = String(mapName).toLowerCase();
  const chosen =
    candidates.find((c) => c.tail.toLowerCase() === lowered) ?? candidates[0];
  const item = machineItemByTranslationKey.get(String(chosen.machine.metaName || ""));
  if (!item) return undefined;
  const resource = {
    kind: "item",
    id: item.id,
    displayName: item.displayName,
    modId: modIdOf(item.id),
  };
  addResource({ ...resource });
  return resource;
}

/** gtMTEs metaNames double as machine-item translationKeys ("gregtech.machine.macerator.lv"). */
const machineItemByTranslationKey = new Map();
for (const item of Array.isArray(raw.items) ? raw.items : []) {
  if (!item?.resource || !String(item.itemClass || "").includes("MachineItemBlock")) continue;
  const id = itemId(item.resource, item.metadata);
  if (!id || !item.translationKey) continue;
  if (!machineItemByTranslationKey.has(item.translationKey)) {
    machineItemByTranslationKey.set(item.translationKey, { id, displayName: item.displayName });
  }
}

// ---------------------------------------------------------------------------
// Dataset accumulators
// ---------------------------------------------------------------------------

const resources = new Map();
const recipes = [];
const recipeMaps = new Set();
const recipeMapIcons = [];

function addResource(entry) {
  const key = `${entry.kind}:${entry.id}`;
  const existing = resources.get(key);
  if (!existing) {
    resources.set(key, entry);
    return entry;
  }
  if (!existing.displayName && entry.displayName) existing.displayName = entry.displayName;
  if (!existing.modId && entry.modId) existing.modId = entry.modId;
  return existing;
}

function modIdOf(id) {
  const separator = id.indexOf(":");
  return separator > 0 ? id.slice(0, separator) : undefined;
}

/** Deterministic fallback NEI-style slot positions (presentation only). */
function assignSlots(recipe) {
  let itemInputs = 0;
  for (const input of recipe.inputs) {
    if (input.kind === "item") {
      input.neiSlot = { x: 6, y: 4 + itemInputs * 18 };
      itemInputs += 1;
    } else {
      input.neiSlot = { x: 30, y: 4 + itemInputs * 18 };
      itemInputs += 1;
    }
  }
  recipe.outputs.forEach((output, index) => {
    output.neiSlot = { x: 102, y: 4 + index * 18 };
  });
}

function stackToResource(stack) {
  const id = itemId(stack.resource, stack.metadata);
  if (!id) return null;
  return addResource({
    kind: "item",
    id,
    amount: Math.max(1, Number(stack.count) || 1),
    displayName: itemDisplayNames.get(id),
    modId: modIdOf(id),
  });
}

function fluidInputToResource(input) {
  const fluidStack = input.inputFluidStack;
  if (!fluidStack) return null;
  const known = fluidByUnlocalizedName.get(fluidStack.unlocalizedName);
  const id = known?.fluidName || String(fluidStack.unlocalizedName || "").replace(/^fluid\./, "");
  if (!id) return null;
  return addResource({
    kind: "fluid",
    id,
    amount: Math.max(1, Number(fluidStack.amount) || 1),
    displayName: fluidStack.specificLocalizedName || known?.displayName,
  });
}

/**
 * CEu chanced-output chances are integers out of 10000 (GT5u convention).
 * Anything larger can only come from a different logic scale, so fall back to
 * the int32 maximum.
 */
function normalizeChance(value) {
  const numeric = Number(value);
  if (!(numeric > 0)) return undefined;
  const fraction = numeric <= 10000 ? numeric / 10000 : numeric / 2147483647;
  return fraction >= 1 ? undefined : Math.round(fraction * 10000) / 10000;
}

function isCircuitStack(stack) {
  const resource = String(stack.resource || "").toLowerCase();
  return (
    resource.includes("integrated_circuit") ||
    resource.includes("programmable_circuit") ||
    /[/:]circuit\b/.test(resource)
  );
}

function convertGtRecipe(mapName, index, rawRecipe) {
  const inputs = [];
  let programmedCircuit;

  for (const input of Array.isArray(rawRecipe.inputs) ? rawRecipe.inputs : []) {
    const stacks = (input.inputStacks || []).filter(
      (stack) => stack && stack.resource,
    );
    if (stacks.length === 0) continue;
    const nonConsumable = Boolean(input.nonConsumable);
    const amount = Math.max(1, Number(input.amount) || 1);

    const primary = stackToResource(stacks[0]);
    if (!primary) continue;
    const entry = {
      kind: primary.kind,
      id: primary.id,
      amount,
      displayName: primary.displayName,
      modId: primary.modId,
      ...(nonConsumable ? { consumed: false } : {}),
    };
    if (nonConsumable && stacks.some(isCircuitStack)) {
      const dialled = stacks.find(isCircuitStack);
      const configuration = Number(dialled.metadata);
      if (Number.isFinite(configuration)) programmedCircuit = String(configuration);
    }
    if (stacks.length > 1) {
      entry.alternatives = stacks
        .slice(1)
        .map((stack) => stackToResource(stack))
        .filter(Boolean)
        .map(({ kind, id, displayName, modId }) => ({ kind, id, displayName, modId }));
    }
    inputs.push(entry);
  }

  for (const input of Array.isArray(rawRecipe.inputsFluid) ? rawRecipe.inputsFluid : []) {
    const fluidResource = fluidInputToResource(input);
    if (!fluidResource) continue;
    inputs.push({
      kind: "fluid",
      id: fluidResource.id,
      amount: Math.max(1, Number(input.amount) || Number(fluidResource.amount) || 1),
      displayName: fluidResource.displayName,
      ...(input.nonConsumable ? { consumed: false } : {}),
    });
  }

  const outputs = [];
  for (const output of Array.isArray(rawRecipe.outputs) ? rawRecipe.outputs : []) {
    const resource = stackToResource(output);
    if (resource) {
      outputs.push({
        kind: resource.kind,
        id: resource.id,
        amount: Math.max(1, Number(output.count) || 1),
        displayName: resource.displayName,
        modId: resource.modId,
      });
    }
  }
  for (const output of Array.isArray(rawRecipe.chancedOutputs) ? rawRecipe.chancedOutputs : []) {
    const resource = stackToResource(output);
    if (!resource) continue;
    const chance = normalizeChance(output.chance);
    outputs.push({
      kind: resource.kind,
      id: resource.id,
      amount: Math.max(1, Number(output.count) || 1),
      displayName: resource.displayName,
      modId: resource.modId,
      ...(chance === undefined ? {} : { chance }),
      ...(outputs.length > 0 ? { byproduct: true } : {}),
    });
  }
  for (const output of Array.isArray(rawRecipe.chancedFluidOutputs)
    ? rawRecipe.chancedFluidOutputs
    : []) {
    const known = fluidByUnlocalizedName.get(output.unlocalizedName);
    const id = known?.fluidName || String(output.unlocalizedName || "").replace(/^fluid\./, "");
    if (!id) continue;
    const chance = normalizeChance(output.chance);
    addResource({ kind: "fluid", id, displayName: known?.displayName });
    outputs.push({
      kind: "fluid",
      id,
      amount: Math.max(1, Number(output.amount) || 1),
      displayName: known?.displayName,
      ...(chance === undefined ? {} : { chance }),
      byproduct: true,
    });
  }
  for (const output of Array.isArray(rawRecipe.fluidOutputs) ? rawRecipe.fluidOutputs : []) {
    const known = fluidByUnlocalizedName.get(output.unlocalizedName);
    const id = known?.fluidName || String(output.unlocalizedName || "").replace(/^fluid\./, "");
    if (!id) continue;
    addResource({ kind: "fluid", id, displayName: known?.displayName });
    outputs.push({
      kind: "fluid",
      id,
      amount: Math.max(1, Number(output.amount) || 1),
      displayName: output.specificLocalizedName || known?.displayName,
    });
  }

  if (inputs.length === 0 || outputs.length === 0) return null;

  const properties = Array.isArray(rawRecipe.properties) ? rawRecipe.properties : [];
  const temperatureProperty = properties.find((prop) => prop.propertyKey === "temperature");
  const metadata = {};
  for (const prop of properties) {
    if (prop.propertyKey === "eu_to_start") metadata.fusionEuToStart = prop.eu_to_start;
    if (prop.propertyKey === "cleanroom") metadata.cleanroom = prop.cleanroom;
    if (prop.propertyKey === "dimension") metadata.dimensions = prop.dimensions;
    if (prop.propertyKey === "cells") metadata.cells = prop.cells;
  }

  const recipe = {
    id: sha16(`susy:${mapName}:${index}`),
    name: outputs[0]?.displayName || outputs[0]?.id || mapName,
    kind: "gregtech_machine",
    machineType: mapName,
    minimumTier: voltageTierForEu(rawRecipe.EUt),
    durationTicks: Math.max(1, Number(rawRecipe.duration) || 1),
    eut: Math.max(0, Number(rawRecipe.EUt) || 0),
    inputs,
    outputs,
    category: rawRecipe.categoryName || undefined,
    ...(programmedCircuit !== undefined ? { programmedCircuit } : {}),
    ...(temperatureProperty ? { specialValue: Number(temperatureProperty.temperature) } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    source: {
      datasetVersionId,
      recipeMap: mapName,
      sourceMod: rawRecipe.categoryModID || undefined,
      exporter: "gtnh-oracle",
      rawRecipeId: rawRecipe.categoryUniqueID || undefined,
    },
  };
  assignSlots(recipe);
  return recipe;
}

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

const machinesByRecipeMap = new Map();
for (const [registryKey, machine] of Object.entries(raw.gtMTEs || {})) {
  if (!machine?.recipemapName) continue;
  const list = machinesByRecipeMap.get(machine.recipemapName) || [];
  list.push({ registryKey, machine });
  machinesByRecipeMap.set(machine.recipemapName, list);
}

// GTNH-pipeline convention: tier variants fold into ONE handler family per
// recipe map. SusyCore metaNames carry the tier as a dotted suffix
// ("macerator.lv"); stripping it yields the family, and the lowest-tier
// machine represents it. Without this the alternative-machine selector fills
// with Lv/Mv/Hv entries that duplicate the app's own tier system.
const TIER_ORDER = new Map(
  ["ulv", "lv", "mv", "hv", "ev", "iv", "luv", "zpm", "uv", "uhv"].map(
    (tier, index) => [tier, index],
  ),
);

function familyHandlers(machines) {
  const byFamily = new Map();
  for (const { registryKey, machine } of [...machines].sort((left, right) => {
    const leftTier = TIER_ORDER.get(String(left.machine.tier ?? "").toLowerCase()) ?? 99;
    const rightTier = TIER_ORDER.get(String(right.machine.tier ?? "").toLowerCase()) ?? 99;
    return leftTier - rightTier;
  })) {
    const rawName = String(machine.metaName || registryKey.split(":").pop() || registryKey);
    const familyName = rawName.replace(TIER_SUFFIX, "");
    const familyKey = `${machine.isController ? "multi:" : "single:"}${familyName.toLowerCase()}`;
    if (byFamily.has(familyKey)) continue;
    byFamily.set(familyKey, {
      id: familyKey,
      label: prettyMachineName(familyName),
      kind: machine.isController ? "multiblock" : "single",
      // Representative machine item (lowest tier): looked up through
      // machineItemByTranslationKey for category / selector icons.
      _metaName: String(machine.metaName || ""),
      ...(Number.isFinite(Number(machine.tier))
        ? {
            minimumTier:
              VOLTAGE_NAMES[Math.min(Number(machine.tier), VOLTAGE_NAMES.length - 1)],
          }
        : {}),
    });
  }
  return [...byFamily.values()];
}

const machineHandlerIcons = [];

for (const [mapName, map] of Object.entries(raw.recipemaps || {})) {
  // SusyCore keys the object by RecipeMap#getUnlocalizedName(); translationKey
  // ends in ".name", so it must not be used for display.
  const machineType = prettyMachineName(mapName);
  const families = familyHandlers(machinesByRecipeMap.get(mapName) || []);
  const handlers = families.map(({ _metaName, ...handler }) => handler);

  // The family's lowest-tier machine ITEM is the face of both the category and
  // its selector entries; apply-susy-icons stamps its iconPath afterwards.
  const familyIconResources = [];
  for (const family of families) {
    const machineItem = machineItemByTranslationKey.get(family._metaName);
    if (!machineItem) continue;
    const resource = {
      kind: "item",
      id: machineItem.id,
      displayName: machineItem.displayName,
      modId: modIdOf(machineItem.id),
    };
    addResource({ ...resource });
    machineHandlerIcons.push({ familyId: family.id, resource });
    familyIconResources.push(resource);
  }

  let index = 0;
  for (const rawRecipe of Array.isArray(map.recipes) ? map.recipes : []) {
    const recipe = convertGtRecipe(machineType, index, rawRecipe);
    index += 1;
    if (!recipe) continue;
    if (handlers.length > 0) recipe.machineHandlers = handlers;
    recipeMaps.add(machineType);
    recipes.push(recipe);
    if (!recipeMapIcons.some((icon) => icon.recipeMap === machineType)) {
      // Prefer the machine's own face; fall back to the first output so a
      // category is never left without any icon at all.
      // Face priority: the family's own machine item, then the multiblock
      // CONTROLLER, then the first ITEM output (a fluid square reads worse at
      // tab size), then any output.
      const primaryOutput =
        recipe.outputs.find((output) => output.kind === "item") ?? recipe.outputs[0];
      const resource =
        familyIconResources[0] ??
        controllerFaceResource(mapName) ??
        (primaryOutput
          ? {
              kind: primaryOutput.kind,
              id: primaryOutput.id,
              displayName: primaryOutput.displayName,
              modId: primaryOutput.modId,
            }
          : undefined);
      if (resource) recipeMapIcons.push({ recipeMap: machineType, resource });
    }
  }
}

// Smelting: SusyCore dumps vanilla FurnaceRecipes without durations; the
// GregTech electric-furnace baseline (128 ticks @ 4 EU/t) is applied so the
// chains do not show an untimed step. Flagged in metadata for later refinement.
let smeltingCount = 0;
for (const entry of Array.isArray(raw.smelting) ? raw.smelting : []) {
  const input = entry.input && stackToResource(entry.input);
  const output = entry.output && stackToResource(entry.output);
  if (!input || !output) continue;
  smeltingCount += 1;
  const recipe = {
    id: sha16(`susy:smelting:${smeltingCount}:${input.id}`),
    name: output.displayName || output.id,
    kind: "gregtech_machine",
    machineType: "Electric Furnace",
    minimumTier: "LV",
    durationTicks: 128,
    eut: 4,
    inputs: [
      {
        kind: input.kind,
        id: input.id,
        amount: Math.max(1, Number(entry.input.count) || 1),
        displayName: input.displayName,
        modId: input.modId,
        neiSlot: { x: 6, y: 22 },
      },
    ],
    outputs: [
      {
        kind: output.kind,
        id: output.id,
        amount: Math.max(1, Number(entry.output.count) || 1),
        displayName: output.displayName,
        modId: output.modId,
        neiSlot: { x: 102, y: 22 },
      },
    ],
    source: { datasetVersionId, recipeMap: "Electric Furnace", exporter: "gtnh-oracle" },
    metadata: { synthesizedDuration: true },
  };
  recipeMaps.add("Electric Furnace");
  recipes.push(recipe);
}

// Crafting table: instant manual recipes (the app treats 0-duration as instant).
let craftingCount = 0;
for (const entry of Array.isArray(raw.crafting) ? raw.crafting : []) {
  const output = entry.output && stackToResource(entry.output);
  if (!output || !Number(entry.output.count)) continue;
  const ingredients =
    entry.type === "shaped" && entry.recipe?.keymap
      ? Object.values(entry.recipe.keymap)
      : Array.isArray(entry.recipe?.ingredients)
        ? entry.recipe.ingredients
        : [];
  const inputs = [];
  for (const ingredient of ingredients) {
    const validInputs = Array.isArray(ingredient?.validInputs) ? ingredient.validInputs : [];
    const stacks = validInputs.filter((stack) => stack && stack.resource);
    if (stacks.length === 0) continue;
    const primary = stackToResource(stacks[0]);
    if (!primary) continue;
    const converted = {
      kind: primary.kind,
      id: primary.id,
      amount: Math.max(1, Number(stacks[0].count) || 1),
      displayName: primary.displayName,
      modId: primary.modId,
    };
    if (stacks.length > 1) {
      converted.alternatives = stacks
        .slice(1)
        .map((stack) => stackToResource(stack))
        .filter(Boolean)
        .map(({ kind, id, displayName, modId }) => ({ kind, id, displayName, modId }));
    }
    inputs.push(converted);
  }
  if (inputs.length === 0) continue;
  craftingCount += 1;
  inputs.forEach((input, index) => {
    input.neiSlot = { x: 6 + (index % 3) * 18, y: 4 + Math.floor(index / 3) * 18 };
  });
  const recipe = {
    id: sha16(`susy:crafting:${craftingCount}:${output.id}`),
    name: output.displayName || output.id,
    machineType: "Crafting Table",
    minimumTier: "ULV",
    durationTicks: 0,
    eut: 0,
    inputs,
    outputs: [
      {
        kind: output.kind,
        id: output.id,
        amount: Math.max(1, Number(entry.output.count) || 1),
        displayName: output.displayName,
        modId: output.modId,
        neiSlot: { x: 102, y: 22 },
      },
    ],
    source: {
      datasetVersionId,
      recipeMap: "crafting",
      exporter: "gtnh-oracle",
      rawRecipeId: typeof entry.registryName === "string" ? entry.registryName : undefined,
    },
  };
  recipeMaps.add("Crafting Table");
  recipes.push(recipe);
}

// ---------------------------------------------------------------------------
// Crop Farm sources: hand-worked farmland crops (the board's "Add crop farm"
// picker). The pack ships no CropsNH-style crop catalogue, so the picker's
// entries derive from the Greenhouse Plant recipes - every crop it grows on
// TILLED SOIL. Sugar cane and cactus never see a hoe and are excluded; the
// dump plants cactus from raw sand, which fails the seed test on its own.
// One recipe = one planted crop over one greenhouse growth cycle.
// ---------------------------------------------------------------------------

const CROP_FARM_MACHINE_TYPE = "Crop Farm";
const NOT_TILLED_SOIL_PLANT_IDS = new Set(["minecraft:reeds", "minecraft:cactus", "minecraft:sand"]);

/** The planted item: the first input stack that is not a dialled circuit. */
function plantedStackOf(rawRecipe) {
  for (const input of Array.isArray(rawRecipe.inputs) ? rawRecipe.inputs : []) {
    for (const stack of input.inputStacks || []) {
      const resource = String(stack.resource || "").toLowerCase();
      if (isCircuitStack(stack) || resource === "gregtech:meta_item_1") continue;
      return {
        stack,
        plantCount: Math.max(1, Number(input.amount) || Number(stack.count) || 1),
      };
    }
  }
  return undefined;
}

const seenCropFarmSeeds = new Set();
let cropFarmIconPushed = false;
for (const [mapName, map] of Object.entries(raw.recipemaps || {})) {
  if (!/greenhouse/i.test(mapName) || !/plant/i.test(mapName)) continue;
  for (const rawRecipe of Array.isArray(map.recipes) ? map.recipes : []) {
    const planted = plantedStackOf(rawRecipe);
    if (!planted) continue;
    const seedId = itemId(planted.stack.resource, planted.stack.metadata);
    if (!seedId || NOT_TILLED_SOIL_PLANT_IDS.has(seedId)) continue;
    // The dump repeats every greenhouse recipe; keep one entry per crop.
    if (seenCropFarmSeeds.has(seedId)) continue;
    seenCropFarmSeeds.add(seedId);

    const perPlantAmount = (count) =>
      Math.max(0, Math.round(((Number(count) || 0) / planted.plantCount) * 1e6) / 1e6);
    const outputs = [];
    for (const output of Array.isArray(rawRecipe.outputs) ? rawRecipe.outputs : []) {
      const resource = stackToResource(output);
      if (!resource) continue;
      const amount = perPlantAmount(output.count);
      if (!(amount > 0)) continue;
      outputs.push({
        kind: resource.kind,
        id: resource.id,
        amount,
        displayName: resource.displayName,
        modId: resource.modId,
      });
    }
    if (outputs.length === 0) continue;

    const seedDisplayName = itemDisplayNames.get(seedId);
    addResource({
      kind: "item",
      id: seedId,
      displayName: seedDisplayName,
      modId: modIdOf(seedId),
    });

    // The crop is named by its harvest - the first output that differs from
    // the planted item ("Wheat" out of seeds) - or by what was planted when
    // the crop is its own seed (carrots, potatoes).
    const produceOutput = outputs.find((output) => output.id !== seedId) ?? outputs[0];
    const cropLabel =
      produceOutput?.displayName ?? produceOutput?.id ?? seedDisplayName ?? seedId;

    const recipe = {
      id: sha16(`susy:crop-farm:${seedId}`),
      name: `${CROP_FARM_MACHINE_TYPE}: ${cropLabel}`,
      kind: "crop_produce",
      machineType: CROP_FARM_MACHINE_TYPE,
      category: "crop-farm",
      minimumTier: "NONE",
      durationTicks: Math.max(1, Number(rawRecipe.duration) || 1),
      eut: 0,
      inputs: [
        {
          kind: "item",
          id: seedId,
          amount: 1,
          displayName: seedDisplayName,
          modId: modIdOf(seedId),
          consumed: false,
        },
      ],
      outputs,
      notes:
        "One hand-worked farmland crop. Yields follow the pack's own greenhouse growth cycle scaled to a single planted crop; the seed stays in the field. Machine count = crops planted.",
      source: {
        datasetVersionId,
        recipeMap: CROP_FARM_MACHINE_TYPE,
        exporter: "gtnh-oracle",
        sourceMod: rawRecipe.categoryModID || undefined,
        rawRecipeId: rawRecipe.categoryUniqueID || undefined,
      },
    };
    assignSlots(recipe);
    recipeMaps.add(CROP_FARM_MACHINE_TYPE);
    recipes.push(recipe);

    if (!cropFarmIconPushed) {
      recipeMapIcons.push({
        recipeMap: CROP_FARM_MACHINE_TYPE,
        resource: { kind: "item", id: seedId, displayName: seedDisplayName, modId: modIdOf(seedId) },
      });
      cropFarmIconPushed = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Growable resources (the browser's "Plants" filter)
// ---------------------------------------------------------------------------

const VANILLA_PLANT_IDS = new Set(
  [
    "minecraft:wheat",
    "minecraft:wheat_seeds",
    "minecraft:carrot",
    "minecraft:potato",
    "minecraft:beetroot",
    "minecraft:beetroot_seeds",
    "minecraft:sugar_cane",
    "minecraft:cocoa_beans",
    "minecraft:cactus",
    "minecraft:melon_slice",
    "minecraft:pumpkin",
    "minecraft:sweet_berries",
    "minecraft:glow_berries",
    "minecraft:nether_wart",
    "minecraft:kelp",
    "minecraft:bamboo",
    "minecraft:apple",
    "minecraft:brown_mushroom",
    "minecraft:red_mushroom",
  ],
);

const plantSourceKeys = new Set();
for (const id of VANILLA_PLANT_IDS) {
  if (resources.has(`item:${id}`)) plantSourceKeys.add(`item:${id}`);
}
for (const [mapName, map] of Object.entries(raw.recipemaps || {})) {
  if (!/greenhouse/i.test(mapName)) continue;
  for (const rawRecipe of Array.isArray(map.recipes) ? map.recipes : []) {
    const collectStack = (stack) => {
      if (!stack?.resource) return;
      const id = itemId(stack.resource, stack.metadata);
      if (id) plantSourceKeys.add(`item:${id}`);
    };
    for (const input of Array.isArray(rawRecipe.inputs) ? rawRecipe.inputs : []) {
      for (const stack of input.inputStacks || []) collectStack(stack);
    }
    for (const input of Array.isArray(rawRecipe.inputsFluid) ? rawRecipe.inputsFluid : []) {
      // Seeds and crops are items; skip fluid greenhouse inputs.
    }
    for (const output of Array.isArray(rawRecipe.outputs) ? rawRecipe.outputs : []) collectStack(output);
    for (const output of Array.isArray(rawRecipe.chancedOutputs) ? rawRecipe.chancedOutputs : []) collectStack(output);
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const oreDictionary = {};
for (const [name, stacks] of Object.entries(raw.oreDict || {})) {
  const ids = (Array.isArray(stacks) ? stacks : [])
    .map((stack) => stack && itemId(stack.resource, stack.metadata))
    .filter(Boolean);
  if (ids.length > 0) oreDictionary[name] = [...new Set(ids)];
}
for (const resource of resources.values()) {
  const membership = Object.entries(oreDictionary)
    .filter(([, ids]) => ids.includes(resource.id))
    .map(([name]) => name);
  if (membership.length > 0) resource.oreDictionary = membership;
}

const dataset = {
  schemaVersion: 1,
  datasetVersionId,
  gtnhVersion: susyVersion,
  sourceInfo: {
    sourceId: "gtnh-oracle",
    sourceVersion: susyVersion,
    generatedAt,
    notes: `SusyCore /recipemapdump of Supersymmetry ${susyVersion}; smelting durations synthesized.`,
  },
  resources: [...resources.values()],
  recipes,
  oreDictionary,
  recipeMaps: [...recipeMaps].sort(),
  ...(recipeMapIcons.length > 0 ? { recipeMapIcons } : {}),
  ...(machineHandlerIcons.length > 0 ? { machineHandlerIcons } : {}),
  ...(plantSourceKeys.size > 0 ? { plantSourceKeys: [...plantSourceKeys].sort() } : {}),
  generatedAt,
};

await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
// Keep this file LINE-ORIENTED (writeDatasetJson): rebuild-manifest reads
// datasetVersionId/gtnhVersion/generatedAt/sourceInfo with a per-line parser.
// Run the index builders against THIS plain file and create recipes.json.gz
// only after them (`gzip -c recipes.json > recipes.json.gz`); a gz rewritten
// by build-resource-index comes out compact and breaks the manifest stage.
await writeDatasetJson(outputPath, dataset);
console.log(
  `SUSY dataset written: ${recipes.length} recipes, ${resources.size} resources, ${Object.keys(oreDictionary).length} oredict entries.`,
);

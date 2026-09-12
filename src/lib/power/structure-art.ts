/**
 * The multiblock structure renders from the Power Planner workbook, shipped
 * as static assets (public/power-art/<sourceId>.png). Singleblocks have no
 * structure to show and fall back to their machine item icon.
 */
const STRUCTURE_ART_IDS = new Set([
  "large-steam-turbine",
  "large-hp-steam-turbine",
  "large-sc-steam-turbine",
  "xl-turbo-steam-turbine",
  "large-gas-turbine",
  "xl-turbo-gas-turbine",
  "large-plasma-generator",
  "xl-turbo-plasma-turbine",
  "solid-oxide-fuel-cell-1",
  "solid-oxide-fuel-cell-2",
  "large-combustion-engine",
  "extreme-combustion-engine",
  "large-semifluid-generator",
  "large-rocket-engine",
  "large-neutralization-engine",
  "universal-chemical-fuel-engine",
  "large-bronze-boiler",
  "large-steel-boiler",
  "large-titanium-boiler",
  "large-tungstensteel-boiler",
  "thermal-boiler",
  "large-heat-exchanger",
  "whakawhiti-wera-xl",
  "extreme-heat-exchanger",
  "ic2-fluid-reactor",
  "dehp",
  "solar-tower",
  "thtr",
  "htgr",
  "lftr",
  "fusion-reactor",
  "compact-fusion-reactor",
  "large-naquadah-reactor",
  "antimatter",
  "eye-of-harmony",
]);

/** Sources that share another source's render (one workbook image for all). */
const STRUCTURE_ART_ALIASES: Record<string, string> = {
  "xl-turbo-hp-steam-turbine": "xl-turbo-steam-turbine",
  "xl-turbo-sc-steam-turbine": "xl-turbo-steam-turbine",
};

export function getPowerStructureArt(sourceId: string): string | undefined {
  const id = STRUCTURE_ART_ALIASES[sourceId] ?? sourceId;
  return STRUCTURE_ART_IDS.has(id) ? `/power-art/${id}.png` : undefined;
}

/**
 * Structure renders for PROCESSING multiblocks, keyed by the dataset's
 * machine handler id (`recipe.machineHandlers[].id`), shipped beside the
 * power renders. Jack supplied the first twenty (2026-09-06) - the ones the
 * public setups place most, which cover most cards on community boards -
 * as 1254px renders, re-encoded here at 640px wide, palette PNG. A handler
 * not in this set wears its controller's item icon, as every multiblock
 * did before. To add one: drop `<handler-id>.png` in public/power-art and
 * list the id here.
 */
const MACHINE_STRUCTURE_ART_IDS = new Set([
  "cryogenic-freezer",
  "dangote-distillus",
  "distillation-tower",
  "electric-blast-furnace",
  "industrial-autoclave",
  "industrial-centrifuge",
  "industrial-chemical-bath",
  "industrial-maceration-stack",
  "industrial-mixing-machine",
  "large-chemical-reactor",
  "large-electric-compressor",
  "large-fluid-extractor",
  "large-sifter",
  "oil-cracking-unit",
  "steam-grinder",
  "steam-separator",
  "steam-squasher",
  "thermic-heating-device",
  "vacuum-freezer",
  "volcanus",
  // The second batch (2026-09-06): machines whose maps export no handler
  // list and so were missed by the first sweep, the Pyrolyse Oven first.
  "boldarnator",
  "chemical-plant",
  "coke-oven",
  "dissolution-tank",
  "industrial-coke-oven",
  "industrial-sledgehammer",
  "multiblock-electrolyzer",
  "pyrolyse-oven",
  // The grey tower that stood as the LFTR's render all along (Jack,
  // 2026-09-09): it is this plant, and the reactor is the purple slab that
  // took its place in lftr.png.
  "reactor-fuel-processing-plant",
]);

/**
 * Recipe-map handlers whose machine is a power source with a render already
 * (a generator placed as a RECIPE card, off the fuel maps, rather than as a
 * power card): the handler id spelled the long way, the render's id short.
 */
const MACHINE_TO_POWER_ART: Record<string, string> = {
  "high-temperature-gas-reactor": "htgr",
  "liquid-fluoride-thorium-reactor": "lftr",
  "thorium-high-temperature-reactor": "thtr",
};

export function getMachineStructureArt(handlerId: string | undefined): string | undefined {
  if (!handlerId) {
    return undefined;
  }
  if (MACHINE_STRUCTURE_ART_IDS.has(handlerId)) {
    return `/power-art/${handlerId}.png`;
  }
  // A power source's render serves its recipe-card handler too (the Large
  // Naquadah Reactor, the boilers, the heat exchangers share their ids).
  return getPowerStructureArt(MACHINE_TO_POWER_ART[handlerId] ?? handlerId);
}

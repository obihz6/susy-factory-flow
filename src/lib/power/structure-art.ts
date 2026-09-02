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

/**
 * Every placeable power source, grouped for the picker. Source ids are
 * stored in plans (Recipe.power.sourceId); never rename a shipped id.
 */
import { engineSources } from "./sources/engines";
import { endgameSources } from "./sources/endgame";
import { passiveSources, reactorSources } from "./sources/reactors";
import { singleblockSources } from "./sources/singleblocks";
import { sofcSources } from "./sources/sofc";
import { steamMakerSources } from "./sources/steam-makers";
import { turbineSources } from "./sources/turbines";
import type { PowerGroupId, PowerSourceDefinition } from "./types";

export const POWER_GROUPS: Array<{ id: PowerGroupId; name: string; blurb: string }> = [
  { id: "burners", name: "Generators", blurb: "Singleblocks: one amp of their tier from fuel." },
  { id: "engines", name: "Engines", blurb: "The big fuel burners: engines and fuel cells." },
  { id: "steam", name: "Boilers and exchangers", blurb: "Everything that makes steam." },
  { id: "turbines", name: "Turbines", blurb: "Steam, gas and plasma through a rotor." },
  { id: "reactors", name: "Reactors", blurb: "Nuclear heat, pebbles and salts." },
  { id: "passive", name: "Solar", blurb: "Power from the sky." },
  { id: "endgame", name: "Endgame", blurb: "Naquadah, fusion, antimatter." },
];

export const POWER_SOURCES: PowerSourceDefinition[] = [
  ...singleblockSources,
  ...engineSources,
  ...sofcSources,
  ...steamMakerSources,
  ...turbineSources,
  ...reactorSources,
  ...passiveSources,
  ...endgameSources,
];

const byId = new Map(POWER_SOURCES.map((source) => [source.id, source]));

export function getPowerSource(sourceId: string): PowerSourceDefinition | undefined {
  return byId.get(sourceId);
}

export function powerSourcesInGroup(group: PowerGroupId): PowerSourceDefinition[] {
  return POWER_SOURCES.filter((source) => source.group === group);
}

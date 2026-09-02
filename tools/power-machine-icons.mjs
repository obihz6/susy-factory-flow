#!/usr/bin/env node
/**
 * Bakes each power source's machine face - the real in-game item icon from
 * the dataset - into src/lib/power/data/machine-icons.json. The id list
 * below was picked by hand from resources API probes (the query is only used
 * to find the entry; the id is what must match).
 *
 *   node tools/power-machine-icons.mjs [--base https://gtnhplanner.com] [--version local-2.9.0-beta-2]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath = path.join(repoRoot, "src", "lib", "power", "data", "machine-icons.json");
const args = process.argv.slice(2);
const base = args.includes("--base") ? args[args.indexOf("--base") + 1] : "https://gtnhplanner.com";
const version = args.includes("--version") ? args[args.indexOf("--version") + 1] : "local-2.9.0-beta-2";

/** sourceId -> { query to find it, exact item id } */
const MACHINES = {
  "steam-turbine": { query: "basic steam turbine", id: "gregtech:gt.blockmachines@1120" },
  "gas-turbine": { query: "basic gas turbine", id: "gregtech:gt.blockmachines@1115" },
  "combustion-generator": { query: "combustion generator", id: "gregtech:gt.blockmachines@1110" },
  "semifluid-generator": { query: "semi-fluid generator", id: "gregtech:gt.blockmachines@837" },
  "rocket-fuel-generator": { query: "rocketdyne", id: "gregtech:gt.blockmachines@996" },
  "plasma-generator": { query: "plasma generator mark", id: "gregtech:gt.blockmachines@1196" },
  "naquadah-reactor": { query: "naquadah reactor", id: "gregtech:gt.blockmachines@1190" },
  "magic-energy-absorber": { query: "magic energy absorber", id: "gregtech:gt.blockmachines@1127" },
  "acid-generator": { query: "acid generator", id: "gregtech:gt.blockmachines@12793" },
  "geothermal-engine": { query: "geothermal", id: "gregtech:gt.blockmachines@830" },
  "magic-energy-converter": { query: "magic energy converter", id: "gregtech:gt.blockmachines@1123" },
  "large-neutralization-engine": { query: "acid generator", id: "gregtech:gt.blockmachines@31088" },
  "large-combustion-engine": { query: "large combustion engine", id: "gregtech:gt.blockmachines@15533" },
  "extreme-combustion-engine": { query: "extreme combustion", id: "gregtech:gt.blockmachines@15534" },
  "large-semifluid-generator": { query: "large semifluid", id: "gregtech:gt.blockmachines@31026" },
  "large-rocket-engine": { query: "rocketdyne", id: "gregtech:gt.blockmachines@996" },
  "universal-chemical-fuel-engine": { query: "universal chemical", id: "gregtech:gt.blockmachines@15535" },
  "solid-oxide-fuel-cell-1": { query: "solid-oxide", id: "gregtech:gt.blockmachines@13101" },
  "solid-oxide-fuel-cell-2": { query: "solid-oxide", id: "gregtech:gt.blockmachines@13102" },
  "large-bronze-boiler": { query: "large bronze boiler", id: "gregtech:gt.blockmachines@15529" },
  "large-steel-boiler": { query: "large steel boiler", id: "gregtech:gt.blockmachines@15530" },
  "large-titanium-boiler": { query: "large titanium boiler", id: "gregtech:gt.blockmachines@15531" },
  "large-tungstensteel-boiler": {
    query: "large tungstensteel boiler",
    id: "gregtech:gt.blockmachines@15532",
  },
  "thermal-boiler": { query: "thermal boiler", id: "gregtech:gt.blockmachines@15557" },
  "large-heat-exchanger": { query: "large heat exchanger", id: "gregtech:gt.blockmachines@1154" },
  "whakawhiti-wera-xl": { query: "whakawhiti", id: "gregtech:gt.blockmachines@31079" },
  "extreme-heat-exchanger": { query: "extreme heat exchanger", id: "gregtech:gt.blockmachines@32017" },
  "large-steam-turbine": { query: "large steam turbine", id: "gregtech:gt.blockmachines@15524" },
  "large-hp-steam-turbine": { query: "large steam turbine", id: "gregtech:gt.blockmachines@15525" },
  "large-sc-steam-turbine": {
    query: "supercritical steam turbine",
    id: "gregtech:gt.blockmachines@15526",
  },
  "xl-turbo-steam-turbine": { query: "xl turbo", id: "gregtech:gt.blockmachines@15519" },
  "xl-turbo-hp-steam-turbine": { query: "xl turbo", id: "gregtech:gt.blockmachines@15520" },
  "xl-turbo-sc-steam-turbine": { query: "xl turbo", id: "gregtech:gt.blockmachines@15521" },
  "large-gas-turbine": { query: "large gas turbine", id: "gregtech:gt.blockmachines@15527" },
  "xl-turbo-gas-turbine": { query: "xl turbo", id: "gregtech:gt.blockmachines@15522" },
  "large-plasma-generator": { query: "large plasma generator", id: "gregtech:gt.blockmachines@15528" },
  "xl-turbo-plasma-turbine": { query: "xl turbo", id: "gregtech:gt.blockmachines@15523" },
  thtr: { query: "thorium reactor", id: "gregtech:gt.blockmachines@12733" },
  htgr: { query: "gas-cooled", id: "gregtech:gt.blockmachines@12791" },
  lftr: { query: "thorium reactor", id: "gregtech:gt.blockmachines@751" },
  "ic2-fluid-reactor": { query: "nuclear reactor", id: "ic2:blockgenerator@5" },
  // The Vacuum Reactor is the same IC2 block run on active cooling.
  "vacuum-reactor": { query: "nuclear reactor", id: "ic2:blockgenerator@5" },
  dehp: { query: "deep earth", id: "gregtech:gt.blockmachines@12729" },
  "solar-tower": { query: "solar tower", id: "gregtech:gt.blockmachines@863" },
  "solar-panel": { query: "solar panel", id: "gregtech:gt.metaitem.01@32752" },
  "large-naquadah-reactor": { query: "nuclear reactor", id: "gregtech:gt.blockmachines@15537" },
  "fusion-reactor": { query: "fusion control computer", id: "gregtech:gt.blockmachines@1193" },
  "compact-fusion-reactor": { query: "fusion computer", id: "gregtech:gt.blockmachines@32019" },
  "eye-of-harmony": { query: "eye of harmony", id: "gregtech:gt.blockmachines@15410" },
  antimatter: { query: "antimatter", id: "goodgenerator:antimatterannihilationmatrix" },
  "small-coal-boiler": { query: "small coal boiler", id: "gregtech:gt.blockmachines@100" },
  "large-coal-boiler": { query: "large coal boiler", id: "gregtech:gt.blockmachines@101" },
  "lava-boiler": { query: "lava boiler", id: "gregtech:gt.blockmachines@102" },
  "solar-boiler": { query: "solar boiler", id: "gregtech:gt.blockmachines@105" },
  "advanced-boiler": { query: "advanced boiler", id: "gregtech:gt.blockmachines@753" },
  rtg: { query: "radioisotope", id: "gregtech:gt.blockmachines@869" },
  "dyson-swarm": { query: "dyson", id: "gregtech:gt.blockmachines@14001" },
};

const out = {};
const missing = [];
for (const [sourceId, spec] of Object.entries(MACHINES)) {
  const url = `${base}/api/datasets/${version}/resources?query=${encodeURIComponent(spec.query)}&limit=24`;
  const results = (await (await fetch(url)).json()).resources ?? [];
  const found = results.find((entry) => entry.kind === "item" && entry.id === spec.id);
  if (found) {
    out[sourceId] = {
      id: found.id,
      displayName: found.displayName,
      iconPath: found.iconPath,
      dominantColor: found.dominantColor,
    };
  } else {
    missing.push(sourceId);
  }
}

fs.writeFileSync(
  outPath,
  JSON.stringify({ datasetVersionId: version, machines: out }, null, 1) + "\n",
);
console.log(`Wrote ${outPath}: ${Object.keys(out).length} machine faces.`);
if (missing.length > 0) {
  console.log("MISSING: " + missing.join(", "));
}

/**
 * Singleblock generators: 1 amp of their tier while running, with a
 * per-family per-tier efficiency ladder. Burn rate is the workbook's
 * (V + packetLoss) / (fuelValue x efficiency) x 20 - the sheet charges GT's
 * per-amp output loss and so do we.
 */
import { findFuel, fuelOptions, powerPlannerData, type PowerFuelEntry } from "../planner-data";
import type { PowerModel, PowerSourceDefinition } from "../types";
import { familyTierOptions, formatAmount, items, liters, percent, stat, tierPower } from "./helpers";

interface SingleblockSpec {
  id: string;
  name: string;
  family: string;
  unlock: string;
  blurb: string;
  fuels: PowerFuelEntry[] | "steam";
  /** Solid fuels burn whole items; the sheet prices them per hour. */
  solid?: boolean;
  /** The fuel players actually run, so a fresh card starts sane. */
  defaultFuel?: string;
}

const SPECS: SingleblockSpec[] = [
  {
    id: "steam-turbine",
    name: "Steam Turbine",
    family: "steamTurbine",
    unlock: "LV",
    blurb: "Burns steam at 2 L per EU.",
    fuels: "steam",
  },
  {
    id: "gas-turbine",
    name: "Gas Turbine",
    family: "gasTurbine",
    unlock: "LV",
    blurb: "Burns benzene and the other gas fuels.",
    fuels: powerPlannerData.gasFuels,
    defaultFuel: "Benzene",
  },
  {
    id: "combustion-generator",
    name: "Combustion Generator",
    family: "combustion",
    unlock: "LV",
    blurb: "Burns the diesel-line fuels.",
    fuels: powerPlannerData.combustionFuels,
    defaultFuel: "Diesel",
  },
  {
    id: "semifluid-generator",
    name: "Semifluid Generator",
    family: "semifluid",
    unlock: "LV",
    blurb: "Burns heavy oils and semifluids.",
    fuels: powerPlannerData.semifluidFuels,
    defaultFuel: "Creosote Oil",
  },
  {
    id: "acid-generator",
    name: "Acid Generator",
    family: "chem",
    unlock: "LV",
    blurb: "Burns the acid-line fluids.",
    fuels: powerPlannerData.chemFuels,
    defaultFuel: "Sulfuric Acid",
  },
  {
    id: "geothermal-engine",
    name: "Geothermal Engine",
    family: "frost",
    unlock: "EV",
    blurb: "Burns lava, cryotheum and pyrotheum.",
    fuels: powerPlannerData.frostFuels,
    defaultFuel: "Lava",
  },
  {
    id: "rocket-fuel-generator",
    name: "Rocket Fuel Generator",
    family: "rocket",
    unlock: "EV",
    blurb: "Burns mixed rocket fuels.",
    fuels: powerPlannerData.rocketFuels,
  },
  {
    id: "plasma-generator",
    name: "Plasma Generator",
    family: "plasma",
    unlock: "EV",
    blurb: "Burns plasma from fusion.",
    fuels: powerPlannerData.plasmas,
    defaultFuel: "Helium Plasma",
  },
  {
    id: "naquadah-reactor",
    name: "Naquadah Reactor",
    family: "naquadah",
    unlock: "EV",
    blurb: "Depletes naquadah and tiberium rods.",
    fuels: powerPlannerData.naquadahRods,
    solid: true,
  },
  {
    id: "magic-energy-converter",
    name: "Magic Energy Converter",
    family: "magicConverter",
    unlock: "LV",
    blurb: "Consumes magical items for power.",
    fuels: powerPlannerData.magicSolids,
    solid: true,
    defaultFuel: "Quicksilver",
  },
  {
    id: "magic-energy-absorber",
    name: "Magic Energy Absorber",
    family: "magicAbsorber",
    unlock: "LV",
    blurb: "Consumes magical items for power.",
    fuels: powerPlannerData.magicSolids,
    solid: true,
  },
];

const STEAM_EU_PER_LITER = 0.5;

/**
 * The naquadah reactors hand back a plain naquadah part for every rod
 * burned (FuelLoader registers the depleted item on each fuel recipe).
 * Tiberium rods are pack-side fuels the loader does not cover; they get
 * no return until their depleted form is confirmed.
 */
const NAQUADAH_SPENT: Record<string, string | undefined> = {
  "Enriched Naquadah Bolt (EV)": "Naquadah Bolt",
  "Enriched Naquadah Rod (IV)": "Naquadah Rod",
  "Long Enriched Naquadah Rod (LuV)": "Long Naquadah Rod",
  "Naquadria Bolt (ZPM)": "Naquadah Bolt",
  "Naquadria Rod (UV)": "Naquadah Rod",
};

function buildSingleblock(spec: SingleblockSpec): PowerSourceDefinition {
  const tiers = familyTierOptions(spec.family);
  const settings: PowerSourceDefinition["settings"] = [
    {
      type: "select",
      id: "tier",
      label: "Tier",
      options: tiers.options,
      defaultKey: tiers.options[0]?.key ?? "LV",
    },
  ];
  if (spec.fuels !== "steam") {
    settings.push({
      type: "select",
      id: "fuel",
      label: "Fuel",
      options: fuelOptions(spec.fuels),
      defaultKey: spec.defaultFuel ?? spec.fuels[0]?.name ?? "",
    });
  }

  return {
    id: spec.id,
    name: spec.name,
    group: "burners",
    unlock: spec.unlock,
    blurb: spec.blurb,
    settings,
    compute(read): PowerModel {
      const tier = read.select("tier");
      const { voltage, ampLoss } = tierPower(tier);
      const efficiency = tiers.efficiencyFor(tier);
      const fuel =
        spec.fuels === "steam"
          ? { name: "Steam", euPerLiter: STEAM_EU_PER_LITER }
          : findFuel(spec.fuels, read.select("fuel"));

      // The geothermal engine mixes forms: the lavas are fluids, the theum
      // dusts items - decided per fuel, not per machine.
      const solidFuel =
        spec.solid || (fuel.euPerItem !== undefined && fuel.euPerLiter === undefined);
      if (solidFuel) {
        const euPerItem = fuel.euPerItem ?? 0;
        // The workbook prices solids per hour: (V+loss)/EU/eff x 20 x 3600.
        const perHour = euPerItem > 0 ? ((voltage + ampLoss) / (euPerItem * efficiency)) * 20 * 3600 : 0;
        const spent = spec.family === "naquadah" ? NAQUADAH_SPENT[fuel.name] : undefined;
        return {
          euPerTick: voltage,
          inputs: [items(fuel.name, perHour / 3600)],
          outputs: spent ? [items(spent, perHour / 3600)] : [],
          stats: [
            stat("Efficiency", percent(efficiency)),
            stat("Fuel per hour", formatAmount(perHour)),
            stat("EU per item", formatAmount(euPerItem * efficiency)),
          ],
        };
      }

      const euPerLiter = fuel.euPerLiter ?? 0;
      const litersPerSecond =
        euPerLiter > 0 ? ((voltage + ampLoss) / (euPerLiter * efficiency)) * 20 : 0;
      return {
        euPerTick: voltage,
        inputs: [liters(fuel.name, litersPerSecond)],
        outputs: [],
        stats: [
          stat("Efficiency", percent(efficiency)),
          stat("EU per L", formatAmount(euPerLiter * efficiency)),
        ],
      };
    },
  };
}

/**
 * GT++ RTG (MTERTGenerator): one pellet runs for its recipe's real days
 * (20 x 86400 x days ticks) at the recipe's voltage, 100% efficiency,
 * zero pollution. Voltages are TierEU.RECIPE values, days rounded as
 * MetaGeneratedGregtechItems rounds them.
 */
const RTG_PELLETS = [
  { key: "am241", name: "Am Pellet", label: "Am-241 (15 EU/t, 216 days)", euPerTick: 15, days: 216 },
  { key: "sr90", name: "Sr Pellet", label: "Sr-90 (30 EU/t, 29 days)", euPerTick: 30, days: 29 },
  { key: "pu238", name: "Pu Pellet", label: "Pu-238 (60 EU/t, 88 days)", euPerTick: 60, days: 88 },
  { key: "po210", name: "Po Pellet", label: "Po-210 (480 EU/t, 1 day)", euPerTick: 480, days: 1 },
  {
    key: "ic2",
    name: "Pellets of RTG Fuel",
    label: "Pellets of RTG Fuel (7 EU/t, 3 days)",
    euPerTick: 7,
    days: 3,
  },
];

const rtg: PowerSourceDefinition = {
  id: "rtg",
  name: "Radioisotope Thermoelectric Generator",
  group: "burners",
  unlock: "HV",
  blurb: "Pellets decay into steady EU for real days.",
  settings: [
    {
      type: "select",
      id: "pellet",
      label: "Pellet",
      options: RTG_PELLETS.map(({ key, label }) => ({ key, label })),
      defaultKey: "pu238",
    },
  ],
  compute(read): PowerModel {
    const pellet = RTG_PELLETS.find((row) => row.key === read.select("pellet")) ?? RTG_PELLETS[2];
    const secondsPerPellet = pellet.days * 86_400;
    return {
      euPerTick: pellet.euPerTick,
      inputs: [items(pellet.name, 1 / secondsPerPellet)],
      outputs: [],
      stats: [
        stat("One pellet runs", `${pellet.days} real ${pellet.days === 1 ? "day" : "days"}`),
        stat("Pollution", "None"),
      ],
    };
  },
};

export const singleblockSources: PowerSourceDefinition[] = [...SPECS.map(buildSingleblock), rtg];

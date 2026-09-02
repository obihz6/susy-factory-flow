/**
 * The steam producers: the four Large Boilers and the heat exchanger family.
 * Boiler rule from the workbook: burning a liquid AND a solid at once gives
 * 100% steam and halves each fuel's burn rate; either alone gives 80%.
 * Exchangers convert hot fluids to steam by threshold: below it the Under
 * ratio and lower grade, at/above it the Over ratio and higher grade.
 */
import { findFuel, powerPlannerData, type PowerFuelEntry } from "../planner-data";
import type { PowerModel, PowerSourceDefinition, PowerSetting } from "../types";
import { formatAmount, items, liters, stat } from "./helpers";

interface BoilerSpec {
  id: string;
  name: string;
  unlock: string;
  steamPerTick: number;
  singleFuelSteamPerTick: number;
  steamGrade: "Steam" | "SH Steam";
  liquidTable: PowerFuelEntry[];
  solidTable: PowerFuelEntry[];
}

const BOILER_SPECS: BoilerSpec[] = [
  {
    id: "large-bronze-boiler",
    name: "Large Bronze Boiler",
    unlock: "MV",
    steamPerTick: 1200,
    singleFuelSteamPerTick: 960,
    steamGrade: "Steam",
    liquidTable: powerPlannerData.boilerFuels.bronzeLiquid,
    solidTable: powerPlannerData.boilerFuels.bronzeSolid,
  },
  {
    id: "large-steel-boiler",
    name: "Large Steel Boiler",
    unlock: "HV",
    steamPerTick: 3000,
    singleFuelSteamPerTick: 2400,
    steamGrade: "Steam",
    liquidTable: powerPlannerData.boilerFuels.steelLiquid,
    solidTable: powerPlannerData.boilerFuels.steelSolid,
  },
  {
    id: "large-titanium-boiler",
    name: "Large Titanium Boiler",
    unlock: "EV",
    steamPerTick: 4000,
    singleFuelSteamPerTick: 3200,
    steamGrade: "SH Steam",
    liquidTable: powerPlannerData.boilerFuels.titaniumLiquid,
    solidTable: powerPlannerData.boilerFuels.titaniumSolid,
  },
  {
    id: "large-tungstensteel-boiler",
    name: "Large Tungstensteel Boiler",
    unlock: "IV",
    steamPerTick: 16000,
    singleFuelSteamPerTick: 12800,
    steamGrade: "SH Steam",
    liquidTable: powerPlannerData.boilerFuels.tungstensteelLiquid,
    solidTable: powerPlannerData.boilerFuels.tungstensteelSolid,
  },
];

const NO_FUEL = "None";

const WATER_KINDS = [
  { key: "Water", label: "Water" },
  { key: "Distilled Water", label: "Distilled Water" },
];

function fuelChoices(table: PowerFuelEntry[]): Array<{ key: string; label: string }> {
  return [{ key: NO_FUEL, label: "None" }, ...table.map((entry) => ({ key: entry.name, label: entry.name }))];
}

function buildBoiler(spec: BoilerSpec): PowerSourceDefinition {
  return {
    id: spec.id,
    name: spec.name,
    group: "steam",
    unlock: spec.unlock,
    blurb: `${formatAmount(spec.steamPerTick)} L/t of ${
      spec.steamGrade === "SH Steam" ? "SH steam" : "steam"
    } on dual fuel.`,
    settings: [
      {
        type: "select",
        id: "liquidFuel",
        label: "Liquid fuel",
        options: fuelChoices(spec.liquidTable),
        defaultKey: spec.liquidTable[0]?.name ?? NO_FUEL,
      },
      {
        type: "select",
        id: "solidFuel",
        label: "Solid fuel",
        options: fuelChoices(spec.solidTable),
        defaultKey: NO_FUEL,
      },
      // MTELargeBoilerBase.consumeWater tries plain water first and falls
      // back to distilled; either works, same amount, no difference.
      {
        type: "select",
        id: "waterKind",
        label: "Water supply",
        options: WATER_KINDS,
        defaultKey: "Water",
      },
    ],
    compute(read): PowerModel {
      const liquidName = read.select("liquidFuel");
      const solidName = read.select("solidFuel");
      const liquid = liquidName === NO_FUEL ? undefined : findFuel(spec.liquidTable, liquidName);
      const solid = solidName === NO_FUEL ? undefined : findFuel(spec.solidTable, solidName);
      const dual = Boolean(liquid && solid);
      const steamPerTick = !liquid && !solid ? 0 : dual ? spec.steamPerTick : spec.singleFuelSteamPerTick;

      const inputs: PowerModel["inputs"] = [];
      if (liquid?.burnTime) {
        // 1000 L lasts burnTime seconds; sharing the firebox halves the rate.
        inputs.push(liters(liquid.name, 1000 / (liquid.burnTime * (dual ? 2 : 1))));
      }
      if (solid?.burnTime) {
        inputs.push(items(solid.name, 1 / (solid.burnTime * (dual ? 2 : 1))));
      }
      if (steamPerTick > 0) {
        inputs.push(liters(read.select("waterKind"), (steamPerTick / 160) * 20));
      }

      return {
        euPerTick: 0,
        inputs,
        outputs: steamPerTick > 0 ? [liters(spec.steamGrade, steamPerTick * 20)] : [],
        stats: [
          stat("Steam", `${formatAmount(steamPerTick)} L/t`),
          stat("Firebox", dual ? "Dual fuel: 100%" : "Single fuel: 80%"),
        ],
        warnings: !liquid && !solid ? ["Pick a fuel to make steam."] : undefined,
      };
    },
  };
}

/**
 * The singleblock boilers (MTEBoiler subclasses). Steam flows at the full
 * per-second rate once hot; at steady state fuel is burned only to cancel
 * cooldown, energyConsumption per cooldownInterval ticks, and a solid fuel
 * item is worth its furnace burn time / 10 in boiler energy. Water is
 * 1 L per 160 L of steam (GTValues.STEAM_PER_WATER).
 */
interface SmallBoilerSpec {
  id: string;
  name: string;
  unlock: string;
  steamPerSecond: number;
  /** energyConsumption x 20 / cooldownInterval, from the machine's class. */
  energyPerSecond: number;
  automatable: boolean;
}

const SMALL_BOILER_SPECS: SmallBoilerSpec[] = [
  // MTEBoilerBronze: 120 L/s, consumption 1 per 45t cooldown.
  {
    id: "small-coal-boiler",
    name: "Small Coal Boiler",
    unlock: "ULV",
    steamPerSecond: 120,
    energyPerSecond: 20 / 45,
    automatable: false,
  },
  // MTEBoilerSteel, in-game name "Large Coal Boiler": 300 L/s, 2 per 40t.
  {
    id: "large-coal-boiler",
    name: "Large Coal Boiler",
    unlock: "LV",
    steamPerSecond: 300,
    energyPerSecond: 1,
    automatable: false,
  },
];

function buildSmallBoiler(spec: SmallBoilerSpec): PowerSourceDefinition {
  const solidTable = powerPlannerData.boilerFuels.bronzeSolid;
  return {
    id: spec.id,
    name: spec.name,
    group: "steam",
    unlock: spec.unlock,
    blurb: `${formatAmount(spec.steamPerSecond)} L/s of steam from any furnace fuel.`,
    settings: [
      {
        type: "select",
        id: "solidFuel",
        label: "Fuel",
        options: solidTable.map((entry) => ({ key: entry.name, label: entry.name })),
        defaultKey: "Coal",
      },
      {
        type: "select",
        id: "waterKind",
        label: "Water supply",
        options: WATER_KINDS,
        defaultKey: "Water",
      },
    ],
    compute(read): PowerModel {
      const fuel = findFuel(solidTable, read.select("solidFuel"));
      // euPerItem in the solid table IS the furnace burn time in ticks.
      const energyPerItem = (fuel.euPerItem ?? 0) / 10;
      const secondsPerItem = energyPerItem / spec.energyPerSecond;
      const warnings: string[] = [];
      if (!spec.automatable) {
        warnings.push("GTNH turns small boiler automation off. Fuel goes in by hand.");
      }
      return {
        euPerTick: 0,
        inputs: [
          items(fuel.name, secondsPerItem > 0 ? 1 / secondsPerItem : 0),
          liters(read.select("waterKind"), spec.steamPerSecond / 160),
        ],
        outputs: [liters("Steam", spec.steamPerSecond)],
        stats: [
          stat("Steam", `${formatAmount(spec.steamPerSecond / 20)} L/t`),
          stat("One item burns", `${formatAmount(secondsPerItem)}s`),
        ],
        warnings,
      };
    },
  };
}

/**
 * GT++ Advanced Boilers (MTEAdvancedBoilerBase): 750 L/s per tier,
 * consumption 2 per 40t cooldown, automatable, and no water explosion.
 */
const ADVANCED_BOILER_TIERS = [
  { key: "LV", label: "Advanced Boiler [LV] (750 L/s)", tier: 1 },
  { key: "MV", label: "Advanced Boiler [MV] (1,500 L/s)", tier: 2 },
  { key: "HV", label: "Advanced Boiler [HV] (2,250 L/s)", tier: 3 },
];

const advancedBoiler: PowerSourceDefinition = {
  id: "advanced-boiler",
  name: "Advanced Boiler",
  group: "steam",
  unlock: "LV",
  blurb: "GT++ boilers: up to 2,250 L/s, safe and automatable.",
  settings: [
    {
      type: "select",
      id: "tier",
      label: "Boiler",
      options: ADVANCED_BOILER_TIERS.map(({ key, label }) => ({ key, label })),
      defaultKey: "LV",
    },
    {
      type: "select",
      id: "solidFuel",
      label: "Fuel",
      options: powerPlannerData.boilerFuels.bronzeSolid.map((entry) => ({
        key: entry.name,
        label: entry.name,
      })),
      defaultKey: "Coal",
    },
    {
      type: "select",
      id: "waterKind",
      label: "Water supply",
      options: WATER_KINDS,
      defaultKey: "Water",
    },
  ],
  compute(read): PowerModel {
    const entry =
      ADVANCED_BOILER_TIERS.find((row) => row.key === read.select("tier")) ?? ADVANCED_BOILER_TIERS[0];
    const steamPerSecond = 750 * entry.tier;
    const fuel = findFuel(powerPlannerData.boilerFuels.bronzeSolid, read.select("solidFuel"));
    const secondsPerItem = (fuel.euPerItem ?? 0) / 10;
    return {
      euPerTick: 0,
      inputs: [
        items(fuel.name, secondsPerItem > 0 ? 1 / secondsPerItem : 0),
        liters(read.select("waterKind"), steamPerSecond / 160),
      ],
      outputs: [liters("Steam", steamPerSecond)],
      stats: [
        stat("Steam", `${formatAmount(steamPerSecond / 20)} L/t`),
        stat("One item burns", `${formatAmount(secondsPerItem)}s`),
      ],
    };
  },
};

/**
 * MTEBoilerLava: 600 L/s, 1 boiler energy per L of lava, 3 per 20t
 * cooldown, so 3 L/s of lava at steady state. Drains lava from below.
 */
const lavaBoiler: PowerSourceDefinition = {
  id: "lava-boiler",
  name: "Reinforced Lava Boiler",
  group: "steam",
  unlock: "LV",
  blurb: "600 L/s of steam on 3 L/s of lava.",
  settings: [
    {
      type: "select",
      id: "waterKind",
      label: "Water supply",
      options: WATER_KINDS,
      defaultKey: "Water",
    },
  ],
  compute(read): PowerModel {
    return {
      euPerTick: 0,
      inputs: [liters("Lava", 3), liters(read.select("waterKind"), 600 / 160)],
      outputs: [liters("Steam", 600)],
      stats: [stat("Steam", "30 L/t"), stat("Lava", "3 L/s")],
    };
  },
};

/**
 * MTEBoilerSolar / MTEBoilerSolarSteel, values from MachineStats.cfg (at
 * defaults): fuel-free steam that calcifies from max down to min output
 * over its runtime on regular water; distilled water never calcifies.
 */
const SOLAR_BOILER_MODELS = [
  { key: "bronze", label: "Simple Solar Boiler", max: 120, min: 40 },
  { key: "steel", label: "Advanced Solar Boiler", max: 360, min: 120 },
];

const solarBoiler: PowerSourceDefinition = {
  id: "solar-boiler",
  name: "Solar Boiler",
  group: "steam",
  unlock: "ULV",
  blurb: "Free steam from the sun. Calcifies on regular water.",
  settings: [
    {
      type: "select",
      id: "model",
      label: "Boiler",
      options: SOLAR_BOILER_MODELS.map(({ key, label }) => ({ key, label })),
      defaultKey: "bronze",
    },
    {
      type: "select",
      id: "waterKind",
      label: "Water supply",
      options: WATER_KINDS,
      defaultKey: "Distilled Water",
    },
    {
      type: "toggle",
      id: "calcified",
      label: "Fully calcified",
      defaultOn: false,
      enabledWhen: { settingId: "waterKind", equals: "Water" },
    },
  ],
  compute(read): PowerModel {
    const model =
      SOLAR_BOILER_MODELS.find((row) => row.key === read.select("model")) ?? SOLAR_BOILER_MODELS[0];
    const onWater = read.select("waterKind") === "Water";
    const steamPerSecond = onWater && read.on("calcified") ? model.min : model.max;
    const warnings: string[] = [];
    if (onWater) {
      warnings.push(
        `Regular water calcifies this boiler from ${model.max} down to ${model.min} L/s over 15 hours. Distilled water does not.`,
      );
    }
    return {
      euPerTick: 0,
      inputs: [liters(read.select("waterKind"), steamPerSecond / 160)],
      outputs: [liters("Steam", steamPerSecond)],
      stats: [stat("Steam", `${formatAmount(steamPerSecond / 20)} L/t`), stat("Needs", "Open sky")],
      warnings,
    };
  },
};

/** Exchanger tiers above 1 shift the threshold by the fluid's throttle and cost 1.5% steam each. */
function buildExchanger(entry: (typeof powerPlannerData.heatExchangers)[number]): PowerSourceDefinition {
  const isThermalBoiler = entry.name === "Thermal Boiler";
  const isExtreme = entry.name === "Extreme Heat Exchanger";
  const capAtMax = isThermalBoiler || isExtreme || entry.name === "Whakawhiti Wera XL";
  const fluidNames = Object.keys(entry.fluids);
  const id = entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  // Names as the resource map keys them (the workbook's own spellings).
  const COLD_RETURN: Record<string, string | undefined> = {
    Lava: "Pahoehoe Lava",
    "Hot Coolant": "Coolant",
    "Hot Solar Salt": "Cold Solar Salt",
  };
  const defaults = entry.fluids[fluidNames[0]];

  const settings: PowerSetting[] = [
    {
      type: "select",
      id: "fluid",
      label: "Hot fluid",
      options: fluidNames.map((name) => ({ key: name, label: name })),
      defaultKey: fluidNames[0],
    },
    {
      type: "number",
      id: "intake",
      label: "Hot fluid rate",
      min: 1,
      max: 10_000_000,
      step: 1,
      defaultValue: Math.max(1, defaults?.threshold ?? 1),
      unit: "L/s",
    },
    { type: "number", id: "tier", label: "Pipe tier", min: 1, max: 10, step: 1, defaultValue: 1 },
  ];
  if (isThermalBoiler) {
    // MTEThermalBoiler.useWater takes plain water first, distilled second;
    // the true exchangers demand distilled and explode without it.
    settings.push({
      type: "select",
      id: "waterKind",
      label: "Water supply",
      options: [
        { key: "Water", label: "Water" },
        { key: "Distilled Water", label: "Distilled Water" },
      ],
      defaultKey: "Water",
    });
  }

  return {
    id,
    name: entry.name,
    group: "steam",
    unlock: isExtreme ? "UHV" : isThermalBoiler ? "HV" : entry.name.startsWith("Whakawhiti") ? "UV" : "EV",
    blurb: isExtreme
      ? "Hot fluids to supercritical steam."
      : entry.name.startsWith("Whakawhiti")
        ? "32 heat exchangers in one block."
        : "Hot fluids to steam; cold comes back.",
    settings,
    compute(read): PowerModel {
      const fluidName = read.select("fluid");
      const rule = entry.fluids[fluidName] ?? defaults;
      const tier = read.number("tier");
      const intake = read.number("intake");
      const threshold = rule.threshold + (tier - 1) * rule.throttle;
      const cap = capAtMax ? rule.max : threshold * 2;
      const used = Math.min(intake, cap);
      const overThreshold = used >= threshold;
      const ratio = overThreshold ? rule.overRatio : rule.underRatio;
      const efficiency = isThermalBoiler ? 1 : 1 - 0.015 * (tier - 1);
      const steamPerSecond = used * ratio * efficiency;
      const grade = isThermalBoiler
        ? "SH Steam"
        : isExtreme
          ? overThreshold
            ? "SC Steam"
            : "SH Steam"
          : overThreshold
            ? "SH Steam"
            : "Steam";

      const outputs = [liters(grade, steamPerSecond)];
      const coldReturn = COLD_RETURN[fluidName];
      if (coldReturn) {
        outputs.push(liters(coldReturn, used));
      }
      const waterName = isThermalBoiler ? read.select("waterKind") : "Distilled Water";
      return {
        euPerTick: 0,
        inputs: [liters(fluidName, used), liters(waterName, steamPerSecond / 160)],
        outputs,
        stats: [
          stat("Steam", `${formatAmount(steamPerSecond / 20)} L/t ${grade}`),
          stat("Threshold", `${formatAmount(threshold)} L/s`),
        ],
        warnings:
          intake > cap ? [`Intake is capped at ${formatAmount(cap)} L/s for this fluid.`] : undefined,
      };
    },
  };
}

export const steamMakerSources: PowerSourceDefinition[] = [
  ...SMALL_BOILER_SPECS.map(buildSmallBoiler),
  solarBoiler,
  lavaBoiler,
  advancedBoiler,
  ...BOILER_SPECS.map(buildBoiler),
  ...powerPlannerData.heatExchangers.map(buildExchanger),
];


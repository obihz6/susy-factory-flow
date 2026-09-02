/**
 * The engine multiblocks: Large Combustion Engine, Extreme Combustion
 * Engine, Large Semifluid Generator, Large Rocket Engine and the Universal
 * Chemical Fuel Engine. Boost mechanics verified against
 * MTELargeCombustionEngine (fuel x2, output x3, oxygen 40 L/s, lubricant
 * 1000 L/hr) and MTEUniversalChemicalFuelEngine (eff = 1.5 e^(-C/ratio)).
 */
import { findFuel, fuelOptions, powerPlannerData } from "../planner-data";
import type { PowerModel, PowerSourceDefinition } from "../types";
import { formatAmount, items, liters, percent, stat } from "./helpers";

interface EngineSpec {
  id: string;
  name: string;
  unlock: string;
  blurb: string;
  fuels: typeof powerPlannerData.combustionFuels;
  baseOutput: number;
  boostedOutput: number;
  lubricantPerHour: number;
  booster: string;
  boosterPerSecond: number;
  /** LCE only: fuels above this EU/L refuse to run without the boost. */
  unboostedFuelCap?: number;
  defaultFuel?: string;
}

const ENGINE_SPECS: EngineSpec[] = [
  {
    id: "large-combustion-engine",
    name: "Large Combustion Engine",
    unlock: "EV",
    blurb: "Diesel fuels; oxygen boost triples it.",
    fuels: powerPlannerData.combustionFuels,
    baseOutput: 2048,
    boostedOutput: 6144,
    lubricantPerHour: 1000,
    booster: "Oxygen",
    boosterPerSecond: 40,
    unboostedFuelCap: 2048,
    defaultFuel: "Diesel",
  },
  {
    id: "extreme-combustion-engine",
    name: "Extreme Combustion Engine",
    unlock: "IV",
    blurb: "Jet fuels and HOG; liquid oxygen boost.",
    fuels: powerPlannerData.eceFuels,
    baseOutput: 10900,
    boostedOutput: 32700,
    // The tooltip claims 8000 L/hr; the code's getAdditiveFactor() is 1,
    // same as the LCE (MTEExtremeCombustionEngine, verified in source).
    lubricantPerHour: 1000,
    booster: "Liquid Oxygen",
    boosterPerSecond: 40,
    unboostedFuelCap: 10900,
  },
  {
    id: "large-semifluid-generator",
    name: "Large Semifluid Burner",
    unlock: "EV",
    blurb: "The engine for heavy oils.",
    fuels: powerPlannerData.semifluidFuels,
    baseOutput: 2048,
    boostedOutput: 6144,
    lubricantPerHour: 1000,
    booster: "Oxygen",
    boosterPerSecond: 80,
    defaultFuel: "Creosote Oil",
  },
];

function buildEngine(spec: EngineSpec): PowerSourceDefinition {
  return {
    id: spec.id,
    name: spec.name,
    group: "engines",
    unlock: spec.unlock,
    blurb: spec.blurb,
    settings: [
      {
        type: "select",
        id: "fuel",
        label: "Fuel",
        options: fuelOptions(spec.fuels),
        defaultKey: spec.defaultFuel ?? spec.fuels[0]?.name ?? "",
      },
      { type: "toggle", id: "boost", label: "Oxygen boost", defaultOn: false },
    ],
    compute(read): PowerModel {
      const fuel = findFuel(spec.fuels, read.select("fuel"));
      const boost = read.on("boost");
      const euPerLiter = fuel.euPerLiter ?? 0;
      const blocked =
        spec.unboostedFuelCap !== undefined && !boost && euPerLiter > spec.unboostedFuelCap;
      const output = blocked ? 0 : boost ? spec.boostedOutput : spec.baseOutput;
      // Boost burns 2x fuel for 3x power: an effective x1.5 on the fuel value.
      const effectiveEu = euPerLiter * (boost ? 1.5 : 1);
      const fuelPerSecond = effectiveEu > 0 && output > 0 ? (output / effectiveEu) * 20 : 0;

      // All three engines pay 1 L of lubricant per 72 ticks, doubled while
      // boosted (the depleteInput at mRuntime % 72 in every engine class).
      const lubricantPerSecond = (spec.lubricantPerHour / 3600) * (boost ? 2 : 1);
      const inputs = [liters(fuel.name, fuelPerSecond), liters("Lubricant", lubricantPerSecond)];
      if (boost) {
        inputs.push(liters(spec.booster, spec.boosterPerSecond));
      }
      return {
        euPerTick: output,
        inputs,
        outputs: [],
        stats: [stat("EU per L", formatAmount(effectiveEu))],
        warnings: blocked
          ? [`${fuel.name} is over ${spec.unboostedFuelCap} EU/L and needs the oxygen boost.`]
          : undefined,
      };
    },
  };
}

/**
 * Large Rocket Engine (GT++): output scales with throttle and fuel, with
 * cube-root falloff past the 30,000 and 80,000 EU/t knees; liquid hydrogen
 * boost x3 on the knees. Air intake is euProduction/100 per tick and CO2
 * is CONSUMED as the lubricant (1 L per 72 ticks, x3 boosted) - the game
 * outputs nothing (MTELargeRocketEngine).
 */
const largeRocketEngine: PowerSourceDefinition = {
  id: "large-rocket-engine",
  name: "Large Rocket Engine",
  group: "engines",
  unlock: "IV",
  blurb: "Rocket fuel; falls off past its knees.",
  settings: [
    {
      type: "select",
      id: "fuel",
      label: "Fuel",
      options: fuelOptions(powerPlannerData.rocketFuels),
      defaultKey: powerPlannerData.rocketFuels[0]?.name ?? "",
    },
    { type: "number", id: "throttle", label: "Fuel rate", min: 1, max: 4000, step: 1, defaultValue: 500, unit: "L/s" },
    { type: "toggle", id: "boost", label: "Liquid hydrogen boost", defaultOn: false },
  ],
  compute(read): PowerModel {
    const fuel = findFuel(powerPlannerData.rocketFuels, read.select("fuel"));
    const throttle = read.number("throttle");
    const boost = read.on("boost");
    const euPerLiter = fuel.euPerLiter ?? 0;
    const power = 0.05 * throttle * euPerLiter;
    const kneeFactor = boost ? 3 : 1;
    const knee1 = (30000 / (0.05 * euPerLiter)) * kneeFactor;
    const knee2 = (80000 / (0.05 * euPerLiter)) * kneeFactor;
    const falloff1 = throttle > knee1 ? Math.cbrt(30000) / Math.cbrt(power) : 1;
    const falloff2 = throttle > knee2 ? Math.cbrt(80000) / Math.cbrt(power) : 1;
    const euPerTick = Math.max(0, 1.6384 * power * falloff1 * falloff2);
    // euProduction is the pre-dynamo figure the game meters air and
    // hydrogen against; the 1.6384 is the dynamo-side efficiency bonus.
    const euProduction = power * falloff1 * falloff2;

    const inputs = [
      liters(fuel.name, throttle),
      // aAirToConsume = euProduction / 100 per tick.
      liters("Air", (euProduction / 100) * 20),
      // consumeCO2: 1 L per 72 ticks, 3 L boosted - the engine's lubricant.
      liters("Carbon Dioxide", (kneeFactor * 20) / 72),
    ];
    if (boost) {
      // consumeLOH: 3 x euProduction / 1000 L once per 21-tick fuel cycle.
      inputs.push(liters("Liquid Hydrogen", ((3 * euProduction) / 1000) * (20 / 21)));
    }
    return {
      euPerTick,
      inputs,
      outputs: [],
      stats: [
        stat("EU per L", formatAmount(throttle > 0 ? euPerTick / (throttle / 20) : 0)),
        stat("Power knees", `${formatAmount(knee1)} / ${formatAmount(knee2)} L/s`),
      ],
    };
  },
};

/**
 * Universal Chemical Fuel Engine (Good Generator): burns almost any fuel
 * with Combustion Promoter; efficiency 1.5 x e^(-C / promoterRatio), C from
 * the fuel table.
 */
const universalChemicalFuelEngine: PowerSourceDefinition = {
  id: "universal-chemical-fuel-engine",
  name: "Universal Chemical Fuel Engine",
  group: "engines",
  unlock: "LuV",
  blurb: "Any fuel plus combustion promoter.",
  settings: [
    {
      type: "select",
      id: "fuel",
      label: "Fuel",
      options: fuelOptions(powerPlannerData.ucfeFuels),
      defaultKey: "RP-1 (red)",
    },
    { type: "number", id: "flow", label: "Fuel rate", min: 1, max: 100000, step: 1, defaultValue: 500, unit: "L/s" },
    {
      type: "number",
      id: "promoterRatio",
      label: "Promoter per fuel",
      min: 0.01,
      max: 2,
      step: 0.01,
      defaultValue: 0.2,
    },
  ],
  compute(read): PowerModel {
    const fuel = findFuel(powerPlannerData.ucfeFuels, read.select("fuel"));
    const flow = read.number("flow");
    const ratio = read.number("promoterRatio");
    const coefficient = fuel.promoterCoefficient ?? 0.04;
    const efficiency = 1.5 * Math.exp(-coefficient / ratio);
    const euPerTick = (flow * (fuel.euPerLiter ?? 0) * efficiency) / 20;
    return {
      euPerTick,
      inputs: [liters(fuel.name, flow), liters("Combustion Promoter", flow * ratio)],
      outputs: [],
      stats: [stat("Efficiency", percent(efficiency))],
    };
  },
};

/**
 * Large Neutralization Engine (GT++): acids to EU at rate x density, a
 * hydroxide base multiplying the power at its own drink rate, robot arms
 * boosting toxic-residue decay at the cost of a loss chance. Residue is a
 * rare accumulation, not a steady flow, so it stays in the stats.
 */
const largeNeutralizationEngine: PowerSourceDefinition = {
  id: "large-neutralization-engine",
  name: "Large Neutralization Engine",
  group: "engines",
  unlock: "EV",
  blurb: "Neutralizes acids for power.",
  settings: [
    {
      type: "select",
      id: "structure",
      label: "Structure",
      options: powerPlannerData.lneStructureTiers.map((entry) => ({
        key: entry.name,
        label: entry.name,
      })),
      defaultKey: powerPlannerData.lneStructureTiers[0]?.name ?? "T1",
    },
    {
      type: "select",
      id: "fuel",
      label: "Acid",
      options: fuelOptions(powerPlannerData.chemFuels),
      defaultKey: "Molten Redstone",
    },
    // Per TICK, like the game's own fluid-use dial (maxFluidUse) and the
    // workbook's rate cell: mEUt = fuel value x litres per tick.
    { type: "number", id: "rate", label: "Acid rate", min: 1, max: 100_000, step: 1, defaultValue: 50, unit: "L/t" },
    {
      type: "select",
      id: "base",
      label: "Base",
      options: [
        { key: "None", label: "None" },
        ...powerPlannerData.lneBases.map((entry) => ({
          key: entry.name,
          label: `${entry.name} (x${entry.multiplier})`,
        })),
      ],
      defaultKey: "None",
    },
    { type: "number", id: "arms", label: "Robot arms", min: 0, max: 16, step: 1, defaultValue: 0 },
    {
      type: "select",
      id: "armTier",
      label: "Arm tier",
      options: powerPlannerData.lneRobotArms.map((entry) => ({
        key: entry.name,
        label: entry.name.replace(/^Amount \((.+)\)$/, "$1"),
      })),
      defaultKey: powerPlannerData.lneRobotArms[1]?.name ?? "Amount (HV)",
      enabledWhen: undefined,
    },
  ],
  compute(read): PowerModel {
    const structure =
      powerPlannerData.lneStructureTiers.find((entry) => entry.name === read.select("structure")) ??
      powerPlannerData.lneStructureTiers[0];
    const fuel = findFuel(powerPlannerData.chemFuels, read.select("fuel"));
    const rate = read.number("rate");
    const baseName = read.select("base");
    const base = powerPlannerData.lneBases.find((entry) => entry.name === baseName);
    const arms = Math.min(16, read.number("arms"));
    const armTier =
      powerPlannerData.lneRobotArms.find((entry) => entry.name === read.select("armTier"))?.tier ??
      2;
    const density = fuel.euPerLiter ?? 0;
    const multiplier = base?.multiplier ?? 1;
    const euPerTick = rate * density * multiplier;

    // Workbook formulas: decay boost sqrt(arms) x 1.2^tier (1.4 past EV);
    // loss chance arms / (45 x (tier + 1)); residue floor/ceil of the ^12.5.
    const decayBoost =
      arms === 0 ? 1 : Math.sqrt(arms) * (armTier <= 4 ? 1.2 ** armTier : 1.4 ** armTier);
    const lossChance = arms / (45 * (armTier + 1));
    const residueCore = (0.05 * Math.pow(density, 0.8) * rate) / (structure.baseDecay * decayBoost);
    const residueMedian = Math.floor(Math.pow(residueCore, 12.5));
    const residueMax = Math.ceil(Math.pow(residueCore * 1.3, 12.5));
    // The random walk targets 0.7-1.3 uniformly, so residue arrives at an
    // average of exactly 0.05 x density^0.8 x rate per tick. Decay scales
    // with the stored amount (^0.08), so its ceiling is at a full tank:
    // baseDecay x armBoost x capacity^0.08. A positive net there means no
    // equilibrium fits inside the tank and the engine eventually explodes.
    const residuePerTick = 0.05 * Math.pow(density, 0.8) * rate;
    const decayAtFull =
      structure.baseDecay * decayBoost * Math.pow(structure.residueCapacity, 0.08);
    const netAtFull = residuePerTick - decayAtFull;

    const inputs = [liters(fuel.name, rate * 20)];
    if (base) {
      // MTELargeNeutralizationEngine.useBooster: one hydroxide DUST per
      // boost window (20/50/200/240 ticks) - the sheet's rates are per
      // minute of those same windows.
      inputs.push(items(`${base.name} Dust`, base.litersPerSecond / 60));
    }
    return {
      euPerTick,
      inputs,
      outputs: [],
      stats: [
        stat("EU per L", formatAmount(density * multiplier)),
        stat("Toxic residue", `${formatAmount(residueMedian)} median / ${formatAmount(residueMax)} max`),
        stat("Avg residue", `${formatAmount(residuePerTick)}/t`),
        stat("At full tank", `${netAtFull > 0 ? "+" : ""}${formatAmount(netAtFull)}/t`),
        stat("Residue capacity", formatAmount(structure.residueCapacity)),
        ...(arms > 0
          ? [
              stat("Decay boost", `x${formatAmount(decayBoost)}`),
              stat("Avg lifespan", `${formatAmount(Math.floor(1 / lossChance))} min`),
            ]
          : []),
      ],
      warnings:
        netAtFull > 0
          ? ["Residue builds faster than it decays even at a full tank. The engine will explode."]
          : undefined,
    };
  },
};

export const engineSources: PowerSourceDefinition[] = [
  ...ENGINE_SPECS.map(buildEngine),
  largeRocketEngine,
  largeNeutralizationEngine,
  universalChemicalFuelEngine,
];

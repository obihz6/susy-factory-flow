/**
 * Reactors and free-energy machines: THTR, HTGR, LFTR, the IC2 fluid
 * reactor presets, DEHP and the Solar Tower. Formulas from
 * docs/power-planner-math.md; where the workbook leaves a cost out (IC2
 * rods), the card says so instead of pretending.
 */
import { powerPlannerData } from "../planner-data";
import type { PowerModel, PowerSourceDefinition } from "../types";
import { formatAmount, items, lifespanHours, liters, percent, stat, tierPower } from "./helpers";

const thtr: PowerSourceDefinition = {
  id: "thtr",
  name: "Thorium High Temperature Reactor",
  group: "reactors",
  unlock: "EV",
  blurb: "Thorium pebbles to hot coolant.",
  settings: [
    {
      type: "number",
      id: "fill",
      label: "Pebble fill",
      min: 100_000,
      max: 675_000,
      step: 1000,
      defaultValue: 675_000,
    },
  ],
  compute(read): PowerModel {
    const fill = read.number("fill");
    const efficiency = Math.min(1, 0.01 + Math.pow((fill - 100_000) / 57_500, 2) / 100);
    const pebbleCost = Math.floor(fill * 0.005 * efficiency);
    const hotCoolantPerSecond = 4800 * efficiency * 20;
    return {
      // MTEThoriumHighTempReactor draws a flat RECIPE_IV/2 regardless of
      // fill; only the coolant line scales with efficiency.
      euPerTick: -3840,
      inputs: [liters("Coolant", hotCoolantPerSecond)],
      outputs: [liters("Hot Coolant", hotCoolantPerSecond)],
      stats: [
        stat("Efficiency", percent(efficiency)),
        stat("Pebbles per cycle", formatAmount(pebbleCost)),
        stat("Hot coolant", `${formatAmount(hotCoolantPerSecond / 20)} L/t`),
      ],
    };
  },
};

const htgr: PowerSourceDefinition = {
  id: "htgr",
  name: "High Temperature Gas-cooled Reactor",
  group: "reactors",
  unlock: "IV",
  blurb: "TRISO pebbles to coolant and steam.",
  settings: [
    {
      type: "select",
      id: "pebble",
      label: "TRISO pebble",
      options: powerPlannerData.htgrPebbles.map((entry) => ({ key: entry.name, label: entry.name })),
      defaultKey: powerPlannerData.htgrPebbles[0]?.name ?? "",
    },
    { type: "number", id: "fill", label: "Pebble fill", min: 1, max: 10_000, step: 100, defaultValue: 10_000 },
  ],
  compute(read): PowerModel {
    const pebble =
      powerPlannerData.htgrPebbles.find((entry) => entry.name === read.select("pebble")) ??
      powerPlannerData.htgrPebbles[0];
    const fill = read.number("fill");
    const x = fill / 10_000;
    const efficiency = Math.min(1, 0.1 + 0.9 * (1 - Math.pow(1 - x, 3)));
    const multiplier = pebble.base * x * Math.pow(1 + (pebble.mult - 1) * x, 1 + (pebble.exp - 1) * x);
    const pebbleCost = fill * (Math.PI - 3) * 0.01 * efficiency;
    // MTEHighTempGasCooledReactor: COOLANT_PER_BALL 0.5 and WATER_PER_BALL
    // 0.1 are per-TICK litres at full helium; steam is water x160.
    const hotCoolantPerTick = 0.5 * fill * multiplier;
    const waterPerTick = 0.1 * fill * multiplier;
    return {
      euPerTick: -1536,
      inputs: [
        liters("Coolant", hotCoolantPerTick * 20),
        liters("Distilled Water", waterPerTick * 20),
      ],
      outputs: [
        liters("Hot Coolant", hotCoolantPerTick * 20),
        liters("Steam", waterPerTick * 160 * 20),
      ],
      stats: [
        stat("Efficiency", percent(efficiency)),
        stat("Output multiplier", formatAmount(multiplier)),
        stat("Pebbles per cycle", formatAmount(pebbleCost)),
      ],
    };
  },
};

const lftr: PowerSourceDefinition = {
  id: "lftr",
  name: "Liquid Fluoride Thorium Reactor",
  group: "reactors",
  unlock: "EV",
  blurb: "Burns fuel salts for direct EU.",
  settings: [
    {
      type: "select",
      id: "fuel",
      label: "Fuel",
      options: powerPlannerData.lftrFuels.map((entry) => ({ key: entry.name, label: entry.name })),
      defaultKey: powerPlannerData.lftrFuels[0]?.name ?? "",
    },
  ],
  compute(read): PowerModel {
    const fuel =
      powerPlannerData.lftrFuels.find((entry) => entry.name === read.select("fuel")) ??
      powerPlannerData.lftrFuels[0];
    // 16 amps of the fuel's base tier: "Net Amps (EV)" names the tier.
    const tierName = fuel.powerLabel.match(/\(([A-Z]+)\)/)?.[1] ?? "EV";
    const euPerTick = tierPower(tierName).voltage * 16;
    const inputs = [liters(fuel.name, 1), liters("Li2BeF4", 2)];
    const outputs = [
      liters("U-Salt", fuel.uSalt / 100),
      liters("T-Salt", fuel.tSalt / 100),
      liters("TB-Salt", fuel.tbSalt / 100),
      liters("UF6", fuel.uf6 / 100),
      liters("Uranium-233", fuel.uranium233PerSecond),
    ].filter((flow) => flow.perSecond > 0);
    // The recipes also drink the carrier salt: 200 L Li2BeF4 per 100 s
    // alongside 100 L of fuel salt (RecipeLoaderLFTR).
    return {
      euPerTick,
      inputs,
      outputs,
      stats: [stat("EU per L", formatAmount(fuel.euPerLiter))],
    };
  },
};

const IC2_DESIGNS = [
  { key: "design-1", label: "Design 1 (1,150 L/s)", rate: 1150 },
  { key: "design-2", label: "Design 2 (1,380 L/s)", rate: 1380 },
  { key: "design-3", label: "Design 3 (1,340 L/s)", rate: 1340 },
];

const ic2FluidReactor: PowerSourceDefinition = {
  id: "ic2-fluid-reactor",
  name: "Nuclear Reactor (fluid mode)",
  group: "reactors",
  unlock: "EV",
  blurb: "A preset rod layout heating coolant.",
  settings: [
    {
      type: "select",
      id: "design",
      label: "Reactor design",
      options: [...IC2_DESIGNS.map(({ key, label }) => ({ key, label })), { key: "custom", label: "Custom rate" }],
      defaultKey: "design-2",
    },
    {
      type: "number",
      id: "customRate",
      label: "Hot coolant rate",
      min: 1,
      max: 100_000,
      step: 10,
      defaultValue: 1380,
      unit: "L/s",
      enabledWhen: { settingId: "design", equals: "custom" },
    },
  ],
  compute(read): PowerModel {
    const design = IC2_DESIGNS.find((entry) => entry.key === read.select("design"));
    const rate = design?.rate ?? read.number("customRate");
    return {
      euPerTick: 0,
      inputs: [liters("Coolant", rate)],
      outputs: [liters("Hot Coolant", rate)],
      stats: [stat("Hot coolant", `${formatAmount(rate)} L/s`)],
      warnings: ["Uranium rod costs are not modeled; the community planner skips them too."],
    };
  },
};

/**
 * The wiki's tested Vacuum Reactor designs (actively cooled IC2 reactor,
 * coolant cells recooled in a Vacuum Freezer). EU and lifespans are the
 * wiki's Reactor Planner figures; rods burn to their depleted forms at
 * count / lifespan per second. Coolant cells circulate through the
 * freezer instead of being consumed, so they are stat lines.
 */
const VACUUM_DESIGNS = [
  {
    key: "thorium",
    label: "Thorium (8,720 EU/t)",
    euPerTick: 8720,
    rod: "Quad Fuel Rod (Thorium)",
    depleted: "Quad Fuel Rod (Depleted Thorium)",
    rods: 40,
    rodLife: 50_000,
    coolant: "14 x 360k He Coolant Cell",
    coolantLife: 1071,
    freezer: "Vacuum Freezer (MV hatch)",
  },
  {
    key: "uranium",
    label: "Uranium (43,600 EU/t)",
    euPerTick: 43_600,
    rod: "Quad Fuel Rod (Uranium)",
    depleted: "Quad Fuel Rod (Depleted Uranium)",
    rods: 40,
    rodLife: 20_000,
    coolant: "14 x 360k He Coolant Cell",
    coolantLife: 267,
    freezer: "Vacuum Freezer (HV hatch)",
  },
  {
    key: "mox",
    label: "MOX (107,979 EU/t)",
    euPerTick: 107_979,
    rod: "Quad Fuel Rod (MOX)",
    depleted: "Quad Fuel Rod (Depleted MOX)",
    rods: 40,
    rodLife: 10_000,
    coolant: "14 x 360k He Coolant Cell",
    coolantLife: 267,
    freezer: "Vacuum Freezer (HV hatch)",
    hot: true,
  },
  {
    key: "hd-plutonium",
    label: "High Density Plutonium (301,958 EU/t)",
    euPerTick: 301_958,
    rod: "Quad Fuel Rod (High Density Plutonium)",
    depleted: "Quad Fuel Rod (Depleted High Density Plutonium)",
    rods: 40,
    rodLife: 70_000,
    coolant: "14 x 540k Sp Coolant Cell",
    coolantLife: 401,
    freezer: "Vacuum Freezer (HV hatch)",
    hot: true,
  },
  {
    key: "excited-uranium",
    label: "Excited Uranium (1.05M EU/t)",
    euPerTick: 1_046_400,
    rod: "Quad Fuel Rod (Excited Uranium)",
    depleted: "Quad Fuel Rod (Depleted Excited Uranium)",
    rods: 40,
    rodLife: 6_000,
    coolant: "14 x 1080k Sp Coolant Cell",
    coolantLife: 50,
    freezer: "Mega Vacuum Freezer (EV hatch)",
  },
  {
    key: "core-25",
    label: "The Core x25 (3.2M EU/t)",
    euPerTick: 3_200_000,
    rod: "The Core",
    depleted: "The Core (Depleted)",
    rods: 25,
    rodLife: 100_000,
    coolant: "16 x 1080k Sp Coolant Cell",
    coolantLife: 11,
    freezer: "Mega Vacuum Freezer (LuV hatch)",
  },
  {
    key: "core-40",
    label: "The Core x40 (4.98M EU/t)",
    euPerTick: 4_979_200,
    rod: "The Core",
    depleted: "The Core (Depleted)",
    rods: 40,
    rodLife: 100_000,
    coolant: "14 x 1080k Sp Coolant Cell",
    coolantLife: 11,
    freezer: "Mega Vacuum Freezer (LuV hatch)",
  },
  {
    key: "core-40-capacitor",
    label: "The Core x40, heat capacitors (4.98M EU/t)",
    euPerTick: 4_979_200,
    rod: "The Core",
    depleted: "The Core (Depleted)",
    rods: 40,
    rodLife: 100_000,
    coolant: "14 x 1G Neutronium Heat Capacitor",
    coolantLife: 9300,
    freezer: "Mega Vacuum Freezer (UV hatch)",
  },
];

const vacuumReactor: PowerSourceDefinition = {
  id: "vacuum-reactor",
  name: "Vacuum Reactor",
  group: "reactors",
  unlock: "EV",
  blurb: "Actively cooled nuke: coolant cells and a Vacuum Freezer.",
  settings: [
    {
      type: "select",
      id: "design",
      label: "Design",
      options: VACUUM_DESIGNS.map(({ key, label }) => ({ key, label })),
      defaultKey: "uranium",
    },
  ],
  compute(read): PowerModel {
    const design =
      VACUUM_DESIGNS.find((entry) => entry.key === read.select("design")) ?? VACUUM_DESIGNS[1];
    const rodsPerSecond = design.rods / design.rodLife;
    const warnings = [
      `Coolant cells are recooled by a ${design.freezer}, not consumed. That loop and its power are not modeled.`,
    ];
    if (design.hot) {
      warnings.push("Runs at 98% Core Temp. The reactor melts down at 100%.");
    }
    return {
      euPerTick: design.euPerTick,
      inputs: [items(design.rod, rodsPerSecond)],
      outputs: [items(design.depleted, rodsPerSecond)],
      stats: [
        stat("Coolant", design.coolant),
        stat("Coolant lifespan", `${formatAmount(design.coolantLife)}s minimum`),
        stat("Rod lifespan", lifespanHours(design.rodLife)),
      ],
      warnings,
    };
  },
};

const dehp: PowerSourceDefinition = {
  id: "dehp",
  name: "Deep Earth Heating Pump",
  group: "reactors",
  unlock: "EV",
  blurb: "Geothermal steam or hot coolant.",
  settings: [
    {
      type: "select",
      id: "mode",
      label: "Mode",
      options: [
        { key: "steam", label: "Direct steam" },
        { key: "coolant", label: "Coolant heating" },
      ],
      defaultKey: "steam",
    },
  ],
  compute(read): PowerModel {
    if (read.select("mode") === "coolant") {
      const perSecond = 192 * 20;
      return {
        euPerTick: -480,
        inputs: [liters("Coolant", perSecond)],
        outputs: [liters("Hot Coolant", perSecond)],
        stats: [stat("Hot coolant", "192 L/t")],
      };
    }
    const steamPerTick = 25_600;
    // MTEDeepEarthHeatingPump: waterConsume = (25600 + 160) / 160 = 161 L/t,
    // one more than the clean ratio - the game's own integer arithmetic.
    return {
      euPerTick: -480,
      inputs: [liters("Distilled Water", 161 * 20)],
      outputs: [liters("SH Steam", steamPerTick * 20)],
      stats: [stat("Steam", `${formatAmount(steamPerTick)} L/t superheated`)],
    };
  },
};

const SOLAR_TOWER_RINGS = [
  { rings: 1, hotSalt: 38.6 },
  { rings: 2, hotSalt: 104.6 },
  { rings: 3, hotSalt: 217.4 },
  { rings: 4, hotSalt: 431 },
  { rings: 5, hotSalt: 883 },
];

const solarTower: PowerSourceDefinition = {
  id: "solar-tower",
  name: "Solar Tower",
  group: "passive",
  unlock: "EV",
  blurb: "Heliostats heat solar salt. No fuel.",
  settings: [
    {
      type: "select",
      id: "rings",
      label: "Heliostat rings",
      options: SOLAR_TOWER_RINGS.map((entry) => ({
        key: String(entry.rings),
        label: `${entry.rings} ${entry.rings === 1 ? "ring" : "rings"}`,
      })),
      defaultKey: "5",
    },
  ],
  compute(read): PowerModel {
    const rings = Number(read.select("rings"));
    const entry = SOLAR_TOWER_RINGS.find((row) => row.rings === rings) ?? SOLAR_TOWER_RINGS[4];
    const heliostats = (28 + 8 * rings) * rings;
    return {
      euPerTick: 0,
      inputs: [liters("Cold Solar Salt", entry.hotSalt)],
      outputs: [liters("Hot Solar Salt", entry.hotSalt)],
      stats: [
        stat("Heliostats", String(heliostats)),
        stat("Hot salt", `${formatAmount(entry.hotSalt)} L/s`),
      ],
    };
  },
};

/**
 * MTESolarGenerator outputs V[tier] EU/t (1 for ULV): the panel's tier
 * name and its voltage line up, so an LV panel makes a full 32 EU/t.
 */
const SOLAR_PANEL_TIERS = [
  { key: "ULV", label: "Solar Panel (1 EU/t)", eut: 1 },
  { key: "LV", label: "LV Solar Panel (32 EU/t)", eut: 32 },
  { key: "MV", label: "MV Solar Panel (128 EU/t)", eut: 128 },
  { key: "HV", label: "HV Solar Panel (512 EU/t)", eut: 512 },
  { key: "EV", label: "EV Solar Panel (2,048 EU/t)", eut: 2048 },
  { key: "IV", label: "IV Solar Panel (8,192 EU/t)", eut: 8192 },
  { key: "LuV", label: "LuV Solar Panel (32,768 EU/t)", eut: 32768 },
  { key: "ZPM", label: "ZPM Solar Panel (131,072 EU/t)", eut: 131072 },
  { key: "UV", label: "UV Solar Panel (524,288 EU/t)", eut: 524288 },
];

const solarPanel: PowerSourceDefinition = {
  id: "solar-panel",
  name: "Solar Panel",
  group: "passive",
  unlock: "MV",
  blurb: "Flat daytime EU from sunlight.",
  settings: [
    {
      type: "select",
      id: "panel",
      label: "Panel",
      options: SOLAR_PANEL_TIERS.map(({ key, label }) => ({ key, label })),
      defaultKey: "LV",
    },
    { type: "number", id: "duty", label: "Duty", min: 1, max: 100, step: 1, defaultValue: 100, unit: "%" },
  ],
  compute(read): PowerModel {
    const panel = SOLAR_PANEL_TIERS.find((entry) => entry.key === read.select("panel")) ?? SOLAR_PANEL_TIERS[1];
    const duty = read.number("duty") / 100;
    return {
      euPerTick: panel.eut * duty,
      inputs: [],
      outputs: [],
      stats: [stat("Daytime output", `${formatAmount(panel.eut)} EU/t`)],
    };
  },
};

export const reactorSources: PowerSourceDefinition[] = [
  thtr,
  htgr,
  lftr,
  ic2FluidReactor,
  vacuumReactor,
  dehp,
];
export const passiveSources: PowerSourceDefinition[] = [solarTower, solarPanel];

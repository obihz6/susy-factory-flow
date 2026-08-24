import { getVoltageTierIndex } from "@/lib/model/tiers";
import type { MachineTier } from "@/lib/model/types";

/**
 * The energy hatch families a multiblock can drink through, from the game's
 * own registrations (GT5-Unofficial `MachineLoader` and `MTEHatchEnergy`).
 *
 * A REGULAR hatch accepts 2 amps of its tier - but a build with exactly one
 * is clamped to 1 amp usable (`setProcessingLogicPower`), and machines
 * typically take up to two of them. The TecTech families are EXOTIC: one
 * hatch replaces the pair and carries its whole rating - Multi-Amp hatches
 * at 4/16/64 A from EV up, Laser Target hatches from 256 A at IV all the
 * way to 16,777,216 A at UXV. The game allows exactly ONE exotic hatch
 * (`checkExoticAndNormalEnergyHatches`), and `getMaxInputVoltageMulti`
 * sums hatch VOLTAGES only, so an exotic hatch's amps never raise the
 * "parallels per voltage tier" ordinal the way a second regular hatch does.
 *
 * Wireless variants exist for every family and supply the same amps; the
 * planner does not distinguish them because the machine cannot either.
 */
export interface EnergyHatchType {
  /** Stored on the node; "standard" is implied by absence. */
  id: string;
  /** Option label, matching the in-game item family. */
  label: string;
  /** What the hatch chip shows in place of the count. */
  chip: string;
  /** Amps one hatch carries. The standard single-hatch 1 A clamp lives in power.ts. */
  amps: number;
  /** One hatch only, of its full rating. */
  exotic: boolean;
  /** Lowest tier the item exists at, for the option hint. */
  minTier: MachineTier;
  /** A representative dataset item, purely for the icon. */
  resourceId: string;
}

export const STANDARD_ENERGY_HATCH_ID = "standard";

export const ENERGY_HATCH_TYPES: EnergyHatchType[] = [
  {
    id: STANDARD_ENERGY_HATCH_ID,
    label: "Energy Hatch",
    chip: "",
    amps: 2,
    exotic: false,
    minTier: "ULV",
    resourceId: "gregtech:gt.blockmachines@41",
  },
  {
    id: "amp4",
    label: "4A Energy Hatch",
    chip: "4A",
    amps: 4,
    exotic: true,
    minTier: "EV",
    resourceId: "gregtech:gt.blockmachines@15109",
  },
  {
    id: "amp16",
    label: "16A Energy Hatch",
    chip: "16A",
    amps: 16,
    exotic: true,
    minTier: "EV",
    resourceId: "gregtech:gt.blockmachines@15119",
  },
  {
    id: "amp64",
    label: "64A Energy Hatch",
    chip: "64A",
    amps: 64,
    exotic: true,
    minTier: "EV",
    resourceId: "gregtech:gt.blockmachines@15129",
  },
  {
    id: "laser256",
    label: "256A Laser Target Hatch",
    chip: "256A",
    amps: 256,
    exotic: true,
    minTier: "IV",
    resourceId: "gregtech:gt.blockmachines@15130",
  },
  {
    id: "laser1k",
    label: "1,024A Laser Target Hatch",
    chip: "1kA",
    amps: 1024,
    exotic: true,
    minTier: "LuV",
    resourceId: "gregtech:gt.blockmachines@15141",
  },
  {
    id: "laser4k",
    label: "4,096A Laser Target Hatch",
    chip: "4kA",
    amps: 4096,
    exotic: true,
    minTier: "ZPM",
    resourceId: "gregtech:gt.blockmachines@15152",
  },
  {
    id: "laser16k",
    label: "16,384A Laser Target Hatch",
    chip: "16kA",
    amps: 16384,
    exotic: true,
    minTier: "UV",
    resourceId: "gregtech:gt.blockmachines@15163",
  },
  {
    id: "laser65k",
    label: "65,536A Laser Target Hatch",
    chip: "65kA",
    amps: 65536,
    exotic: true,
    minTier: "UHV",
    resourceId: "gregtech:gt.blockmachines@15174",
  },
  {
    id: "laser262k",
    label: "262,144A Laser Target Hatch",
    chip: "262kA",
    amps: 262144,
    exotic: true,
    minTier: "UEV",
    resourceId: "gregtech:gt.blockmachines@15185",
  },
  {
    id: "laser1m",
    label: "1,048,576A Laser Target Hatch",
    chip: "1MA",
    amps: 1048576,
    exotic: true,
    minTier: "UIV",
    resourceId: "gregtech:gt.blockmachines@15196",
  },
  {
    id: "laser4m",
    label: "4,194,304A Laser Target Hatch",
    chip: "4MA",
    amps: 4194304,
    exotic: true,
    minTier: "UMV",
    resourceId: "gregtech:gt.blockmachines@16023",
  },
  {
    id: "laser16m",
    label: "16,777,216A Laser Target Hatch",
    chip: "16MA",
    amps: 16777216,
    exotic: true,
    minTier: "UXV",
    resourceId: "gregtech:gt.blockmachines@16025",
  },
];

const BY_ID = new Map(ENERGY_HATCH_TYPES.map((type) => [type.id, type]));

/** An unknown or absent id is the plain hatch pair every plan started with. */
export function getEnergyHatchType(id: string | undefined): EnergyHatchType {
  return (id && BY_ID.get(id)) || ENERGY_HATCH_TYPES[0];
}

/**
 * The families that exist at this hatch tier: there is no 64A hatch below EV
 * and no laser below IV, and each laser rating starts at its own tier. Only
 * the floor is guarded; at MAX the game itself only mints the wireless
 * standard hatch, a distinction the planner does not draw.
 */
export function energyHatchTypesForTier(tier: string): EnergyHatchType[] {
  const ordinal = getVoltageTierIndex(tier as Exclude<MachineTier, "DEMO">);
  return ENERGY_HATCH_TYPES.filter(
    (type) => getVoltageTierIndex(type.minTier as Exclude<MachineTier, "DEMO">) <= ordinal,
  );
}

/** Whether this hatch family exists at this tier - the pair always does. */
export function energyHatchTypeExistsAtTier(id: string | undefined, tier: string): boolean {
  const type = getEnergyHatchType(id);
  return (
    getVoltageTierIndex(type.minTier as Exclude<MachineTier, "DEMO">) <=
    getVoltageTierIndex(tier as Exclude<MachineTier, "DEMO">)
  );
}

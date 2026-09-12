import type { MachineConfigControl } from "@/lib/model/types";
import { GT_VOLTAGE_TIERS } from "@/lib/model/tiers";

// MTEPreciseAssembler: casingTier -1..3 maps to Imprecise / Mk-I..IV.
const unitCasings = ["Imprecise", "Mk-I", "Mk-II", "Mk-III", "Mk-IV"].map((label, index) => ({
  key: `mk${index}`,
  label,
  resource: {
    kind: "item" as const,
    id: `factoryflow:machine_config/preciseCasing_mk${index}`,
    amount: 1,
    consumed: false,
    displayName: `${label} Unit Casing`,
  },
}));

export const PRASS_NORMAL_CASING: MachineConfigControl = {
  id: "preciseCasing",
  label: "Unit casing",
  minimumKey: "mk0",
  defaultKey: "mk0",
  tiers: unitCasings.map((casing, index) => ({
    ...casing,
    resource: {
      ...casing.resource,
      tooltip: [
        `Normal Assembler mode: ${16 * 2 ** index} maximum parallels at 2x speed. Energy supply limits usable parallels.`,
      ],
    },
  })),
};

export const PRASS_PRECISE_CASING: MachineConfigControl = {
  id: "preciseCasing",
  label: "Unit casing",
  minimumKey: "mk1",
  defaultKey: "mk1",
  // Special value 1 means Mk-I, so this ladder begins at Mk-I rather than Imprecise.
  minimumFromSpecialValue: true,
  tiers: unitCasings.slice(1).map((casing, index) => ({
    ...casing,
    resource: {
      ...casing.resource,
      tooltip: [
        `Precise mode: unlocks recipes requiring casing tier ${index + 1} or lower. One parallel, with no speed bonus.`,
      ],
    },
  })),
};

export const PRASS_MACHINE_CASING: MachineConfigControl = {
  id: "prassMachineCasing",
  label: "Machine casing",
  minimumKey: "ulv",
  defaultKey: "uhv",
  tiers: GT_VOLTAGE_TIERS.slice(0, 10).map(({ tier }, ordinal) => ({
    key: tier.toLowerCase(),
    label: tier,
    resource: {
      kind: "item",
      id: `gregtech:gt.blockcasings1${ordinal ? `@${ordinal}` : ""}`,
      amount: 1,
      consumed: false,
      displayName: `${tier} Machine Casing`,
      tooltip: [
        ordinal === 9
          ? "UHV machine casings remove the casing voltage limit. Energy hatches still determine supplied voltage and amps."
          : `Limits usable voltage to ${tier}, even with higher-tier energy hatches. Amps can buy overclocks but cannot unlock recipes above this voltage.`,
      ],
    },
  })),
};

export function prassInputVoltageLimit(settings: Record<string, string>): number {
  const index = PRASS_MACHINE_CASING.tiers.findIndex(
    (tier) => tier.key === settings.prassMachineCasing,
  );
  // Legacy plans never stored this casing. Keep their previous assumption of
  // a sufficient casing, represented explicitly by the UHV (uncapped) default.
  return index < 0 || index === 9 ? Infinity : index;
}

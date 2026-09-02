import { powerPlannerData } from "../planner-data";
import type { PowerFlowLine, PowerSelectOption, PowerStatLine } from "../types";

export function liters(name: string, perSecond: number): PowerFlowLine {
  return { name, perSecond, unit: "L" };
}

export function items(name: string, perSecond: number): PowerFlowLine {
  return { name, perSecond, unit: "item" };
}

export function stat(label: string, value: string): PowerStatLine {
  return { label, value };
}

const NUMBER_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatAmount(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (Math.abs(value) >= 1_000_000_000) {
    return `${NUMBER_FORMAT.format(value / 1_000_000_000)}G`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `${NUMBER_FORMAT.format(value / 1_000_000)}M`;
  }
  return NUMBER_FORMAT.format(value);
}

export function percent(value: number): string {
  return `${NUMBER_FORMAT.format(value * 100)}%`;
}

/** Voltage and per-amp packet loss for a tier name, from the workbook's own ladder. */
export function tierPower(tier: string): { voltage: number; ampLoss: number } {
  const entry = powerPlannerData.singleblockTiers.find((row) => row.tier === tier);
  return entry ? { voltage: entry.voltage, ampLoss: entry.ampLoss } : { voltage: 32, ampLoss: 1 };
}

/** Tier options for a singleblock family: the tiers its efficiency ladder covers. */
export function familyTierOptions(family: string): {
  options: PowerSelectOption[];
  efficiencyFor(tier: string): number;
} {
  const ladder = powerPlannerData.singleblockEfficiency[family] ?? [];
  const options = powerPlannerData.singleblockTiers
    .map((row, index) => ({ row, index }))
    .filter(({ index }) => typeof ladder[index] === "number")
    .map(({ row }) => ({ key: row.tier, label: row.tier }));
  return {
    options,
    efficiencyFor(tier) {
      const index = powerPlannerData.singleblockTiers.findIndex((row) => row.tier === tier);
      const value = ladder[index];
      return typeof value === "number" ? value : 1;
    },
  };
}

/** Rotor lifespan in whole hours, from seconds. */
export function lifespanHours(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "-";
  }
  const hours = seconds / 3600;
  return hours >= 100 ? `${Math.round(hours)}h` : `${NUMBER_FORMAT.format(hours)}h`;
}

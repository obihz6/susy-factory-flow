import type { MachineConfigControl } from "@/lib/model/types";
import { GT_VOLTAGE_TIERS } from "@/lib/model/tiers";

// tectech.loader.thing.MachineLoader: IV starts at 256A; each tier adds
// one four-times-larger hatch, through UXV's 16,777,216A. The Legendary
// source is also UXV, with V[13] = 536,870,912A (not a MAX-tier source).
export const HILE_SOURCES = GT_VOLTAGE_TIERS.slice(5, 14).flatMap(({ tier }, index) =>
  Array.from({ length: index + 1 }, (_, ampIndex) => ({
    key: `${tier.toLowerCase()}-${256 * 4 ** ampIndex}`,
    tier,
    ordinal: index + 5,
    amps: 256 * 4 ** ampIndex,
  })),
);
HILE_SOURCES.push({ key: "uxv-536870912", tier: "UXV", ordinal: 13, amps: 536_870_912 });

export const HILE_SOURCE_CONTROL: MachineConfigControl = {
  id: "laserSource",
  label: "Laser source",
  minimumKey: HILE_SOURCES[0].key,
  defaultKey: HILE_SOURCES[0].key,
  tiers: HILE_SOURCES.map(({ key, tier, ordinal, amps }) => ({
    key,
    label: `${tier} · ${amps.toLocaleString("en-US")}A${amps === 536_870_912 ? " (Legendary)" : ""}`,
    resource: {
      kind: "item",
      id: `factoryflow:machine_config/laser_source_${key}`,
      amount: 1,
      consumed: false,
      displayName:
        amps === 536_870_912
          ? "Legendary Laser Source Hatch"
          : `${tier} ${amps.toLocaleString("en-US")}A Laser Source Hatch`,
      tooltip: [
        `${Math.floor(Math.cbrt(amps))} maximum parallels; recipe and overclock ceiling: ${GT_VOLTAGE_TIERS[ordinal + 1].tier}.`,
        `Requires ${tier} or higher glass. The laser source supplies no operating power; set energy supply separately.`,
        ...(ordinal >= 10
          ? ["Allows one multi-amp energy hatch instead of regular energy hatches."]
          : []),
      ],
    },
  })),
};

export function hileSourceAt(index: number) {
  return HILE_SOURCES[index] ?? HILE_SOURCES[0];
}

/** Old cards had an amperage-only source and a second, conflicting count knob. */
export function normalizeHileSettings(settings: Record<string, string>): Record<string, string> {
  if (HILE_SOURCES.some((source) => source.key === settings.laserSource)) return settings;
  // The named source is the actual hatch the player chose. Only use the old
  // count knob when no named source was saved. Impossible counts round up to
  // the next real hatch; legacy cards never recorded a source voltage, so
  // select the lowest registered tier carrying that amperage.
  const oldSource = /^a(\d+)$/.exec(settings.laserSource ?? "");
  const amps = Number(oldSource?.[1] ?? settings.laserAmperage ?? 256);
  const source = HILE_SOURCES.find((entry) => entry.amps >= amps) ?? HILE_SOURCES[0];
  return { ...settings, laserSource: source.key };
}

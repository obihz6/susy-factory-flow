import { useEffect, useState } from "react";
import { ENERGY_HATCH_TYPES } from "@/lib/machines/energy-hatches";
import type { ResourceIconAtlasRef } from "@/lib/model/types";

/** One concrete hatch item: a (tier, family) cell of the picker. */
export interface EnergyHatchCatalogEntry {
  id: string;
  displayName: string;
  iconPath?: string;
  iconAtlas?: ResourceIconAtlasRef;
  dominantColor?: string;
}

export type EnergyHatchCatalog = Map<string, EnergyHatchCatalogEntry>;

export function energyHatchCatalogKey(tier: string, familyId: string): string {
  return `${tier}|${familyId}`;
}

/**
 * Every wired energy hatch item in the dataset, keyed by tier and family,
 * fetched once per dataset and shared by every card. The client dataset only
 * carries resources the loaded recipes touch, and no plan's recipes reference
 * the hatches themselves, so the picker asks the server the same question the
 * item browser would: two queries cover the lot ("Energy Hatch" returns the
 * regular and multi-amp families, "Laser Target Hatch" the lasers). Wireless
 * variants are dropped on purpose - they feed a machine identical amps, and
 * the planner does not model the wireless network.
 */
const catalogCache = new Map<string, EnergyHatchCatalog>();
const inFlight = new Map<string, Promise<EnergyHatchCatalog>>();

const FAMILY_BY_AMPS = new Map(
  ENERGY_HATCH_TYPES.filter((type) => type.exotic).map((type) => [type.amps, type.id]),
);

/** "EV 64A Energy Hatch" / "IV 256A/t Laser Target Hatch" -> tier + family. */
function parseHatchName(name: string): { tier: string; familyId: string } | undefined {
  if (/wireless/i.test(name)) {
    return undefined;
  }
  const regular = /^([A-Z][A-Za-z]{1,3}) Energy Hatch$/.exec(name);
  if (regular) {
    return { tier: regular[1], familyId: "standard" };
  }
  const rated = /^([A-Z][A-Za-z]{1,3}) ([\d,]+)A(?:\/t)? (?:Energy|Laser Target) Hatch$/.exec(name);
  if (!rated) {
    return undefined;
  }
  const familyId = FAMILY_BY_AMPS.get(Number(rated[2].replace(/,/g, "")));
  return familyId ? { tier: rated[1], familyId } : undefined;
}

async function fetchCatalog(datasetVersionId: string): Promise<EnergyHatchCatalog> {
  const catalog: EnergyHatchCatalog = new Map();
  await Promise.all(
    ["Energy Hatch", "Laser Target Hatch"].map(async (query) => {
      try {
        const url =
          `/api/datasets/${encodeURIComponent(datasetVersionId)}/resources` +
          `?query=${encodeURIComponent(query)}&kind=item&limit=120`;
        const response = await fetch(url);
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as {
          resources?: Array<EnergyHatchCatalogEntry & { displayName?: string }>;
        };
        for (const entry of data.resources ?? []) {
          const parsed = entry.displayName ? parseHatchName(entry.displayName) : undefined;
          if (parsed) {
            catalog.set(energyHatchCatalogKey(parsed.tier, parsed.familyId), {
              id: entry.id,
              displayName: entry.displayName ?? entry.id,
              iconPath: entry.iconPath,
              iconAtlas: entry.iconAtlas,
              dominantColor: entry.dominantColor,
            });
          }
        }
      } catch {
        // Offline: the picker synthesizes rows without art instead.
      }
    }),
  );
  return catalog;
}

export function useEnergyHatchCatalog(datasetVersionId: string | undefined): EnergyHatchCatalog {
  const [catalog, setCatalog] = useState<EnergyHatchCatalog>(
    () => (datasetVersionId && catalogCache.get(datasetVersionId)) || new Map(),
  );

  useEffect(() => {
    if (!datasetVersionId) {
      return;
    }
    const cached = catalogCache.get(datasetVersionId);
    if (cached) {
      setCatalog(cached);
      return;
    }
    let cancelled = false;
    const pending =
      inFlight.get(datasetVersionId) ??
      (() => {
        const promise = fetchCatalog(datasetVersionId).then((map) => {
          catalogCache.set(datasetVersionId, map);
          inFlight.delete(datasetVersionId);
          return map;
        });
        inFlight.set(datasetVersionId, promise);
        return promise;
      })();
    void pending.then((map) => {
      if (!cancelled) {
        setCatalog(map);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [datasetVersionId]);

  return catalog;
}

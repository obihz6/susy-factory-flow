import type { FactoryProject, FuelProfile } from "./types";

export const DEFAULT_FUEL_PROFILE_ID = "bio_diesel";

/**
 * Supersymmetry generator fuel values, derived from the pack's own
 * groovy/prePostInit/Thermodynamics.groovy: every fuel burns at a fixed
 * EUt of 32, so EU/L = 32 * duration / fuel_amount (combustion-generator
 * recipe shape). Gas-turbine multiblock variants run 1.5x the duration and
 * fuel cells 2x at the same EUt, so this figure is the per-liter constant
 * across all three consumers.
 */
export const susyFuelProfiles: FuelProfile[] = [
  { id: "wood_gas", name: "Wood Gas", fuelFluidId: "wood_gas", euPerLiter: 5.6, notes: "SUSY Thermodynamics.groovy (32 EUt x duration / amount)." },
  { id: "coal_gas", name: "Coal Gas", fuelFluidId: "coal_gas", euPerLiter: 8, notes: "SUSY Thermodynamics.groovy." },
  { id: "hydrogen_rich_syngas", name: "Hydrogen-Rich Syngas", fuelFluidId: "hydrogen_rich_syngas", euPerLiter: 8.33, notes: "SUSY Thermodynamics.groovy." },
  { id: "monoxide_rich_syngas", name: "Monoxide-Rich Syngas", fuelFluidId: "monoxide_rich_syngas", euPerLiter: 10, notes: "SUSY Thermodynamics.groovy." },
  { id: "methanol", name: "Methanol", fuelFluidId: "methanol", euPerLiter: 41, notes: "SUSY Thermodynamics.groovy." },
  { id: "natural_gas", name: "Natural Gas", fuelFluidId: "natural_gas", euPerLiter: 72.5, notes: "SUSY Thermodynamics.groovy." },
  { id: "ethanol", name: "Ethanol", fuelFluidId: "ethanol", euPerLiter: 88, notes: "SUSY Thermodynamics.groovy." },
  { id: "methane", name: "Methane", fuelFluidId: "methane", euPerLiter: 50, notes: "SUSY Thermodynamics.groovy." },
  { id: "ethane", name: "Ethane", fuelFluidId: "ethane", euPerLiter: 100, notes: "SUSY Thermodynamics.groovy." },
  { id: "gasoline", name: "Gasoline", fuelFluidId: "gasoline", euPerLiter: 325, notes: "SUSY Thermodynamics.groovy." },
  { id: "midgrade_gasoline", name: "Midgrade Gasoline", fuelFluidId: "midgrade_gasoline", euPerLiter: 390, notes: "SUSY Thermodynamics.groovy." },
  { id: "premium_gasoline", name: "Premium Gasoline", fuelFluidId: "premium_gasoline", euPerLiter: 455, notes: "SUSY Thermodynamics.groovy." },
  { id: "supreme_gasoline", name: "Supreme Gasoline", fuelFluidId: "supreme_gasoline", euPerLiter: 520, notes: "SUSY Thermodynamics.groovy." },
  { id: "fuel_gas", name: "Fuel Gas", fuelFluidId: "fuel_gas", euPerLiter: 178, notes: "SUSY Thermodynamics.groovy." },
  { id: "propane", name: "Propane", fuelFluidId: "propane", euPerLiter: 150, notes: "SUSY Thermodynamics.groovy." },
  { id: "butane", name: "Butane", fuelFluidId: "butane", euPerLiter: 200, notes: "SUSY Thermodynamics.groovy." },
  { id: "kerosene", name: "Kerosene", fuelFluidId: "kerosene", euPerLiter: 575, notes: "SUSY Thermodynamics.groovy." },
  { id: "midgrade_kerosene", name: "Midgrade Kerosene", fuelFluidId: "midgrade_kerosene", euPerLiter: 690, notes: "SUSY Thermodynamics.groovy." },
  { id: "premium_kerosene", name: "Premium Kerosene", fuelFluidId: "premium_kerosene", euPerLiter: 805, notes: "SUSY Thermodynamics.groovy." },
  { id: "supreme_kerosene", name: "Supreme Kerosene", fuelFluidId: "supreme_kerosene", euPerLiter: 920, notes: "SUSY Thermodynamics.groovy." },
  { id: "diesel", name: "Diesel", fuelFluidId: "diesel", euPerLiter: 775, notes: "SUSY Thermodynamics.groovy." },
  { id: "bio_diesel", name: "Biodiesel", fuelFluidId: "bio_diesel", euPerLiter: 950, notes: "SUSY Thermodynamics.groovy." },
  { id: "midgrade_diesel", name: "Midgrade Diesel", fuelFluidId: "midgrade_diesel", euPerLiter: 930, notes: "SUSY Thermodynamics.groovy." },
  { id: "premium_diesel", name: "Premium Diesel", fuelFluidId: "premium_diesel", euPerLiter: 1085, notes: "SUSY Thermodynamics.groovy." },
  { id: "supreme_diesel", name: "Supreme Diesel", fuelFluidId: "supreme_diesel", euPerLiter: 1240, notes: "SUSY Thermodynamics.groovy." },
  { id: "fuel_oil", name: "Fuel Oil", fuelFluidId: "fuel_oil", euPerLiter: 1000, notes: "SUSY Thermodynamics.groovy." },
  { id: "lpg", name: "LPG", fuelFluidId: "lpg", euPerLiter: 11392, notes: "SUSY Thermodynamics.groovy." },
  { id: "liquid_natural_gas", name: "LNG", fuelFluidId: "liquid_natural_gas", euPerLiter: 4640, notes: "SUSY Thermodynamics.groovy." },
];

/** Upstream GTNH profiles, kept dormant so old exported plans still parse. */
export const gtnhFuelProfiles: FuelProfile[] = [
  {
    id: "benzene",
    name: "Benzene",
    fuelFluidId: "benzene",
    euPerLiter: 32000,
    notes: "GTNH generator fuel value.",
  },
  {
    id: "biodiesel",
    name: "Biodiesel",
    fuelFluidId: "biodiesel",
    euPerLiter: 12800,
    notes: "GTNH generator fuel value.",
  },
  {
    id: "steam",
    name: "Steam",
    fuelFluidId: "steam",
    euPerLiter: 16,
    notes: "GTNH steam turbine value.",
  },
];

/** Plans authored on upstream carry these ids; map them onto SUSY fluids. */
export const legacyFuelProfileIds: Record<string, string> = {
  "demo-benzene": "gasoline",
  benzene: "gasoline",
  "demo-biodiesel": "bio_diesel",
  biodiesel: "bio_diesel",
  "demo-steam": "wood_gas",
};

const canonicalFuelProfiles = susyFuelProfiles;

export function normalizeProjectFuelProfiles(project: FactoryProject): FactoryProject {
  const canonicalById = new Map(canonicalFuelProfiles.map((fuel) => [fuel.id, fuel]));
  const customProfiles = project.fuelProfiles.filter((fuel) => {
    const normalizedId = legacyFuelProfileIds[fuel.id] ?? fuel.id;
    return !canonicalById.has(normalizedId);
  });
  const selectedFuelProfileId =
    legacyFuelProfileIds[project.selectedFuelProfileId ?? ""] ??
    project.selectedFuelProfileId ??
    DEFAULT_FUEL_PROFILE_ID;

  return {
    ...project,
    fuelProfiles: [...canonicalFuelProfiles, ...customProfiles],
    selectedFuelProfileId: canonicalById.has(selectedFuelProfileId)
      ? selectedFuelProfileId
      : customProfiles.some((fuel) => fuel.id === selectedFuelProfileId)
        ? selectedFuelProfileId
        : DEFAULT_FUEL_PROFILE_ID,
  };
}

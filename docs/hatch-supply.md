# Hatch supply

The input row's **Reservoir Hatch** or **Air Intake Hatch** toggle supplies ordinary fluid water or air to a
compatible machine. Jack explicitly requested an abstraction on 2026-09-11:
assume enough hatches to fully satisfy the input, without counts or rate limits.
The label stays the same in both states, with a green pressed state when on and
no hover tooltip. It does not supply cells, distilled/purified water, liquid air, oxygen, nitrogen,
or other fluids. Air assumes a dimension producing ordinary air and clear hatch
fronts. Those construction conditions are not simulated.

`FactoryNode.hatchSupplies` stores the selected fluid IDs for the whole machine,
including shared recipe sections. Recipes remain read-only. The schema preserves
the setting through save/export/import, and `updateNode` supplies ordinary undo.
Eligibility is evaluated again against the selected handler on every solve;
changing to an ineligible machine makes a saved choice dormant.

## Compatibility evidence

These are fluid input hatch subclasses, not universal attachments:

- [MTEHatchFluidGenerator](https://github.com/GTNewHorizons/GT5-Unofficial/blob/master/src/main/java/gtPlusPlus/xmod/gregtech/api/metatileentity/implementations/MTEHatchFluidGenerator.java)
  extends `MTEHatchInput` and generates without EU.
- [Reservoir](https://github.com/GTNewHorizons/GT5-Unofficial/blob/master/src/main/java/gtPlusPlus/xmod/gregtech/api/metatileentity/implementations/MTEHatchReservoir.java):
  regular water, two billion litres replenished every 100 ticks; registered EV.
- [Air Intake](https://github.com/GTNewHorizons/GT5-Unofficial/blob/master/src/main/java/gtPlusPlus/xmod/gregtech/api/metatileentity/implementations/MTEHatchAirIntake.java):
  5,000 L/20 ticks; registered IV. Extreme supplies 40,000 L/20 ticks;
  Atmospheric supplies two billion L/20 ticks. The front must be clear. Output
  changes to Nether Air or Toxic Air in those dimensions.
- [Chemical Plant](https://github.com/GTNewHorizons/GT5-Unofficial/blob/master/src/main/java/gtPlusPlus/xmod/gregtech/common/tileentities/machines/multi/production/chemplant/MTEChemicalPlant.java)
  caps hatch tier by machine casing (`maxTierOfHatch` / `mMachineCasingTier`). It
  is excluded until that restriction is represented. Singleblocks, dedicated
  hatch machines, and unknown multiblocks are excluded too.
- [Steam Separator](https://github.com/GTNewHorizons/GT5-Unofficial/blob/master/src/main/java/gregtech/common/tileentities/machines/multi/steam/MTESteamCentrifuge.java)
  accepts steam item buses and ordinary fluid outputs, but no ordinary fluid
  input hatch. It is excluded even though the dataset offers fluid-input recipes.

The explicit list in `src/lib/model/hatch-supply.ts` was checked against the
GT5U sources in `C:/Users/jack/gtnh-sources/GT5-Unofficial` and current GitHub
source. Each included structure accepts ordinary `InputHatch`:

| Machine | Source class |
| --- | --- |
| Large / Mega Chemical Reactor | MTELargeChemicalReactor / MTEMegaChemicalReactor |
| Vacuum / Cryogenic Freezer, Endothermic Fridge | MTEVacuumFreezer / MTECryogenicFreezer / MTEEndothermicFridge |
| Industrial Centrifuge / Mixing Machine | MTEIndustrialCentrifuge / MTEIndustrialMixer |
| Industrial Chemical Bath / Cutting Factory | MTEIndustrialChemicalBath / MTEIndustrialCuttingMachine |
| Ore Washing Plant | MTEOreWashingPlant (and MTEIndustrialWashPlantLegacy) |
| Distillation Tower / Mega / Dangote Distillus | MTEDistillationTower / MTEMegaDistillationTower / MTEAdvDistillationTower |
| Steam Purifier / Blender | MTESteamWasher / MTESteamMixer |
| Industrial Autoclave / Big Barrel Brewery / TurboCan Pro | MTEMultiAutoclave / MTEIndustrialBrewery / MTEMultiCanner |
| Mass Solidifier / Exo-Foundry / Spinmatron-2737 | MTEMassSolidifier / MTEExoFoundry / MTESpinmatron |
| Industrial Forming Press / Thermic Heating Device | MTEIndustrialFormingPress / MTEIndustrialFluidHeater |
| Large Scale Auto-Assembler / Precise Auto-Assembler | MTEAutoCrafter / MTEPreciseAssembler |

## Solver

After shared recipes and pools expand, `expandHatchSupplies` adds a private
source drawer per selected fluid and solve node. It replaces incoming edges
only in that temporary graph. Saved wires survive and work again when disabled.
The source cannot feed another machine or leak into the shared pool. Consumption
rates remain visible; hatch production balances them locally and is not an import.
Expansion caches preserve identity when graph diagnoses re-read or re-solve it.
No extra hatch cards or count estimates are added to the board or machine list.

`hatch-supply.test.ts` exercises Build, Solve, Pool, shared sections, repeated
expansion, strict fluid matching, machine changes, save/reload and wire survival.

# Dangote Distillus audit — 2026-09-11

The report is valid for **Distillery mode**, not Distillation Tower mode.
The missing amp control came from the card requiring curated machine math;
Dangote still used exported runtime variants. Those variants do not model
the multiblock's parallel helper.

Verified against GT5-Unofficial commit
`8e238674ae0763ad38803b2dc56049ade2cbedc2`:

- [MTEAdvDistillationTower](https://github.com/GTNewHorizons/GT5-Unofficial/blob/8e238674ae0763ad38803b2dc56049ade2cbedc2/src/main/java/gtPlusPlus/xmod/gregtech/common/tileentities/machines/multi/processing/advanced/MTEAdvDistillationTower.java):
  Tower mode has 12 parallels, 3× speed and normal EU/t. Distillery mode
  has 2× speed, 15% EU/t and `2 * floor(totalHeight / 3) * voltageTier`
  parallels. Internal `mHeight` excludes the bottom layer, so the Java
  formula uses `mHeight + 1`. The structure accepts ordinary Energy hatches,
  including multiple hatches, but not exotic multi-amp/laser hatches.
- [MTEMultiBlockBase](https://github.com/GTNewHorizons/GT5-Unofficial/blob/8e238674ae0763ad38803b2dc56049ade2cbedc2/src/main/java/gregtech/api/metatileentity/implementations/MTEMultiBlockBase.java):
  one regular hatch supplies 1 working amp; multiple regular hatches supply
  their combined amperage and permit amperage overclocking.
- [MTEExtendedPowerMultiBlockBase](https://github.com/GTNewHorizons/GT5-Unofficial/blob/8e238674ae0763ad38803b2dc56049ade2cbedc2/src/main/java/gregtech/api/metatileentity/implementations/MTEExtendedPowerMultiBlockBase.java):
  `getMaxInputVoltage` sums hatch voltages. Two IV hatches therefore give
  the LuV ordinal for the parallel formula, while processing receives 4A IV.

The planner assumes the maximum **12-layer** structure in Distillery mode:
8 parallels per voltage ordinal (40 at IV with one hatch, 48 at LuV).
Shorter structures are not configurable. The machine tooltip states this
assumption and the hatch restriction. The existing power entry represents
total supplied amps, not an exotic hatch selection.

Both modes now use the curated table, selected by `source.recipeMap`.
Base recipe EU/t and time replace stale baked handler values; runtime variants
and scraped fixed parallel controls cannot override the verified formulas.
The reference calculator is deliberately not followed here: its one Dangote
entry describes only Distillery mode and charges 85% EU rather than 15%.

Verification: focused source-boundary tests, full Vitest suite, typecheck,
and a Chromium check using actual exported recipes for both maps. Editing
amps and voltage changed Distillery parallels, kept Tower parallels at 12,
and persisted through reload. No dataset rebuild is required.

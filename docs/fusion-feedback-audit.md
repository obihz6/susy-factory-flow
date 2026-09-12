# Fusion feedback audit

Verified against a fresh export of the installed GTNH 2.9.0-beta-2 game on
2026-09-12, the supplied GTNH Power Planner 2.9 workbook, and GT5U source.

## Corrections

- The recipe handler normalizer stripped trailing Roman numerals. This merged
  Fusion Control Computer Mark I/II/III and FusionTech MK IV/V. All ten real
  reactor controllers now retain their names and identities. Recipe eligibility
  filters the picker before its default controller is selected.
- GoodGenerator compact controllers were classified as singleblocks by a
  class-name heuristic. The oracle now exports the actual multiblock superclass
  check. The application also corrects legacy fusion handlers.
- Exported generic OverclockCalculator variants did not invoke the fusion
  describer. Fusion now uses reactor-mark overclocks: 2/2 for I-III and 4/4 for
  IV-V, capped by the difference between reactor and recipe fusion marks.
- Reactor power capacity is fixed, independent of saved voltage/amp choices.
  Actual running EU/t remains in card and machine-list power reports. The
  operating-tier chip is read-only; changing the controller changes the mark.
- Compact reactors have 64 base parallels and `extraPara(startEnergy)` bonuses,
  reaching 320. Recipe fusion tier uses both startup threshold and recipe EU/t.
  Parallel bonus thresholds are strict `<`; fusion recipe tiers use inclusive
  `<=`. These tests must remain separate, especially at 160M and 320M EU.
- Startup charging is not added to steady-state draw. Its numeric threshold
  remains essential to eligibility and compact parallel calculations.

## Export and saved-plan compatibility

The oracle previously exported `mSpecialValue`, which is zero on all 68 fusion
recipes. Fusion uses `GTRecipeConstants.FUSION_THRESHOLD`, a long-valued recipe
metadata entry. It now travels as `fusionStartupEu` in the raw export and
`metadata.fusionStartupEu` in normalized recipes. Recipe IDs retain their existing
signature; this extra metadata does not rename recipes or break saved links.

`src/lib/machines/data/fusion-startups.json` contains exact recipe fingerprints
from the fresh runtime export. All 68 recipes in the current local dataset match.
It repairs existing exports and embedded saved recipes without a dataset rebuild
or a name-based lookup. Fresh recipe metadata takes priority. An unknown recipe
with no threshold is reported as unavailable rather than assigned a guessed tier.

Regenerate from a fresh export with:

```text
node tools/audits/extract-fusion-startups.mjs oracle-export.json src/lib/machines/data/fusion-startups.json
```

The power-menu plasma producers remain backed by their existing workbook tables;
they already include mark-dependent overclocks and compact scaling. The reported
missing-overclock and controller-merging bugs were in the recipe-card path.
Draconic Evolution Fusion Crafter does not use reactor rules.

## Source

- [FusionOverclockDescriber](https://github.com/GTNewHorizons/GT5-Unofficial/blob/master/src/main/java/gregtech/api/objects/overclockdescriber/FusionOverclockDescriber.java)
- [AdvancedFusionOverclockDescriber](https://github.com/GTNewHorizons/GT5-Unofficial/blob/master/src/main/java/gregtech/api/util/AdvancedFusionOverclockDescriber.java)
- [FusionSpecialValueFormatter](https://github.com/GTNewHorizons/GT5-Unofficial/blob/master/src/main/java/gregtech/nei/formatter/FusionSpecialValueFormatter.java)
- [MTEFusionComputer](https://github.com/GTNewHorizons/GT5-Unofficial/blob/master/src/main/java/gregtech/common/tileentities/machines/multi/MTEFusionComputer.java)
- [MTELargeFusionComputer](https://github.com/GTNewHorizons/GT5-Unofficial/blob/master/src/main/java/goodgenerator/blocks/tileEntity/base/MTELargeFusionComputer.java) and its five subclasses.

The supplied workbook's standard helium output ladder is 156.25, 312.5, 625,
10,000 and 40,000 L/s (some displayed cells round); compact output is 10,000,
40,000, 120,000, 2,560,000 and 12,800,000 L/s. Regression tests verify these
alongside their EU/t, eligibility boundaries, saved-plan loading and shared cards.

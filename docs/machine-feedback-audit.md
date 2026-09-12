# Machine feedback pass — September 2026

This is the player-report queue and resolution log. Completed here means the
specific reported defect was addressed, not that every mechanic is modeled.
Release 3.1.4 collects the changes since production commit `453d91c` (3.1.2).
The full release explanation is in [the 3.1.4 engineering changelog](releases/3.1.4.md).

| Order | Machine | Report | Resolution |
|---|---|---|---|
| 1 | Neutron Activator | Astralzx: height should be adjustable; tall builds are unrealistically slow. | Fixed in `7a7021b`, included in 3.1.4. Direct integer entry from 4 pipe casings with no structural maximum; game-source duration rounding and sub-tick throughput. Accelerator power and neutron kinetic energy regulation remain unmodeled. |
| 2 | Utupu-Tanuri | Lord Peverell, September 9: missing coil benefits and incorrect structure picture. | Included in 3.1.4. Vacuum Furnace now matches the existing Utupu-Tanuri definition; both modes receive coils, 2.2x speed, half EU, up to 4 power-limited parallels, heat discounts and perfect overclocks. Picker starts at recipe heat. Removed the incorrect render; the actual controller icon is used. |
| 3 | Chemical Plant, Boldarnator, Industrial Sledgehammer | Screenshot shows wrong structure images on all three cards. | Included in 3.1.4. Verified the wiki images and rotated the three existing PNGs to their correct names. Five other renders from the same import batch match the wiki. |
| 4 | Coke Oven / Industrial Coke Oven | [Issue #58](https://github.com/jackwrichards/gtnh-factory-flow/issues/58), reported against 3.0.0: missing oven, wrong art, doubled EV output. | Mixed findings; see below. Both maps are published, the art was already fixed, and the linked plan explicitly supplies 2A. A separate brick-oven legacy-voltage bug was reproduced and fixed for 3.1.4. |
| 5 | LFTR | [Issue #54](https://github.com/jackwrichards/gtnh-factory-flow/issues/54): Fuel 3 shows 1A LuV despite the correct EU/L. | Confirmed and fixed for 3.1.4: numeric fuel energy gives 524,288 EU/t (1A UV); fuels 1/2 stay unchanged and saved cards update on load. |
| 6 | Hyper-Intensity Laser Engraver | [Issue #50](https://github.com/jackwrichards/gtnh-factory-flow/issues/50): duplicate laser controls, missing amperages and voltage, unstable card size. | Confirmed control/math defects, fixed for 3.1.4: one selector for real voltage/amperage pairs; 65,536A yields up to 40 parallels; source voltage independently gates recipes and caps OCs. Local browser verifies stable dimensions. |
| 7 | Precise Auto-Assembler MT-3662 (PrAss) | Players report voltage-only controls and ineffective casing parallels. | Confirmed and fixed for 3.1.4. Both modes use curated multiblock power; normal mode gets 16–256 casing parallels and 2x speed, precise mode stays at one parallel and uses casing requirements. Separate machine casing limits working voltage. |
| 8 | Auto Workbench | [Issue #49](https://github.com/jackwrichards/gtnh-factory-flow/issues/49): resistor ingredients display dictionary names and split into unsatisfied duplicates on wiring. | Confirmed against the attached plan and current code; fixed for 3.1.4. Wires select all repeated slots in the input row, saved partial choices repair on load, and unwired dictionary inputs show concrete item names/icons. |
| 9 | Inspector machine list | Counts/power must follow individual cards, including fractional Solve/Pool counts. | Fixed for 3.1.4. Existing machine-name tree retained; each card has a separate child row even for identical recipes/settings. Build reads stored counts; Solve/Pool read solved counts and scale each card's power accordingly. |

## Machine list verification — September 11

The old list combined cards with the same machine label and power configuration,
read their stored counts in every mode, and clamped solved utilization to one.
That lost both fractional requirements and requirements above the stored count.
It also multiplied physical machine counts by the legacy parallel setting.

`buildMachineList` now computes one entry per card. Presentation retains the
original machine-name headers and indented count/tier/power rows, with no item
names or recipe subtitles. Clicking a child row focuses only its card;
checklist actions on a child likewise affect only that card. Shared-recipe
cards stay together, with their section requirements summed for the count and
their own time-weighted average draw. Generator and steam figures follow the
same count rule. Crop cards retain their harvester count rather than seed count.

Local browser test: three real Wiremill cards, two with the identical Fine
Copper Wire recipe, stay separate. Build reports counts 2/3/4 and 8/12/16 EU/t,
total 9 machines and 36 EU/t. Solve and Pool both report pinned requirements
0.125/6.25/101.375 and 0.5/25/405.5 EU/t, total 107.75 machines and 431 EU/t.
Counts are never rounded up to whole machines. Tests cover real solves in both
modes, zero demand, shared recipes, parallel processing, steam/generation,
fraction formatting, and per-card focus/checklist behavior.

## Auto Workbench resistor verification — September 11

The [reporter's public plan](https://github.com/user-attachments/files/31819006/passive-lv-circuits.json)
contains crafting recipe `6a7ad9655f8f9abe` with seven slots: two Sticky Resin,
two Fine Copper Wire, two 1x Copper Wire, and one Charcoal Dust per Resistor.
The card groups these into four rows. Its saved Fine Copper Wire edge selected
slot 1 alone; slot 6 remained `oredict:wireFineCopper`, creating a fifth row
and a separate solver demand. This is planner wiring/display logic, not a
machine coefficient or game recipe discrepancy.

`edge-input-overrides.ts` now chooses every repeated slot in the addressed
resource row, retaining each quantity and NEI position. Both indexed legacy
handles and current row handles get the same treatment. Existing separate
variant choices, non-consumed slots, shared-machine sections, generator fuel
slots and cross-form wires remain scoped appropriately. The load funnel reuses
this rule to repair saved partial selections without modifying recipe data.
Wires also move from the vanished dictionary handle to the concrete row's
handle, so React Flow can continue drawing them after the repair.
The rail display uses the dictionary's first concrete alternative for its
name/icon while retaining its matching identity and alternatives.

The regression fixture preserves the reported recipe's real input layout.
Tests cover fresh wiring, the saved partial choice, reload stability, concrete
names/icons, separate variants, and shared sections with unequal slot amounts.
The solver check requires positive transfer from the Wiremill and exactly two
Fine Copper Wire per Resistor, with no hidden source for a leftover dictionary
demand. This fix does not require a dataset rebuild.
Local browser verification imported unwired and saved-wired copies of the real
recipe: both render four named/icon-bearing inputs, the repaired Fine Copper
Wire row is connected, and its wire survives a fresh page load.

## PrAss verification — September 11

Verified against local GT5-Unofficial `8e23867`,
[MTEPreciseAssembler.java](https://github.com/GTNewHorizons/GT5-Unofficial/blob/8e23867/src/main/java/goodgenerator/blocks/tileEntity/MTEPreciseAssembler.java).
The structure accepts `ExoticEnergy.or(Energy)` and advertises all energy
hatch types. It supplies `getMachineVoltageLimit()` times the working amps,
allows amperage overclocks and sets zero input tier skips. A single regular
hatch is clamped to 1A; exotic hatches retain their amperage.

Two defects explained the report: neither mode had a curated definition,
which hid hatch controls, and exported generic runtime ladders never modeled
the chosen casing parallels. The dedicated Precise Assembler map also
carried the **normal-mode** casing ladder despite running only one parallel.

- Normal `Precise Auto-Assembler MT-3662` handler: unit casings Imprecise,
  Mk-I, Mk-II, Mk-III, Mk-IV give 16, 32, 64, 128, 256 parallels and 2x speed.
  These are capacity limits; working energy pays for parallels before OCs.
  Baked handler speed is ignored so the bonus is applied once.
- Dedicated `Precise Assembler` map: 1 parallel, base speed and EU, normal
  overclocks. The unit-casing picker begins at the recipe's special-value
  requirement. Upgrading that casing does not increase throughput.
- Both expose the existing volts/amps power controls. Multi-amp and laser
  hatches are modeled by their supplied voltage and working amperage; this
  is not a HILE-style separate laser source.
- A separate **Machine casing** control limits working voltage to its tier
  below UHV; UHV removes this cap. The cap applies before multiplying by amps,
  and recipes above the capped voltage stall even with excess amperage.
  The default is UHV to preserve the previous assumption of sufficient casings.
  EV+ glass remains a construction requirement, not another performance knob.
- The normal handler's exported UHV unlock is the controller's crafting tier,
  not a required hatch voltage. Its working recipe tier now comes from the
  base recipe, so low-tier recipes can use low-tier energy hatches.
- Browser check used real local Ameliorated Superconducting Coil and Potion
  Flask recipes: both cards show amps, unit casing and machine casing;
  normal Mk-I to Mk-II changes the displayed parallel capacity from 32 to 64;
  precise-mode amps accept 1,024A. The user's original design was restored.
- Regression tests cover both modes, all five normal casing levels, precise
  recipe requirements, energy-limited parallels, multi-amp OCs, voltage caps,
  legacy migration, normal-handler switching and solver stall/resume.

## Issue #50 verification — September 11

Checked the actual `MTEIndustrialLaserEngraver.java` and TecTech
`MachineLoader.java` in local GT5-Unofficial revision `8e23867`, plus the
wiki contents supplied in the report. The web fetch was blocked; no claim
is made that the current remote wiki page was independently read.

- The curated table added the impossible cube-number `laserAmperage` list
  alongside the exporter's real-amperage `laserSource` list; only the former
  controlled the curated calculation. It also allowed unlimited normal OCs.
- The replacement is one searchable **Laser source** selector with all 46
  registered hatch combinations, including the Legendary source. IV has only
  256A; each higher tier unlocks the next four-times-larger hatch. 65,536A
  begins at UHV. Legendary is **UXV**, 536,870,912A, not a MAX-tier source.
- Source amperage gives `floor(cbrt(amps))` structural parallels, from 6
  through 812. 65,536A gives 40. Actual parallels are still limited by the
  separate energy supply; the laser source supplies no operating EU.
- Source tier + 1 gates raw recipe EU/t and caps normal overclocks relative
  to the raw recipe tier. The source's 3.5x speed and 0.8x EU remain intact.
  A source-tier failure now stalls the solver and names the laser source
  in the warning rather than suggesting more energy hatch amps.
- Glass is assumed to meet the selected source tier; that construction
  requirement appears in the source tooltip. The UEV+ source permission for
  one multi-amp energy hatch is also explained, but the general power budget
  controls do not validate a player's exact physical hatch arrangement.
- Old `a65536` selections become `uhv-65536`. The named legacy source wins
  over the conflicting dummy count; if no source was saved, use the count
  and round up to a real hatch. Old plans recorded no source voltage, so the
  lowest registered tier for the amperage is the migration default. Players
  with a higher-tier source should select it to restore their extra OC cap.
- UI checked using the real Shimmerrock recipe from local dataset shard 532:
  one source selector, UHV / 65,536A / 40 parallels, searchable with `65536`
  or commas. Switching to Legendary kept the rendered card at
  444.59 x 257.41 CSS pixels; its IV/1A energy supply limited it to 85 usable
  parallels. Source help distinguishes the 812 structural cap.
- Tests cover all amperage levels, legal hatch combinations, energy-limited
  parallels, independent OC caps, old selections, handler switching and
  solver stall/resume when the recipe exceeds the source tier.

Source references:
[HILE controller](https://github.com/GTNewHorizons/GT5-Unofficial/blob/8e23867/src/main/java/gregtech/common/tileentities/machines/multi/MTEIndustrialLaserEngraver.java),
[hatch registrations](https://github.com/GTNewHorizons/GT5-Unofficial/blob/8e23867/src/main/java/tectech/loader/thing/MachineLoader.java).

## Issue #54 verification — September 11

**Confirmed and fixed for 3.1.4:** LFTR Fuel 3 generated 32,768 EU/t (1A LuV)
instead of 524,288 EU/t (1A UV). The fuel table already contained the correct
10,485,760 EU/L. The calculation parsed `Net Amps (LuV)` with `[A-Z]+`, missed
the lowercase `u`, and silently fell back to EV. Fuels 1 and 2 matched and
were correct. This is a calculation bug independent of browser or dataset.

The model now derives EU/t from the numeric EU/L at the reactor's fixed
1 L/s consumption, divided by 20 ticks/s. This agrees with local game source
revision `8e23867`: [RecipeLoaderLFTR.java](https://github.com/GTNewHorizons/GT5-Unofficial/blob/8e23867/src/main/java/gtPlusPlus/xmod/gregtech/loaders/recipe/RecipeLoaderLFTR.java)
sets fuel output metadata to 8,192 / 32,768 / 131,072, and
[MTENuclearReactor.java](https://github.com/GTNewHorizons/GT5-Unofficial/blob/8e23867/src/main/java/gtPlusPlus/xmod/gregtech/common/tileentities/machines/multi/production/MTENuclearReactor.java)
multiplies that by four without overclocking. All three recipes consume
100 L fuel and 200 L carrier salt over 100 seconds.

| Fuel | EU/L | Correct EU/t | Equivalent output |
|---|---:|---:|---|
| 1 | 655,360 | 32,768 | 1A LuV |
| 2 | 2,621,440 | 131,072 | 1A ZPM |
| 3 | 10,485,760 | 524,288 | 1A UV |

Regression tests reproduce the Fuel 3 failure before the fix, verify all
three fuels and their solver-facing EU output ports, and check that existing
saved Fuel 3 cards are corrected by the normal load-time recipe rebuild.
The issue's picture fix was already completed; no artwork changed here.
Recorded from [issue #54](https://github.com/jackwrichards/gtnh-factory-flow/issues/54).

## Issue #58 verification — September 11

Checked the live 3.1.2 site's published 2.9.0-beta-2 recipe index and recipe
API, the [linked Benzene plan](https://gtnhplanner.com/?plan=4a49bd06-a91a-441f-950f-ac4e37b04dfd),
and local GT5-Unofficial source revision `8e23867`.

| Claim | Finding |
|---|---|
| Coke Oven disappears after replacement | The original pre-replacement plan is not supplied, so the historical click path cannot be reconstructed. The old industrial map was also named Coke Oven; `06190f5` renamed `gtpp.recipe.cokeoven` to Industrial Coke Oven on August 23. The shared plan uses that industrial map. The brick oven is a separate recipe family and cannot substitute for a Wood Tar recipe. |
| Coke Oven completely removed | Not true of the current published dataset: 8 Coke Oven recipes and 63 Industrial Coke Oven recipes. A live charcoal search returns two brick-oven recipes, including logs to 1 charcoal + 250 L creosote in 1800 ticks at 0 EU. A Wood Tar search correctly omits the brick oven. |
| Wrong Industrial Coke Oven image | Valid historical report, already fixed in `c1a07ee` on September 9, after the issue was opened. The Industrial Coke Oven and electrolyzer structure files had been swapped. The current image matches the wiki's `ICO2.png`; no new swap is needed. |
| One EV hatch becomes 2A and doubles production | The game does clamp one regular hatch to 1A, and the current planner preserves that through migration. However, the supplied plan stores `powerEuT: 4096`, `overclockTier: EV`, and `energyHatches: 2`. The explicit budget takes precedence and correctly migrates to 2A at EV. The saved snapshot does not establish how that budget was originally introduced; do not overwrite explicit budgets globally. |

For the reported recipe (`gtpp.recipe.cokeoven:6661ae242651d73a`), the
exported base is 512 ticks at 60 EU/t, with 16 logs producing 20 charcoal and
1500 L Wood Tar. The plan uses Kanthal coils and the default one-slice,
heat-resistant casing (16 parallels). At full supply and with outputs accepted:

| Working supply | Operation time | Charcoal/s | Wood Tar L/s | Running draw EU/t |
|---|---:|---:|---:|---:|
| 1A EV = 2048 EU/t | 512 ticks | 12.5 | 937.5 | 921.984 |
| Saved 2A EV = 4096 EU/t | 256 ticks | 25 | 1875 | 3687.936 |

These are per-machine capacity figures, not a guarantee that the complete
Benzene plan has enough inputs and downstream capacity. Two amps buy one normal
overclock after paying for the 16 parallels. To model the reporter's stated
single regular EV hatch, the card should be EV / 1A (2048 EU/t).

Source: `MTEIndustrialCokeOven.createProcessingLogic` uses the 0.98-per-coil-tier
EU modifier and its structural parallel count. Inherited
`MTEMultiBlockBase.setProcessingLogicPower` clamps a lone regular hatch to 1A.
The current source model reproduces both rows above; no change to industrial
hatch math was needed.

**Additional reproduced bug:** the legacy `Coke Oven` alias let an unpowered
brick oven inherit industrial overclocks when an old node still carried a
voltage tier. An 1800-tick brick recipe became 225 ticks with a leftover EV
setting. `MTECokeOven` instead assigns `mMaxProgresstime = recipe.mDuration`.
The table now uses the existing slices-control distinction for overclocking
as well as parallels: industrial ovens retain normal overclocks; brick ovens
get none. Covered alongside the issue's industrial cases in
`src/lib/machines/industrial-coke-oven.test.ts`, included in 3.1.4.

## Structure image audit — September 11

The three reported images were misnamed when added in `1d86caf` (September 6).
The card-to-file mapping was correct; the PNG contents were under the wrong
filenames. Reassigned the existing bytes without re-rendering or downloading
new artwork. The table below records visual checks against the wiki's actual
full-size images, not just the page titles.

| Machine / local filename | Wiki reference | Finding |
|---|---|---|
| Chemical Plant / `chemical-plant.png` | [ExxonMobil Chemical Plant](https://wiki.gtnewhorizons.com/wiki/ExxonMobil_Chemical_Plant), `ChemPlant.png` | Orange casing, grey internal machinery and coils. Was stored as `industrial-sledgehammer.png`; corrected. |
| Boldarnator / `boldarnator.png` | [Boldarnator](https://wiki.gtnewhorizons.com/wiki/Boldarnator), `Boldarnator2.png` | Red/black structure with water and lava columns. Was stored as `chemical-plant.png`; corrected. |
| Industrial Sledgehammer / `industrial-sledgehammer.png` | [Industrial Sledgehammer](https://wiki.gtnewhorizons.com/wiki/Industrial_Sledgehammer), `IndustrialSledgeHammer2.png` | Tall black frame with purple central hammer section. Was stored as `boldarnator.png`; corrected. |
| Coke Oven / `coke-oven.png` | [Coke Oven](https://wiki.gtnewhorizons.com/wiki/Coke_Oven), `CokeOven2.png` | Matches: brown brick cube and dark front opening. |
| Dissolution Tank / `dissolution-tank.png` | [Dissolution Tank](https://wiki.gtnewhorizons.com/wiki/Dissolution_Tank), `Dissolution Tank.png` | Matches: light-blue casing, glass tank and two legs. |
| Industrial Coke Oven / `industrial-coke-oven.png` | [Industrial Coke Oven](https://wiki.gtnewhorizons.com/wiki/Industrial_Coke_Oven), `ICO2.png` | Matches: long light-blue structure with repeated framed vertical sections. |
| Multiblock Electrolyzer / `multiblock-electrolyzer.png` | [Industrial Electrolyzer](https://wiki.gtnewhorizons.com/wiki/Industrial_Electrolyzer), `IndustrialElectrolyzer2.png` | Matches: brown casing, framed pillars and vertical vents. |
| Pyrolyse Oven / `pyrolyse-oven.png` | [Pyrolyse Oven](https://wiki.gtnewhorizons.com/wiki/Pyrolyse_Oven), `PyrolyseOven2.png` | Matches: silver box, upper coils and two tall vents. |

The ninth render in that batch was `vacuum-furnace.png`, already removed in
the Utupu-Tanuri fix above. This checks that batch, not every processing or
generator render shipped by the app.

## Utupu-Tanuri evidence

- Game source: `GT5-Unofficial` local revision `8e23867`,
  [MTEIndustrialDehydrator.java](https://github.com/GTNewHorizons/GT5-Unofficial/blob/8e23867/src/main/java/gtPlusPlus/xmod/gregtech/common/tileentities/machines/multi/processing/MTEIndustrialDehydrator.java).
  `getAvailableRecipeMaps` lists both maps. `validateRecipe` requires coil heat
  at least equal to recipe special value. Shared processing logic uses 1/2.2
  duration, 0.5 EU, 4 parallels, heat discount and heat overclocks with raw coil
  heat (no voltage heat bonus).
- The [player-supplied wiki page](https://wiki.gtnewhorizons.com/wiki/Utupu-Tanuri)
  agrees: 5% multiplicative EU discount per 900 K excess and one perfect OC per
  1800 K excess. Dehydration starts from zero K; vacuum recipes do not.
- Local 2.9.0-beta-2 export: 88 Multiblock Dehydrator recipes and 17 Vacuum
  Furnace recipes, all without explicit handler lists. The screenshot's
  sulfur/antimony/poor nether waste recipe is
  `gtpp.recipe.vacfurnace:a068a7261b3d65c2`: 1200 ticks, 30720 EU/t, 7200 K.
  Vacuum Furnace previously had no curated match, so its exported runtime
  calculation bypassed the machine's modifiers and coils.
- At UV with four parallels, that recipe is 272 ticks with Naquadah coils;
  Trinium supplies 1801 K excess, two heat discounts and one perfect OC,
  reducing it to 136 ticks. LuV power only supports two simultaneous parallels.
- Tests: `src/lib/machines/utupu-tanuri.test.ts` covers both modes, heat minima,
  old/default coil selections, runtime bypass and the singleblock boundary.
  Structure-art tests prevent the incorrect render from returning.

## EBF quantity override verification — September 11

The two supplied aluminium plans have identical recipe bodies and machine settings.
The first stores an alumina input override of 5 on a recipe requiring 10; the
second stores 10 after the intermediate drawer is removed. Carbon remains 3,
aluminium output 4 and carbon dioxide output 3,000 L per batch. The old
connection helper accepted the feeder resource amount as the receiving input
amount. The grouped-input repair in `ebbdfc4` removes that shortcut and always
uses the receiving slot and its supported alternative ratio.

A local probe ran both supplied JSON files through `normalizeLoadedProject`
and the actual throughput solver. Both repair to 10 alumina, with alumina
consumption exactly 2.5 times aluminium production. A separate buffer-insertion
probe passed a 2,000 L resource batch into `insertStorageOnEdge` for a recipe
requiring 1,000 L oxygen per dust. Inserting the buffer retained the 1,000:1
ratio and positive ingot production. The oxygen screenshots establish the
reported doubling; the synthetic probe verifies the corresponding mutation
path without claiming to have the original oxygen plan.

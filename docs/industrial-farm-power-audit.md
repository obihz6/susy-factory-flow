# Industrial Farm power and upgrade audit

## Decision: retain requirement-driven planning

The user chose to restore the original Industrial Farm model: **seed-bed tier in the top-right, upgrades and target overclocks in the configuration, calculated consumption in the existing Power section**. No separate amp/hatch selector or duplicate power badge is needed.

Selected overclocks express the desired operating point, not a count of installed upgrade blocks. The planner calculates the power required to achieve it; the player supplies sufficient power in game. This is a valid inverse of the game's supply-derived calculation. Seed-bed tier alone does not determine consumption: upgrades and target overclocks matter too.

The source findings below remain useful. The supply-driven redesign in sections 5–8 is an **archived, rejected proposal**, not an implementation requirement. Existing accounting limitations are recorded for future work; this rollback does not claim to fix them. Do not reintroduce supply controls or migrate existing target-overclock settings on the basis of that proposal.

## Source baseline and confidence

The local exporter instance contains `cropsnh-2.0.91.jar` and `gregtech-5.09.54.20.jar` under the GT New Horizons 2.9.0-beta-2 installation. This audit uses the corresponding public tags, pinned to immutable commits:

| Component | Installed version | Pinned revision |
| --- | --- | --- |
| CropsNH | 2.0.91 | `e5c8767dc2a334b53d2c466cd4f6627ec1b8e314` |
| GregTech | 5.09.54.20 | `6e32345058a2f5b97b1d7b92db268cd2e3ebab82` |

Current CropsNH source at `72fa337a870fee5fb2235702298a857e2a238fcb` and GregTech at `7e0aed27dc366f3438a614d3fa8de18e7749baf1` were also examined. The relevant farm rules remain the same. Later source extracts the seed-bed base-power expression into `BlockSeedBed.getBaseEUt`; the installed version reads `GTValues.VP[upgradeTier]` directly. Later changes to laser overclock calculation do not affect this farm, which rejects laser hatches.

This is a source audit and an executable test of the actual GregTech calculator. It is not a Minecraft world test. Construction-error handling, fluid-buffer effects, maintenance losses, output blocking, and long-run averages are distinguished below rather than claimed to have been exercised in a running world.

## 1. Structure, tiers, and slots

The farm has fixed front/back sections and one or more middle slices. Each middle slice has exactly one upgrade position (`U`) and seed-bed positions (`s`). An unused upgrade position can be a wooden frame. The common tier of the seed beds and installed upgrade blocks determines the required number of middle slices:

`upgrade slots = middle slices = seed-bed tier ordinal − 1`

MV is ordinal 2, so the farm starts with one slot. The upper bound is UXV: twelve slots. This is a structural requirement, not a resource purchased by supplying more power. Installed upgrades must match the seed-bed tier. Glass is a separate structural tier and does not create upgrade slots. [1][2]

| Seed bed | Capacity per farm | Middle slices / upgrade slots | Full structure length |
| --- | ---: | ---: | ---: |
| MV | 225 | 1 | 3 |
| HV | 361 | 2 | 4 |
| EV | 529 | 3 | 5 |
| IV | 729 | 4 | 6 |
| LuV | 961 | 5 | 7 |
| ZPM | 1,225 | 6 | 8 |
| UV | 1,521 | 7 | 9 |
| UHV | 1,849 | 8 | 10 |
| UEV | 2,209 | 9 | 11 |
| UIV | 2,601 | 10 | 12 |
| UMV | 3,025 | 11 | 13 |
| UXV | 3,481 | 12 | 14 |

Capacity follows `(4 × tier ordinal + 7)²`. The crop itself can require a minimum seed-bed tier; enough electric power does not satisfy that seed requirement. [2]

### Upgrade effects and restrictions

All installed units compete for the same structural slots. The overclocked unit occupies **one slot even when it produces zero overclocks**, and still occupies only one slot when it produces many. The current model cannot represent the installed-but-zero-overclocks state because it uses `overclocks > 0` as the installation flag. [1][3]

| Upgrade | Maximum installed | Production effect | Addition to base running power |
| --- | ---: | --- | ---: |
| Growth Acceleration | Available slots | Adds +1 to the growth multiplier per unit | +125% per unit |
| Fertilization | 1 | Multiplies growth by 1.5; adds 0.5 to harvest-round bonus | +50% |
| Advanced Harvesting | 2 | Multiplies harvest rounds by `1 + 0.2 × count` | +50% per unit |
| Environmental Enhancement | 2 | Adds biome-card slots; actual benefit depends on liked biome tags | +50% per unit |
| Overclocked Growth Acceleration | 1; ZPM+ | Enables supply-derived overclocks | No separate flat addition |

Regular Growth Acceleration and Overclocked Growth Acceleration units cannot coexist. Installing one family must remove or refuse the other; the UI must communicate that consequence. Environmental cards are not an unconditional production multiplier. Their value comes through the crop’s nutrient calculation. [1][3]

**Existing behavior worth retaining:** capacity, tier-dependent slots, tier matching, unit caps, and the general upgrade cost coefficients are already represented. The main correction is separating installed hardware from derived overclocks.

## 2. What “supplied power” means

The farm passes `getMaxInputEu()` to GregTech’s OverclockCalculator. Its inherited implementation calls `ExoticEnergyInputHelper.getTotalEuMulti`, which sums **input voltage × working amperage for every connected energy hatch**. A regular energy hatch exposes two input amps in this version. There is no special one-hatch-as-one-amp exception in this farm’s source path. [4][5]

For an abstract, single-tier planner input:

`available EU/t = selected voltage × supplied working amps`

Changing that number must affect sustainable operation. With the overclocked unit installed, it also changes production thresholds. The game derives this budget from installed hatches; it does not dynamically throttle its selected overclock level to a weak external generator. If the installed hatches permit a higher overclock than the network can sustain, buffers eventually drain and the machine shuts down. “Connected capacity” and “generator/network delivery” must therefore not be silently conflated.

### Hatch and glass constraints

The source permits ordinary energy hatches. With the overclocked unit installed, it additionally permits **one multi-amp energy hatch**, which cannot be mixed with ordinary energy hatches. Multi-amp hatches are rejected without that unit. Laser hatches are rejected in either case. Glass must be at least MV; below UMV glass, hatch tier cannot exceed glass tier. UMV glass removes that hatch-tier ceiling. These are construction rules, not overclock multipliers. [1]

The structure has thirteen front/back hatch-capable positions before mandatory maintenance/input/output hardware occupies some of them. A scalar amp budget cannot prove that every requested supply has a realizable arrangement of ordinary hatches. A fractional hatch equivalent is useful arithmetic, but must not be presented as a validated bill of materials.

**UI recommendation:** keep the requested two-control interface. Treat it explicitly as a capacity abstraction and label hatch counts as equivalents. Do not resurrect the rejected hatch-family picker. If construction validation is added, derive and show the required arrangement/conditions in information text; until then, do not claim that an arbitrary number of amps validates glass, hatch count, or hatch family. The zero-power and overclock calculations remain meaningful with this abstraction.

The farm does not invoke the ordinary recipe minimum-voltage/tier-skip check in this path. A low-voltage combination with enough total working power must not be rejected merely because its hatch tier is below the seed-bed tier. Glass limits and total sustainable power are the relevant checks.

Raw EU/t mode uses the exact budget and assumes compatible voltage/hardware, consistent with the established planner interaction. It must still enforce the required total power. It must not assume an ULV hatch or bypass seed-bed minimums.

## 3. Base draw, overclock steps, and production

Let `B` be seed-bed base power, `G` regular growth units, `F` fertilizer units, `H` harvesting units, and `E` environmental units. With ordinary values in the supported tier range:

`P₀ = B × (1 + 1.25G + 0.5F + 0.5H + 0.5E)`

The source uses integer additions for each unit family. `B` is the GT practical voltage value, 30/32 of nominal voltage for these seed-bed tiers. Examples: MV 120 EU/t, IV 7,680 EU/t, ZPM 122,880 EU/t. The cost belongs to a whole farm, not to each planted seed. [1]

Without the overclocked unit, performed overclocks are zero regardless of surplus capacity. Supply below `P₀` cannot sustain the farm; supply above it does not increase production.

With the overclocked unit, the farm invokes the calculator using `P₀`, total input capacity, and `Integer.MAX_VALUE` as the dummy duration. For this call and the supported farm power range, the resulting count is the largest nonnegative `n` satisfying:

`P₀ × 4ⁿ ≤ supplied EU/t`

The calculator still returns base consumption at insufficient supply; sustainable-operation gating is a separate concern. The farm copies the returned overclock count into its production and fluid multipliers. It does **not** use the calculator’s shortened duration as its real cycle length. The actual farming cycle is fixed at 100 ticks, or five seconds. [1][6]

- Running draw: `P₀ × 4ⁿ` EU/t.
- Growth multiplier: `(1 + G) × (1 + 0.5F) × 2ⁿ`.
- Harvest-round multiplier: `(1 + 0.2 × seed-bed ordinal + 0.5F) × (1 + 0.2H)`.
- Water/fertilizer potency per cycle grows by `2ⁿ`.
- Seed capacity and upgrade-slot count do not change with input power.

There is no explicit six-overclock limit in this farm call. The current slider’s cap of six is a planner invention, not a source-derived mechanic. Valid hatch power and numeric limits bound the attainable count. [1][6]

### Worked power cases

| Configuration | Supply | Derived OCs | Running draw | Growth multiplier |
| --- | ---: | ---: | ---: | ---: |
| MV, no upgrades | 1 A MV = 128 EU/t | 0 | 120 EU/t | 1× |
| MV, one regular growth unit | 2 A MV = 256 EU/t | 0 | Needs 270 EU/t; cannot sustain | — |
| Same MV configuration | 3 A MV = 384 EU/t | 0 | 270 EU/t | 2× |
| ZPM, OC unit, no other units | 1 A UV = 524,288 EU/t | 1 | 491,520 EU/t | 2× |
| Same ZPM configuration | 3.75 A UV = 1,966,080 EU/t | 2 | 1,966,080 EU/t | 4× |
| Same ZPM configuration | 4 A UV = 2,097,152 EU/t | 2 | 1,966,080 EU/t | 4× |
| ZPM, OC unit + fertilizer unit | 4 A UV = 2,097,152 EU/t | 1 | 737,280 EU/t | 3× |

These are capacity examples, not discrete hatch layouts. The last case is particularly important: adding an upgrade increases base power and can remove an affordable overclock. Fertilizer also changes drop rounds, so the UI must recompute the whole result rather than assume every installed upgrade increases output. In this particular ZPM comparison, the combined growth-and-round factor changes from `4 × 2.4 = 9.6` to `3 × 2.9 = 8.7`.

### Executable boundary check

The unmodified OverclockCalculator from GregTech 5.09.54.20 was compiled and executed with its original arithmetic helper implementations extracted from GTUtility. Minimal annotation/GTRecipe stubs satisfied unused compile dependencies; the farm’s calculator call path was unchanged.

The matrix tested twelve seed-bed tiers, seven base-power multipliers, nine overclock thresholds, and five supply probes per threshold: zero, base minus one, threshold minus one, threshold, and threshold plus one. **3,780 cases matched** the affordable-fourfold-step formula and consumption result, including exact threshold equality. This establishes the calculator behavior; it does not substitute for testing fluid consumption or machine construction in-world.

The reproducible harness is `tools/audits/industrial-farm-power-oracle.py`. With a local GregTech checkout containing the pinned revision and JDK 17+ installed:

```powershell
py tools/audits/industrial-farm-power-oracle.py --gregtech .industrial-farm-audit/GT5-Unofficial
```

It extracts the pinned calculator and required original arithmetic helpers, compiles the harness, writes the CSV results and JSON summary, and fails on any mismatch. It does not download sources or edit the application.

## 4. Water, fertilizer, and full-farm costs

Fluid use is part of the power audit because overclocks change it. The game computes base potency per cycle as:

`Q₀ = ceil(seed capacity × 100 / 256)`

At `n` overclocks, required potency becomes `ceil(Q₀ × 2ⁿ)`. The implementation must also respect the game’s safe-integer saturation at extreme demands. The rounding order matters: round the base cycle requirement before multiplying for overclocks. Ordinary water has potency 1 and distilled water potency 2. Ordinary fertilizer has potency 1; enriched fertilizer has potency 10 when used as ordinary fertilizer. With a Fertilization Unit installed, enriched fertilizer becomes mandatory and is counted at potency 1. [1][7]

At ZPM, capacity is 1,225, so base demand is 479 potency per five-second cycle. Two overclocks require 1,916 potency per cycle: 383.2 L/s ordinary water, or 191.6 L/s distilled water. The farm pays this for its full capacity even when only some seed spaces are occupied. A partial last farm is not a fraction of a farm’s power or fluid cost.

Lack of required water prevents farming. Ordinary fertilizer is optional; absence removes its nutrient benefit. A Fertilization Unit makes enriched fertilizer mandatory. Merely setting a “Fed” option without supplying a modeled input does not prove that the configured farm is sustainable.

The current crop recipe has no such dynamic input ports. A full implementation must either introduce these inputs with correct per-farm scaling and matching, or explicitly identify them as assumed external supplies. It must not claim complete resource accounting while silently omitting them. For the intended full audit/rebuild, modeling the inputs is the stronger design.

## 5. Archived comparison for the rejected supply-driven proposal

| Area | Current implementation | Required correction |
| --- | --- | --- |
| Installation vs OCs | `cropIfOverclocks` stores 0–6 and doubles as unit presence | Store unit installation independently; derive count from supply |
| Installed unit at 0 OCs | Cannot be represented | Consumes one slot, excludes regular growth units, even with low supply |
| Supply | No effective farm amp/voltage budget | Same capacity controls as electric multiblocks |
| Low power | Crops excluded from `hasPowerReport` | Report unsustainable power and zero sustainable production, while preserving ports |
| Growth | Reads manually selected overclocks | Reads the single derived farm performance result |
| Power accounting | Crop recipe EU/t stays zero in the solver; card and machine list calculate special power separately | One farm result feeds solver totals, card, ledger, and tooltip |
| Solve/Pool counts | Card computes solved seed count; machine-list crop path still starts from stored seed count | Use calculated seeds and round to whole farms consistently |
| Fluids | No dynamic water/fertilizer requirements | Model per-cycle, per-farm consumption and upgrade-dependent fertilizer rules |
| Slot changes | Normalizer silently degrades units by priority | Preserve predictable edits and disclose any removal when tier/upgrade changes invalidate hardware |
| Tooltip | Standalone required-EU/t badge and unconditional “extra supply does not increase growth” | Replace with supply controls and conditional, calculated performance story |
| Compatibility | Old saves encode target OCs | Migrate to installed unit plus a capacity preserving the old intended rate where possible |

Relevant implementation sites are `passive-production.ts`, `machine-effects.ts`, `overclock.ts`, `power-report.ts`, `throughput.ts`, `RecipeNode.tsx`, `CropPowerReadout.tsx`, and `MachineShoppingList.tsx`. Merely wiring the new controls to stored hatch fields does not fix these disconnected calculations.

## 6. Rejected proposal: model and solver contract

Create one farm performance calculation with explicit hardware, supply, and crop inputs. It should return normalized hardware, seed capacity, slot usage, base draw, available supply, computed overclocks, growth/output multipliers, fixed cycle duration, per-farm fluid requirements, sustained-operation state, and next power threshold. These are derived facts, not separately editable state.

Retain the existing crop growth and drop formulas that agree with source. Pass the resolved farm setup into them instead of letting each caller independently reconstruct manual overclocks. Keep crop count as planted seeds if preserving the current board contract, but carry **physical farm count separately**. A generic `draw × machineCount` multiplication is wrong when machineCount means seeds.

The report should distinguish at least: disabled, insufficient power, missing required water, missing enriched fertilizer, valid/no OC unit, valid/OC enabled, and construction assumptions. Source behavior can transiently draw stored energy before shutting down; the planner should describe **sustainable operation**, not invent fractional slow running below the required draw.

Build uses installed/planted counts and its actual utilization for averages. Solve and Pool determine required seeds for the target, then physical farms by ceiling against capacity. Their tooltip uses calculated demand without percentages. Power and fluids must apply that whole-farm count consistently. Because whole-farm fixed costs are not linear in seed count, do not hide them inside a per-seed coefficient and expect rounding afterward to preserve resource feasibility. The implementation must explicitly handle that coupling or disclose an approximation.

### Save migration

For an old farm with manual OC count `n > 0`, install the OC unit, calculate base draw after the normalized other upgrades, and seed an explicit budget of `P₀ × 4ⁿ` when no intentionally supplied farm budget exists. This preserves the old intended growth/draw rather than translating “4 overclocks” into four installed blocks. Preserve zero-valued explicit supply as zero. Version the migration so repeated loads do not overwrite edits.

Old `n = 0` means absent unit unless a future installation field says otherwise. Default supply for a newly placed farm should be a sufficient, clearly shown starting capacity; turning upgrades on afterward may legitimately make it insufficient. Switching to Crop Manager must stop applying the farm’s supply math while retaining any remembered settings according to the existing handler-switch policy.

## 7. Rejected proposal: controls and tooltip design

The main card should have the same two supply controls as other electric multiblocks. Seed-bed tier belongs with farm hardware. The existing top-right seed-bed chip should not masquerade as hatch voltage once both values exist. Move that selector into the farm’s configuration area, or label it clearly if retaining it near the header. Replace the manual OC stepper with an installed/absent upgrade tile.

The hover should use the same tier badges, text sizes, above-card positioning, and compact comparison styling. It should not display fictitious recipe parallels, shortened cycle times, or “runs per second” derived from generic recipe overclocking.

```text
Power input                         [same supply conversion / raw EU/t]

Seed capacity     1,225 / farm       Cycle                    5 s
Overclocks                  2       Growth                    ×4
Base draw        122.88k EU/t        Running draw     1.966M EU/t

Next improvement                                   +11 A [UV]
Overclocks                     2  →  3
Production capacity doubles. Water/fertilizer demand doubles.
[ current threshold | supplied capacity | next threshold ]

Build: running draw × usage = average consumption
Solve/Pool: power demand for the calculated farm count
```

This example is a ZPM seed bed with the OC unit and 4 A UV supply. The next step is 15 A UV total, hence 11 additional amps. The visible production comparison should use actual item output for the selected crop; “doubles” is the simple no-other-change case. Seed capacity is a structural fact, not a power-funded parallel meter.

When the OC unit is absent, omit the next-OC ladder and use one concise explanation: **“Overclocking requires an Overclocked Growth Acceleration Unit.”** Show any power shortfall independently. When the unit is installed but zero steps are affordable, show `0 → 1` and the true threshold. An installed unit must not disappear because it is currently buying zero steps.

Build footer: **“Supply sets capacity. Average draw follows operating time.”** Solve/Pool footer: **“Demand is calculated for the required farms.”** Keep per-farm and whole-card quantities explicitly labeled. At a fixed Solve/Pool output target, more supply increases capacity and can reduce required seeds/farms; it does not necessarily increase the requested total output.

Hatch-equivalent text must be informational and accurate for the farm’s 2 A regular hatches. Raw mode omits hatch/tier interpretation and preserves exact EU/t. Glass/hatch-layout assumptions belong in a concise contextual note, not in a new required picker.

## 8. Rejected proposal: acceptance criteria

1. A base MV farm at 119 EU/t is unsustainable, at 120 EU/t sustainable, and at larger supply remains un-overclocked without the unit.
2. An MV growth unit changes base draw to 270 EU/t; 256 EU/t is insufficient.
3. An installed ZPM OC unit uses a slot even at zero OCs and cannot coexist with regular growth units.
4. Supply immediately below/at/above each verified threshold selects the correct OC and running draw. No artificial cap of six remains.
5. Adding fertilizer/environment/harvest units recomputes the threshold from the new base cost and can lower the OC count.
6. Every OC doubles production and fluid demand, quadruples EU/t, and leaves the five-second cycle unchanged.
7. A seed-bed tier change updates capacity and slot count independently of hatch voltage; invalid hardware changes are predictable and visible.
8. Raw and amps mode give identical results for identical total capacity under the same hardware assumptions; raw mode does not invent an ULV restriction.
9. Partially filled last farms pay whole-farm running power and fluids. Build, Solve, Pool, card, inspector, and solver totals agree.
10. Missing required fluids stop sustainable output; optional fertilizer absence changes growth rather than always stopping it.
11. Loading old manual-OC plans preserves their intended performance through a one-time migration. Undo, copy/paste, handler switching, export/import, and reload retain installation and supply separately.
12. UI checks cover absent/installed OC unit, zero supply, threshold crossings, high-tier values, several farms, and small viewports. No irrelevant parallel section, duplicate top EU/t badge, or obscured card remains.

## Sources

[1] GTNewHorizons, CropsNH 2.0.91, [MTEIndustrialFarm.java](https://github.com/GTNewHorizons/CropsNH/blob/e5c8767dc2a334b53d2c466cd4f6627ec1b8e314/src/main/java/com/gtnewhorizon/cropsnh/tileentity/multi/MTEIndustrialFarm.java#L467): structure validation, hatch restrictions, power calculation, fluid processing, growth, and fixed cycles.

[2] GTNewHorizons, CropsNH 2.0.91, [BlockSeedBed.java](https://github.com/GTNewHorizons/CropsNH/blob/e5c8767dc2a334b53d2c466cd4f6627ec1b8e314/src/main/java/com/gtnewhorizon/cropsnh/blocks/BlockSeedBed.java): capacity, structure length, fluid baseline, and harvest bonus.

[3] GTNewHorizons, CropsNH 2.0.91, [BlockOverclockedGrowthAccelerationUnit.java](https://github.com/GTNewHorizons/CropsNH/blob/e5c8767dc2a334b53d2c466cd4f6627ec1b8e314/src/main/java/com/gtnewhorizon/cropsnh/blocks/BlockOverclockedGrowthAccelerationUnit.java), [BlockGrowthAccelerationUnit.java](https://github.com/GTNewHorizons/CropsNH/blob/e5c8767dc2a334b53d2c466cd4f6627ec1b8e314/src/main/java/com/gtnewhorizon/cropsnh/blocks/BlockGrowthAccelerationUnit.java), [BlockFertilizerUnit.java](https://github.com/GTNewHorizons/CropsNH/blob/e5c8767dc2a334b53d2c466cd4f6627ec1b8e314/src/main/java/com/gtnewhorizon/cropsnh/blocks/BlockFertilizerUnit.java), [BlockAdvancedHarvestingUnit.java](https://github.com/GTNewHorizons/CropsNH/blob/e5c8767dc2a334b53d2c466cd4f6627ec1b8e314/src/main/java/com/gtnewhorizon/cropsnh/blocks/BlockAdvancedHarvestingUnit.java), and [BlockEnvironmentalEnhancementUnit.java](https://github.com/GTNewHorizons/CropsNH/blob/e5c8767dc2a334b53d2c466cd4f6627ec1b8e314/src/main/java/com/gtnewhorizon/cropsnh/blocks/BlockEnvironmentalEnhancementUnit.java): installation gates, counts, and coefficients.

[4] GTNewHorizons, GregTech 5.09.54.20, [MTEExtendedPowerMultiBlockBase.java](https://github.com/GTNewHorizons/GT5-Unofficial/blob/6e32345058a2f5b97b1d7b92db268cd2e3ebab82/src/main/java/gregtech/api/metatileentity/implementations/MTEExtendedPowerMultiBlockBase.java): aggregated input power and energy-buffer drain/shutdown path.

[5] GTNewHorizons, GregTech 5.09.54.20, [ExoticEnergyInputHelper.java](https://github.com/GTNewHorizons/GT5-Unofficial/blob/6e32345058a2f5b97b1d7b92db268cd2e3ebab82/src/main/java/gregtech/api/util/ExoticEnergyInputHelper.java) and [MTEHatchEnergy.java](https://github.com/GTNewHorizons/GT5-Unofficial/blob/6e32345058a2f5b97b1d7b92db268cd2e3ebab82/src/main/java/gregtech/api/metatileentity/implementations/MTEHatchEnergy.java): voltage × working amps and ordinary-hatch amperage.

[6] GTNewHorizons, GregTech 5.09.54.20, [OverclockCalculator.java](https://github.com/GTNewHorizons/GT5-Unofficial/blob/6e32345058a2f5b97b1d7b92db268cd2e3ebab82/src/main/java/gregtech/api/util/OverclockCalculator.java) and [GTUtility.java](https://github.com/GTNewHorizons/GT5-Unofficial/blob/6e32345058a2f5b97b1d7b92db268cd2e3ebab82/src/main/java/gregtech/api/util/GTUtility.java): actual calculator and integer threshold arithmetic.

[7] GTNewHorizons, CropsNH 2.0.91, [FertilizerLoader.java](https://github.com/GTNewHorizons/CropsNH/blob/e5c8767dc2a334b53d2c466cd4f6627ec1b8e314/src/main/java/com/gtnewhorizon/cropsnh/loaders/FertilizerLoader.java), plus [farm fluid consumption](https://github.com/GTNewHorizons/CropsNH/blob/e5c8767dc2a334b53d2c466cd4f6627ec1b8e314/src/main/java/com/gtnewhorizon/cropsnh/tileentity/multi/MTEIndustrialFarm.java#L1175): water/distilled-water/fertilizer potency and enriched-fertilizer exception.

[8] Local planner source at commit `8feef15`: `src/lib/model/passive-production.ts`, `src/lib/solver/overclock.ts`, `src/lib/solver/throughput.ts`, `src/components/flow/RecipeNode.tsx`, `src/components/flow/CropPowerReadout.tsx`, and `src/components/MachineShoppingList.tsx`. This implementation comparison is separate from the game-source findings.

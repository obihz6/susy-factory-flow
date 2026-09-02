# The Power Sector (PRD)

Power generation as a first-class part of the planner: every serious GTNH
power source as a placeable card with real settings, real wired inputs, and
an honest EU/t figure, summed in a generation summary beside the existing
power-draw summary. Revised 2026-08-30 after decoding the community power
spreadsheet; first draft's notes are folded in.

Status: Phase 1 is BUILT on the `power-sector` branch (2026-08-30, not
merged): the power lib lives in `src/lib/power/` (source catalog, workbook
data extracted by `tools/power-planner-extract.mjs`, fuel names resolved to
dataset resources by `tools/power-resource-map.mjs`, golden tests in
`power.test.ts`), the picker is `PowerSourceOverlay`, the summary is
`PowerMadePanel`, and each placed card owns a synthesized one-second recipe
(`power-recipe.ts`, the custom-rate pattern) so wiring, the books and
import/export need no special cases. Known gaps of the first pass: two
unidentified singleblock panels and one Large Engines block from the
workbook are left out; LCE/LRE side-flow units and the DEHP figure should
still be double-checked against game source. The math appendix is
`docs/power-planner-math.md`.

## What players are asking for

From Discord:

1. "Can I somehow calculate fuel spendings? Output here is wrong because I
   use benzene to produce more benzene." - generators must sit on the board
   eating fuel, so the plan's output is net of the power bill.
2. "How do I give power to a machine in the planner?" - there is no way to
   SUPPLY the EU/t the plan already counts.
3. "Is there a way to count the EU output of fuels in generators yet?" - the
   recipe book cannot say what a fuel is worth.

And Jack's direction (2026-08-30): power is more than fuel-to-EU recipes -
plenty of sources make power from little or nothing (solar, geothermal) and
carry their own settings. The community power spreadsheet is the math
everyone actually uses; integrate ITS logic, so a player places machines,
wires what they consume, tunes their settings, and reads the result.

## Sources of truth

1. **The GTNH Power Planner spreadsheet** ("Power Planner 2.9, Made by
   Fox") - THE reference for machine behaviour: settings, formulas,
   constants, data tables. Fully decoded in `docs/power-planner-math.md`;
   Jack's copy sits at `C:\Users\jack\Downloads\Copy of GTNH Power Planner
   2.9.xlsx`. Its data is EXTRACTED by script (rotor catalog, fuel tables,
   heat-exchanger table, its own computed sample cells as golden test
   values), never hand-typed.
2. **The game's own registries via the oracle export.** Finding from the
   first draft, still load-bearing: the raw oracle export ALREADY contains
   GT's eight fuel maps (~370 entries - Combustion, Extreme Diesel, Gas
   Turbine, Plasma, Semifluid Boiler, Large Boiler, Thermal, Magic
   Absorber - plus the singleblock Naquadah Reactor maps), each with real
   items, icons, catalysts, and the fuel value in `specialValue`. They are
   dropped only by two lines in `normalize-oracle-export.mjs`
   (`outputs.length === 0`; `eut = Math.max(0, ...)`). No new Minecraft
   export is needed. Fuel LISTS and icons come from here; the spreadsheet
   cross-checks the values.
3. **GT5U/GT++ source** (`C:\Users\jack\gtnh-sources`) - arbiter wherever
   the spreadsheet simplifies or a formula needs verifying, same discipline
   as `machine-table.ts`.

## What the spreadsheet taught us (design-shaping findings)

- **One turbine formula rules everything.** Steam, gas and plasma turbines,
  large and XL, share `EU = eff x fuelEU x flow x (1 - |flow-opt| /
  (opt x penalty))` with per-class caps and penalties, all driven by a
  166-material rotor catalog (efficiency, optimal flow, durability,
  overflow tier, x4 sizes, tight/loose). Implement it once; the rotor
  catalog is the single biggest data import.
- **Power is chains, not single machines.** The sheet's best builds are
  reactor -> heat exchanger -> SC turbine -> SH turbine -> steam turbine,
  with each stage's exhaust feeding the next 1:1. That is literally wired
  cards - the planner's native shape. Where the spreadsheet hardcodes each
  chain per sheet, we get chains for free from the board, and the solver
  already balances the intermediate fluids.
- **Settings are knobs, and we already have the knob system.** Rotor
  material/size/fitting, oxygen boost, pebble fill, reactor mark, coolant
  and booster choice, heliostat rings, throttle - every one is a
  `MachineConfigControl` on a card, the same UI as coil tiers today.
- **Some sources make power from (almost) nothing.** Solar Tower, DEHP,
  wind/water. The sheet models them as flat rate tables with settings and a
  parasitic draw. Cards with no consumed inputs are fine - crops and bees
  already work this way.
- **The sheet omits things we must not copy blindly**: IC2 reactor rod
  layouts (it uses four hot-coolant presets and ignores rod consumption
  entirely), day/night for solar (it prices the daytime rate), water intake
  in places. Where the omission would lie on a board (rod costs), note it on
  the card; where it is a sane simplification (constant solar), adopt it.

## Doctrine

1. **A generator is a card.** Placed like any machine, its consumed inputs
   are real wired resources (fuel, oxygen, lubricant, water, coolant loops,
   pebbles, salts), its settings are config controls, its EU/t is a stat on
   the card. Its consumption enters the books like any machine's - that
   alone nets the benzene loop.
2. **Generation and consumption stay UNCOUPLED in Phase 1.** The bottom
   right gains a generation summary beside the existing draw summary. No
   solver row, no throttling, no net verdict. Coupling (and, later, drawn
   power wires) are separate phases.
3. **Chains are wired, not baked.** Boiler cards make steam, turbine cards
   burn it, exchanger cards convert hot fluids, exhausts are real outputs.
   No card hides a downstream machine inside itself.
4. **Rates are nameplate**, full-speed at the chosen settings, like every
   card on the board.
5. **Additive, never breaking.** Plans without generators are untouched.
6. **Voltage tiers are reporting**, as today; the generation summary lists
   per-tier output but nothing enforces tier matching.

## Phase 1 - place them, wire them, sum them

### Placement and the recipe book

Every generator family becomes a recipe map in the dataset (real exported
fuel maps where they exist; synthesized maps for the rest - Solar Tower,
DEHP, boilers, exchangers, reactors), so the ONE recipe book places
everything: right-click benzene shows Gas Turbine and SOFC chips with
counts; searching "solar" finds the tower. Fuel cards render the fuel value
where a normal card shows outputs.

### The card

- Fuel/inputs: ordinary slots and ports, wired like any card. Cell-form
  fuel recipes return the empty cell (Cells Are Items); each gets a
  synthesized 1000 L fluid twin (the Tank precedent) since boards make
  fluid, not cells. Loop fluids are input AND output on the same card
  (coolant in / hot coolant out), which wires the loop naturally.
- Settings: `MachineConfigControl`s per family - rotor material (the big
  one: a searchable control, 166 materials, gated by unlock tier), rotor
  size, tight/loose, oxygen boost, pebble fill (a number knob), reactor
  design preset, coolant, booster, rings, mode (DEHP), mark (fusion).
- Output: a PRODUCES power section (EU/t, tier, amps) where consumers show
  draw. Steam/hot-fluid producers output those fluids as normal ports.
  Rotor turbines also surface rotor lifespan as a card stat (hours) - the
  sheet's players plan around it.
- EU is NOT a resource and NOT a port in Phase 1.

### The summary (bottom right)

A POWER MADE summary beside the existing POWER draw summary, same visual
family: one line per generator group with count and EU/t, a total, per-tier
subtotals where useful. Both figures visible, nothing computed between
them - the player compares, the planner does not (yet). The old
`fuels.ts` fuel-profile estimate retires (its migration keeps old plans
loading).

### The engine under it

- Dataset: unblock the eight fuel maps + naq reactor maps in
  `normalize-oracle-export.mjs` (scoped: the zero-output filter stays for
  everything else); recipe field `fuel: { euTotal }` instead of negative
  eut through the `Math.abs` paths; synthesize maps for spreadsheet-only
  machines; confirm the steam grades (SH/SC/dense) and loop fluids exist as
  dataset resources.
- Curated math: a `power-table.ts` family of modules (pattern:
  `machine-table.ts`) implementing the formulas in
  `docs/power-planner-math.md` - the turbine formula + rotor catalog, the
  heat-exchanger table, singleblock per-tier efficiencies, engine boosts,
  boiler dual-fuel rule, reactor curves, LNR multipliers, fusion tables.
- Extraction tool: `tools/power-planner-extract` parses the xlsx into JSON
  fixtures (rotor catalog, fuel tables, HX constants) AND golden test
  values from the workbook's own computed cells. Every ported formula gets
  a fixture test against those goldens (the `reference-coefficients.json`
  discipline), then spot-verification against game source.

### Catalog waves (all Phase 1, shipped in slices)

- **Wave A - burners.** All singleblock generator families (per-tier
  efficiency + amp-loss math), LCE/ECE with boosts, SOFC I/II, rocket
  engines. Answers the benzene thread completely.
- **Wave B - the steam economy.** Rotor catalog + the turbine formula
  (large + XL, steam/gas/plasma), large boilers (dual-fuel rule), heat
  exchangers (LHE/EHE/Thermal Boiler + the grade gate), steam grades. The
  cascade becomes a wireable build. Biggest data lift, biggest payoff.
- **Wave C - reactors and free energy.** THTR, HTGR, LFTR + LFTB, IC2
  fluid-reactor presets (rod costs flagged as unmodeled on the card), DEHP,
  Solar Tower. Solar panels (singleblock, flat EU/t by tier with a duty
  knob) if cheap.
- **Wave D - endgame.** Fusion/Compact Fusion power configs (the dataset
  already has the fusion map; add the drain/output-by-mark model), LNR with
  coolant/booster knobs, EOH (expected-value model), Antimatter (closed-form
  optimum search instead of the sheet's 3235-row sweep).

### What ships (changelog view)

Players place any power setup the community spreadsheet covers, wire its
inputs, tune its knobs, and the bottom right shows what the plan makes next
to what it needs. The benzene board finally reports net benzene.

## Phase 2 - coupling (opt-in)

A `SetupRules` toggle. EU becomes one LP row: generation covers draw;
shortage throttles by the existing fairness machinery (the honest
brown-out); generators go demand-driven (matching the game: a full buffer
stops the burn), so fuel bills become real bills instead of nameplate.
Board summaries gain a power line; the machine-count optimizer can size
generators. Per-node power stalls keep their meaning.

## Phase 3 - drawing the power (maybe)

Visible EU wires as presentation over the coupled model (EU chips on cards,
dynamo chips on generators, or boards as named power networks). Decide on
fresh player feedback after Phases 1-2; do not pre-build.

## Non-goals

- Cables as entities (materials, per-meter loss, amperage, melt rules,
  cardinal priority) - the planner has no base geometry. The per-amp output
  loss IS modeled where the spreadsheet models it (singleblock burn rates).
- Transformers, battery buffers, machine internal buffers - time-domain
  devices; the books are steady-state.
- IC2 reactor interior design - presets only, like the spreadsheet; players
  have dedicated reactor planners.
- Day/night and weather simulation - constant daytime rates like the
  spreadsheet; at most a duty-factor knob.
- RF/EU conversion.
- Turbine rotor DAMAGE economics (rotor crafting cost per hour) - lifespan
  is displayed, replacement cost is the player's judgment.

## Open questions for Jack

1. **Wave order**: A then B as written, or is the steam economy (B) the
   headline worth leading with?
2. **Rotor catalog size**: ship all 166 materials from the extraction, or
   curate to the ones players actually run first? (Extraction cost is the
   same; this is a UI-noise question.)
3. **Fox's spreadsheet**: credit it in-app (the changelog or an about
   line)? Worth a heads-up message to its author?
4. **Summary comparison**: strictly two side-by-side totals in Phase 1, or
   is one small "makes X / needs Y" line together acceptable while still
   uncoupled? (It is display arithmetic only.)
5. **Unidentified block**: one Large Engines section (T1-T3, capacity/decay
   math) resists identification; resolve against GT++ source during Wave A
   or drop it?
6. **`fuels.ts` retirement**: goes without ceremony in Wave A?

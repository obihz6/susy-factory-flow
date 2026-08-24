# AGENTS.md

Working notes for future agents on GTNH Factory Flow.

## Project Shape

- App: Next.js App Router, TypeScript strict mode, Tailwind, React Flow, Zustand, Zod, Vitest.
- Domain model lives under `src/lib/model/`; solver logic lives under `src/lib/solver/`.
- Dataset tooling lives under `tools/dataset-pipeline/scripts/`.
- Raw exporter data must be normalized before it reaches UI or solver code.
- UI recipes are read-only. Do not add manual recipe editing unless explicitly requested.

## Branches, Deploy, Dataset

- App version lives in `src/lib/version.ts` (`APP_VERSION`) and renders as a
  chip in the header. ONE bump per RELEASE - a deploy to the live site - never
  one per commit. Minor for a release carrying features (1.1.0), patch for one
  that is only fixes (1.0.1).
  - Check what `https://gtnhplanner.com/api/version` reports before bumping.
    Behind `version.ts` means the release has not shipped yet: fold the new
    work into the top changelog entry and leave the number alone. Equal to
    `version.ts` means everything is live, so this is a new release: bump, and
    open one new entry.
- The chip opens the changelog, so every release needs ONE entry in
  `src/lib/changelog.ts`. Write it for players, not developers: what changed on
  THEIR board, a headline plus at most four notes. Every note is one short
  sentence. No second sentence saying what it used to do, no reasoning, no
  jargon ("solver", "refactor", "edge role"). Newest first.
- `main` is the ONLY branch, by explicit decision (2026-08-19): all work lands
  on it, and stale feature branches were deleted after verifying main carried
  every patch. Do not accumulate long-lived branches; the unmerged
  reachability-wizard work survives as the tag `archive/reachability-wizard`.
- Pushing `main` does not deploy gtnhplanner.com by itself; deploys are asked
  for explicitly.
- CI (`.github/workflows/ci.yml`) runs typecheck + the full vitest suite on
  every PR and push to main. The suite is expected GREEN; there are no
  tolerated failures. A test pinning player-facing copy must be updated in the
  same change that rewords the copy.
- `https://gtnhplanner.com/` is production for this repo.
- `origin` is `jackwrichards/gtnh-factory-flow` (this project). `upstream` is
  `Samiracle64/gtnh-factory-flow`, the repo this was originally forked from -
  it is not a push target and the two have long since diverged.
- Pushing code can deploy the app, but dataset changes require a dataset
  rebuild - and the GitHub "GTNH dataset pipeline" workflow is a DECOY, like
  the deploy workflows: the repo has no self-hosted runner, so every run
  queues until the next half-hourly cron supersedes it. Established
  2026-08-23; do not dispatch it and wait.
- Datasets are really rebuilt by hand in this PC's WSL (Ubuntu):
  - `~/gtnh-factory-flow` is a git-less SNAPSHOT of the repo. Copy any
    changed pipeline scripts into it first or the rebuild runs old code.
  - Raw oracle exports (the expensive Minecraft part, reusable as long as
    the pack versions stand) live at
    `~/gtnh-factory-flow/.pipeline/raw-export/<id>/oracle-export.json` with
    `rendered-icons/` beside them.
  - `~/run-both.sh` (and the fuller `~/rebuild-cokeoven.sh`) run
    normalize-oracle-export.mjs, build-resource-index.mjs,
    build-recipe-index.mjs (recipe index + lookup index + shards), then gzip,
    into `~/gtnh-export/datasets/gtnh/<id>` (2.9) and
    `~/gtnh-export/datasets-284/gtnh/<id>` (2.8.4).
  - `~/copy-datasets.sh` copies the results into the Windows repo's
    `public/datasets/gtnh`.
  - Publish: scp the changed files (gzips, shards, oracle-report) to the
    droplet's `/opt/shared/gtnh-datasets/<id>/`, rebuild
    `datasets.manifest.json` with rebuild-manifest.mjs, then
    `systemctl restart gtnh-flow`. Only textures are cache-immutable, so
    replacing dataset gzips in place is safe.
- After a publish, verify the live manifest and, when relevant, inspect the
  published gzipped dataset, not only local output.
- Stable and daily both matter. If the user says relaunch/import dataset, usually run both unless they explicitly narrow it.
- The server should be prewarmed on startup. Slow first API calls usually mean prewarm/deploy service behavior regressed, not that the client should wait longer.

## Dataset Import Principles

- Prefer data exported from NEI/RecEx/runtime over manual fallback tables.
- Avoid broad fallback logic on `dev`; the user explicitly wants bad fallback noise removed.
- Do not parse arbitrary tooltips globally. Tooltip parsing is acceptable only when scoped to reliable objects, especially multiblock controllers exported with `mb`.
- RecEx patching for multiblock detection is in `tools/dataset-pipeline/scripts/patch-recex-autorun.mjs`.
- Normalization of RecEx exports is in `tools/dataset-pipeline/scripts/normalize-recex-export.mjs`.
- `mb` means the exported item is a multiblock MetaTileEntity. Use this to scope multiblock parameter parsing.
- Machine catalysts/handlers should come from NEI/runtime data, not hand-written category lists.
- Machine family merging should fold tier variants together:
  - Example: Fluid Extractor includes tiered Fluid Extractors, Liquefying Suckers, and Large Fluid Extractor as the same recipe family where the dataset supports it.
  - Example: Centrifuge should fold tiered centrifuge variants and leave distinct real families such as Steam Separator.
- If there is only one real machine family in a recipe group, keep the recipe map/base name as the primary visible name.

## Ore Dictionary And Concrete Items

- Concrete items must carry ore dictionary membership in the dataset.
- Uses for a concrete item must include:
  - exact concrete recipes, e.g. `item:spruce_log`
  - compatible oredict recipes, e.g. `item:oredict:logWood`
  - explicit alternatives containing that concrete item
- When a user opens recipes/uses from a concrete item, preserve that concrete context in rendered slots.
- Oredict recipes selected from a concrete item must render/link as that concrete item when compatible. Spruce Log must not silently become Oak Log after node creation, refresh, or reload.
- Tooltips should not show noisy ore dictionary internals when the node was created from a concrete item context unless that is explicitly useful.
- Resource matching/handles must use the effective rendered recipe/resource, including concrete oredict overrides, not only the raw recipe.

## Cells Are Items

- A filled cell is an ordinary ITEM. It does not satisfy its fluid's slot, and
  the fluid does not satisfy the cell's. `resourceMatchesInput` compares kinds
  strictly; do not reintroduce a cross-kind branch.
- Crossing the two forms takes a machine on the board, exactly as it does in
  game. There are ~4,000 Canner recipes in the dataset (~1,150 fill, ~1,150
  empty), so the bridge is always a placeable machine, and GT registers ~3,000
  recipe shapes in BOTH forms so most chains just need the matching variant.
- The TANK (Jack, 2026-08-23) is the free version of that bridge: the
  pipeline mirrors every fluid-touching Canner recipe into a synthesized
  "Tank" map (`addTankRecipe` in `normalize-oracle-export.mjs`) at 0 EU and
  1 tick - the same "instant" shape hand-crafting wears, machine count still
  scales it. It keeps the REAL slots, empty cells included: the game never
  deletes an emptied cell and neither does the planner. It waives only the
  Canner's power and time. Do NOT go further than this by default - an
  auto-inserted converter that discarded empty cells was designed and
  rejected in the same session.
- LOOSE CELL WIRES is the one opt-in beyond it (`SetupRules.looseCellWires`,
  off by default, in the board-rules sheet): a filled cell and its fluid wire
  straight together, EITHER WAY ROUND - cell output onto fluid input, fluid
  output onto cell input - and the gesture behaves like any compatible pair
  (green wash, whole-card drops, drags started from either end). The wire
  itself is still same-kind (its resource is the SOURCE's own form; the far
  form is named by its target handle) and carries the Canner's
  litres-per-cell on `edge.crossForm`, fetched at wire time - no ratio
  found, no wire. `getCrossFormCellMatch` in resources.ts is the one
  pair-matching question. The solver bridges the forms through a hidden free
  Tank (`expandCrossFormEdges` in throughput.ts, converting whichever way
  the wire runs) that never reaches the board or the result.
  `resourceMatchesInput` stays strict; the rule lives in the gesture
  (`handleConnect` / `isCompatibleResourceConnection`, plus the whole-card
  drop path `findNodeDropTargetOnSide` / `isCompatibleDraggedResourceTarget`
  / `handleConnectEnd` - drawers stay strict), edge survival
  (`isFactoryEdgeStillValid`, `dropCrossFormConnections`), and the
  expansion - nowhere else. The pair-match reuses the search's name-tolerant
  `isFluidEquivalentToFilledCell` (fluid ids rarely spell their names:
  "Molten Cast Iron" is `molten.castiron`); a false name match still wires
  nothing because the ratio fetch looks the pair up by exact ids. Residual
  quirk: a same-named different-id fluid (TCon `iron.molten` vs GT
  `molten.iron`) can wash green during the drag and then refuse silently
  when no Canner recipe links the exact pair.
- The old behaviour auto-converted at a guessed 1000 L per cell. It made chains
  look complete while omitting a real machine, empty cells and the power to run
  them, and it reported item production in litres. It also inflated cell inputs
  1000x. All of that is gone; do not rebuild it.
- The ONE surviving cross-form rule is SEARCH: `getFilledCellFluidEquivalent`
  and `isFluidEquivalentToFilledCell` widen what the recipe book shows. They
  wire nothing and convert no amounts, and carry no litres-per-cell ratio.
- `dropCrossFormConnections` in `project-normalize.ts` drops legacy cross-form
  wires and slot overrides on load. It compares KINDS only, never ids, because
  a slot legitimately carries an id the edge does not (oredict, chosen
  alternatives) and matching on id would delete honest wires.
- Note for anyone tempted by the Fluid Canner indexing that used to live in
  `build-resource-index.mjs`/`enrich.ts`: it matched `recipeMap === "Fluid
  Canner"` while the dataset says `"Canner"`, so it produced zero links in
  every published dataset. It was removed as dead code, not as a behaviour
  change.

## NEI Layout And Slots

- Prefer NEI-exported slot positions and progress bars over reconstructed layouts.
- Empty NEI slots still matter and must remain visible.
- Non-consumed slots (`NC`) should stay visible generally; only hide `NC` for specific cases explicitly requested, such as TGS tool placeholders.
- Do not replace real slots with `"..."`, `"-"`, or fake labels when a concrete item context exists. Render the actual selected alternative.
- Arrows/progress indicators should come from the NEI layout when available.
- Recipe book search must query the API, not only filter the first loaded page. Pagination must continue beyond the first page, especially for cases like Coke Oven charcoal/nitrogen recipes.

## The Recipe Search (One Screen)

- The recipe book popup is `RecipeSearchOverlay.tsx`: results over a detached
  STENCIL card (takes on the left, makes on the right). Each side reads
  ANY / ALL / ONLY, ALL the default: any = touches one of these, all = every
  one of them with extras allowed, only = exactly these and nothing else.
  ONLY's nothing-else half is verified against recipe bodies server-side
  (`recipeIsOnlyMatch`), capped at `ONLY_VERIFY_LIMIT` candidates - past the
  cap it degrades to all. Non-consumed inputs (circuits, catalysts) never
  count against takes-ONLY. There is no NEI canvas in it, no makes/uses
  mode switch and no category rail - machine chips with counts do that job,
  "All" (every map at once) being the default. Left click on an item
  anywhere still opens it with one MAKES condition, right click one TAKES;
  `browseResource`/`clearResourceBrowser` remain the only doors in and out,
  and `RecipeBrowser.tsx` still owns all query state (the stencil is edits
  keyed by the browse that seeded them, so a new browse always starts over).
- A query is `clauses` (`role:kind:id` wire form, `recipe-query.ts`) plus
  `takesOp`/`makesOp`/`allMaps` on the same recipes API. The server side is
  set algebra over the lookup index (`getClauseLookupRecipesByMap`): any =
  union, all = intersection, sides intersect. Every clause resource gets the
  concrete-context rewrite (`applyClauseResourceContexts`), and the legacy
  resource+mode wire form is exactly a one-clause query.
- The machine chips are a MULTI-SELECT (Jack, 2026-08-23): every map is
  selected by default, a chip click toggles just that map, and All is
  select-all/select-none - unselecting one map unlights All but keeps the
  rest. The selection persists (`gtnh-factory-flow.machine-map-selection.v1`,
  exclusions survive searches where the map never appears) and rides the
  recipes API as `mapMode=exclude|include` plus repeated `map=` params;
  the map list and per-map counts always cover everything that matched, so
  an unselected chip keeps its count. There is no per-map scoping any more
  and no crafting-map special case: Shaped/Shapeless Crafting are ordinary
  maps whose machine is GT++'s Auto Workbench, synthesized in
  `recipe-rules.ts` (LV seed 64t/32EU; the "Auto Workbench" machine-table
  entry caps its perfect overclocks at EV's one craft per tick - transcribed
  from MTEElectricAutoWorkbench: flat 2048 EU per craft), with the instant
  hand-craft as the second handler. Purging the crafting maps from the
  dataset itself is a pipeline decision that has NOT been made.
- Result cards merge duplicate slot entries (nine planks is one line, x9) and
  oredict slots wear their first concrete face; both are display-only.
  Chips that satisfy a stencil condition ring cyan; chips browse on
  click/right-click like port rows. The stencil's arrow SWAPS the two sides.
- WHERE AN ADD LANDS: every spawn runs `nearestFreeSpot` over
  `projectBlockerRects` (cards, drawers, minimized board cards, and open
  frames as whole rects - nothing spawns inside a board uninvited) and the
  camera flies to it (`boardFocusRequest`). An add whose browse came from a
  card's PORT (`anchorNodeId`) goes through `addConnectedRecipeNodeToState`:
  beside the anchor, upstream when the click asked who makes, and WIRED on
  the clicked resource alone (`buildResourceEdgesBetweenNodes`) - never on
  byproducts, and not at all when the pick no longer touches that resource.
- REFACTOR: the card header's refresh button (`beginRecipeRefactor`) reopens
  the search seeded with every consumed input and every output of that card,
  and the add REPLACES the card in place (`refactorNodeWithRecipe`): wires
  whose resource still has a port on the new recipe re-dock onto its slots,
  the rest drop, position/count/board stay. When NO wire would survive, the
  old card stays and the pick lands beside it instead. All one undo step.

## Machine Configs And Multiblocks

- Machine BEHAVIOUR (speed, EU discount, parallels, overclock style) comes from
  the curated table in `src/lib/machines/machine-table.ts`, transcribed from
  ShadowTheAge's MIT calculator (`https://github.com/ShadowTheAge/gtnh`,
  `src/machines.ts`), which was verified against the mod source machine by
  machine. The table wins over anything the dataset scraped. Machines absent
  from it fall back to the dataset, so partial coverage is safe.
  - Do NOT add entries by guessing. Transcribe from the reference and note the
    two indexing differences: their voltage tiers start at LV = 0 (ours at
    ULV = 0, so their `voltageTier + 1` is our ordinal), and their `speed` is a
    throughput multiplier while we store a duration multiplier (`1 / speed`).
  - EVERY entry is machine-checked against
    `src/lib/machines/__fixtures__/reference-coefficients.json`, which is the
    reference's own definitions evaluated over a grid of tiers and choices.
    `machine-table.test.ts` documents how to regenerate it. Add an entry, run
    that test, and it will tell you if the transcription is wrong. Two earlier
    hand-ports had silent errors that this caught.
  - A table entry may declare `controls`, which are ordinary
    `MachineConfigControl`s merged over the dataset's, so a machine can offer a
    knob the dataset has none for (electrodes, sawblades, anvils) and the
    existing config UI renders it unchanged.
  - `ctx.tier(id)` is the option's position; `ctx.value(id)` is the number
    behind a count knob (laser amperage, parallels). The reference states some
    choices as raw counts with a minimum, and its formulas read the count, so
    those must use `value`.
  - Still on scraped data, deliberately: the 11 fusion reactors (need
    `fixedVoltageTier` and their own overclock), and the machines whose
    coefficients read recipe metadata or the recipe type (Nano Forge, PCB
    Factory, Naquadah Fuel Refinery, Component Assembly Line, Dangote
    Distillus, Precise Auto-Assembler, QFT, Eye of Harmony).
  - Steam machines are handled in code, not scraped. The 8 steam multiblocks
    (Steam Grinder/Squasher/Separator/Purifier/Presser/Blender/Fuser/Hearth)
    are table entries: `1.6 / tierMachine` duration, 8 parallels, no
    overclock, a shared `steamPressure` control (bronze/high pressure).
    Steam SINGLEBLOCK handlers export no stats, so `recipe-rules.ts`
    synthesizes bronze x2 / high pressure x1 duration. Smelting seeds from
    GT's fixed 128t/4EU furnace recipe, not the exported 200t/0EU vanilla
    smelt (the Hearth's odd 0.9765625 speed constant is that, pre-divided).
    Steam LITRES are `getNodeSteamReport` in power-report.ts: singles pay
    2 L/EU at (x1 bronze / x2 HP) EU, multis pay 1 L/EU on
    `recipe EU x 1.25 x tierMachine` per parallel. EU stays zeroed on steam
    cards; do not bill both.
  - The dataset pipeline BAKES its scraped multipliers into each handler's
    own `durationTicks`/`eut` (a Volcanus handler carries the EBF recipe
    pre-multiplied by x0.8/x0.9; the steam multis' bake was outright wrong,
    the tooltip's HP figure). `machineTableSeedsFromBase` therefore makes
    every table machine that declares `speed` or `power` ignore baked handler
    stats and seed from the recipe's base. Entries WITHOUT speed/power (Multi
    Smelter) keep handler stats - the Electric Furnace family's are ABSOLUTE
    (128t/4EU) and correct.
  - Tooltip scraping in `tools/dataset-pipeline/scripts/machine-configs.mjs`
    still supplies the control DEFINITIONS (which knobs exist, their icons and
    tier lists). It should no longer be trusted for effect VALUES: it once
    stamped a heat capacity on every coil, which handed four machines
    overclocks they do not get.
- Parallels are paid for with power BEFORE overclocks, and only the leftover
  voltage buys overclock steps. See `src/lib/solver/overclock.ts`. Heat
  overclocks belong to the Electric Blast Furnace, Volcanus, the Exothermic
  Hearth and the Utupu-Tanuri (our "Multiblock Dehydrator") and nothing else.
- A recipe runs in WHOLE TICKS. Over one tick GT truncates, which favours the
  player. Under one tick a multiblock banks the leftover speed as parallels
  while a singleblock wastes it, so duration is only floored at 1 for
  singleblocks. `canSubTick` in `overclock.ts` decides, and note the trap it
  documents: when a recipe carries no handlers, `getRecipeMachineHandlers`
  invents one stamped `kind: "single"` as a placeholder, which is NOT evidence.
- Recipes carrying `runtimeCalculation` are NOT authoritative for multiblocks.
  That export is the game's `OverclockCalculator` alone; it never saw
  `GTParallelHelper`, so all 202,322 of them say `parallel: 1` and 145,231
  flatline at one tick. `prefersCuratedMachineMath` makes the curated table win
  for machines it covers. Everything else still uses the runtime data.
- A special value of 0 can be a REAL heat requirement, not a gap: dehydrator
  recipes start from 0 K. Do not reintroduce a `specialValue > 0` guard; the
  machine list is what keeps heat off machines with no heat mechanic.
- Where the reference punts and the wiki gives a real mechanic, follow the
  wiki. It asks the player for the Utupu-Tanuri's heat difference because it
  cannot read the requirement, and spends it as speed; the wiki says energy
  discount plus perfect overclocks, and that is what we implement. Machines
  that diverge on purpose are listed in `machine-table.test.ts`.
- Machine config controls are structured data, not frontend hardcoding. Use `machineConfigControls`.
- Existing supported tier effects include:
  - `parallelMultiplier`
  - `durationMultiplier`
  - `eutMultiplier`
  - `outputMultiplier`
  - `heat`
- Multiple config dimensions can stack on one node. Do not model `coilTier` and `pipeCasingTier` as mutually exclusive.
- Keep legacy `coilTier` compatibility, but prefer generalized `machineConfigTiers`.
- Show the parallel slot as a non-clickable slot when imported parallel count is greater than 1; keep it as the rightmost config slot.
- Disable tier controls when the selected machine/handler is not affected by voltage tier.
- Manual/instant crafting tables without time/tier behavior should not appear as timed machine choices.
- If no duration is available for a manual/instant machine, treat it as instant rather than inventing fake `0 EU / 1s` timed behavior.
- Pyrolyse Oven coil behavior comes from multiblock tooltip/code formula: `Speed is 50% times Coil Tier`, exported as a `heatingCoil` control with `durationMultiplier`.
- Industrial Coke Oven / other multiblocks can have casing-based parameters. Parse them only from multiblock-scoped exported data.
- Mega/Dangote-style machines may define fixed high parallel counts. These should be represented in machine config output.
- TGS is special:
  - Output is affected by voltage tier and selected tools.
  - If no relevant tool is selected for an output category, multiplier is effectively zero.
  - Tool choices are per empty TGS input slot; each slot should offer the valid tool categories through an icon menu.
  - TGS tool icons should be real item icons, not text labels.

## Frontend State And Recipe Context

- Node creation from recipe book must preserve selected context/resource overrides.
- Refresh/reload must not re-resolve oredict slots back to the first alternative.
- Changing a machine config such as TGS tools must not drop unrelated links or resource overrides.
- When selected handler changes through the machine dropdown/multi-arrow UI, carry handler-specific tier/config behavior with it.
- Images/icons in recipe nodes should use dataset resources/atlas paths. If they exist in prod but not dev, suspect deployment/static asset path/build mismatch before changing recipe logic.

## Tabs, Cameras And Where A Plan Lands

- The Welcome tab's `active` flag is per browser SESSION
  (`sessionStorage`, `src/lib/tour/welcome-tab.ts`). A reload is not a fresh
  visit: it must leave you on the tab you were on. `open` and `showOnStartup`
  are permanent.
- Each design tab remembers its own camera:
  `src/lib/designs/design-camera.ts`, localStorage keyed by design id. It is
  deliberately NOT part of the plan - a shared setup carries positions and view
  settings and no viewport, so someone opening one gets it framed.
  - Not recorded during a design handover, which is what the latch in that
    file is for.
  - A tab with no camera stored yet is framed, which is what every tab used to
    get.
- The board has NO `fitView` prop, on purpose. React Flow's fit-on-init waits
  for cards to be measured, so on a page load it fires after the plan arrives
  and stamps over the restored camera. The app frames for itself on every path
  that puts cards on the board (design store, plan import, blueprint paste,
  tours); do not add the prop back.

## Boards (And Their Minimized State, Formerly Pockets)

- A board is the ONLY container: a `FactoryPocket` record, two states.
  `expanded: true` plus a `size` renders it as a window frame (`BoardNode`)
  with its members inside; minimized it renders as a SUMMARY CARD
  (`PocketNode`). That card is ALL a "pocket" is now - there is no dive-in
  view, no breadcrumbs, no Esc-up, no violet room, no unpack button, and no
  convergence rewiring anywhere. Old plans load their pockets as minimized
  boards.
- A MINIMIZED BOARD IS A SUMMARY, NOT A MACHINE. It has NO PORTS: you
  cannot drop a wire on it (`findNodeDropTarget` returns undefined, so it
  washes red like any card refusing a resource), no drag starts on it, and
  `connectResourceEdges` refuses any end that names one. It stacks two
  readings and a stat line, and every figure comes from the PLAN-WIDE
  solve (`computePocketSummaries`). To change anything you open the
  window.
  - NEEDS / MAKES: the board read as a little factory, WIRES IGNORED -
    the members' flows netted against each other, so a board whose own
    mine feeds its own macerator asks the world for no ore. These are
    FULL SPEED figures on purpose: a board stalled because a need is
    unmet must still say what it is missing, and scaling by utilization
    erases exactly that line.
  - COMING IN / GOING OUT: what actually crosses the border on wires
    right now, one line per resource per direction with its wire count.
  - Only the BALANCE is painted: red ground under NEEDS, green under
    MAKES, each with a centred title chip. The wire crossings are plain
    paper - colouring them too made the card two stacks of the same two
    colours saying different things. A ground ends with its own last
    line (`items-start`), never running down past the taller column, and
    a rule (one cell, charged for in `pocketCardHeight`) separates the
    two sections. NO CAP and no "and N more" - a summary that hides half
    of itself is not one - so the card grows a row per line and
    `sectionCells` charges for every one of them.
  - The footer is what is inside: machines, cards, EU/t.
  - The card used to run a SCOPED solve over its members with the outside
    world unhooked and wear the result as input/output rails. It read like
    a machine and lied like one: a board holding its own source was told it
    was starving, a board exporting a byproduct was told it was clogged.
    That whole apparatus is gone - the scoped solve, `buildPocketRailPorts`,
    `resolvePocketPortHandleId`, the port fan-out
    (`resolvePocketMemberIds`, `listPocketPortResources`,
    `getPocketResourceForHandle`). Do not rebuild it.
  - Crossing wires still land on the card, as ANY-SIDE endpoints (like a
    drawer's), on two inert handles that exist only because React Flow will
    not draw an edge without one. Several wires carrying one resource across
    one border are still drawn as ONE line (the channel grouping, now keyed
    on resource alone) and counted as one summary row with its wire count.
  - `pocketCardHeight` is the one place the card's height is decided, so
    the auto-arranger can size a minimized board from
    `countPocketCrossings` before it has ever been measured.
- The canvas always shows the ROOT plus the contents of every open board,
  recursively (`computeBoardLevelView` in `src/lib/model/board-windows.ts`:
  shown levels, representatives, frame rects, drop-owner picking).
  Double-click or the restore button opens a minimized board in place;
  Ctrl+G wraps a selection in an OPEN board fitted around it, moving
  nothing and touching no wire.
- While open, member positions are FRAME-RELATIVE and members are React
  Flow children (`parentId`), which is what makes a dragged title bar carry
  the household. Everything downstream speaks flow space:
  `publishBoardGeometry` and `cameraCards` resolve the parent chain once.
- Wires belong to cards. An open board's members wire directly, and the
  frame is invisible to wire GESTURES (drops land on the cards inside) -
  but to ROUTING a frame is as solid as a card: foreign wires go around it
  with the same one-cell clearance, and only wires whose endpoints live
  inside it are exempt (`throughBoardIds` on the route inputs,
  `exemptObstacleIds` in grid-edge-router.ts) - they have to cross the
  border to exist. Frames publish through `publishedBoardFrameBounds`,
  separate from the card set, and exemptions ride the solve signature so
  adopting a card reroutes its wires without anything moving. A wire whose far
  end is a MINIMIZED board lands on the summary card as an any-side
  endpoint, and same-resource crossings collapse into one drawn channel -
  presentation, never stored rewiring.
- Membership changes by drop (`handleNodeDragStop`): a card WHOLLY inside a
  frame's floor joins that board (deepest frame wins), a card dragged clear
  of every frame leaves its board and surfaces on the canvas
  (`pickBoardOwnerFor`). Coordinates convert so nothing moves on screen,
  and the frame NEVER grows to swallow a drop - a board's walls are the
  player's to set, and a drop that would not fit simply lands outside.
  Drawing a board with the toolbar tool adopts the cards it covers; a
  drawer spawned off a member's port joins the member's board.
- Opening a legacy pocket (`size` absent - the "coordinates are their own
  old space" signal) rebases members to fit the frame and drops waypoints
  on wires touching them; minimize mirrors the waypoint rule.
- Auto-arrange DUMPS EVERY BOARD FIRST and builds zones from scratch, and
  it draws no ink (`computeAutoArrangement`). Phase 0 spills every frame's
  cards onto the canvas at their absolute positions (`removeBoards` on
  `applyBoardArrangement`), then scouts with a throwaway arrange: each
  natural island becomes a fresh open board ("Zone N", `addBoards` /
  `setOwners`, all one undo entry). A rebuilt zone holding exactly the same
  cards as a dumped board inherits its NAME and paper — the layout is
  decided from scratch either way, and renaming somebody's zone on every
  arrange is its own small betrayal. Hand-drawn frames therefore never
  fence the layout in, and the button gives the same answer for the same
  factory. Shelf strays and interchange buffers (the arranger's
  `backdrop: false` islands) stay loose between zones. Then the
  layout passes: every open board arranges its own members inside its
  frame (deepest first, in frame space, origin one cell under the title
  bar) and the frame REFITS around the result (`setBoardSizes`); the root
  then arranges with every board as one meta card at its fresh size, wire
  length between blocks doing the placing. Interior passes pin no
  waypoints (stored waypoints are flow-space); ink on every arranged level
  is cleared and nothing replaces it - the zones are the grouping.
- The interior passes are BOUNDARY-AWARE: every wire crossing a frame gets
  a phantom partner card (one per outer neighbour and direction, weight
  x3), so members that talk across the border land against the edge their
  wires leave through; phantoms are discarded and the members re-normalise
  to the frame corner. Each interior pass records where every crossing
  wire's member landed (`boundaryPortY`, "edgeId:boardId" from frame top),
  and outer passes use those as the board card's PORT heights - which is
  what lines frames up so wires between boards run straight instead of
  crossing. The arrange also paints every unpainted board from
  `ZONE_PAINTS`, skipping coats other boards already wear.
- The board title bar has a paint button (palette in a NodeToolbar portal,
  because the frame's own layer sits under the cards); the paint TOOL works
  on boards too. Both go through `paintPocket`.
- A board is drawn on PAPER: `pocket.theme` is a canvas theme id, and it
  gives the floor its base colour, its grain and its own grid dots on the
  20px pitch (`chromeFor` in BoardNode.tsx cuts the title bar from the same
  paper). The title bar's paper button picks one; the arrange assigns from
  `ZONE_PAPERS`, skipping papers other boards already wear. `colorTag`
  still works (the paint tool) and wins when there is no theme.
  The resize grip's floor is the members' extent plus a cell - a frame can
  never be made smaller than what it holds.
- The paper is painted by `BoardFloors`, ONE viewport portal at z -4, not
  by the board's node. A board's chrome sits at 15 (over the wires at 10,
  under the cards at 20) so its bar and rim OCCLUDE the wires crossing
  them, while the floor stays under those wires - one node cannot be in
  two places in the stack, and React Flow pins every child node above its
  parent, so a floor child could not go below either. The layer reads live
  positions from the node lookup, so paper tracks a dragged frame exactly.
  Open boards therefore also un-seal the edge/node layers
  (`factory-flow-board--edges-under`, the lever thickness mode pulls).
- The marching dashes are a CANVAS painted over everything, so anything the
  wires go under has to be punched back out of it. A board's bar and rim are
  in that set in EVERY mode (`boardChromeOccluders`, fed from
  `publishedBoardFrameBounds` and copied into the GIF capture's
  `occlusionRects`) - unlike the cards, which only occlude when thickness
  mode runs the wires beneath them. Only the chrome strips are erased, never
  the whole frame: the floor is a layer UNDER the wires, so the dashes cross
  it, and a frame dragged by its bar erases the same strips at its live
  position rather than blanking its own interior.
- Two mirrored routing rules keep wires honest about rooms
  (grid-edge-router.ts). A wire leaving a board pays `COST_INSIDE_EXEMPT`
  per pixel spent inside it, so it makes for the nearest border instead of
  riding the frame's own edge line on the way out. A wire whose BOTH ends
  sit in a frame (`homeObstacleIds` — the shared prefix of the two
  endpoints' ancestor chains, `exemptObstacleIds` being their union) pays
  `COST_OUTSIDE_HOME` for every pixel spent OUTSIDE it, so it never ducks
  out of its own board and back in. The second rule exists because the
  first one alone made leaving cheaper than staying.
- A board has NO DEFAULT COLOUR - the house purple it used to fall back to
  is gone (`src/lib/model/board-paper.ts`). A board created now stores a
  paper nobody else on the plan is WEARING, picked at random
  (`pickBoardPaper` in `createBoard`/`wrapSelectionInBoard`), and a board
  with no stored paper - every pocket made before papers existed - is drawn
  in `paperForBoardId`, hashed from its own id so it looks the same on
  every reload and needs no migration. The picker's clear button hands a
  board back to that id colour rather than to a house one. The MINIMIZED
  card wears the same paper (`boardChrome`, exported from BoardNode):
  folding a board must not turn it into a different-coloured object, and
  the paper is how you recognise which board it is. The house purple it
  used to wear is gone from there too.
- Only DARK papers are offered (`BOARD_PAPERS` filters the light canvas
  themes out, and `BOARD_PAPER_IDS` - which `ZONE_PAPERS` now is - lists
  the dark ids): a pale sheet under the
  board's dark cards reads as a hole in the plan. A board already carrying
  a light theme still renders it. `pocket.pattern` rules that paper with
  the same six the canvas offers (`boardRuling` draws them as CSS layers,
  and the picker previews each one at a 7px cell). The picker's popover is
  `align="end"` — it belongs under the button that opens it, which sits at
  the right end of a bar that can be very wide.
- The frame line is `BOARD_EDGE` (4px), and the title bar wears the same
  weight in the same colour so the window reads as one object: a 2px line
  vanished at the zooms a board is actually read at.
- `dissolvePocket` is the DUMP: the frame goes and its cards stay exactly
  where they were (frame-relative positions get the frame's corner added
  back when the board carries a `size`). Its button lives on both the open
  title bar and the minimized card.
- NOTHING SOLID OVERLAPS. `board-placement.ts` is the magnet, and it runs
  LIVE: `handleNodesChange` rewrites each drag frame's position to the
  nearest free grid spot, so a card is never allowed onto an occupied spot
  rather than being tidied up after release (the drop keeps the same call
  as a safety net for drops that never saw a drag frame). Blockers are
  computed ONCE per drag in `handleNodeDragStart` — nothing they depend on
  can change mid-drag — and differ by kind: a CARD is blocked by other
  cards but never by frames (a frame is a room you drag into, and the drop
  decides membership); a FRAME is blocked by other frames and by every card
  that is not its own. Annotations are ink and never block anything.
- NOTHING STRADDLES A WALL. Every open frame is also a REGION to the magnet
  (`PlacementRegion`: the whole frame as `outer`, the floor under the title
  bar as `inner`), and a card position that touches `outer` without fitting
  inside `inner` is refused exactly like an occupied spot. So a card clicks
  IN or clicks OUT as the hand crosses the wall, whichever side is nearer,
  and the drop can then read membership as plain containment instead of
  guessing from a centre point. A frame being dragged is not asked to be in
  or out of anything, and a frame carried by the same drag is not a wall to
  the cards riding with it.
- Board frames resize from all four edges and all four corners
  (`RESIZE_GRIPS`), each with a generous hit box straddling the wall, plus
  permanent corner brackets. A wall never cuts into the board's own cards
  and never crosses anything outside — the same no-overlap rule the drag
  magnet enforces. Dragging the TOP or LEFT wall moves the origin, so
  members are shifted by the same step the other way and stay put on the
  canvas: live through `board-resize.ts` (the frame publishes, the board
  applies both halves to its node state on one frame) and committed by
  `setPocketFrame`, one undo entry, nothing written until the pointer lifts.
- A board SELECTS like anything else: `selectable: true`, so a marquee
  drawn round one picks up the frame (and, being a marquee, the cards
  inside it too) and it wears the same purple ring every selected card
  wears (`SELECTION_RING`). The frame used to be unselectable because a
  selected frame AND its selected members both took the drag delta, so
  the household moved twice as far as the hand. `dragPassengersRef` is
  the fix: at drag start, any held card whose board is held too is a
  PASSENGER, and its own position changes are dropped for the length of
  the drag - the frame carries it, and its stored frame-relative position
  is already right.
- NOTHING SITS IN TWO BOARDS AT ONCE. `wrapSelectionInBoard` refuses a
  selection where anything already has an owner or IS a board, and the
  board hides the wrap button for such a selection (`selectionCanWrap`),
  so Ctrl+G and the button agree. Boards inside boards is a real feature
  and a separate decision; it must not happen by accident from a marquee.

## Compact Mode (Phones And Small Windows)

- `src/lib/compact-view.ts` owns the switch: `useIsCompactViewport()` /
  `isCompactViewport()`, true under 900px wide OR 560px tall (a phone held
  sideways is 932x430 and needs the same layout). `globals.css` defines a
  Tailwind `compact:` variant on the same two numbers for style-only changes.
  Change one, change the other.
- Ask the MEDIA QUERY, never `window.innerWidth`: a mobile browser widens the
  layout viewport when content overflows it, so a 390px phone can report 935 and
  answer the question backwards. This is what used to open both side columns on
  the one device with room for neither.
- Compact replaces the three-column grid with the board plus two drawers
  (`PanelDrawer`), the top bar with one menu (`AppMenu`), and each board toolbar
  with one folded button (`ToolGroup` in `FactoryFlow.tsx`, one open at a time,
  all three triggers on the top line and every fold-out on the line below).
- The drawers track the finger: the live offset is written to the `translate`
  property, not `transform`, because Tailwind's own translate utilities use
  `translate` and the two COMPOSE. A drag holds the panel mounted past the moment
  it closes, which is what there is to animate.
- Do not put minimum heights in the way of a short window; pair them with
  `compact:min-h-0` as the shell, the board and both panels do.

## Board Gestures

- A port ROW answers, not its little item icon: left click opens what makes the
  resource, right click what uses it, R and U do the same for the row under the
  pointer (`port-browse.ts` holds the pointed-at row imperatively — do not
  subscribe cards to it), a long press opens a two-item menu for a finger, and a
  drag still wires. The icon is art with `pointer-events-none`; the full-row
  React Flow handle underneath it takes the drag.
- Touch gestures on the board live in `board-touch-gestures.ts`, in native
  capture-phase listeners: React Flow's pan sits on the pane below, and stopping
  the event before it gets there is the only way to take a gesture off it
  mid-flight. Double tap zooms, double tap and slide keeps zooming (both anchored
  on the tap point), and a swipe in from the outer third of either side pulls that
  drawer out. Claiming an edge swipe restores the viewport captured at touchstart,
  so opening a drawer never leaves the board panned.
- A drawer follows the finger through `panel-pull.ts`: the gesture starts on the
  board, the drawer does the moving, and the registry is how the two meet.
- On compact, a card is draggable only while selected (`withTouchDragRule` in
  `FactoryFlow.tsx`, plus `nodesDraggable={!isCompact}`). Apply it where the
  selection changes, never per drag frame.

## The Board Grid

- `src/lib/board-grid.ts` owns `BOARD_GRID = 20` and every card size derived
  from it. Read the "board grid" section of `ARCHITECTURE.md` before changing
  any size, offset, or padding on the flow board.
- The grid is always on. There is no snap toggle and no grid button; do not
  reintroduce one.
- Node positions, node sizes, and port row centres must all be multiples of
  `BOARD_GRID`. Verify with a Playwright measurement, not by eye.
- Blocks whose height depends on content use `GridBlock` in `RecipeNode.tsx`:
  round up to the next cell, never compress to fit.

## Routing Links

- Wires are routed by the grid router (`src/components/flow/grid-edge-router.ts`),
  one A* solve over every edge at once. Do not reintroduce per-edge candidate
  scoring or hardcoded special-case paths.
- Routes travel on 20px grid lines and never come within one cell of any card.
  The only exception is the port stub — the final hop across a card's margin
  into the port itself.
- A grid line is a lane with 16 usable px. Wire widths are fractions of a lane
  (`LANE_FRACTIONS`); wires that fit side by side share a lane with a 2px gap,
  packed around the line's centre. Riding a shared lane is slightly cheaper
  than an empty one, so wires travel together and split near destinations.
- Wires never overlap outside port stubs. Overfull lanes cost heavily, so a
  latecomer takes the next line over; only at a port, where any number of
  wires can converge on one row, may they stack — and only on the stub.
- Docking is a VIEW toggle (the anchor button, on by default): free mode
  attaches a wire wherever on the perimeter routes cheapest (any side,
  corners and their two neighbouring cells excluded, centre-biased, dock
  points claimed so no two wires share one); port mode pins wires to the
  classic fixed ports - inputs left, outputs right, storage side centres.
  Ports always remain where wires START (drag from a chip) and where the
  numbers live.
- Routing must stay deterministic for the same graph state, independent of
  zoom and render order (edges are solved in routeIndex order).
- Edge rate labels are a VIEW mode, off by default: the tag button in the
  board toolbar shows lean rate pills on the lines. No dragging, no popover.

## Import/Export Plans

- Plan import/export must preserve item/fluid identity. `fluid.*` showing in UI usually means fluid IDs were imported without resolving display resource metadata.
- When importing image-embedded or JSON plans, preserve node recipe overrides, selected machine handler, tier/config selections, and concrete oredict alternatives.
- Creating a storage/drawer by dragging from a recipe slot must create both the storage node and the edge.

## Performance

- Performance is a first-class requirement, especially on the flow board. Read
  `ARCHITECTURE.md` (root) before touching board, routing, or rendering code —
  it documents the invariants (viewport-independent routing, published
  geometry, content-keyed cache invalidation, identity reuse, frozen drags,
  localized route scoring) and the Playwright + CDP profiler stress workflow.
- Anything O(nodes) per frame is suspect; anything O(nodes × edges) per frame
  is a bug. No DOM measurement per edge/per frame. Hover must not rebuild the
  board.
- Perf-sensitive changes need a before/after check with the stress workflow,
  not just green tests.

## The Equation Books (solver rebuild, branch solver-equations)

- The BOOKS - every act, edge flow and eaten total - come from ONE direct LP
  solve in `src/lib/solver/equations-core.ts`, wired into `throughput.ts`
  behind `const EQUATION_BOOKS = true` (one-line revert). The iterative
  engine in `equilibrium.ts` still runs and keeps the DIAGNOSIS: capability,
  clog names, "one wire fixes it". If the core returns non-optimal the old
  books stand, so a solve failure degrades, never crashes.
- The doctrine (Jack, 2026-08-19): if it would fail in the game it fails in
  the planner, and otherwise EVERYTHING RUNS - a fed machine with somewhere
  to put its output never idles. Sources are inputs; products, byproducts
  and OVERSPILLING drawers are outputs. A plain buffer banks its surplus
  (visible +N/s); `bufferMode: "strict"` opts back into the clog. A
  byproduct pill changes bookkeeping, never pace. Targets are display
  arithmetic, not rows - a target-driven >100% figure survives in finalize,
  a demand-driven one does not.
- The drain pill cycles THREE ways since 2026-08-23: product, byproduct,
  trash. A TRASH drawer is the byproduct's shape (free disposal, no demand)
  with the books voided (`applyTrashedOutputBalances` covers it alongside
  the legacy trash can nodes): what it eats is neither shipped nor spare.
  The toolbar's trash can spawner is gone, and old plans CONVERT on load:
  `migrateTrashCansToDrawers` in project-normalize.ts turns every wired can
  into trash-mode drawers (one per resource, since a can drank anything and
  a drawer holds one thing) and drops unwired cans. The can node type,
  `connectTrash` and the solver's trash-role plumbing remain as dead-path
  safety for projects that never pass the normalize funnel.
- Stage chain, each optimum locked as a row before the next: max total act;
  progressive max-min FAIRNESS over acts (the game's round-robin split - a
  big asker cannot crush a small one); recycle-before-import; ship-before-
  banking (min pool fill); min total flow (canonical determinism). There is
  deliberately NO product-purpose stage - it starved real machines to fatten
  export drawers - and no "least machinery" stage - it idled machines the
  game would run.
- EQUAL-FILL rows encode round-robin as physics: machine co-consumers of one
  output port fill at the same per-pull rate (a sibling's share of its pull
  never exceeds a clean co-consumer's act). This is what makes a TAPPED
  break-even ring die instead of pretending its tap never pulls - the LP
  contains that fantasy point and these rows exclude it. Consumers the
  diagnosis marks output-throttled (disposal < 1), power-stalled or
  bare-ported are exempt (their chest fills; the port serves the others).
  Only OUTPUT-side figures may drive the exemption - using supply-aware
  capability exempted the starving tap itself.
- The LP engine is the homegrown two-phase dense simplex in
  `src/lib/solver/simplex.ts` (Dantzig entering rule, permanent Bland
  fallback after a 60-pivot degenerate stall, row equilibration,
  deterministic). Its one historical bug - degenerate artificials surviving
  phase 1 through slack columns, then silently regrowing in phase 2 - is
  fixed and pinned by the doctrine exam. Known straggler: ONE community
  board ("Total Oil Products", 73 machines of heavily degenerate oil
  chains) exhausts the iteration cap and falls back to the old books; the
  other 153/154 solve, and HiGHS solved it in the lab if a second-opinion
  engine is ever wanted in production.
  `src/lib/solver/equations-doctrine.test.ts` is the exam,
  `src/lib/solver/simplex.test.ts` pins the engine itself, and
  `docs/solver-equations.md` is the design page. The one surviving lab tool
  is the tick simulator (`src/lib/solver-lab/simulate.ts`), the independent
  "what does the game literally do" oracle; the lab's duplicate model
  builder and its HiGHS adapter were deleted with the `highs` dependency
  once the production core existed. Scratch harnesses belong in
  `*.local.test.*` files, which the vitest config excludes from the suite.
- Power stalls are pinned to act 0 INSIDE the LP so the outage propagates by
  conservation. Balance dust snaps at 1e-5 relative (`balances.ts`) because
  LP flows carry solver-precision dust proportional to board scale.

## Verification

- For code changes:

```bash
npm run typecheck
npm run test
```

- Run targeted synthetic dataset checks for normalizer changes when possible.
- For frontend behavior, use browser/Playwright screenshots when the bug is visual or interaction-based.
- For dataset changes, verify actual published `recipes.json.gz` or indexes after pipeline publish.

## Git Hygiene

- The worktree may contain unrelated/untracked files. Do not include them unless the user asked.
- Known local files that have appeared and should usually be ignored:
  - `platline-v4-1.generated.json`
  - `platline-v4-1.link-report.txt`
  - `platline-v4-1.linked.json`
  - `tools/import-export-public.mjs`
- Commit and push completed requested code changes unless the user explicitly says not to.
- Never reset or revert unrelated user changes.


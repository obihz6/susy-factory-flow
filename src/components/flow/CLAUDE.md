# The board (src/components/flow)

`FactoryFlow.tsx` hosts the React Flow canvas. `RecipeNode.tsx` is the machine card,
`StorageNode.tsx` the drawer, `BoardNode.tsx` / `PocketNode.tsx` an open / minimized
board, `grid-edge-router.ts` the wire router. Auto-arrange lives in
`src/lib/board-arrange*.ts`, the grid constants in `src/lib/board-grid.ts`.

## Performance invariants

The board must stay smooth with 100+ cards on weak PCs.

1. Routing is viewport-independent: routes depend only on flow-space geometry, never on
   zoom, pan or the DOM. React Flow culling is off, but DOM reads still leak viewport and
   mount state into routes.
2. Geometry is published, not measured ad hoc. `publishBoardGeometry` snapshots
   positions and sizes; it refreshes on a geometry fingerprint and explicitly on drop.
3. Caches key on content fingerprints, not object identity. Keep React Flow's `measured`
   sizes when rebuilding nodes, or every rebuild looks like a resize.
4. Identity is currency: node `data` through `reuseObjectIdentity`, edges through
   `reuseDeepObjectIdentity` (`layoutEpoch` is the deliberate bust), custom `memo`
   comparators on node components, stable callbacks for toolbar children.
5. During a node drag, connected wires show a straight preview and do no pathfinding.
   On drop, only incident edges are rerouted; cached routes for other edges stay pinned.
6. An effect that touches every card at once (the hop map, `hop-map.ts`) paints CSS
   custom properties; it does not go through React.
7. No `querySelectorAll` / `getBoundingClientRect` per edge, node or frame. No card
   subscribes to per-frame values (raw zoom, pointer); derive a coarse level
   (`node-detail.ts`). A hover re-renders one wrapper.
8. Round every DOM-measured routing input; sub-pixel jitter breaks determinism.
9. The scroll camera: only the wrapper scrolls. React rewrites the board's className,
   so hang CSS on data attributes. Per-frame CSS variables go on the smallest element;
   under the shell zoom animate left/width, not transforms.
10. Profile with Playwright + CDP Profiler (CPU throttle 6-20x) on a cloned stress plan. If
   route scoring shows up during pan, zoom or hover, a cache is being invalidated.

## Grid and card sizes

- `BOARD_GRID = 20`. Positions, card sizes and port-row centres are whole cells; check
  with a Playwright measurement, not by eye. The grid is always on (no snap toggle).
- Recipe card: 19 cells wide, 40px port rows, machine picture between the rails
  (flex-1, 96px, at least 2 rows tall). The card frame is an inset shadow, not a border.
- Port chips: name 9px, two-line clamp (`.flow-port-name` does ONLY the clamp; size and
  weight are utilities on the element so a late stylesheet can't burst the chip). Smaller
  type buys width; reach for it before shrinking the picture.
- Content-height blocks use `GridBlock`: round up to the next cell, never compress.

## Cards and ports

- The port ROW is the control: click = what makes it, right click = what uses it, R / U
  over the hovered row, long press = menu, drag = wire. The icon is `pointer-events-none`.
  `port-browse.ts` holds the hovered row imperatively; do not subscribe cards to it.
- Hover highlight (`flow-scope.ts`): a wire belongs to the recipe section its handle
  names; the walk passes through drawers and stops at the first machine.
- Every knob on a recipe card checks `checklistLocked()` at event time; drawer rate
  controls read `isReadOnly || checklistMode`. Wheel controls need `nowheel` or the
  camera takes the wheel.
- A shared-machine card stacks its recipes on one pair of rails (`SharedMachineRails`),
  each under a one-cell rule: share % and verdict word on the left, move up/down and
  remove keys on the right, no name. The picture spans them all.
  The machine menu lists the intersection of the sections' handlers
  (`getSharedMachineHandlers`; model rules in `src/lib/model/CLAUDE.md`).

## Drawers (StorageNode)

- A one-port machine card, 6x4 cells: a title bar (move grip, board menu, never starts a
  wire) and a port chip that answers exactly like a port row (`usePortRowBrowse`). Keep
  the two zones separate.
- Solve mode: source and product drawers show a rule row, a rule button (Any / At least /
  Exactly / At most) and a sunken rate box (`RuleInput`, `useRateRule`, `setStorageRule`).
  Any is `targetMode: "ignore"` or no number. Pool's table uses the same `RuleButton`
  in its "table" dress (`rate-rule.tsx`).
- Sources have no role switch (it would drop their wires). Buffer modes: overflow (banks
  surplus), strict (clogs), ratio (percent splits edited in `StorageRatioEditor.tsx`, a
  non-modal panel; branch percentages ride the wires near the drawer).
- Traps: `.storage-chip-text` must not set a z-index; drawer content is not clipped so
  lists can open past the edge; open lists carry `data-tooltip-stop`.
- Exams: `StorageRuleInput.test.tsx`, `../inspector/DrawerTargetRow.test.tsx`.

## Boards (containers)

- A board is a `FactoryPocket`: open (`expanded` + `size`, a window frame) or minimized
  (a summary card). There is no other container.
- A minimized board is a summary, not a machine: no ports, nothing wires to it. Its
  figures come from the plan-wide solve (`computePocketSummaries`): Needs / Makes (members
  netted, wires ignored, full speed) and Coming in / Going out (actual crossings), with
  no row cap (`pocketCardHeight` sizes it). Do not build a per-board scoped solve.
- Open boards: members are React Flow children with frame-relative positions. A card
  wholly inside a frame on drop joins it (deepest wins); dragged clear, it leaves.
  Frames never grow to swallow a drop.
- Nothing solid overlaps and nothing straddles a wall: `board-placement.ts` runs live
  while dragging (blockers computed once at drag start). Held cards whose board is also
  held are passengers (`dragPassengersRef`), or they would move twice.
- Nothing sits in two boards: `wrapSelectionInBoard` refuses, `selectionCanWrap` hides
  the button. `dissolvePocket` removes the frame and keeps the cards.
- Paper: `pocket.theme` (dark papers only); boards without one use `paperForBoardId`.
  Floors paint in `BoardFloors` (one portal at z -4); chrome sits at 15, between wires (10)
  and cards (20). Live marching dashes are off; `boardChromeOccluders` only cuts board
  chrome out of the export capture.
- Every `NodeToolbar` goes through `CameraNodeToolbar` and wears `nopan`; the scroll
  camera otherwise applies the pan twice and a press starts a pan.

## Wires and routing (grid-edge-router.ts)

- One deterministic solve over every edge (`solveGridRoutes`), independent of zoom and
  render order: plan docks per card so siblings don't cross (`planDocks`), route the
  thickest then longest wires first, keep the board with the fewest points (`retainBest`,
  `routePoints`), then rip up and reroute crossing wires with escalating costs and dock
  swaps. Never add per-edge scoring or special-case paths.
- Automated board routing uses four-direction orthogonal A* on the 20px grid; nothing
  within one cell of a card except the port stub. The general solver can retain diagonals
  for other routing clients, but board wires default to orthogonal paths.
- Diagonals only for trips whose card rims are 6+ cells apart, at least two cells
  long. Self loops use 90-degree turns and land a cell from their exit. Turns and
  crossings are priced; reversals are all but forbidden.
- Docking is free on the whole perimeter (corners excepted). Wire width follows flow
  (`laneWidthForHeat`) and wires sit under cards. No rate labels on wires, except
  ratio-drawer percentages. One drawn wire per material between two cards
  (`channelEdgeIdsByRepresentative`).
- Frames are routing obstacles but invisible to wire gestures. Wires inside a board pay to
  leave it (`costOutsideHome`); wires leaving pay per px spent inside (`costInsideExempt`).
- Every dial is in `router-tuning.ts` (`DEFAULT_ROUTER_TUNING`), editable per device in the
  dev menu. Arrange dials are left out of `routerTuningKey` so they never re-route.
- Past `ASYNC_ROUTE_EDGE_LIMIT` wires, routing runs in a worker (`grid-route-solve.ts`).
  A worker file must never import the module that spawns it (Turbopack hangs).
- Crossing hops (`wire-hops.ts`) are measured along the whole wire; arrows avoid hops.
- Count crossings with `measureWireRoutes` (`src/lib/route-metrics.ts`), which counts them
  at bends and run ends too. Tools: `router-replay.local.test.ts`,
  `node tools/audit-board.mjs <plan.json> <output-prefix> [--arrange] [--layout <file>]`
  (prints crossings, total length).

## Auto-arrange (src/lib/board-arrange*.ts)

- Three candidates (column pass, annealed challenger, free placement in
  `board-arrange-free.ts`), each judged by the real router on points (flow-weighted via
  `wireWeight`) plus stranger air; the best two are polished and the lower wins. The proxy
  scorer must price like the router and must never pin ports.
- The arrange dissolves every board first (`flattenBoards`) unless the "Keep boards on
  rearrange" browser setting is on. Islands emerge from `board-arrange-air.ts`
  (`islandAir`), not from cutting rules. Drawers are placed by pattern (a line beside
  their one machine, or between their two), not searched.
- Run the `free-explain` harness before tuning arrange weights. The free placement spots
  drawers by width, not role. Every router-judged search needs a time cap, not only a count.
- Cancel terminates the worker (`cancelArrange`). Keep the loader's `role=status`
  `aria-live=polite`; `tools/audit-board.mjs` waits on it.
- Harnesses in `src/lib/`: `arrange-capture`, `free-explain`, `versus`, `score-layout`,
  `proxy-score` (`*.local.test.ts`).

## Other board rules

- One right-click menu, `BoardContextMenu.tsx`. A control with its own right click calls
  `preventDefault`; board handlers skip prevented events.
- Calm mode is session-only and never stored: a stored flag once stranded players with no
  way to turn it off.
- No `fitView` prop: it fires after the plan loads and overwrites the restored camera.
  The app frames the camera itself wherever it puts cards on the board. Each design's
  camera is stored per browser (`src/lib/designs/design-camera.ts`), never in the plan.
- Toolbars fold by BOARD width using measured widths (`toolbar-fold.ts`; re-measure after
  adding a key), never onto a second line. `BOARD_TOOL_SCALE = 0.8`.
- Touch gestures are native capture-phase listeners (`board-touch-gestures.ts`). On compact
  screens a card drags only while selected.
- The help sheet (`BoardHelp.tsx`) is a computed layout of 280px cards hung from
  `data-help-anchor` rings; no per-card offsets.
- Checklist mode is presentation only; wires keep full routes in an invisible hit layer,
  and middle mouse and wheel still reach the camera.
- Animate values and routes through `board-motion.tsx`, never ad-hoc CSS transitions or
  node wrapper transforms.
- Card pictures: structure renders in `public/power-art` beat dataset icons, and can be
  edited in place (dataset icons are immutable).
- Sounds (`src/lib/board-sounds.ts`): ramp 10 ms or more, resume the context before
  scheduling, keep the output hot (inaudible keep-alive), overload protection stateless
  (tanh soft-clip, never a compressor); plan arrivals call `quietBoardSoundsFor`; judge
  "the plan changed" by `projectSoundFingerprint`, never object identity.

/**
 * Auto-arrange: one deterministic layout pass over the visible board.
 *
 * The shape it aims for is the one players draw by hand when they have the
 * patience. A factory plan is almost a TREE: one main product line, fed by
 * side chains, which are fed by their own side chains - with a few wires
 * that double back (recycles) or cross over (one pump feeding four
 * machines). So the layout leans into that:
 *
 *  - Flow runs LEFT TO RIGHT, raw inputs to final products, one column past
 *    the cards that feed you.
 *  - The TRUNK - the chain behind the plan's biggest final product - runs
 *    through the middle. Every feeder chain that joins it is a SECTION: its
 *    cards stay together as one contiguous band, big sections hugging the
 *    trunk, with clear air between bands. That is what kills spaghetti -
 *    a wire's two ends are almost always in the same band.
 *  - Recycles stay tight. The forward half of a loop reads left to right;
 *    the wire that doubles back hugs its own section instead of lassoing
 *    the board.
 *  - Wires want to be short and straight. Columns sit close (growing only
 *    when many wires must cross a boundary), and the vertical pass lines
 *    each card's ports up with the ports they feed, weighted by how much
 *    actually flows - the busiest lines get the straightest runs.
 *  - Cards with no wire to the main graph become their own islands below;
 *    cards wired to nothing at all are gathered onto a shelf at the bottom.
 *
 * The result is a pure function of the graph: same cards and wires in, same
 * layout out, regardless of camera, render order, or what the board looked
 * like before. Everything lands on the 20px grid.
 */

import { BOARD_GRID, cells, snapToGrid } from "./board-grid";
import {
  optimizeIslandLayout,
  routerPrices,
  scoreLayoutProxy,
  type OptimizeCard,
} from "./board-arrange-optimize";
import { makeAirTerm } from "./board-arrange-air";
import { DEFAULT_ROUTER_TUNING, type RouterTuning } from "@/components/flow/router-tuning";
import { arrangeFree } from "./board-arrange-free";

/** A card to place: its id, footprint, and where it sits today. */
export interface ArrangeCard {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * "storage" marks drawers, tanks and trash cans - the small tiles. A
   * storage whose every wire meets one machine becomes a SATELLITE: it
   * leaves the column system entirely and pins itself against that
   * machine's edge at the port it serves - supplies on the left, catches
   * on the right - the way players park them. Absent means machine.
   */
  role?: "machine" | "storage";
}

/** A wire between two cards, source makes the resource, target drinks it. */
export interface ArrangeWire {
  /**
   * The project edge behind this wire. A bridge between two islands that
   * would cut through a third gets steering stops back under this id;
   * wires without an id still place cards, they just cannot be steered.
   */
  id?: string;
  source: string;
  target: string;
  /**
   * The port's centre, measured from its card's TOP edge, when the board has
   * measured it. Absent (culled, never-rendered cards) falls back to the
   * card's vertical centre - alignment degrades gracefully, never breaks.
   */
  sourcePortY?: number;
  targetPortY?: number;
  /**
   * How much this wire matters, on any consistent scale (the board passes
   * a compressed live flow rate). Heavier wires pull harder in every pass:
   * their chain becomes the trunk, their ends sit closer, their runs come
   * out straighter. Absent means 1.
   */
  weight?: number;
  /**
   * The stroke the wire routes at, in px. The optimiser weighs wires by it
   * exactly as the router's points do (wireWeight in route-metrics.ts).
   */
  width?: number;
}

/** Ink (boxes, zones, notes, arrows): follows the cards it was written over. */
export interface ArrangeInk {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ArrangeMove {
  id: string;
  position: { x: number; y: number };
}

export interface ArrangeResult {
  moves: ArrangeMove[];
  /**
   * The rectangle every island landed in, in final board coordinates -
   * what an island box is drawn around. The shelf of strays is the last
   * entry when one exists.
   */
  islands: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    /**
     * Whether this island wants a drawn background. The shelf of strays and
     * an interchange buffer standing between two islands do not - a wash
     * under a lone drawer reads as clutter, not grouping.
     */
    backdrop: boolean;
  }>;
  /**
   * Steering for the bridges: a wire between two islands that would cut
   * through a third island's ground gets the same stops a player places by
   * hand, walking it around that ground. Wires inside an island never get
   * stops - routing there is the router's business.
   */
  wireRoutes: Array<{ id: string; waypoints: Array<{ x: number; y: number }> }>;
}

/**
 * The dials a player may want a hand on, all optional; absent means the
 * default taste. These map one-to-one onto the arrange settings panel.
 */
export interface ArrangeTaste {
  /** How much air everything gets. */
  spacing?: "compact" | "normal" | "roomy";
}

export interface ArrangeInput {
  cards: readonly ArrangeCard[];
  wires: readonly ArrangeWire[];
  ink?: readonly ArrangeInk[];
  /**
   * Where the arranged bounding box's top-left corner lands. Defaults to the
   * OLD bounding box's top-left, so a tidied plan stays in its own
   * neighbourhood instead of teleporting across board space.
   */
  origin?: { x: number; y: number };
  taste?: ArrangeTaste;
  /**
   * The judge of candidate layouts (board-arrange-optimize.ts): given
   * every card's top-left, how many crossings the board's real wires would
   * have. Built by the host on the board's own route requests, so the
   * arranger optimises the picture the player will actually get.
   */
  judge?: (
    positions: ReadonlyMap<string, { x: number; y: number }>,
    options?: {
      /**
       * A quicker verdict for the polish's many trials: the wires a moved
       * card touches are re-solved, the rest hold their routes from the
       * `base` layout. The final word is always the full verdict.
       */
      quick?: boolean;
      base?: ReadonlyMap<string, { x: number; y: number }>;
    },
  ) => {
    crossings: number;
    length: number;
    /** Length plus bends and crossings at the router's prices: the score. */
    points: number;
    /** Where wires cross, with the two wire ids, when the judge knows. */
    events?: Array<{ point: { x: number; y: number }; edges: [string, string] }>;
  };
  /**
   * Judge calls the exact polish may spend after the layout is chosen
   * (default 60). Each is a full solve of the board's wires.
   */
  polishBudget?: number;
  /**
   * The router's dials: the proxy prices its paths with them and the
   * `islandAir` dial sets how much air strangers owe each other. Read from
   * the tuning store when absent (the worker passes the host's).
   */
  tuning?: RouterTuning;
  /** Where the arrange is, as it goes: for a loader on the board. */
  onProgress?: (progress: { step: number; stage: string; done: number; total: number }) => void;
}

/* ---------------------------------------------------------------------- */
/* Spacing taste, all in whole cells.                                      */
/* ---------------------------------------------------------------------- */

/** A column corridor grows one cell per this many wires crossing it... */
const COLUMN_GAP_WIRES_PER_CELL = 3;
/** ...up to this much. */
const COLUMN_GAP_MAX = cells(10);
/** Island columns wrap to the next line past this width: plans read like
 * text, not like one endless ribbon. */
const ISLAND_ROW_MAX_WIDTH = cells(240);
/** Air between parked, unwired cards on the shelf. */
const SHELF_GAP = cells(2);
/** Ink counts as "written over" a card up to this far away from it. */
const INK_REACH = cells(2);

/* The taste dials, set once per arrangeBoard call from ArrangeTaste. They
 * live at module level because half the passes read them; applyTaste always
 * assigns EVERY one, so a call can never inherit the previous call's mood. */
/** The narrowest corridor between two columns. */
let COLUMN_GAP_MIN = cells(3);
/** Vertical air between stacked cards of one section. */
let ROW_GAP = cells(2);
/** Vertical air between two different sections sharing a column. */
let SECTION_GAP = cells(4);
/** Air around a whole island. Generous: separateness is the point. */
let ISLAND_GAP = cells(12);
/** The router's prices for this arrange (set by arrangeBoard). */
let ARRANGE_PRICES: RouterTuning | undefined;
/** The air owed between strangers at a set of positions (set by arrangeBoard). */
let ARRANGE_AIR: (positions: ReadonlyMap<string, { x: number; y: number }>) => number = () => 0;
/** Where the optimiser's search is, for the loader (set by arrangeBoard). */
let ARRANGE_SEARCH_PROGRESS: ((done: number, total: number) => void) | undefined;
/** Air between a satellite and the card it rides (horizontal). */
let SATELLITE_PAD = cells(2);
/** Air between satellites stacked on one side. */
let SATELLITE_STACK_GAP = cells(1);
/** Island scale only: fold a too-wide run of columns back like text. */
let PAGE_FOLD = false;

/**
 * The dev menu's Arrange dials override the taste's spacing (Jack,
 * 2026-09-08) - but only a dial someone has MOVED; at its default the
 * taste (compact, normal, roomy) still decides, so tests and callers that
 * ask for a taste get it.
 */
function applyArrangeDials(dials: RouterTuning | undefined): void {
  if (!dials) return;
  if (dials.arrangeRowGap !== DEFAULT_ROUTER_TUNING.arrangeRowGap) ROW_GAP = cells(dials.arrangeRowGap);
  if (dials.arrangeColumnGap !== DEFAULT_ROUTER_TUNING.arrangeColumnGap) {
    COLUMN_GAP_MIN = cells(dials.arrangeColumnGap);
  }
  if (dials.arrangeDrawerGap !== DEFAULT_ROUTER_TUNING.arrangeDrawerGap) {
    SATELLITE_PAD = cells(dials.arrangeDrawerGap);
  }
}

function applyTaste(taste: ArrangeTaste | undefined): void {
  const spacing = taste?.spacing ?? "normal";
  // Compact is what a hand draws (Jack's oil board, 2026-09-08): rows a
  // cell apart, columns two, drawers touching. Wire has to be paid for.
  ROW_GAP = cells(spacing === "compact" ? 1 : spacing === "roomy" ? 3 : 2);
  SECTION_GAP = cells(spacing === "compact" ? 2 : spacing === "roomy" ? 6 : 4);
  COLUMN_GAP_MIN = cells(spacing === "compact" ? 2 : spacing === "roomy" ? 5 : 3);
  // Wide enough that two islands' grounds plus both their two-cell no-go
  // collars fit between any pair with room left over.
  ISLAND_GAP = cells(spacing === "compact" ? 10 : spacing === "roomy" ? 16 : 12);
  SATELLITE_PAD = cells(spacing === "compact" ? 1 : 2);
  SATELLITE_STACK_GAP = cells(spacing === "compact" ? 0 : 1);
}

/**
 * Run the SAME layout engine at island scale: every gap swaps to the
 * island gap, then swaps back. Cards in an island and islands on the
 * board are one problem - this is what keeps it one engine.
 */
function atIslandScale<T>(run: () => T): T {
  const saved = {
    rowGap: ROW_GAP,
    sectionGap: SECTION_GAP,
    columnGapMin: COLUMN_GAP_MIN,
    satellitePad: SATELLITE_PAD,
    satelliteStackGap: SATELLITE_STACK_GAP,
  };
  // A touch tighter than the outer island gap: islands should cluster,
  // staying close enough to read as one factory while every ground keeps
  // room for a wire to walk around it.
  const metaGap = Math.max(ISLAND_GAP - cells(2), cells(8));
  ROW_GAP = metaGap;
  SECTION_GAP = metaGap;
  COLUMN_GAP_MIN = metaGap;
  SATELLITE_PAD = metaGap;
  SATELLITE_STACK_GAP = metaGap;
  PAGE_FOLD = true;
  try {
    return run();
  } finally {
    ROW_GAP = saved.rowGap;
    SECTION_GAP = saved.sectionGap;
    COLUMN_GAP_MIN = saved.columnGapMin;
    SATELLITE_PAD = saved.satellitePad;
    SATELLITE_STACK_GAP = saved.satelliteStackGap;
    PAGE_FOLD = false;
  }
}

/* ---------------------------------------------------------------------- */
/* Internal graph model.                                                   */
/* ---------------------------------------------------------------------- */

interface CardSlot {
  card: ArrangeCard;
  /** Position in the input array: the deterministic tiebreak everywhere. */
  index: number;
  layer: number;
  /** Global vertical theme: cards sort within their column by this. */
  seq: number;
  /** The band this card belongs to; a boundary between bands adds air. */
  section: number;
  /** On the main line. Trunk-to-trunk wires get the straightest runs. */
  trunk: boolean;
  y: number;
}

interface WireLink {
  id?: string;
  from: CardSlot;
  to: CardSlot;
  fromAnchor: number;
  toAnchor: number;
  weight: number;
  width?: number;
}

interface Placement {
  x: number;
  y: number;
}

/** Where a satellite storage rides: which machine, which side, which port. */
interface SatellitePlan {
  anchor: CardSlot;
  side: "left" | "right";
  /** Satellite top relative to the anchor's top, ports aligned. */
  offsetY: number;
}

/** One laid-out block (an island), positions relative to its own top-left. */
interface Block {
  ids: string[];
  places: Placement[];
  width: number;
  height: number;
  size: number;
  minIndex: number;
  /** The parked-strays shelf: always takes the bottom row of the page. */
  shelf?: boolean;
  /** No background wanted: an interchange buffer standing between islands. */
  plain?: boolean;
}

/**
 * The layout, then the challenger. The column pass lays the board out as
 * it always has; the optimiser (board-arrange-optimize.ts) then rearranges
 * each island against a router-shaped score. With a judge supplied by the
 * host, BOTH layouts are routed with the real router and the one with
 * fewer crossings wins, shorter wire breaking the tie - so an arrange is
 * never worse than the plain pass on the board's own wires. Without a
 * judge the plain pass stands: the optimiser's proxy is not to be trusted
 * unjudged.
 */
export function arrangeBoard(rawInput: ArrangeInput): ArrangeResult {
  // ISLANDS ARE EMERGENT (Jack, 2026-09-08). The one readability term on
  // top of the router's points is the air strangers owe each other
  // (board-arrange-air.ts), and it is in the objective EVERYWHERE - the
  // proxy the search runs on, the finalists the router judges, the polish
  // and the choice between the plain pass and the challenger - so the
  // judge never undoes what the search found. The player's score in the
  // dev menu stays pure routing points.
  ARRANGE_PRICES = rawInput.tuning ?? routerPrices();
  ARRANGE_AIR = makeAirTerm(rawInput.cards, rawInput.wires, ARRANGE_PRICES.islandAir);
  const airOf = (positions: ReadonlyMap<string, { x: number; y: number }>) => ARRANGE_AIR(positions);
  const input: ArrangeInput = rawInput.judge
    ? {
        ...rawInput,
        judge: (positions, options) => {
          const verdict = rawInput.judge!(positions, options);
          return { ...verdict, points: verdict.points + airOf(positions) };
        },
      }
    : rawInput;
  input.onProgress?.({ step: 0, stage: "Laying the board out", done: 0, total: 1 });
  const plain = arrangeBoardOnce(input, false);
  if (input.cards.length < 2) {
    return plain;
  }
  const proxy = (result: ArrangeResult) =>
    scoreLayoutProxy(
      input.cards,
      input.wires.map((wire) => ({ ...wire })),
      new Map(result.moves.map((move) => [move.id, move.position])),
      ARRANGE_PRICES!,
      airOf,
    );
  if (!input.judge) {
    // No router at hand: the proxy chooses among the plain pass, the
    // challenger and the free placement, the way it chose among the
    // challenger's own trials.
    const challenger = arrangeBoardOnce(input, true);
    const free = arrangeFreeCandidate(input);
    return [plain, challenger, free].sort((a, b) => proxy(a) - proxy(b))[0];
  }
  input.onProgress?.({ step: 1, stage: "Searching for a better layout", done: 0, total: 1 });
  ARRANGE_SEARCH_PROGRESS = (done, total) =>
    input.onProgress?.({ step: 1, stage: "Searching for a better layout", done, total });
  const challenger = arrangeBoardOnce(input, true);
  ARRANGE_SEARCH_PROGRESS = undefined;
  // THE THIRD CANDIDATE (Jack, 2026-09-08): a placement with no columns at
  // all, from graph distance and a free search (board-arrange-free.ts).
  const free = arrangeFreeCandidate(input);
  input.onProgress?.({ step: 2, stage: "Routing the candidates", done: 0, total: 1 });
  const verdict = (result: ArrangeResult) =>
    input.judge!(new Map(result.moves.map((move) => [move.id, move.position])));
  // The two best by the router's verdict are polished - they start from
  // different structures and the polish is greedy, so each can reach a
  // place the other cannot - and the better finished board wins.
  const named = [
    { name: "plain", result: plain },
    { name: "challenger", result: challenger },
    { name: "free", result: free },
  ];
  const ranked = named
    .map(({ name, result }) => ({ name, result, verdict: verdict(result) }))
    .sort((a, b) => a.verdict.points - b.verdict.points);
  // For the offline harnesses: which candidate the router preferred, and by how much.
  (globalThis as { __arrangeCandidates?: unknown }).__arrangeCandidates = ranked.map((entry) => ({
    name: entry.name,
    crossings: entry.verdict.crossings,
    points: Math.round(entry.verdict.points),
  }));
  const polishedFirst = polishWithJudge(input, ranked[0].result, ranked[0].verdict, "first");
  const polishedSecond = polishWithJudge(input, ranked[1].result, ranked[1].verdict, "second");
  input.onProgress?.({ step: 5, stage: "Choosing the better board", done: 1, total: 1 });
  const finalFirst = verdict(polishedFirst);
  const finalSecond = verdict(polishedSecond);
  // POINTS decide (Jack, 2026-09-08): a crossing is already priced into
  // them at the crossing dial, and a board that avoids one by sending a
  // wire round the whole board has paid more than the crossing cost.
  return finalSecond.points < finalFirst.points ? polishedSecond : polishedFirst;
}

/** The free placement as an ArrangeResult: component boxes, no steering. */
function arrangeFreeCandidate(input: ArrangeInput): ArrangeResult {
  const prices = ARRANGE_PRICES ?? routerPrices();
  const spacing = input.taste?.spacing ?? "normal";
  const placed = arrangeFree(input.cards, input.wires, {
    prices,
    // Per card, not per board: a trial is one card's move re-priced
    // incrementally, so a bigger board needs proportionally more of them.
    trials: Math.max(prices.searchTrials, 1500 * input.cards.length),
    gapCells: ROW_GAP / BOARD_GRID,
    besideCells: spacing === "compact" ? 2 : spacing === "roomy" ? 5 : 3,
    onProgress: (done, total) =>
      input.onProgress?.({ step: 1, stage: "Placing freely", done, total }),
  });
  const origin = input.origin ?? boundingTopLeft(input.cards);
  const newById = new Map<string, { x: number; y: number }>();
  const moves: ArrangeMove[] = input.cards.map((card) => {
    const p = placed.positions.get(card.id) ?? { x: 0, y: 0 };
    const position = { x: origin.x + p.x, y: origin.y + p.y };
    newById.set(card.id, position);
    return { id: card.id, position };
  });
  followInk(input, newById, moves);
  const islands = placed.islands.map((island) => ({
    ...island,
    x: origin.x + island.x,
    y: origin.y + island.y,
  }));
  return { moves, islands, wireRoutes: [] };
}

/**
 * The column candidates alone, plain versus challenger, chosen the way the
 * whole arrange chooses. For tests of the column pass's own mechanisms
 * (sections, satellites, the fold); the arrange itself is `arrangeBoard`.
 */
export function arrangeBoardColumns(rawInput: ArrangeInput): ArrangeResult {
  ARRANGE_PRICES = rawInput.tuning ?? routerPrices();
  ARRANGE_AIR = makeAirTerm(rawInput.cards, rawInput.wires, ARRANGE_PRICES.islandAir);
  const airOf = (positions: ReadonlyMap<string, { x: number; y: number }>) => ARRANGE_AIR(positions);
  const plain = arrangeBoardOnce(rawInput, false);
  if (rawInput.cards.length < 2) {
    return plain;
  }
  const challenger = arrangeBoardOnce(rawInput, true);
  const proxy = (result: ArrangeResult) =>
    scoreLayoutProxy(
      rawInput.cards,
      rawInput.wires.map((wire) => ({ ...wire })),
      new Map(result.moves.map((move) => [move.id, move.position])),
      ARRANGE_PRICES!,
      airOf,
    );
  return proxy(challenger) < proxy(plain) ? challenger : plain;
}

/**
 * THE EXACT POLISH. The layout is done; now the real router says where the
 * wires still cross, and the cards on those wires are tried elsewhere -
 * swapped with a column neighbour, or set down beside a partner on any of
 * its four sides - each try judged by the router itself. The first try
 * that lowers the crossings (or keeps them and shortens the wire) is
 * taken, and the search goes again from there until nothing helps or the
 * budget of judge calls is spent. This is what a player does by hand: look
 * at the crossing, move the card. Every try keeps the grid and the
 * no-overlap rule; nothing else on the board moves.
 */
/**
 * How long one polish may run, on top of its count of judge calls. Two
 * polishes per arrange, so the pair takes at most twice this plus the
 * verdict in flight when time runs out. The oil board's polish spends a
 * couple of seconds; a board routing in seconds per verdict hits this.
 */
const POLISH_TIME_MS = 8_000;

function polishWithJudge(
  input: ArrangeInput,
  result: ArrangeResult,
  verdict: {
    crossings: number;
    length: number;
    points: number;
    events?: Array<{ point: { x: number; y: number }; edges: [string, string] }>;
  },
  which: "first" | "second" = "first",
): ArrangeResult {
  const judge = input.judge;
  if (!judge) {
    return result;
  }
  const fullBudget = input.polishBudget ?? ARRANGE_PRICES?.polishBudget ?? 100;
  let budget = fullBudget;
  // The budget is a COUNT of judge calls, and on a big board each call is
  // a whole-board route that can take seconds - Jack watched "Polishing
  // the first layout, 110 crossings" for five minutes (2026-09-08). So
  // each polish also has a wall-clock allowance: the verdict under way
  // finishes, and the next one is not asked for. The bar reads whichever
  // of the two is further along, so it keeps moving on a slow board.
  const startedAt = performance.now();
  const deadline = startedAt + POLISH_TIME_MS;
  const spend = () => {
    budget = performance.now() > deadline ? 0 : budget - 1;
  };
  const report = () =>
    input.onProgress?.({
      step: which === "first" ? 3 : 4,
      // The step label already says which layout; this is the detail line
      // beside it, short enough not to be cut off.
      stage: `${verdict.crossings} crossings to start`,
      done: Math.min(
        fullBudget,
        Math.max(fullBudget - budget, (fullBudget * (performance.now() - startedAt)) / POLISH_TIME_MS),
      ),
      total: fullBudget,
    });
  report();
  const sizeById = new Map(input.cards.map((card) => [card.id, { width: card.width, height: card.height }]));
  const wiresOf = new Map<string, ArrangeWire[]>();
  for (const wire of input.wires) {
    push(wiresOf, wire.source, wire);
    push(wiresOf, wire.target, wire);
  }
  const wireById = new Map(input.wires.filter((wire) => wire.id).map((wire) => [wire.id!, wire]));
  const positions = new Map(result.moves.map((move) => [move.id, { ...move.position }]));
  // The search runs on quick verdicts against a fully judged BASE: a move
  // is tried with only its own wires re-solved, and when it wins, the new
  // layout gets the full verdict and becomes the base.
  let base = new Map(positions);
  let best = verdict;
  const start = { positions: new Map(positions), verdict };
  const gap = BOARD_GRID;
  const overlaps = (id: string, x: number, y: number): boolean => {
    const size = sizeById.get(id)!;
    for (const [other, at] of positions) {
      if (other === id) continue;
      const otherSize = sizeById.get(other)!;
      if (
        x < at.x + otherSize.width + gap &&
        x + size.width + gap > at.x &&
        y < at.y + otherSize.height + gap &&
        y + size.height + gap > at.y
      ) {
        return true;
      }
    }
    return false;
  };
  const tried = new Set<string>();
  // A machine moves with the drawers that serve only it, the way a hand
  // drags a machine and its buds together.
  const budsOf = new Map<string, string[]>();
  for (const [id, size] of sizeById) {
    if (size.width > cells(6)) continue;
    const partners = new Set((wiresOf.get(id) ?? []).map((wire) => (wire.source === id ? wire.target : wire.source)));
    if (partners.size === 1) {
      const [anchor] = partners;
      if (sizeById.get(anchor)!.width > cells(6)) push(budsOf, anchor, id);
    }
  }
  const groupOf = (id: string): string[] => [id, ...(budsOf.get(id) ?? [])];
  const groupOverlaps = (group: string[], dx: number, dy: number): boolean => {
    const set = new Set(group);
    for (const member of group) {
      const at = positions.get(member)!;
      const size = sizeById.get(member)!;
      const x = at.x + dx;
      const y = at.y + dy;
      for (const [other, otherAt] of positions) {
        if (set.has(other)) continue;
        const otherSize = sizeById.get(other)!;
        if (
          x < otherAt.x + otherSize.width + gap &&
          x + size.width + gap > otherAt.x &&
          y < otherAt.y + otherSize.height + gap &&
          y + size.height + gap > otherAt.y
        ) {
          return true;
        }
      }
    }
    return false;
  };
  for (let round = 0; round < 40 && budget > 0; round += 1) {
    // Cards on crossing wires, the most-crossed first; drawers before
    // machines because a drawer is cheap to move.
    const blame = new Map<string, number>();
    // The far end of each crossing wire, per card: the partner a move
    // should bring the card toward.
    const crossingPartners = new Map<string, Set<string>>();
    for (const event of best.events ?? []) {
      for (const edgeId of event.edges) {
        const wire = wireById.get(edgeId);
        if (!wire) continue;
        blame.set(wire.source, (blame.get(wire.source) ?? 0) + 1);
        blame.set(wire.target, (blame.get(wire.target) ?? 0) + 1);
        if (!crossingPartners.has(wire.source)) crossingPartners.set(wire.source, new Set());
        if (!crossingPartners.has(wire.target)) crossingPartners.set(wire.target, new Set());
        crossingPartners.get(wire.source)!.add(wire.target);
        crossingPartners.get(wire.target)!.add(wire.source);
      }
    }
    // Nothing crosses: the cards on the longest wires are the suspects,
    // since every remaining point is wire and bends.
    if (blame.size === 0) {
      for (const wire of input.wires) {
        const a = positions.get(wire.source);
        const b = positions.get(wire.target);
        if (!a || !b) continue;
        const span = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        blame.set(wire.source, Math.max(blame.get(wire.source) ?? 0, span));
        blame.set(wire.target, Math.max(blame.get(wire.target) ?? 0, span));
      }
      if (blame.size === 0) break;
    }
    // The most-crossed card first: it is the one standing in the wrong
    // place. Drawers break ties, being cheap to move.
    const suspects = [...blame.keys()].sort((a, b) => {
      const storageA = sizeById.get(a)!.width <= cells(6) ? 1 : 0;
      const storageB = sizeById.get(b)!.width <= cells(6) ? 1 : 0;
      return blame.get(b)! - blame.get(a)! || storageB - storageA || (a < b ? -1 : 1);
    });
    let improved = false;
    for (const id of suspects) {
      if (improved || budget <= 0) break;
      const size = sizeById.get(id)!;
      const partners = [...new Set((wiresOf.get(id) ?? []).map((wire) => (wire.source === id ? wire.target : wire.source)))]
        .filter((partner) => positions.has(partner));
      const candidates: Array<{ x: number; y: number }> = [];
      const add = (x: number, y: number) => {
        x = snapToGrid(x);
        y = snapToGrid(y);
        const key = `${id}@${x},${y}`;
        if (tried.has(key)) return;
        const home = positions.get(id)!;
        if (groupOverlaps(groupOf(id), x - home.x, y - home.y)) return;
        tried.add(key);
        candidates.push({ x, y });
      };
      const own = positions.get(id)!;
      const group = groupOf(id);
      for (const partner of partners) {
        const at = positions.get(partner)!;
        const partnerSize = sizeById.get(partner)!;
        const rows = [at.y, at.y + partnerSize.height - size.height, at.y + (partnerSize.height - size.height) / 2];
        const columns = [at.x, at.x + partnerSize.width - size.width, at.x + (partnerSize.width - size.width) / 2];
        for (const y of rows) {
          add(at.x - size.width - 2 * gap, y);
          add(at.x + partnerSize.width + 2 * gap, y);
          // A slide in its own column, level with the partner.
          add(own.x, y);
        }
        for (const x of columns) {
          add(x, at.y - size.height - 2 * gap);
          add(x, at.y + partnerSize.height + 2 * gap);
        }
      }
      // Nearest a partner first: the smallest move that helps is the one a
      // hand would make.
      // The partners on the crossing wires count four times over: it is
      // the wire that crosses that the move has to shorten.
      const wanted = crossingPartners.get(id);
      const distance = (p: { x: number; y: number }) =>
        partners.reduce((sum, partner) => {
          const at = positions.get(partner)!;
          const partnerSize = sizeById.get(partner)!;
          const weight = wanted?.has(partner) ? 4 : 1;
          return (
            sum +
            weight *
              (Math.max(0, at.x - p.x - size.width, p.x - at.x - partnerSize.width) +
                Math.max(0, at.y - p.y - size.height, p.y - at.y - partnerSize.height))
          );
        }, 0) + Math.abs(p.x - own.x) * 0.1 + Math.abs(p.y - own.y) * 0.1;
      candidates.sort((a, b) => distance(a) - distance(b));
      for (const candidate of candidates.slice(0, 18)) {
        if (budget <= 0) break;
        const saved = new Map(group.map((member) => [member, positions.get(member)!]));
        const dx = candidate.x - own.x;
        const dy = candidate.y - own.y;
        for (const member of group) {
          const at = saved.get(member)!;
          positions.set(member, { x: at.x + dx, y: at.y + dy });
        }
        const quick = judge(positions, { quick: true, base });
        spend();
        report();
        if (typeof process !== "undefined" && process.env?.ARRANGE_DEBUG) {
          console.log("try", id.slice(0, 14), candidate.x, candidate.y, "quick", quick.crossings, Math.round(quick.points), "best", best.crossings, Math.round(best.points));
        }
        // A crossing fewer is always worth the full verdict; a length gain
        // must be real (two percent) to be worth one.
        if (quick.points < best.points * 0.98) {
          const next = judge(positions);
          if (next.points < best.points - 1) {
            best = next;
            base = new Map(positions);
            improved = true;
            break;
          }
        }
        for (const [member, at] of saved) positions.set(member, at);
      }
      if (improved || budget <= 0) break;
      // SWAPS: trade places with a card in the same column - the move
      // that fixes a wire climbing past its neighbours' wires. Each card
      // takes the other's top-left, buds riding along; both must fit.
      const swapKeys = new Set<string>();
      for (const [other, otherAt] of positions) {
        if (budget <= 0 || improved) break;
        if (other === id || group.includes(other) || groupOf(other).includes(id)) continue;
        const otherSize = sizeById.get(other)!;
        const sameColumn = own.x < otherAt.x + otherSize.width && otherAt.x < own.x + size.width;
        if (!sameColumn) continue;
        const key = [id, other].sort().join("<>") + `@${own.x},${own.y}|${otherAt.x},${otherAt.y}`;
        if (tried.has(key) || swapKeys.has(key)) continue;
        swapKeys.add(key);
        tried.add(key);
        const otherGroup = groupOf(other);
        const both = [...group, ...otherGroup];
        const saved = new Map(both.map((member) => [member, positions.get(member)!]));
        const dxA = otherAt.x - own.x;
        const dyA = otherAt.y - own.y;
        for (const member of group) {
          const at = saved.get(member)!;
          positions.set(member, { x: at.x + dxA, y: at.y + dyA });
        }
        for (const member of otherGroup) {
          const at = saved.get(member)!;
          positions.set(member, { x: at.x - dxA, y: at.y - dyA });
        }
        // Neither group may land on anything (the other group included).
        let legal = true;
        for (const member of both) {
          const at = positions.get(member)!;
          const memberSize = sizeById.get(member)!;
          for (const [third, thirdAt] of positions) {
            if (third === member) continue;
            const thirdSize = sizeById.get(third)!;
            if (
              at.x < thirdAt.x + thirdSize.width + gap &&
              at.x + memberSize.width + gap > thirdAt.x &&
              at.y < thirdAt.y + thirdSize.height + gap &&
              at.y + memberSize.height + gap > thirdAt.y
            ) {
              legal = false;
              break;
            }
          }
          if (!legal) break;
        }
        if (legal) {
          const quick = judge(positions, { quick: true, base });
          spend();
          report();
          if (quick.points < best.points * 0.98) {
            const next = judge(positions);
            if (next.points < best.points - 1) {
              best = next;
              base = new Map(positions);
              improved = true;
              break;
            }
          }
        }
        for (const [member, at] of saved) positions.set(member, at);
      }
    }
    if (!improved) break;
  }
  // The full verdict decides: the polished layout only replaces the
  // starting one if it is truly better by the real router.
  const final = judge(positions);
  const keep = final.points < start.verdict.points;
  const chosen = keep ? positions : start.positions;
  return {
    ...result,
    moves: result.moves.map((move) => ({ ...move, position: chosen.get(move.id) ?? move.position })),
  };
}

/** Whether layoutIsland runs the optimiser; set per arrangeBoardOnce call. */
let OPTIMISE = false;

function arrangeBoardOnce(input: ArrangeInput, optimise: boolean): ArrangeResult {
  OPTIMISE = optimise;
  const { cards, wires } = input;
  if (cards.length === 0) {
    return { moves: [], islands: [], wireRoutes: [] };
  }
  applyTaste(input.taste);
  applyArrangeDials(ARRANGE_PRICES);

  const slotById = new Map<string, CardSlot>();
  cards.forEach((card, index) => {
    slotById.set(card.id, { card, index, layer: 0, seq: 0, section: 0, trunk: false, y: 0 });
  });

  // Wires with a missing end or both ends on one card place nothing.
  const links: WireLink[] = [];
  for (const wire of wires) {
    const from = slotById.get(wire.source);
    const to = slotById.get(wire.target);
    if (!from || !to || from === to) {
      continue;
    }
    links.push({
      id: wire.id,
      from,
      to,
      fromAnchor: wire.sourcePortY ?? from.card.height / 2,
      toAnchor: wire.targetPortY ?? to.card.height / 2,
      weight: Math.max(wire.weight ?? 1, 0.01),
      width: wire.width,
    });
  }

  // Drawers that serve exactly one machine leave the graph here and come
  // back at the very end, pinned against that machine's side. The layout
  // then only has to solve the machines and the true multi-way buffers.
  const satellitePlans = planSatellites(slotById, links);
  const mainLinks = links.filter(
    (link) => !satellitePlans.has(link.from) && !satellitePlans.has(link.to),
  );
  const anchors = new Set([...satellitePlans.values()].map((plan) => plan.anchor));

  // Split into islands: weakly-connected components of the wire graph.
  const componentOf = unionComponents(cards.length, mainLinks);
  const componentSlots = new Map<number, CardSlot[]>();
  for (const slot of slotById.values()) {
    if (satellitePlans.has(slot)) {
      continue;
    }
    const root = componentOf(slot.index);
    const members = componentSlots.get(root);
    if (members) {
      members.push(slot);
    } else {
      componentSlots.set(root, [slot]);
    }
  }

  const parked: CardSlot[] = [];
  const islandGroups: Array<{
    members: CardSlot[];
    links: WireLink[];
    satellites: Map<CardSlot, SatellitePlan>;
    /** A buffer standing alone between islands; drawn without a ground. */
    interchange?: boolean;
  }> = [];
  for (const members of componentSlots.values()) {
    // A card with no wires parks on the shelf - unless satellites ride on
    // it, which makes it a one-card island that keeps its drawers.
    if (
      members.length === 1 &&
      !mainLinks.some((l) => l.from === members[0] || l.to === members[0]) &&
      !anchors.has(members[0])
    ) {
      parked.push(members[0]);
      continue;
    }
    members.sort((a, b) => a.index - b.index);
    const componentSet = new Set(members);
    const componentLinks = mainLinks.filter((link) => componentSet.has(link.from));
    // One connected web is one island. Loose clusters used to be cut off
    // by a rule here (a branch hanging on by a wire or two); now they part
    // from the main body inside the search, because strangers owe each
    // other air (board-arrange-air.ts) - and only as far as that air is
    // worth against the bridge wire's length.
    for (const group of [members]) {
      const groupSet = new Set(group);
      const groupLinks = componentLinks.filter(
        (link) => groupSet.has(link.from) && groupSet.has(link.to),
      );
      const groupSatellites = new Map<CardSlot, SatellitePlan>();
      for (const [sat, plan] of satellitePlans) {
        if (groupSet.has(plan.anchor)) {
          groupSatellites.set(sat, plan);
        }
      }
      islandGroups.push({ members: group, links: groupLinks, satellites: groupSatellites });
    }
  }
  // A buffer SHARED ACROSS islands belongs to none of them. Only a storage
  // that two or more OTHER islands trade through steps out to stand alone
  // in the gap - a simple pass-through between two islands stays where the
  // split put it, part of that island's own chain. The island graph then
  // places the shared one between its users like any trader.
  {
    const prelim = new Map<CardSlot, number>();
    islandGroups.forEach((group, index) => {
      for (const slot of group.members) {
        prelim.set(slot, index);
      }
    });
    for (const group of [...islandGroups]) {
      for (const slot of [...group.members]) {
        if (group.members.length < 2 || slot.card.role !== "storage") {
          continue;
        }
        const ownGroup = prelim.get(slot);
        const otherGroups = new Set<number>();
        for (const link of mainLinks) {
          const other = link.from === slot ? link.to : link.to === slot ? link.from : undefined;
          if (!other) {
            continue;
          }
          const otherGroup = prelim.get(other);
          if (otherGroup !== undefined && otherGroup !== ownGroup) {
            otherGroups.add(otherGroup);
          }
        }
        if (otherGroups.size >= 2) {
          group.members = group.members.filter((member) => member !== slot);
          group.links = group.links.filter((link) => link.from !== slot && link.to !== slot);
          const ownSatellites = new Map<CardSlot, SatellitePlan>();
          for (const [sat, plan] of group.satellites) {
            if (plan.anchor === slot) {
              ownSatellites.set(sat, plan);
              group.satellites.delete(sat);
            }
          }
          islandGroups.push({
            members: [slot],
            links: [],
            satellites: ownSatellites,
            interchange: true,
          });
          prelim.set(slot, islandGroups.length - 1);
        }
      }
    }
  }

  islandGroups.sort(
    (a, b) =>
      b.members.length + b.satellites.size - (a.members.length + a.satellites.size) ||
      a.members[0].index - b.members[0].index,
  );

  // The island flow BEFORE any island is laid out: which island stands
  // upstream of which. Each island's internal layout then knows which side
  // its bridge cards should lean toward, so a bridge leaves the FACING
  // edge instead of dragging across its own island.
  const groupOfCard = new Map<string, number>();
  islandGroups.forEach((group, index) => {
    for (const slot of group.members) {
      groupOfCard.set(slot.card.id, index);
    }
    for (const sat of group.satellites.keys()) {
      groupOfCard.set(sat.card.id, index);
    }
  });
  const bridgeLinks: Array<{ from: number; to: number; weight: number; link: WireLink }> = [];
  for (const link of mainLinks) {
    const fromGroup = groupOfCard.get(link.from.card.id);
    const toGroup = groupOfCard.get(link.to.card.id);
    if (fromGroup === undefined || toGroup === undefined || fromGroup === toGroup) {
      continue;
    }
    bridgeLinks.push({ from: fromGroup, to: toGroup, weight: link.weight, link });
  }
  const islandLayer = islandFlowLayers(
    islandGroups.map((_, index) => index),
    bridgeLinks,
  );
  const exitsByGroup: Array<Map<string, number>> = islandGroups.map(() => new Map());
  for (const bridge of bridgeLinks) {
    const direction = Math.sign(
      (islandLayer.get(bridge.to) ?? 0) - (islandLayer.get(bridge.from) ?? 0),
    );
    if (direction === 0) {
      continue;
    }
    const fromExits = exitsByGroup[bridge.from];
    const fromId = bridge.link.from.card.id;
    fromExits.set(fromId, (fromExits.get(fromId) ?? 0) + direction * bridge.weight);
    const toExits = exitsByGroup[bridge.to];
    const toId = bridge.link.to.card.id;
    toExits.set(toId, (toExits.get(toId) ?? 0) - direction * bridge.weight);
  }

  const layoutAll = (
    pullsByGroup?: Array<Map<string, Array<{ y: number; weight: number; anchor: number }>>>,
  ): Block[] => {
    const built = islandGroups.map((group, index) => {
      const pulls = pullsByGroup?.[index];
      const block = layoutIsland(
        group.members,
        group.links,
        group.satellites,
        exitsByGroup[index],
        pulls && pulls.size > 0 ? pulls : undefined,
        links,
        input.judge,
      );
      if (group.interchange) {
        block.plain = true;
      }
      return block;
    });
    if (parked.length > 0) {
      built.push(layoutShelf(parked, built[0]?.width ?? 0));
    }
    return built;
  };
  let blocks = layoutAll();

  const origin = input.origin ?? boundingTopLeft(cards);
  const originX = snapToGrid(origin.x);
  const originY = snapToGrid(origin.y);

  // The islands trade with each other, so WHERE each island stands follows
  // the same rules as the cards inside one - literally: the blocks go
  // through the same engine as meta-cards.
  const assemble = () => {
    const local = new Map<string, Placement>();
    blocks.forEach((block) => {
      block.ids.forEach((id, i) => {
        local.set(id, block.places[i]);
      });
    });
    return local;
  };
  let localPlaceOfCard = assemble();
  let offsets = placeIslands(blocks, bridgeLinks, localPlaceOfCard);

  // The second pass. With every island standing somewhere real, each
  // bridge's far end is a known point - so every island lays itself out
  // once more with its bridges pulling their exit cards toward where the
  // partner actually is. A wire to the island below now leaves from the
  // bottom edge, not the top corner, and the islands are placed again
  // around the reshaped blocks.
  if (bridgeLinks.length > 0) {
    const pullsByGroup = islandGroups.map(
      () => new Map<string, Array<{ y: number; weight: number; anchor: number }>>(),
    );
    const addPull = (
      group: number,
      cardId: string,
      target: { y: number; weight: number; anchor: number },
    ) => {
      const map = pullsByGroup[group];
      const list = map.get(cardId);
      if (list) {
        list.push(target);
      } else {
        map.set(cardId, [target]);
      }
    };
    for (const bridge of bridgeLinks) {
      const fromLocal = localPlaceOfCard.get(bridge.link.from.card.id)!;
      const toLocal = localPlaceOfCard.get(bridge.link.to.card.id)!;
      // Heavy on purpose: the exit card goes to the partner's level even
      // when its own island's wires would rather keep it.
      const weight = bridge.weight * 5;
      addPull(bridge.from, bridge.link.from.card.id, {
        y: offsets[bridge.to].y + toLocal.y + bridge.link.toAnchor - offsets[bridge.from].y,
        weight,
        anchor: bridge.link.fromAnchor,
      });
      addPull(bridge.to, bridge.link.to.card.id, {
        y: offsets[bridge.from].y + fromLocal.y + bridge.link.fromAnchor - offsets[bridge.to].y,
        weight,
        anchor: bridge.link.toAnchor,
      });
    }
    blocks = layoutAll(pullsByGroup);
    localPlaceOfCard = assemble();
    offsets = placeIslands(blocks, bridgeLinks, localPlaceOfCard);
  }

  const moves: ArrangeMove[] = [];
  const islands: ArrangeResult["islands"] = [];
  const newById = new Map<string, Placement>();
  blocks.forEach((block, blockIndex) => {
    const blockX = snapToGrid(originX + offsets[blockIndex].x);
    const blockY = snapToGrid(originY + offsets[blockIndex].y);
    block.ids.forEach((id, i) => {
      const position = {
        x: blockX + block.places[i].x,
        y: blockY + block.places[i].y,
      };
      moves.push({ id, position });
      newById.set(id, position);
    });
    islands.push({
      x: blockX,
      y: blockY,
      width: block.width,
      height: block.height,
      backdrop: !block.shelf && !block.plain,
    });
  });

  followInk(input, newById, moves);

  // Bridges never cut through a foreign island. A wire between two islands
  // that would pass OVER a third gets steering stops walking it around that
  // island's ground - because the router routes around CARDS, not around
  // the ground an island stands on. The hit is judged against the island's
  // own rectangle, so a wire passing NEAR an island earns nothing; the
  // detour lane is laid on the no-go collar, two cells clear of the box.
  const wireRoutes: ArrangeResult["wireRoutes"] = [];
  {
    const collar = cells(4);
    const grounds = islands.map((island) => ({
      tight: {
        left: island.x,
        top: island.y,
        right: island.x + island.width,
        bottom: island.y + island.height,
      },
      lane: {
        left: island.x - collar,
        top: island.y - collar,
        right: island.x + island.width + collar,
        bottom: island.y + island.height + collar,
      },
    }));
    for (const bridge of bridgeLinks) {
      if (bridge.link.id === undefined) {
        continue;
      }
      const fromPosition = newById.get(bridge.link.from.card.id);
      const toPosition = newById.get(bridge.link.to.card.id);
      if (!fromPosition || !toPosition) {
        continue;
      }
      const stops = routeAroundGrounds(
        {
          x: fromPosition.x + bridge.link.from.card.width,
          y: fromPosition.y + bridge.link.fromAnchor,
        },
        { x: toPosition.x, y: toPosition.y + bridge.link.toAnchor },
        grounds.filter((_, index) => index !== bridge.from && index !== bridge.to),
      );
      if (stops.length > 0) {
        wireRoutes.push({ id: bridge.link.id, waypoints: stops });
      }
    }
  }

  return { moves, islands, wireRoutes };
}

/**
 * Ink follows the cards it overlapped: a note pinned on a machine, a box
 * framing a cluster, each rides the average displacement of the cards it
 * reached. Ink over empty canvas has nothing to follow and stays put.
 */
function followInk(
  input: ArrangeInput,
  newById: ReadonlyMap<string, { x: number; y: number }>,
  moves: ArrangeMove[],
): void {
  for (const ink of input.ink ?? []) {
    let deltaX = 0;
    let deltaY = 0;
    let touched = 0;
    for (const card of input.cards) {
      const moved = newById.get(card.id);
      if (!moved) {
        continue;
      }
      if (
        ink.x - INK_REACH < card.x + card.width &&
        ink.x + ink.width + INK_REACH > card.x &&
        ink.y - INK_REACH < card.y + card.height &&
        ink.y + ink.height + INK_REACH > card.y
      ) {
        deltaX += moved.x - card.x;
        deltaY += moved.y - card.y;
        touched += 1;
      }
    }
    if (touched > 0) {
      moves.push({
        id: ink.id,
        position: {
          x: snapToGrid(ink.x + deltaX / touched),
          y: snapToGrid(ink.y + deltaY / touched),
        },
      });
    }
  }
}

interface Ground {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Whether the segment from a to b passes through the box (Liang-Barsky). */
function segmentHitsGround(
  a: { x: number; y: number },
  b: { x: number; y: number },
  box: Ground,
): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) {
      return q >= 0;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) {
        return false;
      }
      if (r > t0) {
        t0 = r;
      }
    } else {
      if (r < t0) {
        return false;
      }
      if (r < t1) {
        t1 = r;
      }
    }
    return true;
  };
  // STRICT: a wire riding exactly along a ground's edge is not a hit -
  // counting touches turns every bridge through a shared corridor into a
  // detour for nothing.
  return (
    clip(-dx, a.x - box.left) &&
    clip(dx, box.right - a.x) &&
    clip(-dy, a.y - box.top) &&
    clip(dy, box.bottom - a.y) &&
    t0 < t1
  );
}

/**
 * Walk a straight run around every ground it would cut through: for each
 * offender in travel order, stops trace the nearer collar side, then the
 * walk continues toward the target. Every stop is CLAMPED inside the
 * run's own span - a stop the wire must double back for reads as broken -
 * and a walk still blocked after two detours places NO stops at all: the
 * router making its own way beats a trail of confused dots.
 */
function routeAroundGrounds(
  start: { x: number; y: number },
  end: { x: number; y: number },
  grounds: Array<{ tight: Ground; lane: Ground }>,
): Array<{ x: number; y: number }> {
  const stops: Array<{ x: number; y: number }> = [];
  let current = start;
  for (let guard = 0; guard <= 2; guard += 1) {
    const blockers = grounds.filter((ground) => segmentHitsGround(current, end, ground.tight));
    if (blockers.length === 0) {
      break;
    }
    if (guard === 2) {
      // Still blocked after two detours: this walk is lost. No stops.
      return [];
    }
    const horizontal = Math.abs(end.x - current.x) >= Math.abs(end.y - current.y);
    let next: { x: number; y: number };
    if (horizontal) {
      const rightward = end.x >= current.x;
      blockers.sort((a, b) =>
        rightward ? a.tight.left - b.tight.left : b.tight.right - a.tight.right,
      );
      const ground = blockers[0];
      const midY = (current.y + end.y) / 2;
      const laneY = snapToGrid(
        Math.abs(midY - ground.lane.top) <= Math.abs(midY - ground.lane.bottom)
          ? ground.lane.top
          : ground.lane.bottom,
      );
      const low = Math.min(current.x, end.x);
      const high = Math.max(current.x, end.x);
      const clamp = (value: number) => snapToGrid(Math.min(high, Math.max(low, value)));
      const enterX = clamp(rightward ? ground.lane.left : ground.lane.right);
      const exitX = clamp(rightward ? ground.lane.right : ground.lane.left);
      if (enterX !== current.x || laneY !== current.y) {
        stops.push({ x: enterX, y: laneY });
      }
      if (exitX !== enterX) {
        stops.push({ x: exitX, y: laneY });
      }
      next = { x: exitX, y: laneY };
    } else {
      const downward = end.y >= current.y;
      blockers.sort((a, b) =>
        downward ? a.tight.top - b.tight.top : b.tight.bottom - a.tight.bottom,
      );
      const ground = blockers[0];
      const midX = (current.x + end.x) / 2;
      const laneX = snapToGrid(
        Math.abs(midX - ground.lane.left) <= Math.abs(midX - ground.lane.right)
          ? ground.lane.left
          : ground.lane.right,
      );
      const low = Math.min(current.y, end.y);
      const high = Math.max(current.y, end.y);
      const clamp = (value: number) => snapToGrid(Math.min(high, Math.max(low, value)));
      const enterY = clamp(downward ? ground.lane.top : ground.lane.bottom);
      const exitY = clamp(downward ? ground.lane.bottom : ground.lane.top);
      if (laneX !== current.x || enterY !== current.y) {
        stops.push({ x: laneX, y: enterY });
      }
      if (exitY !== enterY) {
        stops.push({ x: laneX, y: exitY });
      }
      next = { x: laneX, y: exitY };
    }
    if (next.x === current.x && next.y === current.y) {
      return [];
    }
    current = next;
  }
  return stops;
}

function boundingTopLeft(cards: readonly ArrangeCard[]): { x: number; y: number } {
  let x = Number.POSITIVE_INFINITY;
  let y = Number.POSITIVE_INFINITY;
  for (const card of cards) {
    x = Math.min(x, card.x);
    y = Math.min(y, card.y);
  }
  return { x, y };
}

/** Union-find over card indices, unioned along the wires. */
function unionComponents(count: number, links: WireLink[]): (index: number) => number {
  const parent = Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (const link of links) {
    const a = find(link.from.index);
    const b = find(link.to.index);
    if (a !== b) {
      parent[Math.max(a, b)] = Math.min(a, b);
    }
  }
  return find;
}

/**
 * Which storages ride as satellites. A drawer whose every wire meets one
 * other card is furniture for that card, not a station of its own: a supply
 * pins to the left edge, a catch to the right, each at the port row it
 * serves. Two lone storages wired only to each other stay ordinary cards -
 * a satellite needs solid ground to pin to.
 */
function planSatellites(
  slotById: Map<string, CardSlot>,
  links: WireLink[],
): Map<CardSlot, SatellitePlan> {
  const bySlot = new Map<CardSlot, WireLink[]>();
  for (const link of links) {
    push(bySlot, link.from, link);
    push(bySlot, link.to, link);
  }
  const plans = new Map<CardSlot, SatellitePlan>();
  for (const slot of slotById.values()) {
    if (slot.card.role !== "storage") {
      continue;
    }
    const myLinks = bySlot.get(slot) ?? [];
    if (myLinks.length === 0) {
      continue;
    }
    const partners = new Set(myLinks.map((l) => (l.from === slot ? l.to : l.from)));
    if (partners.size !== 1) {
      continue;
    }
    const anchor = [...partners][0];
    const feeds = myLinks.some((l) => l.from === slot);
    const fed = myLinks.some((l) => l.to === slot);
    // Ports aligned: the satellite's port row meets the machine's port row.
    let sum = 0;
    let weight = 0;
    for (const l of myLinks) {
      const anchorPort = l.from === slot ? l.toAnchor : l.fromAnchor;
      const ownPort = l.from === slot ? l.fromAnchor : l.toAnchor;
      sum += (anchorPort - ownPort) * l.weight;
      weight += l.weight;
    }
    plans.set(slot, {
      anchor,
      side: feeds && !fed ? "left" : "right",
      offsetY: sum / weight,
    });
  }
  for (const [slot, plan] of [...plans]) {
    if (plans.has(plan.anchor)) {
      plans.delete(slot);
      plans.delete(plan.anchor);
    }
  }
  return plans;
}

/**
 * The wires of every two-card loop (A feeds B, B feeds A). Those pairs are
 * drawn STACKED - same column, one above the other - the way players draw
 * an electrolyzer trading with its reactor, so their wires stay off the
 * column system entirely.
 */
function twoCycleLinks(links: WireLink[]): Set<WireLink> {
  const directions = new Set<string>();
  for (const link of links) {
    directions.add(`${link.from.index}>${link.to.index}`);
  }
  const pairs = new Set<WireLink>();
  for (const link of links) {
    if (directions.has(`${link.to.index}>${link.from.index}`)) {
      pairs.add(link);
    }
  }
  return pairs;
}

/* ---------------------------------------------------------------------- */
/* One island: trunk, sections, columns.                                   */
/* ---------------------------------------------------------------------- */

function layoutIsland(
  members: CardSlot[],
  links: WireLink[],
  satellites: Map<CardSlot, SatellitePlan>,
  exits: ReadonlyMap<string, number>,
  pulls?: ReadonlyMap<string, Array<{ y: number; weight: number; anchor: number }>>,
  /**
   * Every wire on the board, satellite wires included: the optimiser at
   * the end scores the island against ALL the wires inside it, not only
   * the ones the column system saw.
   */
  allLinks?: WireLink[],
  _judge?: ArrangeInput["judge"],
): Block {
  // The layout may run twice over the same slots (the second pass knows
  // where every island stands); everything derived is recomputed from
  // scratch, so clear the one flag that only ever gets set.
  for (const slot of members) {
    slot.trunk = false;
  }
  // Bridge pulls become phantom partners: a fixed point in island space the
  // exit card's port is drawn toward, so a wire leaving for another island
  // exits from the corner facing it instead of crossing its own island.
  let extraPartners: Map<CardSlot, PartnerEntry[]> | undefined;
  if (pulls && pulls.size > 0) {
    extraPartners = new Map();
    for (const slot of members) {
      const entries = pulls.get(slot.card.id);
      if (!entries) {
        continue;
      }
      extraPartners.set(
        slot,
        entries.map((entry) => ({
          other: { ...slot, y: entry.y },
          own: entry.anchor,
          their: 0,
          weight: entry.weight,
        })),
      );
    }
  }
  // -- Cycles. A layered layout needs an acyclic graph to rank, so a DFS in
  // input order marks the wires that close each loop. Those wires still
  // exist for every later pass - they pull their ends together vertically -
  // they just do not constrain the columns, so the forward half of a
  // recycle reads left to right and the return wire doubles back beside it.
  // Two-card loops are lifted out before any of that: their wires never
  // touch the column system, and the pair stacks in one column.
  const pairs = twoCycleLinks(links);
  const forward = splitCoFeeders(breakCycles(members, links, pairs), members);

  assignLayers(members, forward, pairs, exits);

  // -- The fold. A big recycle ring flattened into one line leaves its
  // closure wire lassoing the whole board. Folding the ring's far half back
  // over the top turns the line into the loop the player would draw: flow
  // runs out along the bottom deck, back along the top, and every closure
  // is a short vertical hop. Where the fold lands is chosen by arithmetic
  // (least total wire span), so the arbitrary cycle break stops mattering.
  const { topDeck, pinned } = foldBigCycles(members, links, pairs);
  // The fold moved the ring; everything hanging off it re-slides to its new
  // wires (the ring itself is pinned), pairs re-stack, and a drawer shared
  // by several machines sits between them rather than to the right of all.
  slideTowardWires(members, forward, pinned, exits);
  pullPairsTogether(pairs, forward);
  relaxSharedStorages(members, links, pinned);
  packLayers(members);

  // The page fold (island scale only): a run of columns wider than the
  // page folds back on itself like text lines - each band a row of its
  // own, odd bands reading right to left, so a long chain of islands
  // becomes a serpentine instead of one endless ribbon.
  const bandOf = PAGE_FOLD ? pageFold(members) : new Map<CardSlot, number>();

  buildBands(members, links, forward);
  if (topDeck.size > 0) {
    // The return deck rides ABOVE the line it feeds: its cards keep their
    // relative order but outrank every bottom-deck seq. Each CONNECTED run
    // of deck cards is its own band - two unrelated returns folded onto the
    // deck must not interleave.
    const shift = members.length * 4;
    const deckChunk = new Map<CardSlot, number>();
    let nextChunk = 0;
    for (const slot of members) {
      if (!topDeck.has(slot) || deckChunk.has(slot)) {
        continue;
      }
      deckChunk.set(slot, nextChunk);
      const queue = [slot];
      for (let head = 0; head < queue.length; head += 1) {
        for (const link of links) {
          const other =
            link.from === queue[head] ? link.to : link.to === queue[head] ? link.from : undefined;
          if (other && topDeck.has(other) && !deckChunk.has(other)) {
            deckChunk.set(other, nextChunk);
            queue.push(other);
          }
        }
      }
      nextChunk += 1;
    }
    for (const slot of members) {
      if (topDeck.has(slot)) {
        slot.seq -= shift;
        slot.section = -1 - (deckChunk.get(slot) ?? 0);
      }
    }
  }

  // A pass-through buffer is its own little band: free to sit wherever its
  // two partners pull it - squarely between them - never glued to whichever
  // card the spanning tree happened to hang it on.
  {
    const wireDegree = new Map<CardSlot, number>();
    for (const link of links) {
      wireDegree.set(link.from, (wireDegree.get(link.from) ?? 0) + 1);
      wireDegree.set(link.to, (wireDegree.get(link.to) ?? 0) + 1);
    }
    members.forEach((slot, index) => {
      if (
        slot.card.role === "storage" &&
        (wireDegree.get(slot) ?? 0) === 2 &&
        !topDeck.has(slot)
      ) {
        slot.section = -1000 - index;
      }
    });
  }

  // Deal the page-fold bands out as stacked rows: band by band down the
  // page, each keeping its own seq range and its own section namespace.
  if (bandOf.size > 0) {
    const stride = Math.max(members.length, 1) * 8;
    for (const slot of members) {
      const band = bandOf.get(slot) ?? 0;
      slot.seq += band * stride;
      slot.section += band * 1000003;
    }
  }

  // A provisional vertical pass, then the anti-crossing polish: with real
  // positions on the board, cards are reordered WITHIN their column and
  // section to follow where their wires pull - a drawer whose feed leaves
  // the bottom of its machine belongs below it, not above, and two wires
  // that would cross between columns uncross by swapping their ends. Bands
  // survive: the polish permutes order only among cards already sharing a
  // column and a section. Then the column settles again.
  placeRows(collectLayers(members), links, extraPartners);
  for (let pass = 0; pass < 3; pass += 1) {
    polishColumnOrder(collectLayers(members), links, extraPartners);
    placeRows(collectLayers(members), links, extraPartners);
  }
  // The finisher a hand gives a board: the barycenter passes above get the
  // order close, this pass does what a player does by eye - flip the one
  // pair of neighbours sitting on the wrong sides of each other, counted
  // against the actual wires, until no flip helps.
  for (let pass = 0; pass < 3; pass += 1) {
    if (!transposeToUncross(collectLayers(members), links)) {
      break;
    }
    placeRows(collectLayers(members), links, extraPartners);
  }
  straightenRows(collectLayers(members), links, extraPartners);
  const layers = collectLayers(members);

  // -- Columns. Every column is as wide as its widest card; the corridor
  // between two columns grows with the number of wires that must cross it,
  // so busy boundaries get room to ribbon while quiet ones stay snug.
  const columnWidth = layers.map((layer) =>
    layer.reduce((max, slot) => Math.max(max, slot.card.width), 0),
  );
  const crossings = new Array<number>(Math.max(layers.length - 1, 0)).fill(0);
  for (const link of links) {
    const lo = Math.min(link.from.layer, link.to.layer);
    const hi = Math.max(link.from.layer, link.to.layer);
    for (let i = lo; i < hi; i += 1) {
      crossings[i] += 1;
    }
  }
  // Corridors widen where satellites ride: a column whose machines carry
  // supply drawers needs room on its left, catch drawers need it on the
  // right.
  const leftPad = new Array<number>(layers.length).fill(0);
  const rightPad = new Array<number>(layers.length).fill(0);
  for (const [sat, plan] of satellites) {
    const need = sat.card.width + SATELLITE_PAD;
    if (plan.side === "left") {
      leftPad[plan.anchor.layer] = Math.max(leftPad[plan.anchor.layer], need);
    } else {
      rightPad[plan.anchor.layer] = Math.max(rightPad[plan.anchor.layer], need);
    }
  }
  const columnX: number[] = [];
  let x = 0;
  layers.forEach((_, i) => {
    x += leftPad[i];
    columnX.push(x);
    x += columnWidth[i] + rightPad[i];
    if (i < layers.length - 1) {
      const gap = COLUMN_GAP_MIN + cells(Math.floor(crossings[i] / COLUMN_GAP_WIRES_PER_CELL));
      x += Math.min(gap, COLUMN_GAP_MAX);
    }
  });

  // Normalise the island to its own top-left and centre each card in its
  // column, snapped so a narrow drawer between wide machine columns still
  // sits on a cell corner.
  let top = Number.POSITIVE_INFINITY;
  for (const slot of members) {
    top = Math.min(top, slot.y);
  }
  const ids: string[] = [];
  const places: Placement[] = [];
  const placeBySlot = new Map<CardSlot, Placement>();
  for (const slot of members) {
    const place = {
      x: snapToGrid(columnX[slot.layer] + (columnWidth[slot.layer] - slot.card.width) / 2),
      y: snapToGrid(slot.y - top),
    };
    ids.push(slot.card.id);
    places.push(place);
    placeBySlot.set(slot, place);
  }

  // Satellites, pinned to their machine's side at the port row they serve
  // and stacked apart when several share a side.
  const slotIndex = new Map<string, CardSlot>();
  for (const slot of members) {
    slotIndex.set(slot.card.id, slot);
  }
  for (const sat of satellites.keys()) {
    slotIndex.set(sat.card.id, sat);
  }
  const slotOfId = (id: string): CardSlot => slotIndex.get(id)!;
  const satGroups = new Map<string, Array<{ sat: CardSlot; plan: SatellitePlan }>>();
  for (const [sat, plan] of satellites) {
    push(satGroups, `${plan.anchor.index}:${plan.side}`, { sat, plan });
  }
  for (const group of satGroups.values()) {
    group.sort((a, b) => a.plan.offsetY - b.plan.offsetY || a.sat.index - b.sat.index);
    let previousBottom = Number.NEGATIVE_INFINITY;
    for (const { sat, plan } of group) {
      const anchorPlace = placeBySlot.get(plan.anchor)!;
      const place = {
        x: snapToGrid(
          plan.side === "left"
            ? anchorPlace.x - SATELLITE_PAD - sat.card.width
            : anchorPlace.x + plan.anchor.card.width + SATELLITE_PAD,
        ),
        y: snapToGrid(
          Math.max(anchorPlace.y + plan.offsetY, previousBottom + SATELLITE_STACK_GAP),
        ),
      };
      previousBottom = place.y + sat.card.height;
      ids.push(sat.card.id);
      places.push(place);
    }
  }

  // THE OPTIMISER. The column system got the island's shape; now the cards
  // move until the wires the router will draw cross as little as possible
  // (board-arrange-optimize.ts). Every wire inside the island counts,
  // satellite wires included, and satellites keep to the side they serve.
  if (OPTIMISE && allLinks && ids.length >= 2) {
    const idSet = new Set(ids);
    const satelliteOf = new Map<string, { anchorId: string; side: "left" | "right" }>();
    for (const [sat, plan] of satellites) {
      satelliteOf.set(sat.card.id, { anchorId: plan.anchor.card.id, side: plan.side });
    }
    const optimizeCards: OptimizeCard[] = ids.map((id) => {
      const slot = slotOfId(id);
      const anchor = satellites.get(slot)?.anchor;
      return {
        id,
        width: slot.card.width,
        height: slot.card.height,
        role: slot.card.role,
        layer: anchor ? anchor.layer : slot.layer,
        seq: anchor ? anchor.seq : slot.y,
        section: anchor ? anchor.section : slot.section,
        satellite: satelliteOf.get(id),
      };
    });
    const optimizeWires = allLinks
      .filter((link) => idSet.has(link.from.card.id) && idSet.has(link.to.card.id))
      .map((link) => ({
        source: link.from.card.id,
        target: link.to.card.id,
        weight: link.weight,
        width: link.width,
        sourcePortY: link.fromAnchor,
        targetPortY: link.toAnchor,
      }));
    if (optimizeWires.length > 0) {
      // The host's judge sees the whole board; the island's finalists are
      // laid where the island stands today (its cards' top-left corner) so
      // the rest of the board keeps its distance from them.
      let originX = Infinity;
      let originY = Infinity;
      for (const id of ids) {
        const slot = slotOfId(id);
        originX = Math.min(originX, slot.card.x);
        originY = Math.min(originY, slot.card.y);
      }
      const hostJudge = _judge;
      const optimized = optimizeIslandLayout(optimizeCards, optimizeWires, {
        rowGapCells: Math.round(ROW_GAP / BOARD_GRID),
        sectionGapCells: Math.round(SECTION_GAP / BOARD_GRID),
        columnGapCells: Math.round(COLUMN_GAP_MIN / BOARD_GRID),
        satellitePadCells: Math.round(SATELLITE_PAD / BOARD_GRID),
        // The real router confirms the finalists (Jack, 2026-09-08: the
        // proxy searches, the router confirms): the host's judge when
        // there is one, the optimiser's own stand-in otherwise.
        judge: hostJudge
          ? (positions) =>
              hostJudge(
                new Map(
                  [...positions].map(([id, p]) => [id, { x: p.x + originX, y: p.y + originY }]),
                ),
              ).points
          : undefined,
        prices: ARRANGE_PRICES,
        air: ARRANGE_AIR,
        onProgress: ARRANGE_SEARCH_PROGRESS,
      });
      if (typeof process !== "undefined" && process.env?.ARRANGE_DEBUG) {
        console.log("finalists", JSON.stringify(optimized.finalists), "before", Math.round(optimized.before), "after", Math.round(optimized.after));
      }
      optimized.positions.forEach((place, i) => {
        places[i].x = place.x;
        places[i].y = place.y;
      });
    }
  }

  // Satellites can poke past the island's top or left edge; pull the whole
  // block back to its own origin, then measure it around everything it owns.
  let minX = 0;
  let minY = 0;
  for (const place of places) {
    minX = Math.min(minX, place.x);
    minY = Math.min(minY, place.y);
  }
  let width = 0;
  let height = 0;
  for (const place of places) {
    place.x -= minX;
    place.y -= minY;
  }
  const slotOf = new Map<string, CardSlot>();
  for (const slot of members) {
    slotOf.set(slot.card.id, slot);
  }
  for (const sat of satellites.keys()) {
    slotOf.set(sat.card.id, sat);
  }
  ids.forEach((id, i) => {
    const slot = slotOf.get(id)!;
    width = Math.max(width, places[i].x + slot.card.width);
    height = Math.max(height, places[i].y + slot.card.height);
  });
  return {
    ids,
    places,
    width,
    height,
    size: members.length + satellites.size,
    minIndex: members[0].index,
  };
}

/**
 * The serpentine. When the columns in a run would stretch wider than the
 * page, they fold back like text lines: contiguous groups of columns
 * become BANDS, odd bands reading right to left so the walk turns at the
 * margin instead of leaping back. Layers are remapped to positions within
 * the band; the caller stacks the bands with seq and section strides.
 * Returns each card's band, empty when no fold was needed.
 */
function pageFold(members: CardSlot[]): Map<CardSlot, number> {
  const bandOf = new Map<CardSlot, number>();
  let layerCount = 0;
  for (const slot of members) {
    layerCount = Math.max(layerCount, slot.layer + 1);
  }
  if (layerCount < 2) {
    return bandOf;
  }
  const columnWidth = new Array<number>(layerCount).fill(0);
  for (const slot of members) {
    columnWidth[slot.layer] = Math.max(columnWidth[slot.layer], slot.card.width);
  }
  let total = -COLUMN_GAP_MIN;
  for (const width of columnWidth) {
    total += width + COLUMN_GAP_MIN;
  }
  if (total <= ISLAND_ROW_MAX_WIDTH) {
    return bandOf;
  }
  const bandOfLayer: number[] = [];
  const positionInBand: number[] = [];
  const bandLength: number[] = [];
  {
    let x = 0;
    let band = 0;
    let position = 0;
    for (let layer = 0; layer < layerCount; layer += 1) {
      if (x > 0 && x + columnWidth[layer] > ISLAND_ROW_MAX_WIDTH) {
        band += 1;
        x = 0;
        position = 0;
      }
      bandOfLayer.push(band);
      positionInBand.push(position);
      bandLength[band] = position + 1;
      x += columnWidth[layer] + COLUMN_GAP_MIN;
      position += 1;
    }
    if (band === 0) {
      return bandOf;
    }
  }
  for (const slot of members) {
    const band = bandOfLayer[slot.layer];
    const position = positionInBand[slot.layer];
    slot.layer = band % 2 === 0 ? position : bandLength[band] - 1 - position;
    bandOf.set(slot, band);
  }
  return bandOf;
}

/**
 * Mark the links that close a cycle. Returns the FORWARD links (the DAG);
 * marked links simply do not constrain layering.
 */
function breakCycles(
  members: CardSlot[],
  links: WireLink[],
  pairs: ReadonlySet<WireLink>,
): WireLink[] {
  const outgoing = new Map<CardSlot, WireLink[]>();
  for (const link of links) {
    if (!pairs.has(link)) {
      push(outgoing, link.from, link);
    }
  }
  const VISITING = 1;
  const DONE = 2;
  const state = new Map<CardSlot, number>();
  const reversed = new Set<WireLink>();
  for (const start of members) {
    if (state.has(start)) {
      continue;
    }
    // Iterative DFS: a recursive one blows the stack on thousand-card boards.
    const stack: Array<{ slot: CardSlot; nextLink: number }> = [{ slot: start, nextLink: 0 }];
    state.set(start, VISITING);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const list = outgoing.get(frame.slot) ?? [];
      if (frame.nextLink >= list.length) {
        state.set(frame.slot, DONE);
        stack.pop();
        continue;
      }
      const link = list[frame.nextLink];
      frame.nextLink += 1;
      const seen = state.get(link.to);
      if (seen === VISITING) {
        reversed.add(link);
      } else if (seen === undefined) {
        state.set(link.to, VISITING);
        stack.push({ slot: link.to, nextLink: 0 });
      }
    }
  }
  return links.filter((link) => !pairs.has(link) && !reversed.has(link));
}

/**
 * Rank every card into a column. Longest path from the sources puts each card
 * one column past the furthest card that feeds it; the tightening sweeps then
 * slide cards toward whichever side holds more of their wire WEIGHT, which
 * pulls a lone raw-material source right up beside its consumer instead of
 * leaving it stranded in column zero, and keeps a heavy line's ends adjacent.
 */
function assignLayers(
  members: CardSlot[],
  forward: WireLink[],
  pairs: ReadonlySet<WireLink>,
  exits?: ReadonlyMap<string, number>,
): void {
  const incoming = new Map<CardSlot, WireLink[]>();
  const outgoing = new Map<CardSlot, WireLink[]>();
  for (const link of forward) {
    push(outgoing, link.from, link);
    push(incoming, link.to, link);
  }

  const order = topologicalOrder(members, outgoing);
  for (const slot of order) {
    let layer = 0;
    for (const link of incoming.get(slot) ?? []) {
      layer = Math.max(layer, link.from.layer + 1);
    }
    slot.layer = layer;
  }

  slideTowardWires(members, forward, undefined, exits);
  pullPairsTogether(pairs, forward);
  packLayers(members);
}

/**
 * Two machines that FEED THE SAME DRAWER stand on opposite sides of it, the
 * drawer between them - the way Jack drew the oil board (2026-09-08): the
 * tower's product drawers in a column to its right, the second producer to
 * the right of the drawers, feeding them leftward. Ranked left to right
 * alone, both producers land in one column, stacked, and their fans of
 * wires into the shared drawers cross each other wholesale. So for every
 * pair of machines that share a drawer as co-feeders (or co-consumers) and
 * have no forward path between them, the wires of one of them are turned
 * round for the RANKING only: that machine ranks past the drawers and
 * stands to their right. The one that keeps the left is the one with more
 * of its own other wires pointing right (its own satellites, its onward
 * chain); the other has less to lose from facing left.
 */
function splitCoFeeders(forward: WireLink[], members: CardSlot[]): WireLink[] {
  const byStorage = new Map<CardSlot, WireLink[]>();
  for (const link of forward) {
    if (link.to.card.role === "storage") push(byStorage, link.to, link);
    if (link.from.card.role === "storage") push(byStorage, link.from, link);
  }
  const outgoing = new Map<CardSlot, WireLink[]>();
  for (const link of forward) {
    push(outgoing, link.from, link);
  }
  const reaches = (from: CardSlot, to: CardSlot): boolean => {
    const seen = new Set<CardSlot>([from]);
    const queue = [from];
    for (let head = 0; head < queue.length; head += 1) {
      for (const link of outgoing.get(queue[head]) ?? []) {
        if (link.to === to) return true;
        if (!seen.has(link.to)) {
          seen.add(link.to);
          queue.push(link.to);
        }
      }
    }
    return false;
  };
  // Decide once per pair of machines which one turns round.
  const turned = new Set<CardSlot>();
  const decided = new Set<string>();
  for (const [storage, storageLinks] of byStorage) {
    const feeders = storageLinks.filter((l) => l.to === storage).map((l) => l.from);
    const takers = storageLinks.filter((l) => l.from === storage).map((l) => l.to);
    for (const group of [feeders, takers]) {
      const machines = [...new Set(group)].filter((slot) => slot.card.role !== "storage");
      if (machines.length !== 2) continue;
      const [p, q] = machines.sort((a, b) => a.index - b.index);
      const key = `${p.index}:${q.index}`;
      if (decided.has(key)) continue;
      decided.add(key);
      if (turned.has(p) || turned.has(q) || reaches(p, q) || reaches(q, p)) continue;
      const shared = new Set<CardSlot>();
      for (const [other, otherLinks] of byStorage) {
        const ends = new Set(otherLinks.map((l) => (l.from === other ? l.to : l.from)));
        if (ends.has(p) && ends.has(q)) shared.add(other);
      }
      const rightward = (slot: CardSlot) =>
        (outgoing.get(slot) ?? []).filter((l) => !shared.has(l.to)).reduce((sum, l) => sum + l.weight, 0);
      turned.add(rightward(p) >= rightward(q) ? q : p);
    }
  }
  if (turned.size === 0) return forward;
  // Cards wired to nothing but shared drawers are the classic case; a card
  // with other forward wires keeps them, and only its drawer wires turn.
  return forward.map((link) => {
    const storageEnd = link.to.card.role === "storage" ? link.to : link.from.card.role === "storage" ? link.from : undefined;
    if (!storageEnd) return link;
    const machine = storageEnd === link.to ? link.from : link.to;
    if (!turned.has(machine)) return link;
    return { ...link, from: link.to, to: link.from, fromAnchor: link.toAnchor, toAnchor: link.fromAnchor };
  });
}

/**
 * Slide every card toward whichever side holds more of its wire weight,
 * within what its wires allow. Pinned cards (a folded ring) hold still but
 * still anchor their neighbours.
 */
function slideTowardWires(
  members: CardSlot[],
  forward: WireLink[],
  pinned?: ReadonlySet<CardSlot>,
  exits?: ReadonlyMap<string, number>,
): void {
  const incoming = new Map<CardSlot, WireLink[]>();
  const outgoing = new Map<CardSlot, WireLink[]>();
  for (const link of forward) {
    push(outgoing, link.from, link);
    push(incoming, link.to, link);
  }
  for (let pass = 0; pass < 3; pass += 1) {
    let maxLayer = 0;
    for (const slot of members) {
      maxLayer = Math.max(maxLayer, slot.layer);
    }
    for (const slot of members) {
      if (pinned?.has(slot)) {
        continue;
      }
      const ins = incoming.get(slot) ?? [];
      const outs = outgoing.get(slot) ?? [];
      // A card whose wire leaves for another island leans toward the edge
      // it exits from - a bridge should leave the FACING side of its
      // island, not drag across it first. The lean is deliberately heavy:
      // where it argues with the card's own left-to-right preference, the
      // exit wins - a clean hand-over beats tidy flow inside one island.
      const exitBias = (exits?.get(slot.card.id) ?? 0) * 4;
      let lower = 0;
      for (const link of ins) {
        lower = Math.max(lower, link.from.layer + 1);
      }
      let upper = Number.POSITIVE_INFINITY;
      for (const link of outs) {
        upper = Math.min(upper, link.to.layer - 1);
      }
      if (upper === Number.POSITIVE_INFINITY) {
        // No forward successors normally means "stay put", but a card
        // exiting rightward may drift as far as the island reaches.
        upper = exitBias > 0 ? maxLayer : slot.layer;
      }
      if (upper < lower) {
        continue;
      }
      // Total weighted wire length is linear in this card's column, so the
      // best spot is whichever end of the feasible range the heavier side
      // points to.
      const inWeight =
        ins.reduce((sum, link) => sum + link.weight, 0) + Math.max(0, -exitBias);
      const outWeight =
        outs.reduce((sum, link) => sum + link.weight, 0) + Math.max(0, exitBias);
      if (outWeight > inWeight) {
        slot.layer = upper;
      } else if (inWeight > outWeight) {
        slot.layer = lower;
      } else if (inWeight > 0 && outWeight > 0) {
        // A tie is flat under linear cost, but long wires read worst, so
        // split the difference.
        slot.layer = Math.round((lower + upper) / 2);
      }
    }
  }
}

/**
 * Two-card loops share a column, stacked, the way players draw an
 * electrolyzer trading with its reactor: the member with fewer other
 * wires adopts the better-anchored one's column.
 */
function pullPairsTogether(pairs: ReadonlySet<WireLink>, forward: WireLink[]): void {
  const degree = new Map<CardSlot, number>();
  for (const link of forward) {
    degree.set(link.from, (degree.get(link.from) ?? 0) + 1);
    degree.set(link.to, (degree.get(link.to) ?? 0) + 1);
  }
  for (const link of pairs) {
    if (link.from.index < link.to.index) {
      const a = link.from;
      const b = link.to;
      if ((degree.get(a) ?? 0) >= (degree.get(b) ?? 0)) {
        b.layer = a.layer;
      } else {
        a.layer = b.layer;
      }
    }
  }
}

/**
 * A drawer serving several machines belongs BETWEEN them, not to the right
 * of them all: left-to-right ranking only means something for cards that
 * transform, and a shared chest just collects. Its column becomes the
 * weighted middle of its partners'.
 */
function relaxSharedStorages(
  members: CardSlot[],
  links: WireLink[],
  pinned: ReadonlySet<CardSlot>,
): void {
  const bySlot = new Map<CardSlot, WireLink[]>();
  for (const link of links) {
    push(bySlot, link.from, link);
    push(bySlot, link.to, link);
  }
  for (const slot of members) {
    if (slot.card.role !== "storage" || pinned.has(slot)) {
      continue;
    }
    const myLinks = bySlot.get(slot) ?? [];
    const partners = new Set(myLinks.map((l) => (l.from === slot ? l.to : l.from)));
    if (partners.size < 2) {
      continue;
    }
    let sum = 0;
    let weight = 0;
    for (const link of myLinks) {
      const other = link.from === slot ? link.to : link.from;
      sum += other.layer * link.weight;
      weight += link.weight;
    }
    slot.layer = Math.round(sum / weight);
  }
}

/** Layers come out sparse after tightening and folding; close the holes. */
function packLayers(members: CardSlot[]): void {
  const used = [...new Set(members.map((slot) => slot.layer))].sort((a, b) => a - b);
  const packed = new Map(used.map((layer, i) => [layer, i]));
  for (const slot of members) {
    slot.layer = packed.get(slot.layer) ?? 0;
  }
}

/**
 * Strongly connected components of the island, iterative Tarjan in input
 * order: the cards that can all reach each other - a recycle ring and
 * everything riding it.
 */
function strongComponents(members: CardSlot[], links: WireLink[]): Map<CardSlot, number> {
  const outgoing = new Map<CardSlot, CardSlot[]>();
  for (const link of links) {
    push(outgoing, link.from, link.to);
  }
  const component = new Map<CardSlot, number>();
  const indexOf = new Map<CardSlot, number>();
  const low = new Map<CardSlot, number>();
  const onStack = new Set<CardSlot>();
  const tarjanStack: CardSlot[] = [];
  let nextIndex = 0;
  let nextComponent = 0;
  for (const start of members) {
    if (indexOf.has(start)) {
      continue;
    }
    const work: Array<{ slot: CardSlot; next: number }> = [{ slot: start, next: 0 }];
    indexOf.set(start, nextIndex);
    low.set(start, nextIndex);
    nextIndex += 1;
    tarjanStack.push(start);
    onStack.add(start);
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const near = outgoing.get(frame.slot) ?? [];
      if (frame.next < near.length) {
        const other = near[frame.next];
        frame.next += 1;
        if (!indexOf.has(other)) {
          indexOf.set(other, nextIndex);
          low.set(other, nextIndex);
          nextIndex += 1;
          tarjanStack.push(other);
          onStack.add(other);
          work.push({ slot: other, next: 0 });
        } else if (onStack.has(other)) {
          low.set(frame.slot, Math.min(low.get(frame.slot)!, indexOf.get(other)!));
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].slot;
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.slot)!));
      }
      if (low.get(frame.slot) === indexOf.get(frame.slot)) {
        for (;;) {
          const popped = tarjanStack.pop()!;
          onStack.delete(popped);
          component.set(popped, nextComponent);
          if (popped === frame.slot) {
            break;
          }
        }
        nextComponent += 1;
      }
    }
  }
  return component;
}

/**
 * Fold each big ring back over itself. For every strongly connected group
 * of four or more cards, try each fold point: cards past it mirror onto a
 * return deck heading back left. Keep the fold whose total wire span is
 * smallest, if it beats the unfolded line. Returns the cards on top decks.
 */
function foldBigCycles(
  members: CardSlot[],
  links: WireLink[],
  pairs: ReadonlySet<WireLink>,
): { topDeck: Set<CardSlot>; pinned: Set<CardSlot> } {
  const component = strongComponents(members, links);
  const groups = new Map<number, CardSlot[]>();
  for (const slot of members) {
    push(groups, component.get(slot) ?? -1, slot);
  }
  const topDeck = new Set<CardSlot>();
  const pinned = new Set<CardSlot>();
  for (const group of groups.values()) {
    if (group.length < 4) {
      continue;
    }
    const inGroup = new Set(group);
    const inner = links.filter(
      (link) => inGroup.has(link.from) && inGroup.has(link.to) && !pairs.has(link),
    );
    const minLayer = group.reduce((min, slot) => Math.min(min, slot.layer), Infinity);
    const flat = new Map(group.map((slot) => [slot, slot.layer - minLayer]));
    const span = group.reduce((max, slot) => Math.max(max, flat.get(slot)!), 0);
    // SQUARED span: one wire lassoing four columns is far worse than four
    // wires each hopping one - long wires are the ugliness being priced.
    // A same-column link is NOT free: an output feeding an input in its own
    // column wraps around the cards, so it prices like a two-column hop.
    // Without this, two rings sharing a machine fold into one tower.
    const cost = (layerOf: (slot: CardSlot) => number) =>
      inner.reduce((sum, link) => {
        const d = Math.abs(layerOf(link.from) - layerOf(link.to));
        return sum + (d === 0 ? 4 : d * d);
      }, 0);
    const baseCost = cost((slot) => flat.get(slot)!);
    let bestM = -1;
    let bestCost = baseCost;
    for (let m = 0; m < span; m += 1) {
      const layerOf = (slot: CardSlot) => {
        const f = flat.get(slot)!;
        return f <= m ? f : 2 * m + 1 - f;
      };
      if (group.some((slot) => layerOf(slot) < 0)) {
        continue;
      }
      const folded = cost(layerOf);
      if (folded < bestCost) {
        bestCost = folded;
        bestM = m;
      }
    }
    if (bestM < 0) {
      continue;
    }
    for (const slot of group) {
      pinned.add(slot);
      const f = flat.get(slot)!;
      if (f > bestM) {
        slot.layer = minLayer + 2 * bestM + 1 - f;
        topDeck.add(slot);
      }
    }
  }
  return { topDeck, pinned };
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) {
    list.push(value);
  } else {
    map.set(key, [value]);
  }
}

function topologicalOrder(
  members: CardSlot[],
  outgoing: Map<CardSlot, WireLink[]>,
): CardSlot[] {
  const indegree = new Map<CardSlot, number>();
  for (const slot of members) {
    indegree.set(slot, 0);
  }
  for (const links of outgoing.values()) {
    for (const link of links) {
      indegree.set(link.to, (indegree.get(link.to) ?? 0) + 1);
    }
  }
  // A plain queue seeded in input order keeps the walk deterministic.
  const queue = members.filter((slot) => indegree.get(slot) === 0);
  const order: CardSlot[] = [];
  for (let head = 0; head < queue.length; head += 1) {
    const slot = queue[head];
    order.push(slot);
    for (const link of outgoing.get(slot) ?? []) {
      const remaining = (indegree.get(link.to) ?? 0) - 1;
      indegree.set(link.to, remaining);
      if (remaining === 0) {
        queue.push(link.to);
      }
    }
  }
  return order;
}

/**
 * The heart of the sectioned look. The island is almost a tree, so treat it
 * as one: grow a spanning tree from the plan's main product (the final sink
 * with the most machinery behind it), heaviest wires claimed first. The
 * TRUNK is the chain of largest subtrees down from that root - the main
 * line. Every subtree hanging off the trunk becomes a SECTION.
 *
 * A single in-order walk then hands out two numbers per card: `seq`, the
 * global vertical theme (cards sort within their column by it, so a
 * subtree's cards stay contiguous in every column they touch - a wire's two
 * ends land in the same band, which is the anti-spaghetti), and `section`,
 * which buys the air between bands. Sections are balanced around the trunk,
 * the biggest hugging it from either side, so the main line runs through
 * the middle of its factory rather than along an edge.
 */
function buildBands(members: CardSlot[], links: WireLink[], forward: WireLink[]): void {
  // How many wires actually touch each card. The spanning tree can leave a
  // two-wire buffer as a tree LEAF, and leaf alone must not make it a bud.
  const wireDegree = new Map<CardSlot, number>();
  for (const link of links) {
    wireDegree.set(link.from, (wireDegree.get(link.from) ?? 0) + 1);
    wireDegree.set(link.to, (wireDegree.get(link.to) ?? 0) + 1);
  }
  // Undirected adjacency, parallel wires merged, heaviest first.
  const adjacency = new Map<CardSlot, Array<{ other: CardSlot; weight: number }>>();
  {
    const paired = new Map<CardSlot, Map<CardSlot, number>>();
    const add = (a: CardSlot, b: CardSlot, weight: number) => {
      let row = paired.get(a);
      if (!row) {
        row = new Map();
        paired.set(a, row);
      }
      row.set(b, (row.get(b) ?? 0) + weight);
    };
    for (const link of links) {
      add(link.from, link.to, link.weight);
      add(link.to, link.from, link.weight);
    }
    for (const [slot, row] of paired) {
      adjacency.set(
        slot,
        [...row.entries()]
          .map(([other, weight]) => ({ other, weight }))
          .sort((a, b) => b.weight - a.weight || a.other.index - b.other.index),
      );
    }
  }

  // The root: among cards nothing forward flows OUT of (final products,
  // export drawers), the one with the most cards feeding it wins. A machine
  // outranks a drawer - growing the tree from a chest gives the walk a
  // trivial first step and scrambles the bands behind it.
  const hasForwardOut = new Set(forward.map((link) => link.from));
  const allSinks = members.filter((slot) => !hasForwardOut.has(slot));
  const machineSinks = allSinks.filter((slot) => slot.card.role !== "storage");
  const sinks = machineSinks.length > 0 ? machineSinks : allSinks;
  const feeders = new Map<CardSlot, WireLink[]>();
  for (const link of forward) {
    push(feeders, link.to, link);
  }
  let root = members[0];
  let rootReach = -1;
  for (const sink of sinks) {
    const seen = new Set<CardSlot>([sink]);
    const queue = [sink];
    for (let head = 0; head < queue.length; head += 1) {
      for (const link of feeders.get(queue[head]) ?? []) {
        if (!seen.has(link.from)) {
          seen.add(link.from);
          queue.push(link.from);
        }
      }
    }
    if (seen.size > rootReach) {
      root = sink;
      rootReach = seen.size;
    }
  }

  // Spanning tree from the root, heaviest neighbours claimed first.
  const parent = new Map<CardSlot, CardSlot>();
  const children = new Map<CardSlot, CardSlot[]>();
  {
    const visited = new Set<CardSlot>([root]);
    const stack = [root];
    while (stack.length > 0) {
      const slot = stack.pop()!;
      // Reverse so the heaviest neighbour is popped (visited) first.
      const near = adjacency.get(slot) ?? [];
      for (let i = near.length - 1; i >= 0; i -= 1) {
        const { other } = near[i];
        if (!visited.has(other)) {
          visited.add(other);
          parent.set(other, slot);
          push(children, slot, other);
          stack.push(other);
        }
      }
    }
  }

  // Subtree sizes and rough band heights, accumulated bottom-up without
  // recursion (the tree can be deep), then the trunk: follow the biggest
  // child down.
  const subtreeSize = new Map<CardSlot, number>();
  const subtreeHeight = new Map<CardSlot, number>();
  {
    const order: CardSlot[] = [];
    const stack = [root];
    while (stack.length > 0) {
      const slot = stack.pop()!;
      order.push(slot);
      for (const child of children.get(slot) ?? []) {
        stack.push(child);
      }
    }
    for (let i = order.length - 1; i >= 0; i -= 1) {
      let size = 1;
      let height = order[i].card.height + ROW_GAP;
      for (const child of children.get(order[i]) ?? []) {
        size += subtreeSize.get(child) ?? 1;
        height += subtreeHeight.get(child) ?? 0;
      }
      subtreeSize.set(order[i], size);
      subtreeHeight.set(order[i], height);
    }
  }
  const onTrunk = new Set<CardSlot>([root]);
  {
    let slot: CardSlot | undefined = root;
    while (slot) {
      const kids = children.get(slot) ?? [];
      let next: CardSlot | undefined;
      for (const child of kids) {
        if (!next || (subtreeSize.get(child) ?? 1) > (subtreeSize.get(next) ?? 1)) {
          next = child;
        }
      }
      if (next) {
        onTrunk.add(next);
      }
      slot = next;
    }
  }
  for (const slot of onTrunk) {
    slot.trunk = true;
  }

  // Which trunk-child subtree each off-trunk card hangs from, and how hard
  // that whole branch holds onto the trunk: every wire between the branch
  // and ANY trunk card counts. This is what puts each branch where its
  // wires want it - a recycle loop (a wire out AND a wire back) hugs the
  // line, a heavy feed sits closer than a trickle, and a big-but-loose
  // branch drifts outward instead of shouldering in on card count alone.
  const branchRoot = new Map<CardSlot, CardSlot>();
  for (const trunkSlot of onTrunk) {
    for (const child of children.get(trunkSlot) ?? []) {
      if (onTrunk.has(child)) {
        continue;
      }
      const queue = [child];
      branchRoot.set(child, child);
      for (let head = 0; head < queue.length; head += 1) {
        for (const grand of children.get(queue[head]) ?? []) {
          branchRoot.set(grand, child);
          queue.push(grand);
        }
      }
    }
  }
  const coupling = new Map<CardSlot, number>();
  for (const link of links) {
    const fromTrunk = onTrunk.has(link.from);
    const toTrunk = onTrunk.has(link.to);
    if (fromTrunk === toTrunk) {
      continue;
    }
    const branch = branchRoot.get(fromTrunk ? link.to : link.from);
    if (branch) {
      coupling.set(branch, (coupling.get(branch) ?? 0) + link.weight);
    }
  }

  // The in-order walk. At a trunk card, side sections split above and below
  // it, biggest nearest the trunk; elsewhere children keep claim order.
  let seqCounter = 0;
  let sectionCounter = 0;
  type Visit = { slot: CardSlot; section: number };
  const walk = (start: Visit) => {
    const stack: Array<{ slot: CardSlot; section: number; phase: number }> = [
      { ...start, phase: 0 },
    ];
    while (stack.length > 0) {
      const frame = stack.pop()!;
      const { slot, section } = frame;
      if (frame.phase === 1) {
        slot.seq = seqCounter;
        seqCounter += 1;
        slot.section = section;
        continue;
      }
      const kids = children.get(slot) ?? [];
      if (!onTrunk.has(slot)) {
        // A section interior: the card, then its children in claim order,
        // every one inheriting the section.
        slot.seq = seqCounter;
        seqCounter += 1;
        slot.section = section;
        for (let i = kids.length - 1; i >= 0; i -= 1) {
          stack.push({ slot: kids[i], section, phase: 0 });
        }
        continue;
      }
      // A trunk card: hang its branches around the line and push the trunk
      // continuation through the middle. BUDS - single stray cards, a
      // byproduct drawer, a lone supply - are not sections at all: they keep
      // the trunk's band and nestle right against their machine. Real
      // branches become sections, placed in coupling order (the branch with
      // the most wire into the trunk sits nearest, which is what keeps a
      // recycle loop or a heavy feed snug), and dealt above or below
      // whichever side is currently shorter, so the main line stays
      // vertically centred in its own factory.
      const trunkChild = kids.find((child) => onTrunk.has(child));
      const sides = kids
        .filter((child) => child !== trunkChild)
        .sort(
          (a, b) =>
            (coupling.get(b) ?? 0) - (coupling.get(a) ?? 0) ||
            (subtreeSize.get(b) ?? 1) - (subtreeSize.get(a) ?? 1) ||
            a.index - b.index,
        );
      const above: Visit[] = [];
      const below: Visit[] = [];
      let aboveHeight = 0;
      let belowHeight = 0;
      // A bud is a true one-wire leaf - a catch drawer, a lone supply. A
      // pass-through buffer can be a TREE leaf while carrying two wires,
      // and gluing it to this card would drag its other wire across the
      // island; it becomes a section of its own instead.
      const isLeafBud = (child: CardSlot) =>
        (subtreeSize.get(child) ?? 1) === 1 && (wireDegree.get(child) ?? 0) <= 1;
      const buds = sides.filter(isLeafBud);
      const branches = sides.filter((child) => !isLeafBud(child));
      // Buds first, so they hold the positions nearest the trunk card while
      // the sections stack outward past them.
      for (const child of [...buds, ...branches]) {
        const isBud = isLeafBud(child);
        let childSection = section;
        if (!isBud) {
          sectionCounter += 1;
          childSection = sectionCounter;
        }
        const height = subtreeHeight.get(child) ?? 0;
        if (aboveHeight <= belowHeight) {
          above.unshift({ slot: child, section: childSection });
          aboveHeight += height;
        } else {
          below.push({ slot: child, section: childSection });
          belowHeight += height;
        }
      }
      // Pushed in reverse of the wanted visit order (it is a stack): below
      // branches, then the trunk continuation, then this card, then above.
      for (let i = below.length - 1; i >= 0; i -= 1) {
        stack.push({ ...below[i], phase: 0 });
      }
      if (trunkChild) {
        stack.push({ slot: trunkChild, section, phase: 0 });
      }
      stack.push({ slot, section, phase: 1 });
      for (let i = above.length - 1; i >= 0; i -= 1) {
        stack.push({ ...above[i], phase: 0 });
      }
    }
  };
  walk({ slot: root, section: 0 });
}

function collectLayers(members: CardSlot[]): CardSlot[][] {
  const count = members.reduce((max, slot) => Math.max(max, slot.layer), 0) + 1;
  const layers: CardSlot[][] = Array.from({ length: count }, () => []);
  for (const slot of members) {
    layers[slot.layer].push(slot);
  }
  for (const layer of layers) {
    layer.sort((a, b) => a.seq - b.seq || a.index - b.index);
  }
  return layers;
}

/**
 * The vertical pass: give every card a y that lines its ports up with the
 * ports on the other end of its wires, without two cards in a column ever
 * overlapping, and with section boundaries holding their air.
 *
 * Each sweep computes where every card WANTS to sit (the flow-weighted
 * average of its wire partners' port lines, measured port to port), then
 * settles the column with an exact solve: minimising the weighted squared
 * distance to those wishes subject to "stay in order, keep your gaps" is
 * isotonic regression, and pool-adjacent-violators gives the optimum in
 * linear time. Busy cards carry more weight, so a hub holds its line and
 * stragglers come to it.
 */
interface PartnerEntry {
  other: CardSlot;
  own: number;
  their: number;
  weight: number;
}
type PartnerMap = Map<CardSlot, PartnerEntry[]>;

function buildPartners(
  links: WireLink[],
  extra?: ReadonlyMap<CardSlot, PartnerEntry[]>,
): PartnerMap {
  const partners: PartnerMap = new Map();
  for (const link of links) {
    // The main line is the one wire run that must read ruler-straight, so a
    // trunk-to-trunk wire pulls several times harder than its flow alone.
    const emphasis = link.from.trunk && link.to.trunk ? 3 : 1;
    push(partners, link.from, {
      other: link.to,
      own: link.fromAnchor,
      their: link.toAnchor,
      weight: link.weight * emphasis,
    });
    push(partners, link.to, {
      other: link.from,
      own: link.toAnchor,
      their: link.fromAnchor,
      weight: link.weight * emphasis,
    });
  }
  // Phantom partners: fixed anchors a card is pulled toward - how a bridge
  // to another island reaches inside and pulls its exit card to the edge
  // facing the partner.
  if (extra) {
    for (const [slot, entries] of extra) {
      for (const entry of entries) {
        push(partners, slot, entry);
      }
    }
  }
  return partners;
}

/** Where a card's wires would put it, port to port, weighted by flow. */
function wishFor(
  slot: CardSlot,
  list: PartnerEntry[] | undefined,
): { wish: number; weight: number } {
  if (!list || list.length === 0) {
    return { wish: slot.y, weight: 0.1 };
  }
  let sum = 0;
  let total = 0;
  for (const p of list) {
    sum += (p.other.y + p.their - p.own) * p.weight;
    total += p.weight;
  }
  return { wish: sum / total, weight: total };
}

/**
 * The anti-crossing pass, at two levels. Within one column, every SECTION
 * moves as one block to where its members' wires pull on average, and the
 * members reorder inside their block by their own pull - so a whole band
 * dealt to the wrong side of the trunk migrates across it, a drawer fed
 * from the bottom of its machine drops below it, and two wires that would
 * cross between columns uncross, while a band can never be split up.
 * The column's seq numbers are dealt back out in the new order; seq only
 * ever means "my order within my column", so nothing else moves.
 */
function polishColumnOrder(
  layers: CardSlot[][],
  links: WireLink[],
  extra?: ReadonlyMap<CardSlot, PartnerEntry[]>,
): void {
  const partners = buildPartners(links, extra);
  for (const layer of layers) {
    if (layer.length < 2) {
      continue;
    }
    const wish = new Map<CardSlot, { y: number; w: number }>();
    for (const slot of layer) {
      const { wish: y, weight } = wishFor(slot, partners.get(slot));
      wish.set(slot, { y, w: weight });
    }
    const groups = new Map<number, CardSlot[]>();
    for (const slot of layer) {
      push(groups, slot.section, slot);
    }
    const blocks = [...groups.values()].map((cardsInGroup) => {
      cardsInGroup.sort((a, b) => wish.get(a)!.y - wish.get(b)!.y || a.seq - b.seq);
      let sum = 0;
      let weight = 0;
      for (const slot of cardsInGroup) {
        sum += wish.get(slot)!.y * wish.get(slot)!.w;
        weight += wish.get(slot)!.w;
      }
      return {
        cards: cardsInGroup,
        mean: weight > 0 ? sum / weight : 0,
        minSeq: cardsInGroup.reduce((min, slot) => Math.min(min, slot.seq), Infinity),
      };
    });
    blocks.sort((a, b) => a.mean - b.mean || a.minSeq - b.minSeq);
    const seqs = layer.map((slot) => slot.seq).sort((a, b) => a - b);
    let next = 0;
    for (const block of blocks) {
      for (const slot of block.cards) {
        slot.seq = seqs[next];
        next += 1;
      }
    }
  }
}

function placeRows(
  layers: CardSlot[][],
  links: WireLink[],
  extra?: ReadonlyMap<CardSlot, PartnerEntry[]>,
): void {
  const partners = buildPartners(links, extra);

  // First stacking: straight down in order, so every wish below starts from
  // a legal picture.
  for (const layer of layers) {
    let y = 0;
    let previous: CardSlot | undefined;
    for (const slot of layer) {
      if (previous) {
        y += gapBetween(previous, slot);
      }
      slot.y = y;
      y += slot.card.height;
      previous = slot;
    }
  }

  for (let sweep = 0; sweep < 8; sweep += 1) {
    const downward = sweep % 2 === 0;
    for (let i = 0; i < layers.length; i += 1) {
      const layer = layers[downward ? i : layers.length - 1 - i];
      const wishes = layer.map((slot) => wishFor(slot, partners.get(slot)));
      settleColumn(layer, wishes);
    }
  }

  // Pull the whole island up so its top card sits at zero.
  let top = Number.POSITIVE_INFINITY;
  for (const layer of layers) {
    for (const slot of layer) {
      top = Math.min(top, slot.y);
    }
  }
  for (const layer of layers) {
    for (const slot of layer) {
      slot.y -= top;
    }
  }
}

/** The air owed between two vertically adjacent cards in one column. */
function gapBetween(upper: CardSlot, lower: CardSlot): number {
  return upper.section === lower.section ? ROW_GAP : SECTION_GAP;
}

/**
 * The last word on straight wires. Every card lands on the grid, then each
 * card in turn snaps onto the exact line of its heaviest wire, when that is
 * a nudge of two cells or less and its column neighbours keep their air -
 * the difference between a wire that is almost straight and one that IS.
 */
function straightenRows(
  layers: CardSlot[][],
  links: WireLink[],
  extra?: ReadonlyMap<CardSlot, PartnerEntry[]>,
): void {
  const partners = buildPartners(links, extra);
  for (const layer of layers) {
    for (const slot of layer) {
      slot.y = snapToGrid(slot.y);
    }
  }
  for (let sweep = 0; sweep < 2; sweep += 1) {
    const leftToRight = sweep % 2 === 0;
    for (let i = 0; i < layers.length; i += 1) {
      const layer = layers[leftToRight ? i : layers.length - 1 - i];
      layer.forEach((slot, row) => {
        let best: { y: number; weight: number } | undefined;
        for (const p of partners.get(slot) ?? []) {
          const aligned = p.other.y + p.their - p.own;
          if (aligned % BOARD_GRID !== 0) {
            continue;
          }
          const distance = Math.abs(aligned - slot.y);
          if (distance === 0 || distance > cells(2)) {
            continue;
          }
          if (!best || p.weight > best.weight) {
            best = { y: aligned, weight: p.weight };
          }
        }
        if (!best) {
          return;
        }
        const previous = layer[row - 1];
        const next = layer[row + 1];
        const lowest = previous
          ? previous.y + previous.card.height + gapBetween(previous, slot)
          : Number.NEGATIVE_INFINITY;
        const highest = next
          ? next.y - slot.card.height - gapBetween(slot, next)
          : Number.POSITIVE_INFINITY;
        if (best.y >= lowest && best.y <= highest) {
          slot.y = best.y;
        }
      });
    }
  }
}

/**
 * Adjacent-pair transposition against the REAL wires: for every pair of
 * vertical neighbours in every column, count the crossings their wires
 * make as placed and as swapped, and keep the swap when it strictly
 * helps. This is the move a player makes by eye - the averaging passes
 * cannot see an actual crossing, only pulls - and it runs until no flip
 * improves anything. Returns whether any flip happened.
 */
function transposeToUncross(layers: CardSlot[][], links: WireLink[]): boolean {
  // EVERY link counts, the same-column ones included: a pair's wrap-around
  // wires cost nothing while the pair sits stacked, and cross everything
  // between the two the moment a swap separates them - which is exactly
  // what keeps the finisher from tearing a stacked pair apart.
  const spanning = links;
  const linksOf = new Map<CardSlot, WireLink[]>();
  for (const link of spanning) {
    push(linksOf, link.from, link);
    push(linksOf, link.to, link);
  }
  // Columns only exist later; for crossing tests each layer is a vertical
  // line, wires leaving a card on the right face and arriving on the left.
  const X_SPAN = 10000;
  const pointOf = (
    link: WireLink,
    end: "from" | "to",
    override: ReadonlyMap<CardSlot, number>,
  ) => {
    const slot = end === "from" ? link.from : link.to;
    const anchor = end === "from" ? link.fromAnchor : link.toAnchor;
    return {
      x: slot.layer * X_SPAN + (end === "from" ? X_SPAN - 100 : 100),
      y: (override.get(slot) ?? slot.y) + anchor,
    };
  };
  const crossed = (
    first: WireLink,
    second: WireLink,
    override: ReadonlyMap<CardSlot, number>,
  ): boolean => {
    if (
      first.from === second.from ||
      first.from === second.to ||
      first.to === second.from ||
      first.to === second.to
    ) {
      return false;
    }
    const a1 = pointOf(first, "from", override);
    const a2 = pointOf(first, "to", override);
    const b1 = pointOf(second, "from", override);
    const b2 = pointOf(second, "to", override);
    const turn = (
      p: { x: number; y: number },
      q: { x: number; y: number },
      r: { x: number; y: number },
    ) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const d1 = turn(b1, b2, a1);
    const d2 = turn(b1, b2, a2);
    const d3 = turn(a1, a2, b1);
    const d4 = turn(a1, a2, b2);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  const still = new Map<CardSlot, number>();
  let flippedAny = false;
  for (const layer of layers) {
    for (let i = 0; i + 1 < layer.length; i += 1) {
      const upper = layer[i];
      const lower = layer[i + 1];
      const involved = [
        ...new Set([...(linksOf.get(upper) ?? []), ...(linksOf.get(lower) ?? [])]),
      ];
      if (involved.length === 0) {
        continue;
      }
      const count = (override: ReadonlyMap<CardSlot, number>) => {
        let total = 0;
        for (let a = 0; a < involved.length; a += 1) {
          for (const other of spanning) {
            const b = involved.indexOf(other);
            if (b >= 0 && b <= a) {
              continue;
            }
            if (crossed(involved[a], other, override)) {
              total += 1;
            }
          }
        }
        return total;
      };
      // The swap trades their centres; exact stacking is the settle's job.
      const upperCentre = upper.y + upper.card.height / 2;
      const lowerCentre = lower.y + lower.card.height / 2;
      const swapped = new Map<CardSlot, number>([
        [upper, lowerCentre - upper.card.height / 2],
        [lower, upperCentre - lower.card.height / 2],
      ]);
      if (count(swapped) < count(still)) {
        const seq = upper.seq;
        upper.seq = lower.seq;
        lower.seq = seq;
        layer[i] = lower;
        layer[i + 1] = upper;
        upper.y = swapped.get(upper)!;
        lower.y = swapped.get(lower)!;
        flippedAny = true;
      }
    }
  }
  return flippedAny;
}

/** The card-column settle: order and section-aware gaps, solved exactly. */
function settleColumn(
  layer: CardSlot[],
  wishes: Array<{ wish: number; weight: number }>,
): void {
  if (layer.length === 0) {
    return;
  }
  const spacing = layer.map((slot, i) =>
    i === 0 ? 0 : layer[i - 1].card.height + gapBetween(layer[i - 1], slot),
  );
  const ys = settleLine(wishes, spacing);
  layer.forEach((slot, i) => {
    slot.y = ys[i];
  });
}

/**
 * Weighted isotonic regression with fixed spacings (pool adjacent
 * violators): place a line of items as close to their wishes as their
 * order and least-distances allow, exactly. `spacing[i]` is the least
 * distance from item i-1's top to item i's top; spacing[0] is ignored.
 * The same settle serves the cards in a column and the islands in one.
 */
function settleLine(
  wishes: Array<{ wish: number; weight: number }>,
  spacing: number[],
): number[] {
  // Substitute out the spacings: z_i = y_i - start_i must merely be
  // non-decreasing.
  const starts: number[] = [];
  let acc = 0;
  for (let i = 0; i < wishes.length; i += 1) {
    if (i > 0) {
      acc += spacing[i];
    }
    starts.push(acc);
  }
  const pools: Array<{ mean: number; weight: number; count: number }> = [];
  wishes.forEach((entry, i) => {
    let mean = entry.wish - starts[i];
    let weight = entry.weight;
    let count = 1;
    while (pools.length > 0 && pools[pools.length - 1].mean >= mean) {
      const prev = pools.pop()!;
      mean = (prev.mean * prev.weight + mean * weight) / (prev.weight + weight);
      weight += prev.weight;
      count += prev.count;
    }
    pools.push({ mean, weight, count });
  });
  const ys: number[] = [];
  let index = 0;
  for (const pool of pools) {
    for (let i = 0; i < pool.count; i += 1) {
      ys.push(pool.mean + starts[index]);
      index += 1;
    }
  }
  return ys;
}

/** A wire between two islands, still holding the card-level link behind it. */
interface BridgeLink {
  from: number;
  to: number;
  weight: number;
  link: WireLink;
}

/**
 * Which island stands upstream of which: net flow per pair picks the
 * direction, a DFS drops ring-closing edges, longest path deals columns,
 * and two slide passes pull each island toward its heavier side. Shared by
 * the exit-bias pre-pass and the island placement, so the two always agree.
 */
function islandFlowLayers(
  indices: number[],
  edges: Array<{ from: number; to: number; weight: number }>,
): Map<number, number> {
  const layerOf = new Map<number, number>(indices.map((index) => [index, 0]));
  if (edges.length === 0) {
    return layerOf;
  }
  const net = new Map<string, { from: number; to: number; weight: number }>();
  for (const edge of edges) {
    const key = `${Math.min(edge.from, edge.to)}:${Math.max(edge.from, edge.to)}`;
    const entry = net.get(key);
    if (!entry) {
      net.set(key, { from: edge.from, to: edge.to, weight: edge.weight });
    } else {
      entry.weight += entry.from === edge.from ? edge.weight : -edge.weight;
    }
  }
  const forward = [...net.values()]
    .map((entry) =>
      entry.weight >= 0 ? entry : { from: entry.to, to: entry.from, weight: -entry.weight },
    )
    .sort((a, b) => a.from - b.from || a.to - b.to);

  const outgoing = new Map<number, Array<{ from: number; to: number; weight: number }>>();
  for (const edge of forward) {
    push(outgoing, edge.from, edge);
  }
  const VISITING = 1;
  const DONE = 2;
  const state = new Map<number, number>();
  const kept: Array<{ from: number; to: number; weight: number }> = [];
  for (const start of indices) {
    if (state.has(start)) {
      continue;
    }
    const stack = [{ island: start, next: 0 }];
    state.set(start, VISITING);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const list = outgoing.get(frame.island) ?? [];
      if (frame.next >= list.length) {
        state.set(frame.island, DONE);
        stack.pop();
        continue;
      }
      const edge = list[frame.next];
      frame.next += 1;
      const seen = state.get(edge.to);
      if (seen === undefined) {
        state.set(edge.to, VISITING);
        kept.push(edge);
        stack.push({ island: edge.to, next: 0 });
      } else if (seen === DONE) {
        kept.push(edge);
      }
    }
  }

  {
    const indegree = new Map<number, number>(indices.map((index) => [index, 0]));
    for (const edge of kept) {
      indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    }
    const queue = indices.filter((index) => (indegree.get(index) ?? 0) === 0);
    for (let head = 0; head < queue.length; head += 1) {
      for (const edge of kept) {
        if (edge.from !== queue[head]) {
          continue;
        }
        layerOf.set(edge.to, Math.max(layerOf.get(edge.to)!, layerOf.get(edge.from)! + 1));
        const remaining = (indegree.get(edge.to) ?? 0) - 1;
        indegree.set(edge.to, remaining);
        if (remaining === 0) {
          queue.push(edge.to);
        }
      }
    }
  }
  for (let pass = 0; pass < 2; pass += 1) {
    for (const island of indices) {
      let lower = 0;
      let upper = Number.POSITIVE_INFINITY;
      let inWeight = 0;
      let outWeight = 0;
      for (const edge of kept) {
        if (edge.to === island) {
          lower = Math.max(lower, layerOf.get(edge.from)! + 1);
          inWeight += edge.weight;
        }
        if (edge.from === island) {
          upper = Math.min(upper, layerOf.get(edge.to)! - 1);
          outWeight += edge.weight;
        }
      }
      if (upper === Number.POSITIVE_INFINITY) {
        upper = layerOf.get(island)!;
      }
      if (upper < lower) {
        continue;
      }
      if (outWeight > inWeight) {
        layerOf.set(island, upper);
      } else if (inWeight > outWeight) {
        layerOf.set(island, lower);
      } else if (inWeight > 0 && outWeight > 0) {
        layerOf.set(island, Math.round((lower + upper) / 2));
      }
    }
  }
  return layerOf;
}

/**
 * Where each island stands: the blocks go through the very engine that
 * laid out their insides, as meta-cards. Their sizes are the block sizes,
 * their ports are the bridge endpoints, and every idea transfers - a
 * single-wire island is a BUD tucked beside its partner, two islands
 * trading both ways STACK as a pair, a lone interchange drawer is a free
 * band between its users, a ring of islands FOLDS, and the polish, the
 * transposition and the settle uncross and level the bridges exactly as
 * they do wires. Islands with no bridges pack in rows below; the shelf of
 * strays keeps the last row. Returns one offset per block.
 */
function placeIslands(
  blocks: Block[],
  bridges: BridgeLink[],
  localPlace: ReadonlyMap<string, Placement>,
): Placement[] {
  const offsets: Placement[] = blocks.map(() => ({ x: 0, y: 0 }));
  const metaSlots: CardSlot[] = blocks.map((block, index) => ({
    card: {
      id: `#${index}`,
      x: 0,
      y: 0,
      width: block.width,
      height: block.height,
      role: block.plain ? ("storage" as const) : ("machine" as const),
    },
    index,
    layer: 0,
    seq: 0,
    section: 0,
    trunk: false,
    y: 0,
  }));
  const metaLinks: WireLink[] = bridges.map((bridge) => ({
    from: metaSlots[bridge.from],
    to: metaSlots[bridge.to],
    fromAnchor: localPlace.get(bridge.link.from.card.id)!.y + bridge.link.fromAnchor,
    toAnchor: localPlace.get(bridge.link.to.card.id)!.y + bridge.link.toAnchor,
    weight: bridge.weight,
  }));

  return atIslandScale(() => {
    const slotById = new Map(metaSlots.map((slot) => [slot.card.id, slot]));
    const plans = planSatellites(slotById, metaLinks);
    const mainLinks = metaLinks.filter((link) => !plans.has(link.from) && !plans.has(link.to));
    const anchors = new Set([...plans.values()].map((plan) => plan.anchor));
    const linked = new Set<CardSlot>();
    for (const link of mainLinks) {
      linked.add(link.from);
      linked.add(link.to);
    }

    const componentOf = unionComponents(metaSlots.length, mainLinks);
    const componentSlots = new Map<number, CardSlot[]>();
    const loose: number[] = [];
    for (const slot of metaSlots) {
      if (plans.has(slot) || blocks[slot.index].shelf) {
        continue;
      }
      if (!linked.has(slot) && !anchors.has(slot)) {
        loose.push(slot.index);
        continue;
      }
      const root = componentOf(slot.index);
      const members = componentSlots.get(root);
      if (members) {
        members.push(slot);
      } else {
        componentSlots.set(root, [slot]);
      }
    }
    const metaBlocks: Block[] = [];
    for (const members of componentSlots.values()) {
      members.sort((a, b) => a.index - b.index);
      const memberSet = new Set(members);
      const componentLinks = mainLinks.filter(
        (link) => memberSet.has(link.from) && memberSet.has(link.to),
      );
      const componentSatellites = new Map<CardSlot, SatellitePlan>();
      for (const [sat, plan] of plans) {
        if (memberSet.has(plan.anchor)) {
          componentSatellites.set(sat, plan);
        }
      }
      metaBlocks.push(layoutIsland(members, componentLinks, componentSatellites, new Map()));
    }
    metaBlocks.sort((a, b) => b.size - a.size || a.minIndex - b.minIndex);

    // The trading constellations stack first, then the islands wired to
    // nothing in rows, then the shelf.
    let cursorY = 0;
    let width = 0;
    for (const metaBlock of metaBlocks) {
      metaBlock.ids.forEach((id, i) => {
        offsets[Number(id.slice(1))] = {
          x: metaBlock.places[i].x,
          y: cursorY + metaBlock.places[i].y,
        };
      });
      width = Math.max(width, metaBlock.width);
      cursorY += metaBlock.height + ISLAND_GAP;
    }
    const rowTarget = Math.max(width, cells(120));
    let rowX = 0;
    let rowHeight = 0;
    for (const index of loose) {
      if (rowX > 0 && rowX + blocks[index].width > rowTarget) {
        rowX = 0;
        cursorY += rowHeight + ISLAND_GAP;
        rowHeight = 0;
      }
      offsets[index] = { x: rowX, y: cursorY };
      rowX += blocks[index].width + ISLAND_GAP;
      rowHeight = Math.max(rowHeight, blocks[index].height);
    }
    if (rowHeight > 0) {
      cursorY += rowHeight + ISLAND_GAP;
    }
    blocks.forEach((block, index) => {
      if (block.shelf) {
        offsets[index] = { x: 0, y: cursorY };
        cursorY += block.height + ISLAND_GAP;
      }
    });

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    for (const offset of offsets) {
      minX = Math.min(minX, offset.x);
      minY = Math.min(minY, offset.y);
    }
    for (const offset of offsets) {
      offset.x -= minX;
      offset.y -= minY;
    }
    return offsets;
  });
}

/* ---------------------------------------------------------------------- */
/* The shelf: cards wired to nothing, parked in tidy rows.                 */
/* ---------------------------------------------------------------------- */

function layoutShelf(parked: CardSlot[], mainWidth: number): Block {
  // Sort by footprint so alike cards sit together - drawers with drawers,
  // machines with machines - then by input order so the shelf is stable.
  const sorted = [...parked].sort(
    (a, b) =>
      b.card.height - a.card.height ||
      b.card.width - a.card.width ||
      a.index - b.index,
  );
  const targetWidth = Math.max(mainWidth, cells(60));
  const ids: string[] = [];
  const places: Placement[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let width = 0;
  let height = 0;
  for (const slot of sorted) {
    if (x > 0 && x + slot.card.width > targetWidth) {
      x = 0;
      y += rowHeight + SHELF_GAP;
      rowHeight = 0;
    }
    ids.push(slot.card.id);
    places.push({ x, y });
    width = Math.max(width, x + slot.card.width);
    height = Math.max(height, y + slot.card.height);
    rowHeight = Math.max(rowHeight, slot.card.height);
    x += slot.card.width + SHELF_GAP;
  }
  return {
    ids,
    places,
    width,
    height,
    size: sorted.length,
    minIndex: sorted.reduce((min, slot) => Math.min(min, slot.index), Number.POSITIVE_INFINITY),
    shelf: true,
  };
}

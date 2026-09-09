/**
 * FREE PLACEMENT: the arranger's third candidate, with no columns, rows,
 * layers or bands (Jack, 2026-09-08: "get rid of the grid thinking ...
 * a lot of considerations when we place a thing").
 *
 * Three stages, all deterministic:
 *
 * 1. RELEVANCE. Every pair of cards gets an ideal distance: the length of
 *    the shortest wire path between them, each hop worth the two cards'
 *    sizes plus a gap. Stress SGD (Zheng, Pawar and Goodman, 2018) then
 *    finds continuous positions whose distances match those ideals as
 *    closely as they can: partners touch, cards two hops apart stand a
 *    card away, a card ten hops away is ten cards away. This is the
 *    whole of "near what is relevant to me, far from what is not", and
 *    it is global - every card's place is settled against every other.
 *
 * 2. THE GRID. Continuous positions overlap; cards are pushed apart along
 *    their least penetration until none do, then set on the cell grid one
 *    at a time, nearest the centre first, each on the free spot closest
 *    to where the stress put it.
 *
 * 3. THE SEARCH. Simulated annealing over FREE moves - a card beside a
 *    partner on any side (port rows aligned for the straight shot), a
 *    nudge, a swap, a machine with its own drawers moved as one, a whole
 *    neighbourhood shifted - every trial scored in the router's own
 *    points (board-arrange-optimize.ts: length, bends, detours,
 *    crossings, each wire weighed by its flow) plus the air strangers owe
 *    each other (board-arrange-air.ts) and a little sprawl. The score is
 *    kept INCREMENTALLY: a trial re-prices only the wires the moved cards
 *    touch and the wires whose path the cards moved across, so a board of
 *    eighty cards affords tens of thousands of trials. Each trial is
 *    every consideration Jack listed - how many wires this placement
 *    makes, how long, how each scores, who is near - and the annealing
 *    is the "future thinking": nothing is final until everything has been
 *    re-judged against everything else many times over.
 *
 * MACHINES STAND IN COLUMNS (the one lattice kept, because it is what a
 * hand draws): a machine's left edge sits on a column pitch of one machine
 * width plus a corridor wide enough for a drawer with a cell of air each
 * side, so drawers live in the corridors between machine columns, where
 * Jack's own boards put them. Rows are free: any cell. The search runs
 * TWICE, the way chip placers do: first with every card free to any cell
 * (the global placement, which finds the structure), then the machines
 * are LEGALISED onto their columns and a shorter, cooler search over
 * column moves repairs what the snap disturbed. Searching on the lattice
 * from the start found layouts a fifth worse under the same score - a
 * column hop is too big a step for the annealing to feel its way with.
 *
 * DRAWERS ARE PLACED BY PATTERN, NOT SEARCHED (Jack, 2026-09-08, holding
 * his own oil board against the arranger's: "shouldn't all the products
 * just be in a row next to each other ... one grid away from the machine
 * ... optimise patterns"): a drawer wired to ONE machine is that
 * machine's bud and stands in a touching LINE on its side - supplies on
 * the left, products on the right, in port order, the line centred on
 * the ports it serves; a drawer wired to exactly TWO machines is a shared
 * drawer and stands in a line BETWEEN them - in the corridor when they
 * are side by side, in a row in the gap when one is above the other. The
 * search moves machines (and the few drawers wired to three or more)
 * and every drawer line follows, so a machine feeding fifty products
 * gets fifty drawers in a column, not fifty spots each at its own port
 * row. The wires are a cell or two longer for it and the board reads.
 *
 * Wired components are laid out one at a time and packed side by side;
 * cards with no wires go on a shelf underneath. The real router judges
 * the result against the column candidates in board-arrange.ts and the
 * fewest points wins, so this can only ever improve what the player sees.
 */

import { BOARD_GRID } from "./board-grid";
import { makeAirTerm } from "./board-arrange-air";
import {
  pathBends,
  pathBlocked,
  pathCrossings,
  pathLength,
  proxyPath,
  type Path,
  type Rect,
} from "./board-arrange-optimize";
import { wireWeight } from "./route-metrics";
import type { RouterTuning } from "@/components/flow/router-tuning";

export interface FreeCard {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  role?: "machine" | "storage";
}

export interface FreeWire {
  id?: string;
  source: string;
  target: string;
  weight?: number;
  width?: number;
  sourcePortY?: number;
  targetPortY?: number;
}

export interface FreeOptions {
  prices: RouterTuning;
  /** Annealing trials for the whole board; split across components by size. */
  trials?: number;
  /** Least air between any two cards, in cells (the taste's row gap). */
  gapCells?: number;
  /** Air a card keeps from a partner it is set beside, in cells (the taste's column gap). */
  besideCells?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface FreeResult {
  /** Every card's new top-left, the bounding box starting at 0,0. */
  positions: Map<string, Point>;
  /** Each wired component's box, the shelf of unwired cards last. */
  islands: Array<{ x: number; y: number; width: number; height: number; backdrop: boolean }>;
}

type Point = { x: number; y: number };

const cells = (n: number) => n * BOARD_GRID;
const snap = (v: number) => Math.round(v / BOARD_GRID) * BOARD_GRID;

/** Least air between any two cards, in cells; set per call from the taste. */
let GAP_CELLS = 1;
/** Air a card keeps from the partner it is set beside, in cells (columns). */
let BESIDE_CELLS = 2;
/** Air between two wired components, and between them and the shelf. */
const COMPONENT_GAP_CELLS = 8;
/** Stress SGD iterations. */
const STRESS_ITERATIONS = 40;
/**
 * TIDINESS: points per pixel a card's edge misses lining up with a
 * neighbour's - a card stacked near another wants a shared left or right
 * edge, a card beside another a shared top or bottom (or a shared port
 * row, the straight shot). Capped per axis, so a card with nothing to
 * line up with pays nothing and a card wildly off pays no more than a
 * few cells' worth. This is how rows and columns HAPPEN without a column
 * system: neighbours agree on edges because it is cheaper.
 */
/** The three, in one object so a harness can sweep them (FREE_DIALS). */
export const FREE_DIALS = {
  tidy: 1,
  tidyCapCells: 4,
  flow: 0.35,
  flowFlat: 400,
  flowFlatColumns: 1500,
  flowFlatCycle: 150,
  sprawl: 0.4,
};
/** How far a neighbour may be, beyond the edges, and still be aligned with. */
const TIDY_REACH = cells(12);
/**
 * FLOW: points per pixel a wire falls short of running forwards - its
 * target's centre less than a card's width to the right of its source's.
 * Outputs leave a card's right side and inputs enter its left, so a board
 * that flows left to right reads at a glance, a chain lays out as a row
 * instead of a stack, and a supply drawer stands on the left of its
 * machine, a catch drawer on the right. A return wire in a loop still
 * pays, and stays short for it. A backward wire also pays a FLAT price
 * (`flowFlat`, a crossing's worth, and `flowFlatColumns`, nearly four,
 * when both ends are column cards): the direction of flow is a reading, not
 * a distance, and without the flat price a chain of three folded into a
 * triangle and a fan-out ringed its hub, because those wires were shorter.
 * Machines pay most because their ports face sideways: a machine fed from
 * the right reads as backwards, a drawer above its machine does not. A
 * wire INSIDE A CYCLE (both ends in one strongly connected component of
 * the directed wire graph) pays only `flowFlatCycle`: a recycle loop must
 * run backwards somewhere, and an oil board is mostly loops, so the full
 * price there was the largest term on the board and bent everything else
 * around it (measured 2026-09-08: 38k of 94k points).
 */

function rng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashIds(ids: readonly string[]): number {
  let hash = 2166136261;
  for (const id of ids) {
    for (let i = 0; i < id.length; i += 1) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 0x9e3779b9;
  }
  return hash >>> 0;
}

/**
 * Lays the board out. Returns every card's new top-left, normalised so the
 * bounding box starts at 0,0.
 */
export function arrangeFree(
  cards: readonly FreeCard[],
  wires: readonly FreeWire[],
  options: FreeOptions,
): FreeResult {
  GAP_CELLS = options.gapCells ?? 1;
  BESIDE_CELLS = options.besideCells ?? 2;
  const index = new Map<string, number>();
  cards.forEach((card, i) => index.set(card.id, i));
  const adjacency: number[][] = cards.map(() => []);
  const usable: Array<{ a: number; b: number; wire: FreeWire }> = [];
  for (const wire of wires) {
    const a = index.get(wire.source);
    const b = index.get(wire.target);
    if (a === undefined || b === undefined || a === b) continue;
    adjacency[a].push(b);
    adjacency[b].push(a);
    usable.push({ a, b, wire });
  }
  // Components: wired webs, and the shelf of cards with no wires at all.
  const component = new Int32Array(cards.length).fill(-1);
  const components: number[][] = [];
  for (let i = 0; i < cards.length; i += 1) {
    if (component[i] >= 0 || adjacency[i].length === 0) continue;
    const members: number[] = [i];
    component[i] = components.length;
    for (let head = 0; head < members.length; head += 1) {
      for (const next of adjacency[members[head]]) {
        if (component[next] < 0) {
          component[next] = components.length;
          members.push(next);
        }
      }
    }
    components.push(members);
  }
  const shelf = cards.map((_, i) => i).filter((i) => component[i] < 0);
  // Bigger components first: they set the row, and they get the trials.
  components.sort((a, b) => b.length - a.length || a[0] - b[0]);
  const totalCards = components.reduce((sum, members) => sum + members.length, 0) || 1;
  const trials = options.trials ?? 20000;
  let progressDone = 0;
  const blocks: Array<{ ids: number[]; positions: Point[]; width: number; height: number }> = [];
  for (const members of components) {
    const local = members.map((i) => cards[i]);
    const localIndex = new Map(members.map((i, k) => [i, k]));
    const localWires = usable
      .filter(({ a }) => localIndex.has(a))
      .map(({ a, b, wire }) => ({ a: localIndex.get(a)!, b: localIndex.get(b)!, wire }));
    const share = Math.max(200, Math.round((trials * members.length) / totalCards));
    const positions = layoutComponent(local, localWires, options.prices, share, (done) =>
      options.onProgress?.(progressDone + done, trials),
    );
    progressDone += share;
    const left = Math.min(...positions.map((p) => p.x));
    const top = Math.min(...positions.map((p) => p.y));
    const normalised = positions.map((p) => ({ x: p.x - left, y: p.y - top }));
    blocks.push({
      ids: members,
      positions: normalised,
      width: Math.max(...normalised.map((p, k) => p.x + local[k].width)),
      height: Math.max(...normalised.map((p, k) => p.y + local[k].height)),
    });
  }
  // Pack the components in a row, wrapping like text past a wide page.
  const out = new Map<string, Point>();
  const islands: FreeResult["islands"] = [];
  const gap = cells(COMPONENT_GAP_CELLS);
  const pageWidth = Math.max(cells(240), ...blocks.map((block) => block.width));
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  for (const block of blocks) {
    if (cursorX > 0 && cursorX + block.width > pageWidth) {
      cursorX = 0;
      cursorY += rowHeight + gap;
      rowHeight = 0;
    }
    block.ids.forEach((i, k) => {
      out.set(cards[i].id, { x: cursorX + block.positions[k].x, y: cursorY + block.positions[k].y });
    });
    islands.push({ x: cursorX, y: cursorY, width: block.width, height: block.height, backdrop: true });
    cursorX += block.width + gap;
    rowHeight = Math.max(rowHeight, block.height);
  }
  // The shelf: unwired cards in a row underneath, in their input order.
  if (shelf.length > 0) {
    let x = 0;
    const y = blocks.length > 0 ? cursorY + rowHeight + gap : 0;
    let height = 0;
    for (const i of shelf) {
      out.set(cards[i].id, { x, y });
      x += cards[i].width + cells(2);
      height = Math.max(height, cards[i].height);
    }
    islands.push({ x: 0, y, width: Math.max(0, x - cells(2)), height, backdrop: false });
  }
  return { positions: out, islands };
}

/* ---------------------------------------------------------------------- */
/* One wired component.                                                    */
/* ---------------------------------------------------------------------- */

function layoutComponent(
  cards: readonly FreeCard[],
  wires: ReadonlyArray<{ a: number; b: number; wire: FreeWire }>,
  prices: RouterTuning,
  trials: number,
  onProgress: (done: number) => void,
): Point[] {
  const random = rng(hashIds(cards.map((card) => card.id)));
  const n = cards.length;
  const lattice = columnLattice(cards);
  const anyCell: Lattice = { pitch: BOARD_GRID, isColumnCard: () => false };
  const continuous = orientForFlow(cards, wires, stressLayout(cards, wires, random));
  if (n < 2) {
    return settleOnGrid(cards, continuous, lattice);
  }
  // The global search runs with every drawer FREE: the patterns need the
  // column corridors to exist, and off the lattice a drawer line collides
  // with whatever stands beside its machine, so most trials were refused
  // and the search went nowhere. The patterns come in with the columns.
  const patterns = planPatterns(cards, wires, lattice);
  const loose: Patterns = { placement: cards.map(() => undefined), attached: cards.map(() => []), pairPartners: cards.map(() => []) };
  const grid = settleOnGrid(cards, continuous, anyCell);
  const globalTrials = Math.round(trials * 0.6);
  const placed = anneal(cards, wires, grid, prices, globalTrials, random, (done) => onProgress(done), anyCell, 1, loose);
  const legal = settleWithPatterns(cards, legalise(cards, placed, lattice), patterns);
  const done = anneal(
    cards,
    wires,
    legal,
    prices,
    trials - globalTrials,
    random,
    (done) => onProgress(globalTrials + done),
    lattice,
    0.15,
    patterns,
  );
  return settleWithPatterns(cards, done, patterns);
}

/**
 * The column lattice (header): machines' left edges sit on multiples of
 * the pitch. The pitch is the widest common machine width plus a corridor
 * for the widest drawer with a cell of air each side (two cells of air
 * when there are no drawers at all).
 */
interface Lattice {
  pitch: number;
  isColumnCard: (i: number) => boolean;
}

function columnLattice(cards: readonly FreeCard[]): Lattice {
  const machines = cards.filter((card) => card.role !== "storage");
  const widths = new Map<number, number>();
  for (const card of machines) widths.set(card.width, (widths.get(card.width) ?? 0) + 1);
  const machineWidth =
    [...widths.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? cells(22);
  const drawers = cards.filter((card) => card.width < 0.6 * machineWidth);
  // The corridor: a drawer, standing BESIDE_CELLS from the machine it is
  // wired to and GAP_CELLS from the next column.
  const corridor =
    drawers.length > 0
      ? Math.max(...drawers.map((card) => card.width)) + cells(BESIDE_CELLS) + cells(GAP_CELLS)
      : cells(BESIDE_CELLS);
  const pitch = snap(machineWidth + corridor);
  // Column cards are the wide ones, by size rather than by role: a small
  // tile with no role stamped on it still lives in the corridors.
  return { pitch, isColumnCard: (i) => cards[i].width >= 0.6 * machineWidth };
}

/** A card's position quantised to what it may stand on: column or cell. */
function quantise(lattice: Lattice, i: number, p: Point): Point {
  return {
    x: lattice.isColumnCard(i) ? Math.round(p.x / lattice.pitch) * lattice.pitch : snap(p.x),
    y: snap(p.y),
  };
}

/**
 * Machines onto their columns, nearest the middle first, each on the free
 * lattice spot closest to where the global search left it; drawers keep
 * their cells unless a machine now needs the spot.
 */
function legalise(cards: readonly FreeCard[], positions: Point[], lattice: Lattice): Point[] {
  const n = cards.length;
  const gap = cells(GAP_CELLS);
  const cx = positions.reduce((s, p, i) => s + p.x + cards[i].width / 2, 0) / n;
  const cy = positions.reduce((s, p, i) => s + p.y + cards[i].height / 2, 0) / n;
  const order = cards
    .map((card, i) => ({
      i,
      column: lattice.isColumnCard(i) ? 0 : 1,
      d: Math.hypot(positions[i].x + card.width / 2 - cx, positions[i].y + card.height / 2 - cy),
    }))
    .sort((a, b) => a.column - b.column || a.d - b.d || a.i - b.i)
    .map((entry) => entry.i);
  const placed: Rect[] = [];
  const out: Point[] = new Array(n);
  for (const i of order) {
    const want = quantise(lattice, i, positions[i]);
    const stepX = lattice.isColumnCard(i) ? lattice.pitch : BOARD_GRID;
    const spot = nearestFree(want, cards[i], placed, gap, 60, undefined, stepX) ?? want;
    out[i] = spot;
    placed.push({ left: spot.x, top: spot.y, right: spot.x + cards[i].width, bottom: spot.y + cards[i].height });
  }
  return out;
}

/* ---------------------------------------------------------------------- */
/* Drawer patterns (header): buds and shared drawers, placed by rule.     */
/* ---------------------------------------------------------------------- */

type Placement =
  | { kind: "bud"; machine: number; side: "left" | "right"; port: number }
  | { kind: "pair"; a: number; b: number; portA: number; portB: number };

interface Patterns {
  /** How each card is placed; undefined for a card the search moves. */
  placement: Array<Placement | undefined>;
  /** The derived drawers attached to each machine (its buds, its shared drawers). */
  attached: number[][];
  /** The machines each machine shares a drawer with. */
  pairPartners: number[][];
}

function planPatterns(
  cards: readonly FreeCard[],
  wires: ReadonlyArray<{ a: number; b: number; wire: FreeWire }>,
  lattice: Lattice,
): Patterns {
  const n = cards.length;
  const placement: Array<Placement | undefined> = new Array(n).fill(undefined);
  const attached: number[][] = cards.map(() => []);
  const pairPartners: number[][] = cards.map(() => []);
  const wiresOf: number[][] = cards.map(() => []);
  wires.forEach(({ a, b }, w) => {
    wiresOf[a].push(w);
    wiresOf[b].push(w);
  });
  for (let d = 0; d < n; d += 1) {
    if (lattice.isColumnCard(d) || wiresOf[d].length === 0) continue;
    const partners = new Map<number, number[]>();
    let foreign = false;
    for (const w of wiresOf[d]) {
      const other = wires[w].a === d ? wires[w].b : wires[w].a;
      if (!lattice.isColumnCard(other)) {
        foreign = true;
        break;
      }
      const list = partners.get(other) ?? [];
      // The port row on the machine's side, the machine's mid-height when unmeasured.
      const port =
        (wires[w].a === other ? wires[w].wire.sourcePortY : wires[w].wire.targetPortY) ??
        cards[other].height / 2;
      list.push(port);
      partners.set(other, list);
    }
    if (foreign) continue;
    const mean = (list: number[]) => list.reduce((s, v) => s + v, 0) / list.length;
    if (partners.size === 1) {
      const [machine, ports] = [...partners.entries()][0];
      // A supply (every wire runs drawer -> machine) stands on the left.
      const supply = wiresOf[d].every((w) => wires[w].a === d);
      placement[d] = { kind: "bud", machine, side: supply ? "left" : "right", port: mean(ports) };
      attached[machine].push(d);
    } else if (partners.size === 2) {
      const [[a, portsA], [b, portsB]] = [...partners.entries()];
      placement[d] = { kind: "pair", a, b, portA: mean(portsA), portB: mean(portsB) };
      attached[a].push(d);
      attached[b].push(d);
      if (!pairPartners[a].includes(b)) pairPartners[a].push(b);
      if (!pairPartners[b].includes(a)) pairPartners[b].push(a);
    }
  }
  return { placement, attached, pairPartners };
}

/**
 * Where the drawers attached to `machines` (and to the machines they share
 * drawers with) stand, given every card's position through `at`. Lines
 * are built whole: a machine's right line holds its product buds and the
 * shared drawers of every partner standing to its right, in port order,
 * touching, centred on the ports they serve and kept within the machine's
 * height; a row between a machine and the one below it likewise.
 */
function derivePatterns(
  cards: readonly FreeCard[],
  patterns: Patterns,
  machines: readonly number[],
  at: (i: number) => Point,
): Map<number, Point> {
  const out = new Map<number, Point>();
  const scope = new Set<number>();
  for (const m of machines) {
    scope.add(m);
    for (const p of patterns.pairPartners[m]) scope.add(p);
  }
  const rectOf = (i: number): Rect => {
    const p = at(i);
    return { left: p.x, top: p.y, right: p.x + cards[i].width, bottom: p.y + cards[i].height };
  };
  const lines = new Map<string, Array<{ d: number; key: number }>>();
  const rows = new Map<string, Array<{ d: number; key: number }>>();
  const add = (map: Map<string, Array<{ d: number; key: number }>>, key: string, d: number, order: number) => {
    const list = map.get(key) ?? [];
    list.push({ d, key: order });
    map.set(key, list);
  };
  const seen = new Set<number>();
  for (const m of scope) {
    for (const d of patterns.attached[m]) {
      if (seen.has(d)) continue;
      seen.add(d);
      const place = patterns.placement[d]!;
      if (place.kind === "bud") {
        add(lines, `${place.machine}:${place.side}`, d, place.port);
        continue;
      }
      const ra = rectOf(place.a);
      const rb = rectOf(place.b);
      if (rb.left >= ra.right) add(lines, `${place.a}:right`, d, place.portA);
      else if (ra.left >= rb.right) add(lines, `${place.b}:right`, d, place.portB);
      else if (rb.top >= ra.bottom) add(rows, `${place.a}:${place.b}`, d, place.portA);
      else if (ra.top >= rb.bottom) add(rows, `${place.b}:${place.a}`, d, place.portB);
      else if ((ra.left + ra.right) / 2 <= (rb.left + rb.right) / 2) add(lines, `${place.a}:right`, d, place.portA);
      else add(lines, `${place.b}:right`, d, place.portB);
    }
  }
  const byKey = (p: { d: number; key: number }, q: { d: number; key: number }) => p.key - q.key || p.d - q.d;
  for (const [key, members] of lines) {
    const [machineText, side] = key.split(":");
    const m = Number(machineText);
    const r = rectOf(m);
    members.sort(byKey);
    const height = members.reduce((s, { d }) => s + cards[d].height, 0);
    const width = Math.max(...members.map(({ d }) => cards[d].width));
    const meanPort = members.reduce((s, { key }) => s + key, 0) / members.length;
    const y0 = snap(Math.min(Math.max(r.top + meanPort - height / 2, r.top), Math.max(r.top, r.bottom - height)));
    // Right: beside the machine. Left: at the far side of the corridor, the
    // same x the previous column's right line uses, so two lines in one
    // corridor can only clash in y.
    const x = side === "right" ? r.right + cells(BESIDE_CELLS) : r.left - width - cells(GAP_CELLS);
    let y = y0;
    for (const { d } of members) {
      out.set(d, { x: snap(x), y });
      y += cards[d].height;
    }
  }
  for (const [key, members] of rows) {
    const [upperText, lowerText] = key.split(":");
    const upper = rectOf(Number(upperText));
    const lower = rectOf(Number(lowerText));
    members.sort(byKey);
    const width = members.reduce((s, { d }) => s + cards[d].width, 0);
    const left = Math.max(upper.left, lower.left);
    const right = Math.min(upper.right, lower.right);
    const x0 = snap(right > left ? Math.min(Math.max((left + right) / 2 - width / 2, left), Math.max(left, right - width)) : left);
    const y = snap(upper.bottom + cells(GAP_CELLS));
    let x = x0;
    for (const { d } of members) {
      out.set(d, { x, y });
      x += cards[d].width;
    }
  }
  return out;
}

/**
 * Every derived drawer put where its pattern says, from the machines as
 * they stand; a drawer whose place is taken (two lines meeting in one
 * corridor, a row with no room) is freed - handed the nearest empty spot
 * and moved by the search like any other card from then on.
 */
function settleWithPatterns(cards: readonly FreeCard[], positions: Point[], patterns: Patterns): Point[] {
  const out = positions.map((p) => ({ ...p }));
  const machines = cards.map((_, i) => i).filter((i) => patterns.attached[i].length > 0);
  const derived = derivePatterns(cards, patterns, machines, (i) => out[i]);
  for (const [d, p] of derived) out[d] = p;
  const gap = cells(GAP_CELLS);
  // Lines that meet in one corridor STACK: two machines side by side put
  // their products and supplies in the same corridor, and the later line
  // slides down until it clears the one above rather than being broken up.
  {
    const byCorridor = new Map<number, number[]>();
    for (const d of derived.keys()) {
      const list = byCorridor.get(out[d].x) ?? [];
      list.push(d);
      byCorridor.set(out[d].x, list);
    }
    for (const list of byCorridor.values()) {
      list.sort((a, b) => out[a].y - out[b].y || a - b);
      let floor = -Infinity;
      for (const d of list) {
        if (out[d].y < floor) out[d] = { x: out[d].x, y: floor };
        floor = out[d].y + cards[d].height;
      }
    }
  }
  const rect = (i: number): Rect => ({ left: out[i].x, top: out[i].y, right: out[i].x + cards[i].width, bottom: out[i].y + cards[i].height });
  // Conflicts, in a fixed order: the later drawer of a clashing pair is freed.
  const ids = [...derived.keys()].sort((a, b) => a - b);
  for (const d of ids) {
    if (!patterns.placement[d]) continue;
    const mine = rect(d);
    let clash = false;
    for (let o = 0; o < cards.length; o += 1) {
      if (o === d) continue;
      if (overlaps(mine, rect(o), patterns.placement[o] && derived.has(o) ? 0 : gap)) {
        clash = true;
        break;
      }
    }
    if (!clash) continue;
    freePlacement(patterns, d);
    const others = cards.map((_, o) => o).filter((o) => o !== d).map(rect);
    out[d] = nearestFree(out[d], cards[d], others, gap, 80) ?? out[d];
  }
  return out;
}

/** A drawer leaves its pattern and becomes a card the search moves. */
function freePlacement(patterns: Patterns, d: number): void {
  const place = patterns.placement[d];
  if (!place) return;
  patterns.placement[d] = undefined;
  const detach = (m: number) => {
    patterns.attached[m] = patterns.attached[m].filter((x) => x !== d);
  };
  if (place.kind === "bud") {
    detach(place.machine);
    return;
  }
  detach(place.a);
  detach(place.b);
  const stillShared = patterns.attached[place.a].some((x) => {
    const p = patterns.placement[x];
    return p?.kind === "pair" && (p.a === place.b || p.b === place.b);
  });
  if (!stillShared) {
    patterns.pairPartners[place.a] = patterns.pairPartners[place.a].filter((x) => x !== place.b);
    patterns.pairPartners[place.b] = patterns.pairPartners[place.b].filter((x) => x !== place.a);
  }
}

/* ---------------------------------------------------------------------- */
/* Stage 1: stress.                                                        */
/* ---------------------------------------------------------------------- */

/** Ideal centre-to-centre distance of two cards that share a wire. */
function pitch(a: FreeCard, b: FreeCard): number {
  return (Math.max(a.width, a.height) + Math.max(b.width, b.height)) / 2 + cells(BESIDE_CELLS);
}

/** Card CENTRES matching graph distance as closely as stress SGD can. */
function stressLayout(
  cards: readonly FreeCard[],
  wires: ReadonlyArray<{ a: number; b: number; wire: FreeWire }>,
  random: () => number,
): Point[] {
  const n = cards.length;
  const edges: Array<Array<{ to: number; length: number }>> = cards.map(() => []);
  for (const { a, b } of wires) {
    const length = pitch(cards[a], cards[b]);
    edges[a].push({ to: b, length });
    edges[b].push({ to: a, length });
  }
  // All-pairs shortest paths by Dijkstra from each card (n is small).
  const distance: Float64Array[] = [];
  for (let source = 0; source < n; source += 1) {
    const dist = new Float64Array(n).fill(Infinity);
    const done = new Uint8Array(n);
    dist[source] = 0;
    for (let round = 0; round < n; round += 1) {
      let best = -1;
      for (let i = 0; i < n; i += 1) {
        if (!done[i] && dist[i] < Infinity && (best < 0 || dist[i] < dist[best])) best = i;
      }
      if (best < 0) break;
      done[best] = 1;
      for (const edge of edges[best]) {
        const through = dist[best] + edge.length;
        if (through < dist[edge.to]) dist[edge.to] = through;
      }
    }
    distance.push(dist);
  }
  // Start on a circle in breadth-first order from the best-connected card,
  // never from where the cards stand: the answer for a board must not
  // depend on how it was left, or two players with one plan would get two
  // arrangements. The seeded shuffles below are the only randomness.
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  {
    const order: number[] = [];
    const seen = new Uint8Array(n);
    const byDegree = cards.map((_, i) => i).sort((a, b) => edges[b].length - edges[a].length || a - b);
    for (const root of byDegree) {
      if (seen[root]) continue;
      seen[root] = 1;
      order.push(root);
      for (let head = order.length - 1; head < order.length; head += 1) {
        for (const edge of edges[order[head]]) {
          if (!seen[edge.to]) {
            seen[edge.to] = 1;
            order.push(edge.to);
          }
        }
      }
    }
    let step = 0;
    for (const { a, b } of wires) step += pitch(cards[a], cards[b]);
    step = wires.length > 0 ? step / wires.length : cells(24);
    const radius = Math.max(step, (n * step) / (2 * Math.PI));
    order.forEach((i, k) => {
      const angle = (2 * Math.PI * k) / n;
      x[i] = radius * Math.cos(angle);
      y[i] = radius * Math.sin(angle);
    });
  }
  const pairs: Array<[number, number]> = [];
  let wMin = Infinity;
  let wMax = 0;
  for (let i = 0; i < n; i += 1) {
    for (let k = i + 1; k < n; k += 1) {
      const d = distance[i][k];
      if (!Number.isFinite(d) || d <= 0) continue;
      pairs.push([i, k]);
      const w = 1 / (d * d);
      wMin = Math.min(wMin, w);
      wMax = Math.max(wMax, w);
    }
  }
  if (pairs.length === 0) {
    return cards.map((_, i) => ({ x: x[i], y: y[i] }));
  }
  const etaMax = 1 / wMin;
  const etaMin = 0.1 / wMax;
  const lambda = Math.log(etaMax / etaMin) / Math.max(1, STRESS_ITERATIONS - 1);
  for (let t = 0; t < STRESS_ITERATIONS; t += 1) {
    const eta = etaMax * Math.exp(-lambda * t);
    // Fisher-Yates with the seeded generator: deterministic shuffles.
    for (let i = pairs.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const swap = pairs[i];
      pairs[i] = pairs[j];
      pairs[j] = swap;
    }
    for (const [i, k] of pairs) {
      const d = distance[i][k];
      const mu = Math.min(1, eta / (d * d));
      const dx = x[i] - x[k];
      const dy = y[i] - y[k];
      const mag = Math.hypot(dx, dy) || 1e-6;
      const r = ((mag - d) / 2) * mu;
      const rx = (dx / mag) * r;
      const ry = (dy / mag) * r;
      x[i] -= rx;
      y[i] -= ry;
      x[k] += rx;
      y[k] += ry;
    }
  }
  return cards.map((_, i) => ({ x: x[i], y: y[i] }));
}

/**
 * Stress is blind to direction: any reflection or rotation scores the
 * same. Of the eight, keep the one where the fewest wires run backwards
 * (weighted), so the search starts from a board that already flows.
 */
function orientForFlow(
  cards: readonly FreeCard[],
  wires: ReadonlyArray<{ a: number; b: number; wire: FreeWire }>,
  centres: Point[],
): Point[] {
  const variants: Array<(p: Point) => Point> = [
    (p) => ({ x: p.x, y: p.y }),
    (p) => ({ x: -p.x, y: p.y }),
    (p) => ({ x: p.x, y: -p.y }),
    (p) => ({ x: -p.x, y: -p.y }),
    (p) => ({ x: p.y, y: p.x }),
    (p) => ({ x: -p.y, y: p.x }),
    (p) => ({ x: p.y, y: -p.x }),
    (p) => ({ x: -p.y, y: -p.x }),
  ];
  let best: Point[] = centres;
  let bestCost = Infinity;
  for (const variant of variants) {
    const mapped = centres.map(variant);
    let cost = 0;
    for (const { a, b, wire } of wires) {
      const weight = wire.width !== undefined ? wireWeight(wire.width) : Math.max(wire.weight ?? 1, 0.01);
      cost += weight * Math.max(0, mapped[a].x - mapped[b].x);
    }
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = mapped;
    }
  }
  return best;
}

/* ---------------------------------------------------------------------- */
/* Stage 2: the grid.                                                      */
/* ---------------------------------------------------------------------- */

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;
}

/** Continuous centres -> non-overlapping grid top-lefts. */
function settleOnGrid(cards: readonly FreeCard[], centres: Point[], lattice: Lattice): Point[] {
  const n = cards.length;
  const gap = cells(GAP_CELLS);
  const tl = centres.map((c, i) => ({ x: c.x - cards[i].width / 2, y: c.y - cards[i].height / 2 }));
  // Push overlapping pairs apart along their least penetration.
  for (let pass = 0; pass < 400; pass += 1) {
    let moved = false;
    for (let i = 0; i < n; i += 1) {
      for (let k = i + 1; k < n; k += 1) {
        const a = { left: tl[i].x, top: tl[i].y, right: tl[i].x + cards[i].width, bottom: tl[i].y + cards[i].height };
        const b = { left: tl[k].x, top: tl[k].y, right: tl[k].x + cards[k].width, bottom: tl[k].y + cards[k].height };
        if (!overlaps(a, b, gap)) continue;
        const px = Math.min(a.right + gap - b.left, b.right + gap - a.left);
        const py = Math.min(a.bottom + gap - b.top, b.bottom + gap - a.top);
        moved = true;
        if (px < py) {
          const dir = (a.left + a.right) / 2 <= (b.left + b.right) / 2 ? 1 : -1;
          tl[i].x -= (dir * px) / 2;
          tl[k].x += (dir * px) / 2;
        } else {
          const dir = (a.top + a.bottom) / 2 <= (b.top + b.bottom) / 2 ? 1 : -1;
          tl[i].y -= (dir * py) / 2;
          tl[k].y += (dir * py) / 2;
        }
      }
    }
    if (!moved) break;
  }
  // Onto the grid: nearest the middle first, each on the closest free spot.
  const cx = tl.reduce((s, p, i) => s + p.x + cards[i].width / 2, 0) / n;
  const cy = tl.reduce((s, p, i) => s + p.y + cards[i].height / 2, 0) / n;
  const order = cards
    .map((card, i) => ({ i, d: Math.hypot(tl[i].x + card.width / 2 - cx, tl[i].y + card.height / 2 - cy) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((entry) => entry.i);
  const placed: Rect[] = [];
  const out: Point[] = new Array(n);
  for (const i of order) {
    const want = quantise(lattice, i, tl[i]);
    const stepX = lattice.isColumnCard(i) ? lattice.pitch : BOARD_GRID;
    const spot = nearestFree(want, cards[i], placed, gap, 60, undefined, stepX) ?? want;
    out[i] = spot;
    placed.push({ left: spot.x, top: spot.y, right: spot.x + cards[i].width, bottom: spot.y + cards[i].height });
  }
  return out;
}

/** The free grid spot nearest `want` for a card of this size, within `radius` cells. */
function nearestFree(
  want: Point,
  card: { width: number; height: number },
  others: readonly Rect[],
  gap: number,
  radius: number,
  skip?: (rect: Rect) => boolean,
  stepX = BOARD_GRID,
): Point | undefined {
  const fits = (x: number, y: number) => {
    const rect = { left: x, top: y, right: x + card.width, bottom: y + card.height };
    for (const other of others) {
      if (skip?.(other)) continue;
      if (overlaps(rect, other, gap)) return false;
    }
    return true;
  };
  if (fits(want.x, want.y)) return want;
  for (let r = 1; r <= radius; r += 1) {
    // Ring r, nearest points first: a diamond by Manhattan distance.
    let best: Point | undefined;
    let bestD = Infinity;
    for (let dx = -r; dx <= r; dx += 1) {
      const dy = r - Math.abs(dx);
      for (const sy of dy === 0 ? [0] : [-1, 1]) {
        const x = want.x + dx * stepX;
        const y = want.y + sy * dy * BOARD_GRID;
        const d = dx * dx + dy * dy;
        if (d < bestD && fits(x, y)) {
          best = { x, y };
          bestD = d;
        }
      }
    }
    if (best) return best;
  }
  return undefined;
}

/* ---------------------------------------------------------------------- */
/* The terms, standalone, so the search and the explainer price alike.     */
/* ---------------------------------------------------------------------- */

type PortRows = Array<Map<number, [number, number]>>;

function portRowsOf(cards: readonly FreeCard[], wires: ReadonlyArray<{ a: number; b: number; wire: FreeWire }>): PortRows {
  const rows: PortRows = cards.map(() => new Map());
  wires.forEach(({ a, b, wire }) => {
    if (wire.sourcePortY !== undefined && wire.targetPortY !== undefined) {
      rows[a].set(b, [wire.sourcePortY, wire.targetPortY]);
      rows[b].set(a, [wire.targetPortY, wire.sourcePortY]);
    }
  });
  return rows;
}

/** The tidiness owed by card k at these rects (header: TIDY). */
function tidyAt(k: number, rects: readonly Rect[], portRows: PortRows): number {
  const me = rects[k];
  let misX = Infinity;
  let misY = Infinity;
  for (let c = 0; c < rects.length; c += 1) {
    if (c === k) continue;
    const other = rects[c];
    // Stacked: x-ranges overlap, within reach vertically -> share a left/right edge.
    if (me.left < other.right && other.left < me.right) {
      const gapY = Math.max(other.top - me.bottom, me.top - other.bottom);
      if (gapY <= TIDY_REACH) {
        misX = Math.min(misX, Math.abs(me.left - other.left), Math.abs(me.right - other.right));
      }
    }
    // Beside: y-ranges overlap, within reach horizontally -> share a top/bottom edge or a port row.
    if (me.top < other.bottom && other.top < me.bottom) {
      const gapX = Math.max(other.left - me.right, me.left - other.right);
      if (gapX <= TIDY_REACH) {
        misY = Math.min(misY, Math.abs(me.top - other.top), Math.abs(me.bottom - other.bottom));
        const rows = portRows[k].get(c);
        if (rows) misY = Math.min(misY, Math.abs(me.top + rows[0] - (other.top + rows[1])));
      }
    }
  }
  const cap = cells(FREE_DIALS.tidyCapCells);
  const x = misX === Infinity ? 0 : Math.min(misX, cap);
  const y = misY === Infinity ? 0 : Math.min(misY, cap);
  return FREE_DIALS.tidy * (x + y);
}

/** The flow price of a wire from rect a to rect b (header: FLOW). */
function flowAt(a: Rect, b: Rect, gap: number, flat: number): number {
  const forward = (a.right - a.left + (b.right - b.left)) / 2 + gap;
  const ahead = (b.left + b.right) / 2 - (a.left + a.right) / 2;
  return FREE_DIALS.flow * Math.max(0, forward - ahead) + (ahead <= 0 ? flat : 0);
}

/**
 * Each wire's flat backward price: the cycle price for a wire whose ends
 * share a strongly connected component, else the column or plain price.
 */
function flatPrices(
  n: number,
  wires: ReadonlyArray<{ a: number; b: number }>,
  lattice: Lattice,
): number[] {
  // Tarjan's strongly connected components over the DIRECTED wires.
  const out: number[][] = Array.from({ length: n }, () => []);
  wires.forEach(({ a, b }) => out[a].push(b));
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  const component = new Int32Array(n).fill(-1);
  let next = 0;
  let count = 0;
  const strong = (v: number) => {
    index[v] = low[v] = next++;
    stack.push(v);
    onStack[v] = 1;
    for (const w of out[v]) {
      if (index[w] < 0) {
        strong(w);
        low[v] = Math.min(low[v], low[w]);
      } else if (onStack[w]) {
        low[v] = Math.min(low[v], index[w]);
      }
    }
    if (low[v] === index[v]) {
      let w: number;
      do {
        w = stack.pop()!;
        onStack[w] = 0;
        component[w] = count;
      } while (w !== v);
      count += 1;
    }
  };
  for (let v = 0; v < n; v += 1) if (index[v] < 0) strong(v);
  return wires.map(({ a, b }) =>
    component[a] === component[b]
      ? FREE_DIALS.flowFlatCycle
      : lattice.isColumnCard(a) && lattice.isColumnCard(b)
        ? FREE_DIALS.flowFlatColumns
        : FREE_DIALS.flowFlat,
  );
}

function sprawlOf(rects: readonly Rect[]): number {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return FREE_DIALS.sprawl * 2 * (right - left + (bottom - top));
}

/** Every term of the free placer's score for a layout, for tuning by hand. */
export function explainFreeScore(
  cards: readonly FreeCard[],
  wires: readonly FreeWire[],
  positions: ReadonlyMap<string, Point>,
  prices: RouterTuning,
): { own: number; flow: number; crossings: number; air: number; sprawl: number; tidy: number; total: number } {
  const index = new Map<string, number>();
  cards.forEach((card, i) => index.set(card.id, i));
  const local = wires
    .map((wire) => ({ a: index.get(wire.source)!, b: index.get(wire.target)!, wire }))
    .filter(({ a, b }) => a !== undefined && b !== undefined && a !== b);
  const rects: Rect[] = cards.map((card) => {
    const p = positions.get(card.id) ?? { x: 0, y: 0 };
    return { left: p.x, top: p.y, right: p.x + card.width, bottom: p.y + card.height };
  });
  const gap = cells(GAP_CELLS);
  const lattice = columnLattice(cards);
  const flats = flatPrices(cards.length, local, lattice);
  const weights = local.map(({ wire }) =>
    wire.width !== undefined ? wireWeight(wire.width) : Math.max(wire.weight ?? 1, 0.01),
  );
  const paths = local.map(({ a, b }) => proxyPath(rects[a], rects[b]));
  let own = 0;
  let flow = 0;
  local.forEach(({ a, b }, w) => {
    own += (pathLength(paths[w]) + pathBends(paths[w], prices) + pathBlocked(paths[w], rects, a, b, prices)) * weights[w];
    flow += flowAt(rects[a], rects[b], gap, flats[w]) * weights[w];
  });
  let crossings = 0;
  for (let i = 0; i < paths.length; i += 1) {
    for (let k = i + 1; k < paths.length; k += 1) {
      crossings += pathCrossings(paths[i], paths[k]) * prices.crossing * Math.max(weights[i], weights[k]);
    }
  }
  const air = makeAirTerm(
    cards.map((card) => ({ id: card.id, width: card.width, height: card.height, role: card.role })),
    wires,
    prices.islandAir,
  )(positions);
  const rows = portRowsOf(cards, local);
  let tidy = 0;
  for (let k = 0; k < cards.length; k += 1) tidy += tidyAt(k, rects, rows);
  const sprawl = sprawlOf(rects);
  return { own, flow, crossings, air, sprawl, tidy, total: own + flow + crossings + air + sprawl + tidy };
}

/* ---------------------------------------------------------------------- */
/* Stage 3: the search.                                                    */
/* ---------------------------------------------------------------------- */

function anneal(
  cards: readonly FreeCard[],
  wires: ReadonlyArray<{ a: number; b: number; wire: FreeWire }>,
  start: Point[],
  prices: RouterTuning,
  trials: number,
  random: () => number,
  onProgress: (done: number) => void,
  lattice: Lattice,
  /** Scales the starting temperature: 1 for a search, less for a repair. */
  heat: number,
  patterns: Patterns,
): Point[] {
  const n = cards.length;
  const m = wires.length;
  // The cards the search moves; derived drawers follow their machines.
  const freeCards = cards.map((_, i) => i).filter((i) => !patterns.placement[i]);
  if (freeCards.length === 0) {
    return start.map((p) => ({ ...p }));
  }
  const stepXOf = (i: number) => (lattice.isColumnCard(i) ? lattice.pitch : BOARD_GRID);
  const gap = cells(GAP_CELLS);
  const pos: Point[] = start.map((p) => ({ ...p }));
  const rects: Rect[] = cards.map((card, i) => ({
    left: pos[i].x,
    top: pos[i].y,
    right: pos[i].x + card.width,
    bottom: pos[i].y + card.height,
  }));
  const setRect = (i: number, p: Point) => {
    pos[i] = p;
    rects[i] = { left: p.x, top: p.y, right: p.x + cards[i].width, bottom: p.y + cards[i].height };
  };
  const wiresOf: number[][] = cards.map(() => []);
  wires.forEach(({ a, b }, w) => {
    wiresOf[a].push(w);
    wiresOf[b].push(w);
  });
  const weights = wires.map(({ wire }) =>
    wire.width !== undefined ? wireWeight(wire.width) : Math.max(wire.weight ?? 1, 0.01),
  );
  const crossPrice = (i: number, k: number) => prices.crossing * Math.max(weights[i], weights[k]);
  const air = makeAirTerm(
    cards.map((card) => ({ id: card.id, width: card.width, height: card.height, role: card.role })),
    wires.map(({ wire }) => ({ source: wire.source, target: wire.target })),
    prices.islandAir,
  );
  const positionsMap = () => new Map(cards.map((card, i) => [card.id, pos[i]]));

  const neighbours: number[][] = cards.map((_, i) => [
    ...new Set(wiresOf[i].map((w) => (wires[w].a === i ? wires[w].b : wires[w].a))),
  ]);
  // BRIDGES: wires whose loss would split the component. The cards on the
  // smaller side of one form a natural island, and shifting them as one is
  // the move that lets an island drift out (the air term asks for it; no
  // one-card move can do it, because every card in the cluster holds the
  // others in place).
  const bridgeSides: number[][] = [];
  {
    const disc = new Int32Array(n).fill(-1);
    const low = new Int32Array(n);
    let time = 0;
    const bridges: number[] = [];
    const dfs = (u: number, viaWire: number) => {
      disc[u] = low[u] = time++;
      for (const w of wiresOf[u]) {
        if (w === viaWire) continue;
        const v = wires[w].a === u ? wires[w].b : wires[w].a;
        if (disc[v] < 0) {
          dfs(v, w);
          low[u] = Math.min(low[u], low[v]);
          if (low[v] > disc[u]) bridges.push(w);
        } else {
          low[u] = Math.min(low[u], disc[v]);
        }
      }
    };
    for (let u = 0; u < n; u += 1) if (disc[u] < 0) dfs(u, -1);
    for (const w of bridges) {
      // The side reachable from one end without the bridge; keep the smaller.
      const side = (start: number): number[] => {
        const seen = new Set([start]);
        const list = [start];
        for (let head = 0; head < list.length; head += 1) {
          for (const x of wiresOf[list[head]]) {
            if (x === w) continue;
            const v = wires[x].a === list[head] ? wires[x].b : wires[x].a;
            if (!seen.has(v)) {
              seen.add(v);
              list.push(v);
            }
          }
        }
        return list;
      };
      const left = side(wires[w].a);
      const right = side(wires[w].b);
      const smaller = left.length <= right.length ? left : right;
      if (smaller.length >= 2 && smaller.length < n) bridgeSides.push(smaller);
    }
  }

  // The books: each wire's path and own price, every crossing pair's price.
  const paths: Path[] = new Array(m);
  const own = new Float64Array(m);
  const flats = flatPrices(n, wires, lattice);
  const flowCost = (w: number) => flowAt(rects[wires[w].a], rects[wires[w].b], gap, flats[w]);
  const priceOwn = (w: number) =>
    (pathLength(paths[w]) +
      pathBends(paths[w], prices) +
      pathBlocked(paths[w], rects, wires[w].a, wires[w].b, prices) +
      flowCost(w)) *
    weights[w];
  // Tidiness per card (header): recomputed only for cards near a move.
  const portRows = portRowsOf(cards, wires);
  const tidyOf = (k: number): number => tidyAt(k, rects, portRows);
  const tidy = new Float64Array(n);
  for (let k = 0; k < n; k += 1) tidy[k] = tidyOf(k);
  let tidyTotal = tidy.reduce((s, v) => s + v, 0);
  for (let w = 0; w < m; w += 1) {
    paths[w] = proxyPath(rects[wires[w].a], rects[wires[w].b]);
    own[w] = priceOwn(w);
  }
  let crossings = 0;
  for (let i = 0; i < m; i += 1) {
    for (let k = i + 1; k < m; k += 1) {
      crossings += pathCrossings(paths[i], paths[k]) * crossPrice(i, k);
    }
  }
  const sprawl = () => sprawlOf(rects);
  let ownTotal = own.reduce((s, v) => s + v, 0);
  let extras = air(positionsMap()) + sprawl();
  let score = ownTotal + crossings + extras + tidyTotal;
  let best = score;
  let bestPos = pos.map((p) => ({ ...p }));

  const bbox = (path: Path): Rect => {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const p of path) {
      left = Math.min(left, p.x);
      top = Math.min(top, p.y);
      right = Math.max(right, p.x);
      bottom = Math.max(bottom, p.y);
    }
    return { left, top, right, bottom };
  };

  /**
   * Tries moving the cards in `moved` to `to`; returns the score delta and
   * keeps the move, or restores everything and returns undefined when the
   * cards would overlap something.
   */
  const savedPos: Point[] = [];
  const savedPaths = new Map<number, Path>();
  const savedOwn = new Map<number, number>();
  // Drawers in a pattern line touch; everything else keeps the gap.
  const gapBetween = (i: number, o: number) => (patterns.placement[i] && patterns.placement[o] ? 0 : gap);
  const attempt = (moved: number[], to: Point[]): number | undefined => {
    const movedSet = new Set(moved);
    for (let k = 0; k < moved.length; k += 1) {
      const i = moved[k];
      const rect = { left: to[k].x, top: to[k].y, right: to[k].x + cards[i].width, bottom: to[k].y + cards[i].height };
      for (let o = 0; o < n; o += 1) {
        if (movedSet.has(o)) continue;
        if (overlaps(rect, rects[o], gapBetween(i, o))) return undefined;
      }
      for (let j = 0; j < k; j += 1) {
        const other = moved[j];
        const otherRect = { left: to[j].x, top: to[j].y, right: to[j].x + cards[other].width, bottom: to[j].y + cards[other].height };
        if (overlaps(rect, otherRect, gapBetween(i, other))) return undefined;
      }
    }
    // The wires re-priced: those on the moved cards, and those whose path
    // the cards stood across before or stand across now.
    const touched = new Set<number>();
    for (const i of moved) for (const w of wiresOf[i]) touched.add(w);
    const swept: Rect[] = [];
    for (let k = 0; k < moved.length; k += 1) {
      const i = moved[k];
      swept.push(inflate(rects[i], BOARD_GRID));
      swept.push(inflate({ left: to[k].x, top: to[k].y, right: to[k].x + cards[i].width, bottom: to[k].y + cards[i].height }, BOARD_GRID));
    }
    const blockedOnly: number[] = [];
    for (let w = 0; w < m; w += 1) {
      if (touched.has(w)) continue;
      const box = bbox(paths[w]);
      for (const sweep of swept) {
        if (overlaps(box, sweep, 0)) {
          blockedOnly.push(w);
          break;
        }
      }
    }
    // Cards whose tidiness may change: the moved ones and every card within
    // reach of where they stood or where they land.
    const tidyCards: number[] = [];
    {
      const reach = swept.map((s) => inflate(s, TIDY_REACH));
      for (let c = 0; c < n; c += 1) {
        if (movedSet.has(c)) {
          tidyCards.push(c);
          continue;
        }
        for (const r of reach) {
          if (overlaps(rects[c], r, 0)) {
            tidyCards.push(c);
            break;
          }
        }
      }
    }
    let oldTidy = 0;
    for (const c of tidyCards) oldTidy += tidy[c];
    const touchedList = [...touched];
    let oldPart = 0;
    for (const w of touchedList) oldPart += own[w];
    for (const w of blockedOnly) oldPart += own[w];
    for (let a = 0; a < touchedList.length; a += 1) {
      const w = touchedList[a];
      for (let o = 0; o < m; o += 1) {
        if (o === w) continue;
        if (touched.has(o) && o < w) continue;
        oldPart += pathCrossings(paths[w], paths[o]) * crossPrice(w, o);
      }
    }
    // Apply.
    savedPos.length = 0;
    savedPaths.clear();
    savedOwn.clear();
    for (let k = 0; k < moved.length; k += 1) {
      savedPos.push(pos[moved[k]]);
      setRect(moved[k], to[k]);
    }
    for (const w of touchedList) {
      savedPaths.set(w, paths[w]);
      savedOwn.set(w, own[w]);
      paths[w] = proxyPath(rects[wires[w].a], rects[wires[w].b]);
      own[w] = priceOwn(w);
    }
    for (const w of blockedOnly) {
      savedOwn.set(w, own[w]);
      own[w] = priceOwn(w);
    }
    let newPart = 0;
    for (const w of touchedList) newPart += own[w];
    for (const w of blockedOnly) newPart += own[w];
    for (let a = 0; a < touchedList.length; a += 1) {
      const w = touchedList[a];
      for (let o = 0; o < m; o += 1) {
        if (o === w) continue;
        if (touched.has(o) && o < w) continue;
        newPart += pathCrossings(paths[w], paths[o]) * crossPrice(w, o);
      }
    }
    savedTidy.clear();
    let newTidy = 0;
    for (const c of tidyCards) {
      savedTidy.set(c, tidy[c]);
      tidy[c] = tidyOf(c);
      newTidy += tidy[c];
    }
    const newExtras = air(positionsMap()) + sprawl();
    const delta = newPart - oldPart + (newExtras - extras) + (newTidy - oldTidy);
    // Book the change; the caller reverts by `undo` if it refuses.
    pendingDelta = {
      touched: touchedList,
      blockedOnly,
      moved,
      oldPart,
      newPart,
      newExtras,
      tidyDelta: newTidy - oldTidy,
    };
    return delta;
  };
  const savedTidy = new Map<number, number>();
  let pendingDelta:
    | {
        touched: number[];
        blockedOnly: number[];
        moved: number[];
        oldPart: number;
        newPart: number;
        newExtras: number;
        tidyDelta: number;
      }
    | undefined;
  const commit = () => {
    const p = pendingDelta!;
    let oldOwn = 0;
    for (const w of p.touched) oldOwn += savedOwn.get(w)!;
    for (const w of p.blockedOnly) oldOwn += savedOwn.get(w)!;
    let newOwn = 0;
    for (const w of p.touched) newOwn += own[w];
    for (const w of p.blockedOnly) newOwn += own[w];
    ownTotal += newOwn - oldOwn;
    crossings += p.newPart - newOwn - (p.oldPart - oldOwn);
    extras = p.newExtras;
    tidyTotal += p.tidyDelta;
    score = ownTotal + crossings + extras + tidyTotal;
    pendingDelta = undefined;
  };
  const undo = () => {
    const p = pendingDelta!;
    for (let k = 0; k < p.moved.length; k += 1) setRect(p.moved[k], savedPos[k]);
    for (const w of p.touched) {
      paths[w] = savedPaths.get(w)!;
      own[w] = savedOwn.get(w)!;
    }
    for (const w of p.blockedOnly) own[w] = savedOwn.get(w)!;
    for (const [c, value] of savedTidy) tidy[c] = value;
    pendingDelta = undefined;
  };

  const pick = (max: number) => Math.floor(random() * max);
  const fitNear = (i: number, want: Point, exclude: Set<number>): Point | undefined =>
    nearestFree(
      quantise(lattice, i, want),
      cards[i],
      rects,
      gap,
      3,
      (rect) => exclude.has(rects.indexOf(rect)),
      stepXOf(i),
    );
  /** Spots beside partner `p` for card `i`: four sides, rows aligned. */
  const besideSpots = (i: number, p: number, w: number): Point[] => {
    const a = cards[i];
    const b = cards[p];
    const at = pos[p];
    const spots: Point[] = [];
    const rowsY = [at.y, at.y + b.height - a.height, at.y + (b.height - a.height) / 2];
    // Port rows aligned: the straight shot the router prices lowest.
    const wire = wires[w].wire;
    const ownPort = wires[w].a === i ? wire.sourcePortY : wire.targetPortY;
    const theirPort = wires[w].a === p ? wire.sourcePortY : wire.targetPortY;
    if (ownPort !== undefined && theirPort !== undefined) rowsY.push(at.y + theirPort - ownPort);
    for (const y of rowsY) {
      spots.push({ x: at.x - a.width - cells(BESIDE_CELLS), y });
      spots.push({ x: at.x + b.width + cells(BESIDE_CELLS), y });
    }
    const colsX = [at.x, at.x + b.width - a.width, at.x + (b.width - a.width) / 2];
    for (const x of colsX) {
      spots.push({ x, y: at.y - a.height - cells(GAP_CELLS) });
      spots.push({ x, y: at.y + b.height + cells(GAP_CELLS) });
    }
    return spots.map((s) => quantise(lattice, i, s));
  };

  /**
   * A move of free cards, completed: every derived drawer attached to a
   * moved machine (or to a machine sharing a drawer with one) is re-placed
   * from the machines' new positions and rides along in the same trial.
   */
  const expand = (moved: number[], to: Point[]): { moved: number[]; to: Point[] } => {
    const override = new Map<number, Point>();
    moved.forEach((i, k) => override.set(i, to[k]));
    const machines = moved.filter((i) => patterns.attached[i].length > 0 || patterns.pairPartners[i].length > 0);
    if (machines.length === 0) return { moved, to };
    const derived = derivePatterns(cards, patterns, machines, (i) => override.get(i) ?? pos[i]);
    const allMoved = [...moved];
    const allTo = [...to];
    for (const [d, p] of derived) {
      if (override.has(d)) continue;
      allMoved.push(d);
      allTo.push(p);
    }
    return { moved: allMoved, to: allTo };
  };
  const isOwnDrawer = (i: number, p: number) => patterns.attached[i].includes(p);
  const propose = (): { moved: number[]; to: Point[] } | undefined => {
    const roll = random();
    const i = freeCards[pick(freeCards.length)];
    if (roll < 0.45) {
      // Beside a partner (never beside a drawer of its own: that follows it).
      const partnerWires = wiresOf[i].filter((w) => !isOwnDrawer(i, wires[w].a === i ? wires[w].b : wires[w].a));
      if (partnerWires.length === 0) return undefined;
      const w = partnerWires[pick(partnerWires.length)];
      const p = wires[w].a === i ? wires[w].b : wires[w].a;
      const spots = besideSpots(i, p, w);
      const want = spots[pick(spots.length)];
      const spot = fitNear(i, want, new Set([i]));
      return spot ? { moved: [i], to: [spot] } : undefined;
    }
    if (roll < 0.7) {
      // A nudge: cells vertically; a column, or cells for a drawer, sideways.
      const sign = random() < 0.5 ? -1 : 1;
      const to =
        random() < 0.5
          ? { x: pos[i].x + sign * (lattice.isColumnCard(i) ? lattice.pitch : (1 + pick(6)) * BOARD_GRID), y: pos[i].y }
          : { x: pos[i].x, y: pos[i].y + sign * (1 + pick(6)) * BOARD_GRID };
      return { moved: [i], to: [to] };
    }
    if (roll < 0.9) {
      // A swap.
      const k = freeCards[pick(freeCards.length)];
      if (k === i) return undefined;
      return { moved: [i, k], to: [quantise(lattice, i, pos[k]), quantise(lattice, k, pos[i])] };
    }
    if (bridgeSides.length > 0 && random() < 0.5) {
      // A whole side of a bridge wire, shifted together.
      const group = bridgeSides[pick(bridgeSides.length)].filter((g) => !patterns.placement[g]);
      if (group.length === 0) return undefined;
      const sign = random() < 0.5 ? -1 : 1;
      const columnMove = group.some((g) => lattice.isColumnCard(g));
      const dx = random() < 0.5 ? sign * (columnMove ? lattice.pitch : (1 + pick(6)) * BOARD_GRID) : 0;
      const dy = dx === 0 ? sign * (1 + pick(6)) * BOARD_GRID : 0;
      return { moved: group, to: group.map((g) => ({ x: pos[g].x + dx, y: pos[g].y + dy })) };
    }
    // A neighbourhood shifted together, by a column or by cells.
    const group = [i, ...neighbours[i]].filter((g) => !patterns.placement[g]);
    const sign = random() < 0.5 ? -1 : 1;
    const columnMove = group.some((g) => lattice.isColumnCard(g));
    const dx = random() < 0.5 ? sign * (columnMove ? lattice.pitch : (1 + pick(4)) * BOARD_GRID) : 0;
    const dy = dx === 0 ? sign * (1 + pick(4)) * BOARD_GRID : 0;
    return { moved: group, to: group.map((g) => ({ x: pos[g].x + dx, y: pos[g].y + dy })) };
  };

  // Temperature from the moves themselves: the median uphill step, so the
  // schedule means the same on a tiny board as on a huge one.
  const samples: number[] = [];
  for (let s = 0; s < 200 && samples.length < 60; s += 1) {
    const proposed = propose();
    if (!proposed) continue;
    const move = expand(proposed.moved, proposed.to);
    const delta = attempt(move.moved, move.to);
    if (delta === undefined) continue;
    undo();
    if (delta > 0) samples.push(delta);
  }
  samples.sort((a, b) => a - b);
  const t0 = Math.max(1, (samples.length > 0 ? samples[Math.floor(samples.length / 2)] * 2 : 200) * heat);
  const tEnd = t0 / 2000;
  const cool = Math.log(tEnd / t0) / Math.max(1, trials);
  for (let trial = 0; trial < trials; trial += 1) {
    const temperature = t0 * Math.exp(cool * trial);
    const proposed = propose();
    if (!proposed) continue;
    const move = expand(proposed.moved, proposed.to);
    const delta = attempt(move.moved, move.to);
    if (delta === undefined) continue;
    if (delta <= 0 || random() < Math.exp(-delta / temperature)) {
      commit();
      if (score < best - 1e-6) {
        best = score;
        bestPos = pos.map((p) => ({ ...p }));
      }
    } else {
      undo();
    }
    if (trial % 500 === 0) onProgress(trial);
  }
  onProgress(trials);
  return bestPos;
}

function inflate(rect: Rect, by: number): Rect {
  return { left: rect.left - by, top: rect.top - by, right: rect.right + by, bottom: rect.bottom + by };
}

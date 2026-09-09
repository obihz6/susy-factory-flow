/**
 * AIR BETWEEN STRANGERS: the one readability term the arranger adds on top
 * of the router's points, and the whole of how islands happen.
 *
 * Jack (2026-09-08): "a cluster that has lots of edges connecting each
 * other but only one edge connecting back to the main cluster ... how do
 * we make this behaviour emergent?" Nothing here decides what an island
 * is. Two cards that are strangers - three or more hops apart in the wire
 * graph, or not connected at all - pay a small price for every pixel they
 * stand closer than ISLAND_AIR_CELLS. Cards a wire joins attract through
 * that wire's length; cards two hops apart (both fed by one machine) are
 * neutral. A dense cluster hanging off the main body by one wire has
 * dozens of stranger pairs across the seam and one wire pulling it in, so
 * the search pushes it out until the bridge's extra length balances the
 * air owed - and a lone card with one wire stays where its wire wants
 * it. How far a cluster drifts follows from how self-contained it is.
 *
 * A drawer serving exactly one machine stands in for that machine in the
 * hop count, so two drawers on neighbouring machines are not strangers.
 * Each card pays for its nearest stranger only, at `islandAir` points per
 * pixel of air short (router-tuning.ts) - the same currency as wire; at
 * zero the arranger packs as tight as the wires allow.
 */

/** Strangers owe each other this much air, in cells. */
export const ISLAND_AIR_CELLS = 6;
/** Cards this many hops apart, or further, are strangers. */
export const ISLAND_STRANGER_HOPS = 3;

import { BOARD_GRID } from "./board-grid";

export interface AirCard {
  id: string;
  width: number;
  height: number;
  role?: "machine" | "storage";
}

export interface AirWire {
  source: string;
  target: string;
}

export type AirPositions = ReadonlyMap<string, { x: number; y: number }>;

/**
 * The air term for a board: given every card's top-left, the price owed by
 * every pair of strangers standing too close. Pairs whose cards are absent
 * from the map (an island scored on its own) are skipped, and the term
 * depends only on relative positions.
 */
export function makeAirTerm(
  cards: readonly AirCard[],
  wires: readonly AirWire[],
  perPixel: number,
): (positions: AirPositions) => number {
  if (perPixel <= 0 || cards.length < 2) {
    return () => 0;
  }
  const index = new Map<string, number>();
  cards.forEach((card, i) => index.set(card.id, i));
  const n = cards.length;
  const partners: number[][] = cards.map(() => []);
  for (const wire of wires) {
    const a = index.get(wire.source);
    const b = index.get(wire.target);
    if (a === undefined || b === undefined || a === b) continue;
    partners[a].push(b);
    partners[b].push(a);
  }
  // A drawer with one partner is that partner for distance purposes.
  const standIn = cards.map((card, i) => {
    if (card.role !== "storage") return i;
    const unique = new Set(partners[i]);
    return unique.size === 1 ? [...unique][0] : i;
  });
  const hops = (from: number): Int32Array => {
    const distance = new Int32Array(n).fill(-1);
    const queue = [standIn[from]];
    distance[standIn[from]] = 0;
    for (let head = 0; head < queue.length; head += 1) {
      const here = queue[head];
      for (const next of partners[here]) {
        const who = standIn[next];
        if (distance[who] < 0) {
          distance[who] = distance[here] + 1;
          queue.push(who);
        }
      }
    }
    return distance;
  };
  const strangers: Array<[number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    const distance = hops(i);
    for (let k = i + 1; k < n; k += 1) {
      const d = distance[standIn[k]];
      if (standIn[i] === standIn[k]) continue;
      if (d < 0 || d >= ISLAND_STRANGER_HOPS) strangers.push([i, k]);
    }
  }
  const air = ISLAND_AIR_CELLS * BOARD_GRID;
  const nearest = new Float64Array(n);
  return (positions) => {
    // Each card pays for its NEAREST stranger only, so the term means the
    // same on nine cards as on ninety: summing every pair grew with the
    // square of the cluster sizes and was too weak on small boards, too
    // strong on big ones.
    nearest.fill(Infinity);
    for (const [i, k] of strangers) {
      const p = positions.get(cards[i].id);
      const q = positions.get(cards[k].id);
      if (!p || !q) continue;
      const gapX = Math.max(q.x - (p.x + cards[i].width), p.x - (q.x + cards[k].width), 0);
      const gapY = Math.max(q.y - (p.y + cards[i].height), p.y - (q.y + cards[k].height), 0);
      const gap = Math.max(gapX, gapY);
      if (gap < nearest[i]) nearest[i] = gap;
      if (gap < nearest[k]) nearest[k] = gap;
    }
    let owed = 0;
    for (let i = 0; i < n; i += 1) {
      if (nearest[i] < air) owed += (air - nearest[i]) * perPixel;
    }
    return owed;
  };
}

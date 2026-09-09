/**
 * A LAYOUT STRING: everything a board's routing problem needs, and nothing
 * the recipes are.
 *
 * "Versus mode" (Jack, 2026-09-08): a player arranges a board by hand, the
 * arranger arranges the same board, and the two compare scores and setups
 * by pasting strings at each other. A whole plan export is far more than
 * that needs; this is the plan's id, the score as drawn, every card's
 * top-left and size in cells, and every wire with its two ends, port rows
 * and width - enough to rebuild the board, route it and arrange it
 * offline, and about a kilobyte for a big board.
 *
 *   {"p":"<plan id>","v":2,"s":{"x":3,"px":14972},
 *    "c":{"node-91f43e9":[8,15,22,15],"storage-54a7":[1,14,5,4],...},
 *    "e":[["node-91f43e9","node-32f9bbb",7,5,6],...]}
 *
 * Cards are keyed by the shortest id prefixes that tell them apart. A wire
 * is [source, target, sourcePortRow?, targetPortRow?, width]; port rows
 * are in cells from the card's top, absent for a drawer end. Applying a
 * layout to a plan moves every card whose id matches; unknown keys are
 * reported, not applied. Version 1 strings (positions only) still apply.
 */

import { BOARD_GRID } from "./board-grid";

export interface LayoutCard {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface LayoutWire {
  id?: string;
  source: string;
  target: string;
  sourcePortY?: number;
  targetPortY?: number;
  width?: number;
}

export interface LayoutSnapshot {
  planId: string;
  cards: LayoutCard[];
  wires?: LayoutWire[];
  score?: { crossings: number; length: number; points?: number };
}

export interface LayoutString {
  p: string;
  v: 1 | 2;
  s?: { x: number; px: number; pts?: number };
  c: Record<string, number[]>;
  e?: Array<[string, string, number | null, number | null, number]>;
}

const KEY_LENGTH = 8;

/** The shortest id prefixes that still tell every card apart. */
export function layoutKeysFor(ids: readonly string[]): Map<string, string> {
  const keys = new Map<string, string>();
  let length = KEY_LENGTH;
  for (;;) {
    keys.clear();
    const seen = new Set<string>();
    let clash = false;
    for (const id of ids) {
      const key = id.slice(0, length);
      if (seen.has(key)) {
        clash = true;
        break;
      }
      seen.add(key);
      keys.set(id, key);
    }
    if (!clash || length >= 64) {
      return keys;
    }
    length += 4;
  }
}

const toCells = (px: number) => Math.round(px / BOARD_GRID);

export function encodeLayout(snapshot: LayoutSnapshot): string {
  const keys = layoutKeysFor(snapshot.cards.map((card) => card.id));
  const c: Record<string, number[]> = {};
  for (const card of snapshot.cards) {
    const entry = [toCells(card.x), toCells(card.y)];
    if (card.width !== undefined && card.height !== undefined) {
      entry.push(toCells(card.width), toCells(card.height));
    }
    c[keys.get(card.id)!] = entry;
  }
  const layout: LayoutString = { p: snapshot.planId, v: 2, c };
  if (snapshot.score) {
    layout.s = { x: snapshot.score.crossings, px: Math.round(snapshot.score.length) };
    if (snapshot.score.points !== undefined) layout.s.pts = Math.round(snapshot.score.points);
  }
  if (snapshot.wires) {
    layout.e = [];
    for (const wire of snapshot.wires) {
      const source = keys.get(wire.source);
      const target = keys.get(wire.target);
      if (!source || !target) continue;
      layout.e.push([
        source,
        target,
        wire.sourcePortY === undefined ? null : toCells(wire.sourcePortY),
        wire.targetPortY === undefined ? null : toCells(wire.targetPortY),
        wire.width ?? 6,
      ]);
    }
  }
  return JSON.stringify(layout);
}

/** The string parsed back into a snapshot, keys standing in for ids. */
export function parseLayout(text: string): LayoutSnapshot {
  const parsed = JSON.parse(text) as Partial<LayoutString>;
  if (!parsed || typeof parsed !== "object" || (parsed.v !== 1 && parsed.v !== 2) || !parsed.c) {
    throw new Error("Not a layout string.");
  }
  const cards: LayoutCard[] = [];
  for (const [key, entry] of Object.entries(parsed.c)) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const card: LayoutCard = { id: key, x: entry[0] * BOARD_GRID, y: entry[1] * BOARD_GRID };
    if (entry.length >= 4) {
      card.width = entry[2] * BOARD_GRID;
      card.height = entry[3] * BOARD_GRID;
    }
    cards.push(card);
  }
  const wires: LayoutWire[] | undefined = parsed.e?.map(([source, target, sourcePortY, targetPortY, width], index) => ({
    id: `w${index}`,
    source,
    target,
    sourcePortY: sourcePortY === null ? undefined : sourcePortY * BOARD_GRID,
    targetPortY: targetPortY === null ? undefined : targetPortY * BOARD_GRID,
    width,
  }));
  return {
    planId: typeof parsed.p === "string" ? parsed.p : "",
    cards,
    wires,
    score: parsed.s ? { crossings: parsed.s.x, length: parsed.s.px, points: parsed.s.pts } : undefined,
  };
}

export interface DecodedLayout {
  /** Cards on the plan the layout places, with their new top-lefts in px. */
  moves: Array<{ id: string; position: { x: number; y: number } }>;
  /** Layout keys matching no card on this plan. */
  unknown: string[];
  /** Cards on the plan the layout says nothing about. */
  missing: string[];
  /** The layout was made for a different plan id. */
  otherPlan: boolean;
}

interface Positioned {
  id: string;
}

interface LayoutProject {
  id: string;
  nodes: readonly Positioned[];
  storages?: readonly Positioned[];
  pockets?: readonly Positioned[];
}

/** Which of a plan's cards a layout string moves, and where. */
export function decodeLayout(text: string, project: LayoutProject): DecodedLayout {
  const snapshot = parseLayout(text);
  const cards = [...project.nodes, ...(project.storages ?? []), ...(project.pockets ?? [])];
  const moves: DecodedLayout["moves"] = [];
  const unknown: string[] = [];
  const placed = new Set<string>();
  for (const card of snapshot.cards) {
    const matches = cards.filter((candidate) => candidate.id.startsWith(card.id));
    if (matches.length !== 1) {
      unknown.push(card.id);
      continue;
    }
    moves.push({ id: matches[0].id, position: { x: card.x, y: card.y } });
    placed.add(matches[0].id);
  }
  return {
    moves,
    unknown,
    missing: cards.filter((card) => !placed.has(card.id)).map((card) => card.id),
    otherPlan: snapshot.planId !== "" && snapshot.planId !== project.id,
  };
}

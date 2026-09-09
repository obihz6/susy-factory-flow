/**
 * The board's SCORE and GEOMETRY, read straight off what the board is
 * drawing, for the dev menu's versus mode (Jack, 2026-09-08).
 *
 * The score is the two numbers the arrange is judged by: how many times the
 * displayed wires cross, and how much wire there is. The geometry is
 * everything needed to rebuild the board's routing problem without the
 * plan: every card's top-left and measured size, every wire's two ends,
 * port rows and width. FactoryFlow registers the readers (it owns the
 * installed routes and the published geometry); the dev menu asks. A tiny
 * registry so the menu never imports the board.
 */

export interface BoardScore {
  crossings: number;
  /** Total centreline length of every displayed wire, in board px. */
  length: number;
  /** The score: length plus bends and crossings at the router's prices. */
  points: number;
  bends45: number;
  bends90: number;
  wires: number;
  /** False while some wire is still waiting for the worker's routes. */
  settled: boolean;
}

export interface BoardGeometryCard {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  role: "machine" | "storage" | "board";
}

export interface BoardGeometryWire {
  id: string;
  source: string;
  target: string;
  /** Port rows from the card's top, in px, when the card is a machine. */
  sourcePortY?: number;
  targetPortY?: number;
  /** Stroke the wire routes at, in px. */
  width: number;
}

export interface BoardGeometry {
  cards: BoardGeometryCard[];
  wires: BoardGeometryWire[];
}

let scoreReader: (() => BoardScore | undefined) | undefined;
let geometryReader: (() => BoardGeometry | undefined) | undefined;

export function registerBoardScoreReader(next: (() => BoardScore | undefined) | undefined) {
  scoreReader = next;
}

export function readBoardScore(): BoardScore | undefined {
  return scoreReader?.();
}

export function registerBoardGeometryReader(next: (() => BoardGeometry | undefined) | undefined) {
  geometryReader = next;
}

export function readBoardGeometry(): BoardGeometry | undefined {
  return geometryReader?.();
}

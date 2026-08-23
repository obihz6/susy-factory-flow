"use client";

import { BOARD_MAX_ZOOM, BOARD_MIN_ZOOM } from "@/components/flow/board-camera";

/**
 * Where each design tab was left: the pan and the zoom it last had.
 *
 * A tab is a whole factory, and coming back to one belongs with coming back to
 * a file in an editor - at the line you were reading, not at the top. Switching
 * away and back used to reframe the whole plan, so a session spent on one
 * furnace in the corner of a hundred-card build began with the same scroll back
 * to it every time.
 *
 * Kept HERE rather than in the plan, deliberately. A camera is where YOU are
 * standing, not part of the factory: a shared setup carries positions and view
 * settings and nothing about its author's viewport, and it should stay that way,
 * because arriving at someone else's plan wants framing. So this is local, keyed
 * by design id, and never travels.
 *
 * localStorage, not the design record: a pan is not an edit. Writing one into
 * IndexedDB would drag a plan of hundreds of kilobytes through a save every time
 * the board moved, and would mark a design as changed for looking at it.
 *
 * Not remembered, on purpose:
 * - Inside a pocket. Positions there are their own space, and loading a plan
 *   always starts at the top level, so a pocket camera restored onto the board
 *   would land you in whatever happens to sit at those coordinates. Entering and
 *   leaving a pocket frames instead, as it always has.
 * - A design with no camera stored yet. That is what framing is for, and it is
 *   what every tab does on its first visit.
 */

export interface BoardCamera {
  x: number;
  y: number;
  zoom: number;
}

const CAMERA_STORAGE_KEY = "susy-factory-flow.design-cameras.v1";

/**
 * How many tabs' cameras to keep. Well past the number of tabs anyone has open,
 * small enough that the blob stays a few kilobytes; the oldest go first, and
 * losing one costs a single framing move.
 */
const MAX_REMEMBERED = 60;

interface StoredCamera extends BoardCamera {
  /** Last written at, for deciding what to drop when the list is full. */
  at: number;
}

type CameraTable = Record<string, StoredCamera>;

function readTable(): CameraTable {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(CAMERA_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const table: CameraTable = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const camera = asStoredCamera(value);
      if (camera) {
        table[id] = camera;
      }
    }
    return table;
  } catch {
    return {};
  }
}

function writeTable(table: CameraTable): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(CAMERA_STORAGE_KEY, JSON.stringify(table));
  } catch {
    // A full or blocked localStorage costs a framing move, nothing more.
  }
}

/**
 * A stored entry, or undefined if it is not one.
 *
 * The zoom is clamped to what the board itself allows: a blob written by a build
 * with a different floor must not be able to strand the camera at a zoom no
 * control can get back from.
 */
function asStoredCamera(value: unknown): StoredCamera | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const { x, y, zoom, at } = value as Record<string, unknown>;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(zoom) || zoom <= 0) {
    return undefined;
  }

  return {
    x,
    y,
    zoom: Math.min(Math.max(zoom, BOARD_MIN_ZOOM), BOARD_MAX_ZOOM),
    at: isFiniteNumber(at) ? at : 0,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Where this design was last left, if anywhere. */
export function readDesignCamera(designId: string): BoardCamera | undefined {
  const stored = readTable()[designId];
  return stored ? { x: stored.x, y: stored.y, zoom: stored.zoom } : undefined;
}

/** Remember where this design is being looked at now. */
export function writeDesignCamera(designId: string, camera: BoardCamera): void {
  if (!designId || !isFiniteNumber(camera.x) || !isFiniteNumber(camera.y)) {
    return;
  }

  const table = readTable();
  const current = table[designId];
  if (current && current.x === camera.x && current.y === camera.y && current.zoom === camera.zoom) {
    // The board re-applies a camera it was just given; that is not news.
    return;
  }

  table[designId] = { ...camera, at: Date.now() };
  writeTable(prune(table));
}

/** Drop the cameras of designs that have been closed. */
export function forgetDesignCameras(designIds: Iterable<string>): void {
  const table = readTable();
  let changed = false;
  for (const id of designIds) {
    if (id in table) {
      delete table[id];
      changed = true;
    }
  }
  if (changed) {
    writeTable(table);
  }
}

/**
 * Keep only the designs that still exist.
 *
 * Run at startup: designs can also go away without this module hearing about it
 * (another browser tab closing one, a storage wipe), and there is no reason to
 * carry a camera for a plan nothing can open.
 */
export function keepDesignCameras(designIds: Iterable<string>): void {
  const alive = new Set(designIds);
  const table = readTable();
  const doomed = Object.keys(table).filter((id) => !alive.has(id));
  if (doomed.length > 0) {
    forgetDesignCameras(doomed);
  }
}

function prune(table: CameraTable): CameraTable {
  const ids = Object.keys(table);
  if (ids.length <= MAX_REMEMBERED) {
    return table;
  }

  const kept = ids.sort((a, b) => table[b].at - table[a].at).slice(0, MAX_REMEMBERED);
  const pruned: CameraTable = {};
  for (const id of kept) {
    pruned[id] = table[id];
  }
  return pruned;
}

/*
 * Handing the board from one design to the next.
 *
 * The board reports every camera move, including the ones it makes itself, and
 * a switch means the store points at the new design a moment before the board
 * has moved to it. Without a latch, the tail of the outgoing tab's camera - a
 * framing move still animating, or the interrupt that stops it - is reported
 * while the new design is already the active one, and gets written down as that
 * design's camera.
 *
 * So a handover starts closed and opens again the moment the board has served
 * the arriving camera. A real gesture opens it too: whatever order things
 * happened in, someone panning by hand is looking at the tab that is up.
 */

let handovers = 0;
let served = 0;

/** Called before the active design changes. */
export function beginDesignCameraHandover(): void {
  handovers += 1;
}

/** Called once the board is showing the arriving design. */
export function settleDesignCamera(): void {
  served = handovers;
}

/** Whether a camera move reported now belongs to the design that is up. */
export function isDesignCameraSettled(): boolean {
  return served === handovers;
}

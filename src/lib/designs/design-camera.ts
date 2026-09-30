"use client";

import { BOARD_MIN_ZOOM, boardMaxZoom } from "@/components/flow/board-camera";

/**
 * Where each design tab was left: the pan and the zoom it last had, so
 * switching back returns to the same spot.
 *
 * Deliberately NOT part of the plan: a shared setup carries no viewport, so
 * someone opening one gets it framed. Stored in localStorage keyed by design
 * id, not in the design record, because a pan is not an edit and must not
 * push a whole plan through a save. A design with no stored camera is framed.
 */

export interface BoardCamera {
  x: number;
  y: number;
  zoom: number;
}

const CAMERA_STORAGE_KEY = "susy-factory-flow.design-cameras.v1";

/**
 * How many tabs' cameras to keep; the oldest go first, and losing one costs a
 * single framing move.
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
 * A stored entry, or undefined if it is not one. The zoom is clamped to the
 * board's range so a blob from a build with different limits cannot strand
 * the camera.
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
    zoom: Math.min(Math.max(zoom, BOARD_MIN_ZOOM), boardMaxZoom()),
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
 * Keep only the designs that still exist. Run at startup, since designs can go
 * away without this module hearing about it (another tab, a storage wipe).
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
 * On a switch the store points at the new design a moment before the board has
 * moved to it, so the tail of the outgoing camera (a framing animation, or its
 * interrupt) would be recorded as the new design's camera. This latch closes
 * at a handover and opens once the board has served the arriving camera, or
 * on a real user gesture.
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

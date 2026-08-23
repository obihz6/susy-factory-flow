"use client";

import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";

import {
  lerpSampledPolylines,
  morphPointsToPath,
  morphSampleCount,
  polylinesEqual,
  resamplePolyline,
  type MorphPoint,
} from "./route-morph";

/**
 * The board's two motion switches, and the machinery that moves things.
 *
 * MOVEMENT motion is how things get where they are going: cards glide onto
 * their grid cell instead of teleporting cell to cell, and a rerouted wire
 * morphs from its old line to its new one. VALUE motion is how numbers get to
 * what they now are: rates, bars, widths and dash speeds ease over about a
 * second instead of flickering to the new answer, so adding a machine reads
 * as the board speeding up rather than as a scene cut.
 *
 * Deliberately NOT part of BoardView. That store is a per-plan snapshot — how
 * a factory is dressed travels with the factory — but whether this DEVICE
 * animates is the viewer's taste, like reduced motion, and a shared plan has
 * no business switching it. So: its own localStorage key, never captured into
 * plan-view state, and the default bows to the OS's reduced-motion setting.
 */
export interface BoardMotion {
  /** Cards magnet onto the grid; rerouted wires glide to their new line. */
  moveMotion: boolean;
  /** Rates, bars, line widths and dash speeds ease instead of jumping. */
  valueMotion: boolean;
}

const BOARD_MOTION_STORAGE_KEY = "susy-factory-flow-board-motion";

/** How long a card glides onto its cell. Mirrored in globals.css. */
export const MOVE_SNAP_MS = 120;
/** How long a rerouted wire takes to lie down on its new line. */
export const ROUTE_MORPH_MS = 260;
/** How long a number, bar or width takes to reach its new value. */
export const VALUE_TWEEN_MS = 1000;

function defaultBoardMotion(): BoardMotion {
  // The OS asked for stillness; start there. An explicit saved choice wins.
  const reduce =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return { moveMotion: !reduce, valueMotion: !reduce };
}

const SERVER_BOARD_MOTION: BoardMotion = { moveMotion: true, valueMotion: true };

let boardMotionState: BoardMotion = SERVER_BOARD_MOTION;
let boardMotionLoaded = false;
const motionListeners = new Set<() => void>();

function readBoardMotion(): BoardMotion {
  const fallback = defaultBoardMotion();
  try {
    const raw = window.localStorage.getItem(BOARD_MOTION_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<Record<keyof BoardMotion, unknown>>;
    // Absent keys fall back to the default, same rule as board-view: only an
    // explicit `false` is an opt-out.
    const flag = (value: unknown, or: boolean) => (typeof value === "boolean" ? value : or);
    return {
      moveMotion: flag(parsed.moveMotion, fallback.moveMotion),
      valueMotion: flag(parsed.valueMotion, fallback.valueMotion),
    };
  } catch {
    return fallback;
  }
}

function subscribeBoardMotion(listener: () => void) {
  motionListeners.add(listener);
  return () => {
    motionListeners.delete(listener);
  };
}

function getBoardMotionSnapshot(): BoardMotion {
  if (!boardMotionLoaded) {
    boardMotionLoaded = true;
    boardMotionState = readBoardMotion();
  }
  return boardMotionState;
}

function getServerBoardMotionSnapshot(): BoardMotion {
  return SERVER_BOARD_MOTION;
}

export function writeBoardMotion(patch: Partial<BoardMotion>) {
  boardMotionState = { ...getBoardMotionSnapshot(), ...patch };
  try {
    window.localStorage.setItem(BOARD_MOTION_STORAGE_KEY, JSON.stringify(boardMotionState));
  } catch {
    // A blocked storage quota must never break the board.
  }
  for (const listener of motionListeners) {
    listener();
  }
}

export function useBoardMotion(): BoardMotion {
  return useSyncExternalStore(
    subscribeBoardMotion,
    getBoardMotionSnapshot,
    getServerBoardMotionSnapshot,
  );
}

/** The same value the hook returns, for callers outside React. */
export function readBoardMotionSnapshot(): BoardMotion {
  if (typeof window === "undefined") {
    return SERVER_BOARD_MOTION;
  }
  return getBoardMotionSnapshot();
}

/**
 * One clock for every tween on the board.
 *
 * Each animating hook registers a step callback; a single rAF loop runs while
 * any are alive and stops dead the moment the last one settles. All the
 * setStates fired from one pump land in one React batch, so a board-wide
 * value change is one commit per frame, not one per number.
 */
type MotionStep = (now: number) => boolean; // true = done, drop it

const activeSteps = new Set<MotionStep>();
let motionFrame = 0;

function pumpMotion(now: number) {
  motionFrame = 0;
  for (const step of [...activeSteps]) {
    let done = true;
    try {
      done = step(now);
    } catch {
      // One broken tween must not stall every other animation on the board.
    }
    if (done) {
      activeSteps.delete(step);
    }
  }
  if (activeSteps.size > 0) {
    motionFrame = window.requestAnimationFrame(pumpMotion);
  }
}

function scheduleMotionStep(step: MotionStep) {
  activeSteps.add(step);
  if (motionFrame === 0) {
    motionFrame = window.requestAnimationFrame(pumpMotion);
  }
}

function cancelMotionStep(step: MotionStep) {
  activeSteps.delete(step);
}

/** Fast out, soft landing — reads as response, not as lag. */
function easeOutCubic(t: number) {
  const inverted = 1 - t;
  return 1 - inverted * inverted * inverted;
}

/**
 * One eased 0→1 run on the shared clock, for callers animating something the
 * value hooks cannot express (list presence, bespoke geometry). Returns a
 * cancel; `onFrame` receives the EASED progress each frame and is always
 * called with exactly 1 before `onDone`.
 */
export function runMotionTween({
  durationMs,
  onFrame,
  onDone,
}: {
  durationMs: number;
  onFrame: (eased: number) => void;
  onDone?: () => void;
}): () => void {
  let cancelled = false;
  let start = 0;
  const step: MotionStep = (now) => {
    if (cancelled) {
      return true;
    }
    if (start === 0) {
      start = now;
    }
    const t = Math.min(1, (now - start) / durationMs);
    onFrame(easeOutCubic(t));
    if (t >= 1) {
      onDone?.();
      return true;
    }
    return false;
  };
  scheduleMotionStep(step);
  return () => {
    cancelled = true;
    cancelMotionStep(step);
  };
}

interface NumberTweenState {
  shown: number[];
  from: number[];
  to: number[];
  start: number;
  step?: MotionStep;
}

function valuesEqual(a: readonly number[], b: readonly number[]) {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

/**
 * The displayed stand-ins for `values`, easing toward them whenever they
 * move. First mount shows the real values (a fresh board does not count up
 * from zero), a non-finite target snaps (there is no honest halfway to
 * Infinity), and `enabled: false` is a pass-through.
 */
export function useMotionValues(
  values: readonly number[],
  enabled: boolean,
  durationMs: number = VALUE_TWEEN_MS,
): readonly number[] {
  const stateRef = useRef<NumberTweenState | undefined>(undefined);
  if (stateRef.current === undefined) {
    stateRef.current = { shown: [...values], from: [...values], to: [...values], start: 0 };
  }
  const state = stateRef.current;
  const [, force] = useReducer((count: number) => count + 1, 0);

  const wantsTween =
    enabled &&
    values.every((value) => Number.isFinite(value)) &&
    state.shown.every((value) => Number.isFinite(value));

  // Change detection in render, so the first frame after a target moves still
  // draws the OLD value: an effect-only start would flash the target once
  // before the tween pulled it back. The writes are idempotent — re-rendering
  // with the same target changes nothing — which is what makes them safe here.
  if (!valuesEqual(state.to, values)) {
    if (!wantsTween) {
      state.shown = [...values];
      state.from = [...values];
      state.to = [...values];
      state.start = 0;
    } else {
      state.from = [...state.shown];
      state.to = [...values];
      state.start = 0; // stamped by the effect below, on the clock the pump uses
    }
  } else if (!wantsTween && !valuesEqual(state.shown, values)) {
    // Motion switched off mid-tween: land immediately.
    state.shown = [...values];
    state.from = [...values];
    state.start = 0;
  }

  const pendingTween = wantsTween && !valuesEqual(state.shown, state.to);

  useEffect(() => {
    if (!pendingTween) {
      return;
    }
    if (state.step) {
      cancelMotionStep(state.step);
    }
    const step: MotionStep = (now) => {
      if (state.step !== step) {
        return true;
      }
      if (state.start === 0) {
        state.start = now;
      }
      const t = Math.min(1, (now - state.start) / durationMs);
      const eased = easeOutCubic(t);
      state.shown = state.to.map(
        (target, index) => state.from[index] + (target - state.from[index]) * eased,
      );
      if (t >= 1) {
        state.shown = [...state.to];
        state.step = undefined;
      }
      force();
      return t >= 1;
    };
    state.step = step;
    state.start = 0;
    scheduleMotionStep(step);
    return () => {
      if (state.step === step) {
        state.step = undefined;
      }
      cancelMotionStep(step);
    };
    // state is a stable ref box; the tween restarts when the target moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTween, state.to, durationMs]);

  return wantsTween ? state.shown : values;
}

/** One-value convenience over useMotionValues. */
export function useMotionValue(value: number, enabled: boolean, durationMs?: number): number {
  const valuesRef = useRef<number[]>([value]);
  if (valuesRef.current[0] !== value) {
    valuesRef.current = [value];
  }
  const shown = useMotionValues(valuesRef.current, enabled, durationMs);
  return shown[0] ?? value;
}

/** What a morphing route hands back: the blend, or the settled route itself. */
export interface MotionRouteState {
  points: Array<{ x: number; y: number }>;
  path: string;
  /** True while mid-blend — hop bumps and caches should wait for the landing. */
  morphing: boolean;
}

interface RouteMorphState {
  to: MorphPoint[];
  fromSamples: MorphPoint[];
  toSamples: MorphPoint[];
  start: number;
  seq: number;
  morphing: boolean;
  shownPoints: MorphPoint[];
  shownPath: string;
  step?: MotionStep;
}

/**
 * The route as drawn this frame: `target` once settled, a blend of the old
 * and new lines for ROUTE_MORPH_MS after the router moves it. The first
 * route an edge ever shows is never animated — a wire scrolled back into
 * view (onlyRenderVisibleElements remounts it) must not wriggle.
 */
export function useMotionRoute(
  targetPoints: Array<{ x: number; y: number }>,
  targetPath: string,
  enabled: boolean,
  durationMs: number = ROUTE_MORPH_MS,
): MotionRouteState {
  const stateRef = useRef<RouteMorphState | undefined>(undefined);
  if (stateRef.current === undefined) {
    stateRef.current = {
      to: targetPoints,
      fromSamples: [],
      toSamples: [],
      start: 0,
      seq: 0,
      morphing: false,
      shownPoints: targetPoints,
      shownPath: targetPath,
    };
  }
  const state = stateRef.current;
  const [, force] = useReducer((count: number) => count + 1, 0);

  if (!enabled) {
    state.to = targetPoints;
    state.morphing = false;
  } else if (!polylinesEqual(state.to, targetPoints)) {
    // Start the glide from whatever is on screen RIGHT NOW — a re-solve that
    // lands mid-morph retargets smoothly instead of snapping back first.
    const fromShape = state.morphing ? state.shownPoints : state.to;
    const count = morphSampleCount(fromShape, targetPoints);
    state.fromSamples = resamplePolyline(fromShape, count);
    state.toSamples = resamplePolyline(targetPoints, count);
    state.to = targetPoints;
    state.start = 0;
    state.seq += 1;
    // A brand-new wire (or one remounting after a cull) has nothing to morph
    // from; only a route that visibly changed shape animates.
    state.morphing = state.fromSamples.length > 0 && state.toSamples.length > 0;
    if (state.morphing) {
      state.shownPoints = state.fromSamples;
      state.shownPath = morphPointsToPath(state.fromSamples);
    }
  }

  const seq = state.seq;
  useEffect(() => {
    if (!enabled || !state.morphing || state.seq !== seq) {
      return;
    }
    if (state.step) {
      cancelMotionStep(state.step);
    }
    const step: MotionStep = (now) => {
      if (state.step !== step || state.seq !== seq) {
        return true;
      }
      if (state.start === 0) {
        state.start = now;
      }
      const t = Math.min(1, (now - state.start) / durationMs);
      if (t >= 1) {
        state.morphing = false;
        state.step = undefined;
        force();
        return true;
      }
      const blended = lerpSampledPolylines(state.fromSamples, state.toSamples, easeOutCubic(t));
      state.shownPoints = blended;
      state.shownPath = morphPointsToPath(blended);
      force();
      return false;
    };
    state.step = step;
    scheduleMotionStep(step);
    return () => {
      if (state.step === step) {
        state.step = undefined;
      }
      cancelMotionStep(step);
    };
    // The ref box is stable; a new seq is a new morph.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, seq]);

  if (enabled && state.morphing) {
    return { points: state.shownPoints, path: state.shownPath, morphing: true };
  }
  return { points: targetPoints, path: targetPath, morphing: false };
}

/**
 * The same shape-morph without a path string: hand it any polyline (a trend
 * chart's line, say) and it glides from the old shape to the new one on the
 * value-motion clock.
 */
export function useMotionPoints(
  targetPoints: Array<{ x: number; y: number }>,
  enabled: boolean,
  durationMs?: number,
): Array<{ x: number; y: number }> {
  const route = useMotionRoute(targetPoints, "", enabled, durationMs);
  return route.points;
}

/**
 * A stretch of text whose numbers ease to their new values: hand it the raw
 * numbers and how to say them, and it re-renders only itself while they move.
 */
export function MotionNumberText({
  values,
  render,
}: {
  values: readonly number[];
  render: (shown: readonly number[]) => string;
}) {
  const { valueMotion } = useBoardMotion();
  const shown = useMotionValues(values, valueMotion);
  return <>{render(shown)}</>;
}

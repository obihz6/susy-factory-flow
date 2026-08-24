"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import { edgePulseCount } from "./edge-pulse";

/**
 * The performance readout, bottom left of the board.
 *
 * Switched on from the dev menu (shift-click the version chip in the top
 * bar); the choice persists. Everything it shows comes from its own rAF
 * sampler and is written straight into the DOM with textContent a few times
 * a second - a HUD that re-rendered React per frame would bend the very
 * numbers it reports (and break the board's own rule: nothing O(anything)
 * per frame goes through React).
 *
 * Readings:
 *  - live frame time and rate over the last half second
 *  - avg / p95 / worst over the last five seconds
 *  - stutter tallies (>25ms and >40ms frames) over the last minute
 *  - what is mounted: cards, wires, marching-dash lines
 */
const PERF_HUD_STORAGE_KEY = "gtnh-factory-flow.perf-hud";

let perfHudState: boolean | undefined;
const perfHudListeners = new Set<() => void>();

export function isPerfHudEnabled(): boolean {
  if (perfHudState === undefined) {
    if (typeof window === "undefined") {
      return false;
    }
    try {
      perfHudState = window.localStorage.getItem(PERF_HUD_STORAGE_KEY) === "1";
    } catch {
      // Blocked storage never blocks the board.
      perfHudState = false;
    }
  }
  return perfHudState;
}

export function setPerfHudEnabled(next: boolean) {
  perfHudState = next;
  try {
    window.localStorage.setItem(PERF_HUD_STORAGE_KEY, next ? "1" : "0");
  } catch {
    // Same bargain as above.
  }
  for (const listener of perfHudListeners) {
    listener();
  }
}

function subscribePerfHud(listener: () => void) {
  perfHudListeners.add(listener);
  return () => {
    perfHudListeners.delete(listener);
  };
}

function serverPerfHudSnapshot() {
  return false;
}

/** How often the text refreshes. The sampler itself runs every frame. */
const HUD_REFRESH_MS = 250;
const LIVE_WINDOW_MS = 500;
const STATS_WINDOW_MS = 5_000;
const STUTTER_WINDOW_MS = 60_000;

export function PerfHud() {
  const enabled = useSyncExternalStore(subscribePerfHud, isPerfHudEnabled, serverPerfHudSnapshot);

  const lineLiveRef = useRef<HTMLDivElement | null>(null);
  const lineStatsRef = useRef<HTMLDivElement | null>(null);
  const lineStutterRef = useRef<HTMLDivElement | null>(null);
  const lineCountsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    // Timestamps of frame ENDS plus each frame's delta, pruned to the minute
    // window. A minute at 120Hz is ~7,200 entries - nothing.
    const stamps: number[] = [];
    const deltas: number[] = [];
    let last = performance.now();
    let lastRefresh = 0;
    let frame = 0;

    const prune = (now: number) => {
      const cutoff = now - STUTTER_WINDOW_MS;
      let drop = 0;
      while (drop < stamps.length && stamps[drop] < cutoff) {
        drop += 1;
      }
      if (drop > 0) {
        stamps.splice(0, drop);
        deltas.splice(0, drop);
      }
    };

    const refresh = (now: number) => {
      let liveSum = 0;
      let liveCount = 0;
      const statsWindow: number[] = [];
      let stutter25 = 0;
      let stutter40 = 0;
      for (let index = stamps.length - 1; index >= 0; index -= 1) {
        const age = now - stamps[index];
        const delta = deltas[index];
        if (age <= LIVE_WINDOW_MS) {
          liveSum += delta;
          liveCount += 1;
        }
        if (age <= STATS_WINDOW_MS) {
          statsWindow.push(delta);
        }
        if (delta > 25) {
          stutter25 += 1;
          if (delta > 40) {
            stutter40 += 1;
          }
        }
      }
      const ms = (value: number) => (Math.round(value * 10) / 10).toFixed(1);
      if (lineLiveRef.current) {
        const liveMs = liveCount > 0 ? liveSum / liveCount : 0;
        const fps = liveMs > 0 ? Math.round(1000 / liveMs) : 0;
        lineLiveRef.current.textContent = `${ms(liveMs)} ms · ${fps} fps`;
      }
      if (lineStatsRef.current) {
        if (statsWindow.length > 0) {
          statsWindow.sort((a, b) => a - b);
          const avg = statsWindow.reduce((sum, value) => sum + value, 0) / statsWindow.length;
          const p95 = statsWindow[Math.min(statsWindow.length - 1, Math.floor(statsWindow.length * 0.95))];
          const worst = statsWindow[statsWindow.length - 1];
          lineStatsRef.current.textContent = `avg ${ms(avg)} · p95 ${ms(p95)} · max ${ms(worst)} (5s)`;
        } else {
          lineStatsRef.current.textContent = "avg - · p95 - · max - (5s)";
        }
      }
      if (lineStutterRef.current) {
        lineStutterRef.current.textContent = `stutters: ${stutter25} over 25ms · ${stutter40} over 40ms (60s)`;
      }
      if (lineCountsRef.current) {
        const cards = document.querySelectorAll(".react-flow__node").length;
        const wires = document.querySelectorAll(".react-flow__edge").length;
        lineCountsRef.current.textContent = `cards ${cards} · wires ${wires} · dashes ${edgePulseCount()}`;
      }
    };

    const tick = (now: number) => {
      frame = window.requestAnimationFrame(tick);
      // A backgrounded tab's first frame back would read as one giant stutter.
      const delta = Math.min(now - last, 1000);
      last = now;
      stamps.push(now);
      deltas.push(delta);
      prune(now);
      if (now - lastRefresh >= HUD_REFRESH_MS) {
        lastRefresh = now;
        refresh(now);
      }
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [enabled]);

  if (!enabled) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute bottom-12 left-2 z-50 border-2 border-[#3b414c] bg-[#14161a]/90 px-2 py-1 font-mono text-[11px] leading-[15px] text-[#c3cad6] shadow-[3px_3px_0_rgba(0,0,0,0.45)]"
      aria-hidden
    >
      <div ref={lineLiveRef} className="text-[#e8ecf3]" />
      <div ref={lineStatsRef} />
      <div ref={lineStutterRef} />
      <div ref={lineCountsRef} className="text-[#8a93a3]" />
    </div>
  );
}

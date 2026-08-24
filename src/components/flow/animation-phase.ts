"use client";

import { useEffect, type RefObject } from "react";

/**
 * Every animation on the board that BREATHES, by keyframe name.
 *
 * The board has one heartbeat, not several. Two things that pulse at different
 * moments read as unrelated faults; the same two pulsing together read as one
 * board telling you something. That takes two properties, and both are easy to
 * lose:
 *
 *  - one PERIOD, which is `--board-pulse` in globals.css. Every rule below
 *    animates for that long, so no two marks can drift apart over time.
 *  - one PHASE, which is what this module does. Period alone is not enough:
 *    a CSS animation's clock starts when it is applied to the element, so a
 *    card scrolled into view, recycled by React Flow, or pulled into a dead
 *    ring by a fresh solve each starts its own cycle wherever it happens to
 *    arrive.
 *
 * Add a keyframe here when you add a breathing state, and give it
 * `--board-pulse` as its duration. A pulse missing from this list still runs;
 * it just runs alone, which is the exact bug this exists to prevent.
 *
 * One-shot flashes are deliberately absent: `board-card-placed` fires four
 * times and stops, and lining it up with the board's clock would only delay
 * the answer to "where did my card land".
 */
export const BOARD_PULSE_ANIMATIONS = [
  // Hovered/selected resource: the glow wash on cards, and the shape-clipped
  // one drawers wear.
  "resource-breathe",
  "resource-breathe-led",
  // A card with a slot nobody wired: the dashed slot, the reason cell, the
  // ring, and the wash layer the cell and the board notice fade on.
  "unwired-port-breathe",
  "unwired-reason-breathe",
  "unwired-wash-breathe",
  "unwired-ring-breathe",
  // A ring of machines feeding each other with nothing coming in, and the
  // wires that close the loop.
  "dead-loop-breathe",
  "dead-loop-wire-breathe",
  // Its mirror: machines frozen because their own surplus filled every
  // escape route, and the wires the jam runs along.
  "clog-lock-breathe",
  "clog-lock-wire-breathe",
] as const;

const BOARD_PULSE_SET: ReadonlySet<string> = new Set(BOARD_PULSE_ANIMATIONS);

/**
 * `startTime = 0` pins an animation to the origin of the document timeline,
 * which every element on the page shares. Set it on every mark and they are all
 * at the same point of the same cycle, whenever each one arrived.
 *
 * `subtree` because a glow is often painted by a ::after, and a pseudo
 * element's animation is not on its element's own list.
 */
function pinToDocumentTimeline(element: Element, names: ReadonlySet<string>) {
  if (!element.getAnimations) {
    return;
  }
  for (const animation of element.getAnimations({ subtree: true })) {
    const name = (animation as Animation & { animationName?: string }).animationName;
    if (!name || !names.has(name)) {
      continue;
    }
    try {
      animation.startTime = 0;
    } catch {
      // A timeline that refuses the write is not worth a broken board; the
      // mark still shows, it just keeps its own phase.
    }
  }
}

/**
 * Puts every breathing mark on the board on one clock. Called once, from the
 * board root — not per card.
 *
 * `animationstart` BUBBLES, so the root hears about every pulse that begins
 * anywhere beneath it: a card scrolled into view, a ring the solver just found,
 * a slot that lost its wire, a card lit by the side panel, and the board's own
 * notices, which live outside any card and were the last thing left out of step
 * when each card pinned only itself. Pinning does not restart an animation, so
 * the handler cannot feed itself, and it runs once per mark rather than per
 * frame.
 *
 * The mount sweep covers what was already running before the listener existed.
 */
export function useBoardPulseSync(ref: RefObject<Element | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    // One frame's grace: an animation does not exist on the element until
    // styles have been applied, and an effect can run before that. Without the
    // wait getAnimations() returns nothing and the mark stays adrift.
    const frame = requestAnimationFrame(() => {
      pinToDocumentTimeline(element, BOARD_PULSE_SET);
    });
    const onStart = (event: Event) => {
      const { animationName, target } = event as AnimationEvent;
      if (!BOARD_PULSE_SET.has(animationName) || !(target instanceof Element)) {
        return;
      }
      pinToDocumentTimeline(target, BOARD_PULSE_SET);
    };
    element.addEventListener("animationstart", onStart);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("animationstart", onStart);
    };
  }, [ref]);
}

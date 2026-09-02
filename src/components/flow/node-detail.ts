/**
 * How much of the board is worth drawing at the current zoom.
 *
 * Zoomed out, a card's contents are noise: the slot sprites are sub-pixel, the
 * dials are a grey smear, the machine name is three pixels tall, and a rate
 * chip is a smudge. So past a threshold the board switches to a glance view —
 * machines show how hard they are running, buffers show what is in them, and
 * lines are just their routes.
 *
 * ONE step, and one threshold, for everything. Nodes and edges used to decide
 * separately: nodes had a hysteretic threshold and edges a plain one, so
 * between the two there was a zone where the rate chips had come back but the
 * cards were still showing percentages. Detail switching in pieces reads as the
 * board glitching. There is now a single level, held here, that both consume.
 *
 * TUNING: the two numbers below are the whole control surface. They are a pair
 * rather than one value because a single boundary flickers — a board parked
 * exactly on it flips detail on and off with every sub-pixel of zoom drift. The
 * gap is the dead zone that stops that, and it is deliberately narrow: too wide
 * and regaining detail means zooming noticeably further in than the point where
 * you lost it, which feels like the board is arguing with you.
 *
 * Nothing here may change a node's SIZE. Detail is dropped with `visibility`,
 * never `display`, so every element keeps its layout box: the router measures
 * node bounds and slot anchors through those boxes, and a card that changed
 * shape with zoom would reroute the board every time you scrolled the wheel —
 * exactly the viewport-dependent routing ARCHITECTURE.md forbids.
 */

export const NODE_DETAIL_FULL = 0;
export const NODE_DETAIL_GLANCE = 1;

export type NodeDetailLevel = typeof NODE_DETAIL_FULL | typeof NODE_DETAIL_GLANCE;

/**
 * Below this the board drops to the glance view. 0.6 is roughly where a port
 * row's lettering falls under eight screen pixels: the moment the card stops
 * being readable is the moment the glance takes over, rather than three
 * wheel-steps later with the board a smear in between.
 */
export const NODE_GLANCE_ENTER_ZOOM = 0.6;
/** And above this it comes back. The gap is the anti-flicker dead zone. */
export const NODE_GLANCE_LEAVE_ZOOM = 0.66;

/**
 * The level for this zoom, given the level currently in force.
 *
 * Passing the current level is what makes the threshold hysteretic: the step is
 * only entered below `ENTER` and only left above `LEAVE`, so zoom noise around
 * the boundary cannot make the board strobe.
 */
export function getNodeDetailLevel(zoom: number, current: NodeDetailLevel): NodeDetailLevel {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return current;
  }
  if (zoom < NODE_GLANCE_ENTER_ZOOM) {
    return NODE_DETAIL_GLANCE;
  }
  if (zoom >= NODE_GLANCE_LEAVE_ZOOM) {
    return NODE_DETAIL_FULL;
  }
  return current;
}

/*
 * The level itself, as a tiny external store.
 *
 * It cannot be derived inside a React Flow selector: hysteresis depends on the
 * PREVIOUS level, and a selector has to be a pure function of store state. So
 * one owner (NodeDetailController) computes it from the live transform and
 * publishes here, and everything that cares subscribes. Edges read it through
 * useSyncExternalStore, which re-renders them only when the level actually
 * flips rather than on every frame of a zoom gesture.
 */
let detailLevel: NodeDetailLevel = NODE_DETAIL_FULL;
const detailListeners = new Set<() => void>();

/**
 * The dev menu's "always glance" switch: the zoomed-out faces at EVERY
 * zoom. The controller keeps computing and publishing the honest level
 * underneath, so switching it off lands straight back on whatever the
 * current zoom deserves - no stale level, no waiting for the next wheel
 * step.
 */
const FORCE_GLANCE_KEY = "gtnh-factory-flow.dev.force-glance";

let forceGlance = readStoredForceGlance();

function readStoredForceGlance(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(FORCE_GLANCE_KEY) === "on";
  } catch {
    return false;
  }
}

export function isNodeDetailGlanceForced(): boolean {
  return forceGlance;
}

export function setNodeDetailGlanceForced(forced: boolean): void {
  if (forced === forceGlance) {
    return;
  }
  forceGlance = forced;
  try {
    if (forced) {
      window.localStorage.setItem(FORCE_GLANCE_KEY, "on");
    } else {
      window.localStorage.removeItem(FORCE_GLANCE_KEY);
    }
  } catch {
    // Session-only is fine.
  }
  for (const listener of detailListeners) {
    listener();
  }
}

export function setNodeDetailLevel(level: NodeDetailLevel) {
  if (level === detailLevel) {
    return;
  }
  detailLevel = level;
  if (forceGlance) {
    // Published output is pinned to glance; the honest level above still
    // updated, so lifting the pin lands on it.
    return;
  }
  for (const listener of detailListeners) {
    listener();
  }
}

export function getPublishedNodeDetailLevel(): NodeDetailLevel {
  return forceGlance ? NODE_DETAIL_GLANCE : detailLevel;
}

/** Server render has no viewport, so it always describes the full board. */
export function getServerNodeDetailLevel(): NodeDetailLevel {
  return NODE_DETAIL_FULL;
}

export function subscribeNodeDetailLevel(listener: () => void) {
  detailListeners.add(listener);
  return () => {
    detailListeners.delete(listener);
  };
}

/**
 * The board element carries the level as a data ATTRIBUTE, not a class.
 *
 * React owns `className` on the board: FactoryFlow rebuilds that string on
 * every render, so a class added imperatively was wiped the moment anything
 * else about the board changed — toggling thickness mode mid-zoom made the
 * glance view vanish until the next threshold crossing. React never touches an
 * attribute it was not given, so this one survives.
 */
export const NODE_DETAIL_ATTRIBUTE = "data-detail-level";

export function nodeDetailAttributeValue(level: NodeDetailLevel): string | undefined {
  return level === NODE_DETAIL_GLANCE ? "glance" : undefined;
}

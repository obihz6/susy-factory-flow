/**
 * The marching dashes, moved off SVG.
 *
 * Pulse mode used to draw one extra `<path>` per edge with a CSS animation on
 * `stroke-dashoffset`. That property is a PAINT property: it cannot be
 * composited, so every frame of the animation invalidated the whole edge layer
 * and Chrome re-rastered every line on the board — 616 edges cost ~90ms a
 * frame with the board otherwise completely still. It was the single most
 * expensive thing the board did, and it did it forever, whether or not anyone
 * was looking.
 *
 * The dashes now live on one canvas sitting directly above the edge layer.
 * Geometry is the edges' own path strings handed to `Path2D`, and stroke
 * widths, dash lengths and speeds are the same numbers the SVG used, so what
 * is drawn is what was drawn before — one raster of the visible rectangle
 * instead of a repaint of the entire board.
 *
 * Everything here is pure module state in FLOW coordinates, the same
 * discipline the routing caches follow: nothing depends on zoom or pan.
 */

import type {
  EdgePulseFrameSpec,
  ExportOcclusionDot,
} from "@/lib/import-export/plan-image";

export interface EdgePulseSpec {
  /** The edge's route, exactly as the SVG draws it (hops included). */
  path: string;
  /** Stroke width of the dash overlay, in flow units. */
  width: number;
  dash: number;
  gap: number;
  /** Flow pixels per second the dashes travel. */
  velocity: number;
  /** Route bounding box, for viewport culling. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /**
   * A mid-morph path: one frame of a wire gliding to its new route. Kept out
   * of the Path2D cache — every frame of every morphing edge is a fresh
   * string, and caching them would churn the cache straight past its ceiling.
   */
  transient?: boolean;
}

interface CompiledPulse extends EdgePulseSpec {
  path2d: Path2D | undefined;
  /**
   * A fixed head start, so lines do not all march in lockstep.
   *
   * Per-edge CSS animations each began whenever their element was created, so
   * the board's dashes were naturally scattered in phase. One shared clock
   * would snap every line of the same speed into a single marching column,
   * which reads as a synchronised light show rather than as flow. Derived from
   * the edge id, so a line's phase is stable across rerenders and reloads.
   */
  phase: number;
  /**
   * The speed the dashes are ACTUALLY moving at, chasing `velocity`. When the
   * board's value motion is on, a solver change swings `velocity` in one
   * step and this eases after it, so the flow reads as speeding up rather
   * than as a different animation being swapped in.
   */
  liveVelocity: number;
  /**
   * Distance marched so far, in flow px. The offset used to be derived from
   * absolute time × velocity, which is only continuous while velocity never
   * changes — the integral is what lets the speed move without the dashes
   * teleporting.
   */
  travel: number;
}

const pulses = new Map<string, CompiledPulse>();
/** Path2D is not free to build; route strings repeat across frames. */
const path2dCache = new Map<string, Path2D>();

function hashPhase(edgeId: string) {
  let hash = 0;
  for (let index = 0; index < edgeId.length; index += 1) {
    hash = (hash * 31 + edgeId.charCodeAt(index)) | 0;
  }
  return (Math.abs(hash) % 1000) / 1000;
}

function compilePath(path: string, transient?: boolean): Path2D | undefined {
  if (!path) {
    return undefined;
  }
  const cached = path2dCache.get(path);
  if (cached) {
    return cached;
  }
  // A malformed `d` throws in some engines; a missing pulse beats a dead frame.
  try {
    const compiled = new Path2D(path);
    if (!transient) {
      // Routes churn while dragging; without a ceiling this grows unbounded.
      if (path2dCache.size > 4000) {
        path2dCache.clear();
      }
      path2dCache.set(path, compiled);
    }
    return compiled;
  } catch {
    return undefined;
  }
}

export function publishEdgePulse(edgeId: string, spec: EdgePulseSpec) {
  const existing = pulses.get(edgeId);
  if (
    existing &&
    existing.path === spec.path &&
    existing.width === spec.width &&
    existing.dash === spec.dash &&
    existing.gap === spec.gap &&
    existing.velocity === spec.velocity
  ) {
    return;
  }

  pulses.set(edgeId, {
    ...spec,
    path2d: compilePath(spec.path, spec.transient),
    phase: existing?.phase ?? hashPhase(edgeId),
    // The march continues from wherever it was: a new route or a new speed
    // target must not reset how far the dashes have walked.
    liveVelocity: existing?.liveVelocity ?? spec.velocity,
    travel: existing?.travel ?? 0,
  });
}

export function retractEdgePulse(edgeId: string) {
  pulses.delete(edgeId);
}

export function clearEdgePulses() {
  pulses.clear();
  labelBoxes.clear();
}

export function edgePulseCount() {
  return pulses.size;
}

/**
 * The marching dashes as data, for rendering outside the live canvas — the
 * export dialog replays these into GIF frames. Geometry and speeds are copied
 * out so the export can quantise velocities for a seamless loop without
 * touching the live march. Taken while the export render is up, because a
 * culled edge has no pulse to copy.
 */
export function snapshotEdgePulses(): EdgePulseFrameSpec[] {
  return [...pulses.values()].map((pulse) => ({
    path: pulse.path,
    width: pulse.width,
    dash: pulse.dash,
    gap: pulse.gap,
    velocity: pulse.velocity,
    phase: pulse.phase,
  }));
}

/** The rate-chip boxes, as plain rects for the export's own eraser. */
export function snapshotEdgeLabelBoxes(): Array<{
  left: number;
  top: number;
  right: number;
  bottom: number;
}> {
  return [...labelBoxes.values()].map((box) => ({
    left: box.left,
    top: box.top,
    right: box.left + box.width,
    bottom: box.top + box.height,
  }));
}

/** Every pinned waypoint dot the dashes must not march over. */
export function snapshotEdgeWaypointDots(): ExportOcclusionDot[] {
  return [...waypointDots.values()].flat().map((dot) => ({ x: dot.x, y: dot.y, r: dot.r }));
}

/**
 * Where each edge's rate chip sits, in flow units.
 *
 * The canvas has to sit at the very TOP of the paint order — anything drawn
 * above a composited layer has to be composited too, and letting 300 nodes and
 * 600 labels each become their own layer cost ~140ms of Layerize per frame. So
 * instead of relying on stacking to keep the dashes underneath the chips and
 * the cards, the canvas punches those rectangles back out after drawing. The
 * result on screen is the same; the layer tree stays at a handful.
 */
export interface EdgeLabelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const labelBoxes = new Map<string, EdgeLabelBox>();

export function publishEdgeLabelBox(edgeId: string, box: EdgeLabelBox) {
  const existing = labelBoxes.get(edgeId);
  if (
    existing &&
    existing.left === box.left &&
    existing.top === box.top &&
    existing.width === box.width &&
    existing.height === box.height
  ) {
    return;
  }
  labelBoxes.set(edgeId, box);
}

export function retractEdgeLabelBox(edgeId: string) {
  labelBoxes.delete(edgeId);
}

/**
 * Clears the rectangles the dashes must not show through: the rate chips
 * always, and the machine cards whenever the edge layer is running beneath
 * them (thickness mode, where fat pipes deliberately dive under the cards).
 */
export function eraseEdgePulseOcclusion(
  context: CanvasRenderingContext2D,
  visible: { left: number; right: number; top: number; bottom: number },
  cardRects: Array<{ left: number; top: number; right: number; bottom: number }>,
) {
  const previousOperation = context.globalCompositeOperation;
  context.globalCompositeOperation = "destination-out";

  for (const rect of cardRects) {
    if (
      rect.right < visible.left ||
      rect.left > visible.right ||
      rect.bottom < visible.top ||
      rect.top > visible.bottom
    ) {
      continue;
    }
    context.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
  }

  for (const box of labelBoxes.values()) {
    if (
      box.left + box.width < visible.left ||
      box.left > visible.right ||
      box.top + box.height < visible.top ||
      box.top > visible.bottom
    ) {
      continue;
    }
    context.fillRect(box.left, box.top, box.width, box.height);
  }

  // Waypoint dots sit ON the wires, so without this the dashes march right
  // over them. Circles, not rects — a square hole poking out around a round
  // dot reads as a rendering glitch.
  for (const dots of waypointDots.values()) {
    for (const dot of dots) {
      if (
        dot.x + dot.r < visible.left ||
        dot.x - dot.r > visible.right ||
        dot.y + dot.r < visible.top ||
        dot.y - dot.r > visible.bottom
      ) {
        continue;
      }
      context.beginPath();
      context.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
      context.fill();
    }
  }

  context.globalCompositeOperation = previousOperation;
}

interface EdgeWaypointDot {
  x: number;
  y: number;
  r: number;
}

const waypointDots = new Map<string, EdgeWaypointDot[]>();

/** The dot circles the dash canvas must not paint over, per edge. */
export function publishEdgeWaypointDots(edgeId: string, dots: EdgeWaypointDot[]) {
  const existing = waypointDots.get(edgeId);
  if (
    existing &&
    existing.length === dots.length &&
    existing.every(
      (dot, index) =>
        dot.x === dots[index].x && dot.y === dots[index].y && dot.r === dots[index].r,
    )
  ) {
    return;
  }
  waypointDots.set(edgeId, dots);
}

export function retractEdgeWaypointDots(edgeId: string) {
  waypointDots.delete(edgeId);
}

/** Colour and cap match the SVG overlay this replaces, exactly. */
export const PULSE_STROKE = "rgba(255,255,255,0.92)";

/**
 * How fast the marching speed itself changes, as an exponential time
 * constant: after 0.45s a speed change is ~63% absorbed, after ~1.4s it is
 * done. Frame-rate independent by construction.
 */
const VELOCITY_SMOOTHING_TAU_SECONDS = 0.45;

/** The draw clock's last tick, for integrating travel. */
let lastDrawTimeSeconds: number | undefined;

/**
 * Draws every pulse whose route intersects the visible flow rect.
 *
 * The context is expected to be in FLOW coordinates already (the caller
 * applies device pixel ratio and the viewport transform), so widths and dash
 * lengths are the same flow-space numbers the SVG used and scale with zoom the
 * same way.
 *
 * `smoothSpeedChanges` is the board's value-motion switch: on, each line's
 * dash speed chases its target exponentially; off, it snaps as it always did.
 * Either way the offset is integrated travel, so no speed change ever makes
 * the dashes jump.
 */
export function drawEdgePulses(
  context: CanvasRenderingContext2D,
  visible: { left: number; right: number; top: number; bottom: number },
  timeSeconds: number,
  smoothSpeedChanges = false,
) {
  // Clamped so a backgrounded tab does not integrate its whole absence in
  // one delta when the loop resumes.
  const dt =
    lastDrawTimeSeconds === undefined
      ? 0
      : Math.min(Math.max(timeSeconds - lastDrawTimeSeconds, 0), 0.1);
  lastDrawTimeSeconds = timeSeconds;
  const blend = 1 - Math.exp(-dt / VELOCITY_SMOOTHING_TAU_SECONDS);

  context.strokeStyle = PULSE_STROKE;
  context.lineCap = "butt";
  context.lineJoin = "round";

  let lastWidth = -1;
  let lastDash = -1;
  let lastGap = -1;
  for (const pulse of pulses.values()) {
    // Every line keeps walking, visible or not: a culled line that froze
    // would fall out of step with its neighbours and lurch on re-entry.
    if (smoothSpeedChanges) {
      pulse.liveVelocity += (pulse.velocity - pulse.liveVelocity) * blend;
    } else {
      pulse.liveVelocity = pulse.velocity;
    }
    pulse.travel += pulse.liveVelocity * dt;

    if (
      !pulse.path2d ||
      pulse.right < visible.left ||
      pulse.left > visible.right ||
      pulse.bottom < visible.top ||
      pulse.top > visible.bottom
    ) {
      continue;
    }

    if (pulse.width !== lastWidth) {
      context.lineWidth = pulse.width;
      lastWidth = pulse.width;
    }
    if (pulse.dash !== lastDash || pulse.gap !== lastGap) {
      context.setLineDash([pulse.dash, pulse.gap]);
      lastDash = pulse.dash;
      lastGap = pulse.gap;
    }
    const period = pulse.dash + pulse.gap;
    // Same sign convention as SVG stroke-dashoffset, and the same motion the
    // keyframes described — stated over integrated travel rather than
    // absolute time, so the speed is free to move.
    context.lineDashOffset = -((pulse.travel / period + pulse.phase) % 1) * period;
    context.stroke(pulse.path2d);
  }
}

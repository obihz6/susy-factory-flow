/**
 * The board's demo-card tilt: a perspective lean on the whole canvas, the
 * way a product page shows off a card. Born as the build timelapse's dress
 * (board-timelapse.ts) and grown into its own dev setting: the angles are
 * fully customizable, the tilt can be worn OUTSIDE the timelapse too, and
 * edits apply live - mid-run included (the dev menu opens over a running
 * timelapse without cancelling it; only board presses cancel).
 *
 * Purely the visual layer: CSS variables on the board container drive a
 * transform on the React Flow root (globals.css), React Flow's own 2D
 * viewport transform is untouched, and the camera math never knows.
 * Pointer positions DO skew while tilted - it is an aesthetic, not a
 * working pose - which is why it lives in the dev menu.
 */

export interface BoardTilt {
  /** rotateX, degrees. Positive leans the top away. */
  pitch: number;
  /** rotateY, degrees. Negative turns the right edge away. */
  yaw: number;
  /** The slow breathing sway on top of the fixed angles. */
  drift: boolean;
  /** Wear the tilt all the time, not only while a timelapse plays. */
  always: boolean;
}

export const BOARD_TILT_DEFAULT: BoardTilt = { pitch: 7, yaw: -3, drift: true, always: false };
/** Unlocked well past taste: at the far end the board is a card on a desk
 * seen from across the room. The cover scale grows to match, within reason. */
export const BOARD_TILT_MAX_ANGLE = 45;

const KEY = "gtnh-factory-flow.dev.board-tilt";

/** The perspective the CSS applies; the cover scale is derived from it. */
const TILT_PERSPECTIVE_PX = 1600;
/** How far the drift sways beyond the set yaw, degrees (globals.css). */
const TILT_DRIFT_DEGREES = 2.5;
/** And how far the camera-motion breathe can lean past that (the follower
 * writes up to 4 degrees of yaw and 2.5 of pitch); the cover and the
 * visible fraction budget for the worst case. */
const TILT_BREATHE_YAW_DEGREES = 4;
const TILT_BREATHE_PITCH_DEGREES = 2.5;

const listeners = new Set<() => void>();

function clampAngle(value: number, fallback: number): number {
  return Number.isFinite(value)
    ? Math.max(-BOARD_TILT_MAX_ANGLE, Math.min(BOARD_TILT_MAX_ANGLE, value))
    : fallback;
}

function readStoredTilt(): BoardTilt {
  if (typeof window === "undefined") {
    return BOARD_TILT_DEFAULT;
  }
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) {
      return BOARD_TILT_DEFAULT;
    }
    const parsed = JSON.parse(raw) as Partial<BoardTilt>;
    return {
      pitch: clampAngle(Number(parsed.pitch), BOARD_TILT_DEFAULT.pitch),
      yaw: clampAngle(Number(parsed.yaw), BOARD_TILT_DEFAULT.yaw),
      drift: parsed.drift !== false,
      always: parsed.always === true,
    };
  } catch {
    return BOARD_TILT_DEFAULT;
  }
}

let current: BoardTilt = readStoredTilt();

export function subscribeBoardTilt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBoardTiltSnapshot(): BoardTilt {
  return current;
}

export function getServerBoardTiltSnapshot(): BoardTilt {
  return BOARD_TILT_DEFAULT;
}

export function writeBoardTilt(patch: Partial<BoardTilt>): void {
  current = {
    ...current,
    ...patch,
    ...(patch.pitch !== undefined ? { pitch: clampAngle(patch.pitch, current.pitch) } : undefined),
    ...(patch.yaw !== undefined ? { yaw: clampAngle(patch.yaw, current.yaw) } : undefined),
  };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Session-only tilt is fine.
  }
  for (const listener of listeners) {
    listener();
  }
}

/**
 * The scale that keeps the leaning plane covering the whole frame. A
 * rotated plane's far edge recedes and its projection shrinks toward the
 * centre, which is what let the canvas corners peek out from under the 2D
 * chrome. Worst case is the far corner: the top (or bottom) half-extent
 * pushed back by the pitch plus a side half-extent pushed back by the yaw
 * and the drift's extra sway, all over the CSS perspective distance. The
 * viewport half-extents are taken generously rather than measured - a few
 * spare percent of scale is invisible, a peeking corner is not.
 */
export function boardTiltCoverScale(tilt: BoardTilt): number {
  const toRadians = Math.PI / 180;
  const pitchSway = Math.abs(tilt.pitch) + TILT_BREATHE_PITCH_DEGREES;
  const pitchShrink = (Math.sin(pitchSway * toRadians) * 620) / TILT_PERSPECTIVE_PX;
  const yawSway =
    Math.abs(tilt.yaw) + (tilt.drift ? TILT_DRIFT_DEGREES : 0) + TILT_BREATHE_YAW_DEGREES;
  const yawShrink = (Math.sin(yawSway * toRadians) * 1100) / TILT_PERSPECTIVE_PX;
  const shrink = Math.min(0.55, pitchShrink + yawShrink);
  return Math.min(2.6, 1.02 / (1 - shrink));
}

/**
 * How much of the flat viewport the timelapse camera may actually PLAN
 * with while the tilt is worn, per axis.
 *
 * The shot planner works in React Flow's 2D space, but the viewer sees
 * that space through the tilt: the cover scale magnifies everything by S
 * (so only 1/S of the plane fits the frame per axis), and the lean
 * keystones the picture - the pitched-away edge is narrower, the turned
 * edge shorter - so the reliable region is the inscribed rectangle, the
 * far edge's extent, not the full frame. Planning against the plain
 * pixel size made the camera frame regions the tilt then pushed half out
 * of view. Approximate on purpose: a shot a little tighter than needed
 * still reads right, one too wide does not.
 */
export function boardTiltVisibleFraction(tilt: BoardTilt): { x: number; y: number } {
  const toRadians = Math.PI / 180;
  const cover = boardTiltCoverScale(tilt);
  // Pitch narrows the far (top or bottom) edge's WIDTH; yaw plus the
  // drift's sway shortens the far side's HEIGHT. Same generous
  // half-extents as the cover scale.
  const pitchDrop =
    Math.sin((Math.abs(tilt.pitch) + TILT_BREATHE_PITCH_DEGREES) * toRadians) * 620;
  const yawSway =
    Math.abs(tilt.yaw) + (tilt.drift ? TILT_DRIFT_DEGREES : 0) + TILT_BREATHE_YAW_DEGREES;
  const yawDrop = Math.sin(yawSway * toRadians) * 1100;
  const keystoneX = (TILT_PERSPECTIVE_PX - pitchDrop) / (TILT_PERSPECTIVE_PX + pitchDrop);
  const keystoneY = (TILT_PERSPECTIVE_PX - yawDrop) / (TILT_PERSPECTIVE_PX + yawDrop);
  // The NEAR edge leans toward the eye and magnifies, pushing content at
  // that edge clean off screen - the first cut of this function only
  // charged for the far edge shrinking, and framed shots that lost their
  // near side. Each axis pays its own near-edge magnification too.
  const nearPitch =
    TILT_PERSPECTIVE_PX / Math.max(1, TILT_PERSPECTIVE_PX - pitchDrop);
  const nearYaw = TILT_PERSPECTIVE_PX / Math.max(1, TILT_PERSPECTIVE_PX - yawDrop);
  return {
    x: Math.max(0.15, keystoneX / (cover * nearYaw)),
    y: Math.max(0.15, keystoneY / (cover * nearPitch)),
  };
}

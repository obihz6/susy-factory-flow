"use client";

import { useEffect, useRef, useState } from "react";
import { registerPanelPull } from "./flow/panel-pull";
import { getUiScale } from "@/lib/ui-scale";

/**
 * A side column as a drawer over the board, for windows too narrow to give it a
 * column of its own.
 *
 * On the desktop a closed column leaves a 26px rail behind carrying its name set
 * sideways. That rail is most of a phone's remaining board width for a word
 * nobody needs twice, so in compact mode it is replaced by this: a drawer that
 * slides in over the board, and a grab handle on the edge it came from.
 *
 * The drawer follows your finger. A tap on the handle slides it in, a drag pulls
 * it in at whatever speed you pull, and a drag back over the panel throws it out
 * again — with the release deciding, from how far it got, whether it lands open
 * or closed. That live tracking is the whole reason this is one component and not
 * two: the panel has to be on screen and moving before the gesture that opens it
 * has finished.
 */

/** How long the drawer takes to finish the job after you let go. */
const SLIDE_MS = 220;

/** Past this fraction of the panel's width, letting go lands it open. */
const COMMIT_FRACTION = 0.4;

/** Sideways travel before a touch on the panel counts as dragging it. */
const CLAIM_DISTANCE = 14;

export function PanelDrawer({
  side,
  label,
  open,
  onOpen,
  onClose,
  children,
}: {
  side: "left" | "right";
  /** What the drawer holds, for the handle's accessible name. */
  label: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrimRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setDragging] = useState(false);
  const [isSlidIn, setSlidIn] = useState(false);
  const settleTimerRef = useRef<number | undefined>(undefined);
  // A drawer often opens because a finger asked for it — tapping "what makes it"
  // on a port opens the recipe book, which lives in here. The tap that asked then
  // finishes with a synthesised click, which lands on a scrim that did not exist
  // when the finger went down, and the drawer closed again the instant it opened.
  const openedAtRef = useRef(0);
  // A touch that turned into a drag still ends with a synthesised click on
  // whatever was under the finger, which on the edge strip is the handle: the
  // drag would settle and then be re-opened by its own click.
  const draggedRef = useRef(false);

  // A frame at the closed position first, then the class that slides it in, or
  // there is nothing to transition from and the panel simply appears where it was
  // going. Closing resets it while the panel is already unmounted, ready for the
  // next time.
  useEffect(() => {
    if (open) {
      openedAtRef.current = performance.now();
    }
    const frame = requestAnimationFrame(() => setSlidIn(open));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => () => window.clearTimeout(settleTimerRef.current), []);

  // A drag holds the panel on screen past the moment it closes, which is what
  // gives the throw-it-out gesture and the tap-the-board dismissal their slide.
  // A close from a button inside the panel has no gesture behind it and leaves at
  // once; it is the one exit that does not animate.
  const isMounted = open || isDragging;
  const closedTranslate = side === "left" ? "-100% 0" : "100% 0";

  /**
   * How wide the panel is, or will be. Measured when it is on screen; when the
   * drag that will mount it has only just started, worked out from the same
   * `min(88vw, …)` the class below sets, since a React state change cannot mount
   * the element before this event handler needs its width.
   */
  const getPanelWidth = () =>
    panelRef.current?.offsetWidth ||
    // Shell pixels, like offsetWidth: the document's width is real pixels.
    Math.min((document.documentElement.clientWidth / getUiScale()) * 0.88, side === "left" ? 256 : 234);

  /**
   * Live during a drag: 0 fully closed, 1 fully open.
   *
   * Written to `translate`, not `transform`, because that is the property
   * Tailwind's own `-translate-x-full` sets — and the two COMPOSE, so a transform
   * of -187px on a class already holding the panel a full width off screen put it
   * two widths out instead of under the finger.
   */
  const paint = (progress: number) => {
    const panel = panelRef.current;
    if (panel) {
      panel.style.transition = "none";
      const hidden = (1 - progress) * getPanelWidth();
      panel.style.translate = `${side === "left" ? -hidden : hidden}px 0`;
    }
    const scrim = scrimRef.current;
    if (scrim) {
      scrim.style.transition = "none";
      scrim.style.opacity = String(progress);
    }
  };

  /** The release: run the rest of the way to whichever end won. */
  const settle = (opened: boolean) => {
    const panel = panelRef.current;
    if (panel) {
      panel.style.transition = `translate ${SLIDE_MS}ms ease-out`;
      panel.style.translate = opened ? "0px 0" : closedTranslate;
    }
    const scrim = scrimRef.current;
    if (scrim) {
      scrim.style.transition = `opacity ${SLIDE_MS}ms ease-out`;
      scrim.style.opacity = opened ? "1" : "0";
    }

    // The inline styles hand back to the resting classes once they agree on the
    // same position, which is why this fires the state change now and the
    // handover after the animation.
    if (opened) {
      onOpen();
    } else if (open) {
      onClose();
    }

    window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      const settled = panelRef.current;
      if (settled) {
        settled.style.transition = "";
        settled.style.translate = "";
      }
      const settledScrim = scrimRef.current;
      if (settledScrim) {
        settledScrim.style.transition = "";
        settledScrim.style.opacity = "";
      }
      draggedRef.current = false;
      setDragging(false);
    }, SLIDE_MS);
  };

  const startDrag = () => {
    draggedRef.current = true;
    setDragging(true);
  };

  // The same pull, driven from the board's own touch layer: a swipe from anywhere
  // down this side of the board opens the drawer, and the drawer still follows the
  // finger. See panel-pull.ts for why it is a registry and not a prop.
  useEffect(
    () =>
      registerPanelPull(side, {
        start: startDrag,
        move: (travelled) => paint(Math.min(1, travelled / getPanelWidth())),
        end: (travelled) => settle(travelled > getPanelWidth() * COMMIT_FRACTION),
      }),
    // Re-registered on every render: the three closures read state that changes,
    // and the registry only ever holds the latest.
  );

  // Pulling the drawer OUT, from the strip down the edge of the board.
  useSlideGesture({
    elementRef: stripRef,
    enabled: !open,
    // Inwards: rightwards from the left edge, leftwards from the right one.
    towards: side === "left" ? 1 : -1,
    claimAtOnce: true,
    getWidth: getPanelWidth,
    onStart: startDrag,
    onMove: (travelled, width) => paint(Math.min(1, travelled / width)),
    onEnd: (travelled, width) => settle(travelled > width * COMMIT_FRACTION),
  });

  // Throwing it back out again, from anywhere on the panel.
  useSlideGesture({
    elementRef: panelRef,
    enabled: open,
    towards: side === "left" ? -1 : 1,
    claimAtOnce: false,
    getWidth: getPanelWidth,
    onStart: startDrag,
    onMove: (travelled, width) => paint(Math.max(0, 1 - travelled / width)),
    onEnd: (travelled, width) => settle(travelled < width * COMMIT_FRACTION),
  });

  // And from the board behind it. With a drawer up, the only thing the board can
  // be asked for is to put it away, so every part of the screen answers: a tap
  // anywhere, or a swipe anywhere, in any direction that means "away".
  useSlideGesture({
    elementRef: scrimRef,
    enabled: open,
    towards: side === "left" ? -1 : 1,
    claimAtOnce: true,
    getWidth: getPanelWidth,
    onStart: startDrag,
    onMove: (travelled, width) => paint(Math.max(0, 1 - travelled / width)),
    onEnd: (travelled, width) => settle(travelled < width * COMMIT_FRACTION),
  });

  return (
    <>
      {isMounted ? (
        <div
          ref={scrimRef}
          className={[
            "absolute inset-0 z-40 bg-black/50 transition-opacity duration-200",
            isSlidIn ? "opacity-100" : "opacity-0",
          ].join(" ")}
          // A tap on the board behind is the dismissal everyone tries first, and
          // it goes out through the same settle the gestures use so it slides
          // rather than blinks. Not a <button>: it wraps nothing and names
          // nothing, and a full-screen button in the tab order ahead of the panel
          // is a trap.
          onClick={() => {
            if (performance.now() - openedAtRef.current < 400) {
              return;
            }
            startDrag();
            settle(false);
          }}
          aria-hidden
        />
      ) : null}
      {isMounted ? (
        <div
          ref={panelRef}
          className={[
            "absolute inset-y-0 z-50 flex flex-col overflow-hidden shadow-[0_0_32px_rgba(0,0,0,0.6)]",
            // While a finger owns it the transform is written frame by frame, so
            // a transition here would lag behind the finger by its own duration.
            isDragging ? "transition-none" : "transition-transform duration-200 ease-out",
            // 256 and 234 are the columns' desktop widths; a phone gets as much
            // of that as it can spare while still showing the board behind.
            side === "left"
              ? "left-0 w-[min(calc(88*var(--ui-vw)),256px)]"
              : "right-0 w-[min(calc(88*var(--ui-vw)),234px)]",
            isSlidIn ? "translate-x-0" : side === "left" ? "-translate-x-full" : "translate-x-full",
          ].join(" ")}
        >
          {children}
        </div>
      ) : null}
      {open ? null : (
        // The strip is the swipe zone: a band down the middle of the edge, so the
        // gesture has somewhere to land without having to hit the tab exactly,
        // while the corners stay clear for the board's own toolbars and the help
        // button. `touch-none` keeps the board underneath from panning along with
        // the drag. Only the visible tab is a tap target — an invisible button
        // down each side of the board would swallow drags aimed at the canvas.
        <div
          ref={stripRef}
          className={[
            "absolute top-1/2 z-30 h-48 w-6 -translate-y-1/2 touch-none",
            side === "left" ? "left-0" : "right-0",
          ].join(" ")}
        >
          <button
            type="button"
            onClick={() => {
              if (draggedRef.current) {
                return;
              }
              onOpen();
            }}
            title={`Show ${label}`}
            aria-label={`Show ${label}`}
            className={[
              "absolute top-1/2 flex h-16 w-6 -translate-y-1/2 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)]",
              side === "left" ? "left-0" : "right-0",
            ].join(" ")}
          >
            <ChevronIcon direction={side === "left" ? "right" : "left"} />
          </button>
        </div>
      )}
    </>
  );
}

/** Which way a column opens: the mark on its rail, its handle and its buttons. */
export function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {direction === "right" ? <path d="M6 3l5 5-5 5" /> : <path d="M10 3L5 8l5 5" />}
    </svg>
  );
}

/**
 * One finger, dragging a panel one way.
 *
 * Native listeners rather than React's props because `touchmove` has to be
 * non-passive: once the drag is claimed it calls preventDefault, which is what
 * stops the panel's own list from scrolling underneath the gesture and what stops
 * a phone treating the same movement as a page swipe.
 *
 * `onMove` reports distance travelled in the wanted direction, never negative and
 * never past the panel's width, so callers do not have to think about signs.
 */
function useSlideGesture({
  elementRef,
  getWidth,
  enabled,
  towards,
  claimAtOnce,
  onStart,
  onMove,
  onEnd,
}: {
  elementRef: React.RefObject<HTMLElement | null>;
  /** The panel's width: what a drag is measured against. */
  getWidth: () => number;
  enabled: boolean;
  /** 1 for rightwards, -1 for leftwards. */
  towards: 1 | -1;
  /**
   * True on the edge strip, which exists for this gesture and nothing else, so
   * the first move claims it. False on the panel, where a touch is far more
   * likely to be a scroll and has to prove otherwise.
   */
  claimAtOnce: boolean;
  onStart: () => void;
  onMove: (travelled: number, width: number) => void;
  onEnd: (travelled: number, width: number) => void;
}) {
  // Handlers are re-read from a ref on each event, so the listeners can be
  // attached once per element rather than re-bound on every render. Refreshed in
  // an effect, not during the render that made them: the listeners only ever read
  // this from inside an event, long after any render has committed.
  const handlers = useRef({ onStart, onMove, onEnd, towards, claimAtOnce, getWidth });
  useEffect(() => {
    handlers.current = { onStart, onMove, onEnd, towards, claimAtOnce, getWidth };
  });

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !enabled) {
      return undefined;
    }

    let start: { x: number; y: number } | undefined;
    let claimed = false;
    let travelled = 0;
    let width = 1;

    const panelWidth = () => Math.max(1, handlers.current.getWidth());

    const handleStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || event.touches.length > 1) {
        start = undefined;
        return;
      }
      // A touch that begins inside something scrollable sideways belongs to that
      // thing: NEI recipe cards and the like are wider than this column.
      if (scrollsSideways(event.target, element)) {
        start = undefined;
        return;
      }
      start = { x: touch.clientX, y: touch.clientY };
      claimed = false;
      travelled = 0;
      width = panelWidth();
    };

    const handleMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!start || !touch) {
        return;
      }

      // Real-pixel travel, spent as a shell-pixel translate: divided by the
      // interface scale so the panel stays under the finger.
      const scale = getUiScale();
      const dx = ((touch.clientX - start.x) / scale) * handlers.current.towards;
      const dy = (touch.clientY - start.y) / scale;
      if (!claimed) {
        // Backwards, or mostly vertical: someone is scrolling the panel.
        if (dx < (handlers.current.claimAtOnce ? 1 : CLAIM_DISTANCE)) {
          if (dx < -CLAIM_DISTANCE || Math.abs(dy) > CLAIM_DISTANCE) {
            start = undefined;
          }
          return;
        }
        if (Math.abs(dy) > Math.abs(dx)) {
          start = undefined;
          return;
        }
        claimed = true;
        width = panelWidth();
        handlers.current.onStart();
      }

      event.preventDefault();
      travelled = Math.min(width, Math.max(0, dx));
      handlers.current.onMove(travelled, width);
    };

    const handleEnd = () => {
      if (!start || !claimed) {
        start = undefined;
        return;
      }
      start = undefined;
      claimed = false;
      handlers.current.onEnd(travelled, width);
    };

    element.addEventListener("touchstart", handleStart, { passive: true });
    element.addEventListener("touchmove", handleMove, { passive: false });
    element.addEventListener("touchend", handleEnd);
    element.addEventListener("touchcancel", handleEnd);
    return () => {
      element.removeEventListener("touchstart", handleStart);
      element.removeEventListener("touchmove", handleMove);
      element.removeEventListener("touchend", handleEnd);
      element.removeEventListener("touchcancel", handleEnd);
    };
    // `enabled` flips when the drawer opens or closes, which is exactly when the
    // element these listeners belong on is replaced.
  }, [elementRef, enabled]);
}

/** Whether anything between `target` and `boundary` scrolls horizontally. */
function scrollsSideways(target: EventTarget | null, boundary: Element): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== boundary) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const overflowX = window.getComputedStyle(node).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") {
        return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}

"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { isTouchPointer } from "@/lib/pointer-kind";

/**
 * Marks an element that turns the wheel into its own state change rather than
 * scrolling: it stays put, so a tooltip over it stays too.
 */
export const WHEEL_STEPS_IN_PLACE_ATTRIBUTE = "data-tooltip-wheel-steps";


export function MinecraftTooltip({
  label,
  content,
  children,
}: {
  label?: string | string[];
  /**
   * Rich panel body; wins over `label` and brings its own typography. Pass a
   * THUNK when the body is expensive to build: it is invoked only while the
   * tooltip is actually open, so a card with eight port tooltips does not
   * build eight discarded panels on every render.
   */
  content?: ReactNode | (() => ReactNode);
  children: ReactNode;
}) {
  const lines = useMemo(
    () => (Array.isArray(label) ? label : label ? label.split("\n") : []),
    [label],
  );
  const hasContent = content !== undefined && content !== null;
  const [position, setPosition] = useState<{ x: number; y: number } | undefined>();
  const frameRef = useRef<number | undefined>(undefined);
  const pendingPositionRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const pointerRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  useEffect(
    () => () => {
      if (frameRef.current !== undefined) {
        window.cancelAnimationFrame(frameRef.current);
      }
    },
    [],
  );

  // A press on one of the hover surface's OWN controls (the tier chip, the
  // hatch counter) is the tooltip's subject being used, not the pointer
  // leaving: the panel stays up and re-reads itself, so clicking through
  // tiers shows each result without re-hovering. Presses anywhere else —
  // panning, dragging, other cards — still clear.
  const pressKeepsTooltip = useCallback(
    (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      rootRef.current?.contains(target) === true &&
      target.closest("button, input, select, textarea") !== null,
    [],
  );

  const clampToViewport = useCallback(
    (pointerX: number, pointerY: number) => {
      const panelWidth = panelRef.current?.offsetWidth ?? (hasContent ? 340 : 320);
      const panelHeight = panelRef.current?.offsetHeight ?? (hasContent ? 240 : 80);
      return {
        x: Math.max(4, Math.min(pointerX + 12, window.innerWidth - panelWidth - 8)),
        y: Math.max(4, Math.min(pointerY + 12, window.innerHeight - panelHeight - 8)),
      };
    },
    [hasContent],
  );

  // The first placement of a fresh tooltip clamps against an ESTIMATED panel
  // size, and near a screen edge the estimate lands the panel a hundred-odd
  // pixels from where the measured clamp will. Re-clamping here, before the
  // browser paints, means nobody ever sees the estimate's position - which
  // used to read as the tooltip jittering sideways while the pointer crossed
  // list rows, each row remounting the panel at the estimate first.
  useLayoutEffect(() => {
    const pointer = pointerRef.current;
    if (!position || !pointer || !panelRef.current) {
      return;
    }
    const corrected = clampToViewport(pointer.x, pointer.y);
    if (Math.abs(corrected.x - position.x) >= 2 || Math.abs(corrected.y - position.y) >= 2) {
      setPosition(corrected);
    }
  }, [clampToViewport, position]);

  const handleMouseMove = (event: MouseEvent) => {
    if (lines.length === 0 && !hasContent) {
      return;
    }

    // A finger has no hover to answer, and no way to stop hovering.
    if (isTouchPointer()) {
      clearTooltip();
      return;
    }

    // Tooltips nest: a row-wide reveal can hold buttons with their own
    // tips. Whoever is CLOSEST to the pointer owns it — an outer tooltip
    // yields (and hides) over any inner tooltip region or anything marked
    // data-tooltip-stop (tag chips, editors).
    const owner = (event.target as HTMLElement | null)?.closest(
      "[data-tooltip-root], [data-tooltip-stop]",
    );
    if (owner && owner !== rootRef.current) {
      clearTooltip();
      return;
    }

    if (event.buttons !== 0 && !pressKeepsTooltip(event.target)) {
      pendingPositionRef.current = undefined;
      if (position !== undefined) {
        setPosition(undefined);
      }
      return;
    }

    // Clamp to the measured panel so wide or tall tooltips stay fully on
    // screen; before the first paint we fall back to a generous estimate,
    // and the layout effect below re-clamps against the real size before
    // anything is painted.
    pointerRef.current = { x: event.clientX, y: event.clientY };
    pendingPositionRef.current = clampToViewport(event.clientX, event.clientY);

    if (frameRef.current !== undefined) {
      return;
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = undefined;
      const nextPosition = pendingPositionRef.current;
      if (!nextPosition) {
        return;
      }

      setPosition((currentPosition) =>
        currentPosition &&
        Math.abs(currentPosition.x - nextPosition.x) < 2 &&
        Math.abs(currentPosition.y - nextPosition.y) < 2
          ? currentPosition
          : nextPosition,
      );
    });
  };

  const clearTooltip = useCallback(() => {
    pendingPositionRef.current = undefined;
    if (frameRef.current !== undefined) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
    }
    if (position !== undefined) {
      setPosition(undefined);
    }
  }, [position]);

  useEffect(() => {
    if (!position) {
      return undefined;
    }

    const clearOnInteraction = () => clearTooltip();
    const clearOnPointerDown = (event: Event) => {
      if (pressKeepsTooltip(event.target)) {
        return;
      }
      clearTooltip();
    };
    // Capture-phase "blur" sees every ELEMENT losing focus, and clicking the
    // chip under the tooltip blurs whatever held focus before it — only the
    // window itself going unfocused means the pointer story ended. Told apart
    // by the target's kind, not identity: an element's blur names the element,
    // the window's names the window.
    const clearOnWindowBlur = (event: Event) => {
      if (event.target instanceof Element) {
        return;
      }
      clearTooltip();
    };
    // A wheel normally scrolls the thing out from under the pointer, so the tip
    // has to go with it. A slot that rotates through what it accepts is the
    // exception: it EATS the wheel to step through its items and never moves, so
    // clearing there made the tip blink out on every notch, exactly while you
    // were reading which item you had landed on. Marked slots keep theirs, and
    // it re-labels itself as the slot steps.
    const clearOnWheel = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest?.(`[${WHEEL_STEPS_IN_PLACE_ATTRIBUTE}]`) &&
        rootRef.current?.contains(target)
      ) {
        return;
      }
      clearTooltip();
    };
    const options = { capture: true, passive: true } as const;

    window.addEventListener("wheel", clearOnWheel, options);
    window.addEventListener("pointerdown", clearOnPointerDown, options);
    window.addEventListener("pointercancel", clearOnInteraction, options);
    window.addEventListener("resize", clearOnInteraction, options);
    window.addEventListener("blur", clearOnWindowBlur, options);
    return () => {
      window.removeEventListener("wheel", clearOnWheel, options);
      window.removeEventListener("pointerdown", clearOnPointerDown, options);
      window.removeEventListener("pointercancel", clearOnInteraction, options);
      window.removeEventListener("resize", clearOnInteraction, options);
      window.removeEventListener("blur", clearOnWindowBlur, options);
    };
  }, [clearTooltip, position, pressKeepsTooltip]);

  return (
    <span
      ref={rootRef}
      data-tooltip-root=""
      className="contents"
      onMouseEnter={handleMouseMove}
      onMouseMove={handleMouseMove}
      onMouseLeave={clearTooltip}
    >
      {children}
      {position && (lines.length > 0 || hasContent) && typeof document !== "undefined"
        ? createPortal(
            hasContent ? (
              <div
                ref={panelRef}
                data-minecraft-tooltip="true"
                className="pointer-events-none fixed z-[9999] max-w-[640px] border-2 border-[#2a005f] bg-[#100010] px-3 py-2.5 text-white shadow-[inset_1px_1px_0_rgba(255,255,255,0.18),inset_-1px_-1px_0_rgba(0,0,0,0.8)]"
                style={{ left: position.x, top: position.y }}
              >
                {typeof content === "function" ? content() : content}
              </div>
            ) : (
              <div
                ref={panelRef}
                data-minecraft-tooltip="true"
                // w-max, and 420 rather than 340: a fixed panel with no width
                // of its own is squeezed by whatever room is left to the
                // viewport's edge, so a one-line label near the right side of
                // the screen shrink-wrapped and broke its last word onto a line
                // of its own. Asking for max-content makes the panel state its
                // real width; the pointer clamp above reads that width back and
                // walks it inside the edge.
                className="pointer-events-none fixed z-[9999] w-max max-w-[420px] border-2 border-[#2a005f] bg-[#100010] px-2 py-1 font-mono text-[16px] leading-[19px] text-white shadow-[inset_1px_1px_0_rgba(255,255,255,0.18),inset_-1px_-1px_0_rgba(0,0,0,0.8)] [text-shadow:2px_2px_0_#3f3f3f]"
                style={{ left: position.x, top: position.y }}
              >
                {lines.map((line, index) => (
                  <div
                    key={`${line}-${index}`}
                    className={index === 0 ? "text-white" : "text-[#aaaaff]"}
                  >
                    {line}
                  </div>
                ))}
              </div>
            ),
            document.body,
          )
        : null}
    </span>
  );
}

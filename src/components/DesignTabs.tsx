"use client";

import { Compass } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EntryIcon } from "@/lib/model/types";
import { FLUID_ICON_SCALE, ResourceIcon } from "./nei/ResourceIcon";
import {
  closeWelcomeTab,
  leaveWelcomeTab,
  openWelcomeTab,
  useWelcomeTab,
} from "@/lib/tour/welcome-tab";
import { useDesignStore } from "@/store/design-store";
import { useSolvingBooks } from "@/components/flow/use-solving-books";

// Wide enough for the longest item on one line ("Close tabs to right"); the
// menu clips rather than wraps, so this and the labels move together.
const MENU_WIDTH = 230;

/** Asymptote of the rubber stretch past either end, in px — the saturating
 * resistance curve approaches it and never quite arrives. */
const RUBBER_MAX = 24;

/** Which destructive item is one click from firing, if any. */
type ArmedAction = "delete" | "right" | "left" | "others";

interface OpenMenu {
  id: string;
  name: string;
  /** Viewport coordinates of the trigger, for the fixed-position menu. */
  left: number;
  top: number;
}

export function DesignTabs() {
  const designs = useDesignStore((state) => state.designs);
  const activeDesignId = useDesignStore((state) => state.activeDesignId);
  const isHydrated = useDesignStore((state) => state.isHydrated);
  const saveState = useDesignStore((state) => state.saveState);
  const switchToDesign = useDesignStore((state) => state.switchToDesign);
  const addDesign = useDesignStore((state) => state.addDesign);
  const copyDesign = useDesignStore((state) => state.copyDesign);
  const renameDesign = useDesignStore((state) => state.renameDesign);
  const removeDesign = useDesignStore((state) => state.removeDesign);
  const removeDesigns = useDesignStore((state) => state.removeDesigns);
  const reorderDesigns = useDesignStore((state) => state.reorderDesigns);
  const welcome = useWelcomeTab();

  const [renamingId, setRenamingId] = useState<string>();
  const [openMenu, setOpenMenu] = useState<OpenMenu>();
  const [armed, setArmed] = useState<ArmedAction>();
  const [overflow, setOverflow] = useState({ left: false, right: false });
  // The tab being dragged, if any. Order changes are previewed with pure
  // transforms — no re-render happens until the drop commits.
  const [draggingId, setDraggingId] = useState<string>();
  // A drag ends with the browser still delivering the click that started it;
  // this keeps that click from also switching tabs.
  const suppressClickRef = useRef(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const closeMenu = () => {
    setOpenMenu(undefined);
    setArmed(undefined);
  };

  const syncOverflow = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }

    const maxScroll = scroller.scrollWidth - scroller.clientWidth;
    setOverflow((previous) => {
      const next = {
        // A pixel of slack: fractional widths otherwise leave a fade lit with
        // nowhere left to scroll.
        left: scroller.scrollLeft > 1,
        right: scroller.scrollLeft < maxScroll - 1,
      };
      // Scrolling fires this per frame; same answer, same object, no render.
      return next.left === previous.left && next.right === previous.right ? previous : next;
    });
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const track = trackRef.current;
    if (!scroller || !track || typeof ResizeObserver === "undefined") {
      return;
    }

    // Both ends matter: the scroller changes width when the window resizes, the
    // track when a design is added or renamed. Observing fires immediately, so
    // this doubles as the initial measurement.
    const observer = new ResizeObserver(syncOverflow);
    observer.observe(scroller);
    observer.observe(track);
    return () => observer.disconnect();
    // isHydrated: before hydration this component renders a bare placeholder,
    // so a mount-time effect finds no scroller and must run again once the
    // real strip is up.
  }, [syncOverflow, isHydrated]);

  // Switching to a design that sits off-screen should bring it into view rather
  // than leaving the strip looking unchanged.
  useEffect(() => {
    if (!activeDesignId) {
      return;
    }

    scrollerRef.current
      ?.querySelector(`[data-design-id="${CSS.escape(activeDesignId)}"]`)
      ?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [activeDesignId]);

  // The strip is the one horizontal scroller under a vertical wheel, so plain
  // wheel input walks the tabs. Attached natively: React registers wheel
  // listeners passively, and a passive listener cannot claim the gesture, so
  // the page would rubber-band instead of the tabs moving.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }

    // ONE motion engine, not the browser's smooth scroll plus a separate
    // band. Wheel input moves a virtual TARGET that is allowed past the ends
    // (rubber-damped); each frame the position eases towards it, the in-range
    // part renders as scrollLeft and the out-of-range part as a translate of
    // the track. So the glide, the stretch at the wall and the spring back
    // are a single continuous curve — the strip arrives at the end and flows
    // straight into the bounce instead of stopping and then twitching.
    let pos: number | undefined;
    let target = 0;
    /** Raw unspent pull past the end; rendered through `rubber`. */
    let excess = 0;
    let lastWheelAt = 0;
    let frame = 0;

    /** Saturating resistance: early pull shows, hard pull barely adds. */
    const rubber = (pull: number) =>
      Math.sign(pull) * RUBBER_MAX * (Math.abs(pull) / (Math.abs(pull) + 120));

    const settle = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      pos = undefined;
      excess = 0;
      const track = trackRef.current;
      if (track) {
        track.style.transform = "";
      }
    };

    const tick = (now: number) => {
      const track = trackRef.current;
      if (!track || pos === undefined) {
        settle();
        return;
      }

      const maxScroll = scroller.scrollWidth - scroller.clientWidth;
      // Once the wheel has gone quiet the pull relaxes, which is what brings
      // the stretch home — same easing, opposite direction, no timer cliff.
      if (now - lastWheelAt > 90) {
        excess *= 0.82;
        if (Math.abs(excess) < 0.5) {
          excess = 0;
        }
      }

      const goal = Math.max(0, Math.min(maxScroll, target)) + rubber(excess);
      pos += (goal - pos) * 0.18;

      const inRange = Math.max(0, Math.min(maxScroll, pos));
      scroller.scrollLeft = inRange;
      const over = pos - inRange;
      track.style.transform = Math.abs(over) > 0.1 ? `translateX(${-over}px)` : "";

      if (Math.abs(goal - pos) < 0.4 && excess === 0 && Math.abs(over) < 0.4) {
        scroller.scrollLeft = Math.max(0, Math.min(maxScroll, target));
        settle();
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    const onWheel = (event: WheelEvent) => {
      if (scroller.scrollWidth <= scroller.clientWidth) {
        return;
      }
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (delta === 0) {
        return;
      }
      event.preventDefault();
      // Line-mode deltas (some mice on Firefox) arrive in rows, not pixels.
      const pixels = event.deltaMode === 1 ? delta * 16 : delta;
      const maxScroll = scroller.scrollWidth - scroller.clientWidth;

      if (pos === undefined) {
        pos = scroller.scrollLeft;
        target = pos;
      }
      const raw = target + excess + pixels;
      target = Math.max(0, Math.min(maxScroll, raw));
      // What the clamp swallowed keeps pulling, capped so a long grind at the
      // wall cannot bank a launch. Signed like scroll: positive past the right.
      excess = Math.max(-400, Math.min(400, raw - target));
      lastWheelAt = performance.now();

      if (!frame) {
        frame = requestAnimationFrame(tick);
      }
    };

    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      scroller.removeEventListener("wheel", onWheel);
      settle();
    };
    // isHydrated: same as the observer above — no scroller exists at mount.
  }, [isHydrated]);

  /**
   * Mouse-and-pen drag to rearrange. Past a small threshold the press becomes
   * a drag; from there the held pill rides the pointer as a transform while
   * the pills it passes slide aside on a transition — the DOM order never
   * changes mid-drag, so nothing jumps. The drop clears the transforms and
   * commits the order in the same breath, which React re-renders before the
   * next paint. Touch keeps its meaning — this same motion is how a finger
   * scrolls the strip.
   *
   * All geometry lives in TRACK space (positions captured once at drag start,
   * the pointer re-based against the track's live rect), so the strip
   * auto-scrolling under the drag does not put the numbers out.
   */
  const beginTabDrag = (event: React.PointerEvent, id: string) => {
    if (event.button !== 0 || event.pointerType === "touch" || renamingId) {
      return;
    }

    const track = trackRef.current;
    if (!track) {
      return;
    }

    const startClientX = event.clientX;
    let started = false;

    interface Slot {
      id: string;
      el: HTMLElement;
      /** Resting centre, track space. */
      mid: number;
    }
    let slots: Slot[] = [];
    let dragged: Slot | undefined;
    let startIndex = 0;
    let targetIndex = 0;
    /** How far a displaced neighbour slides: the held pill's footprint. */
    let step = 0;
    /** Half the held pill: its leading edge is what asks neighbours to move. */
    let reach = 0;
    let startTrackX = 0;
    let trackWidth = 0;
    let lastClientX = startClientX;
    let frame = 0;

    const trackX = (clientX: number) => clientX - track.getBoundingClientRect().left;

    /**
     * Re-derives everything from the last known pointer position. Called from
     * pointermove AND once per animation frame: while the strip auto-scrolls
     * under a parked pointer no pointermove fires, and without this the pill
     * and the displacement stop dead until the hand twitches.
     */
    const update = () => {
      if (!dragged) {
        return;
      }

      // Clamped inside the strip: past the last slot the pill has nowhere
      // truer to go, and pinning it there says so better than letting it
      // sail off over the Welcome tab or the + button.
      const dx = Math.max(
        -(dragged.mid - reach),
        Math.min(trackWidth - (dragged.mid + reach), trackX(lastClientX) - startTrackX),
      );
      dragged.el.style.transform = `translateX(${dx}px)`;

      // Where the held pill sits, against RESTING midpoints — the DOM never
      // reorders mid-drag, so they stay true. A neighbour yields as soon as
      // the pill's LEADING EDGE reaches its middle, not when centre passes
      // centre: each slot's threshold moves `reach` towards the held pill, so
      // tabs step aside early instead of waiting to be fully overlapped.
      const centre = dragged.mid + dx;
      let index = 0;
      for (const slot of slots) {
        if (slot === dragged) {
          continue;
        }
        const threshold = slot.mid > dragged.mid ? slot.mid - reach : slot.mid + reach;
        if (centre > threshold) {
          index += 1;
        }
      }
      targetIndex = index;
      slots.forEach((slot, position) => {
        if (slot === dragged) {
          return;
        }
        const shift =
          position > startIndex && position <= targetIndex
            ? -step
            : position < startIndex && position >= targetIndex
              ? step
              : 0;
        slot.el.style.transform = shift ? `translateX(${shift}px)` : "";
      });
    };

    /**
     * Holding the pill against either end walks the strip along, faster the
     * deeper into the zone, for as long as the hand stays there. Runs on
     * frames, not pointer events, so a parked pointer keeps scrolling; the
     * update() after it re-anchors the pill so it stays under the hand.
     */
    const autoScrollTick = () => {
      const scroller = scrollerRef.current;
      if (scroller && scroller.scrollWidth > scroller.clientWidth) {
        const rect = scroller.getBoundingClientRect();
        const zone = 40;
        if (lastClientX < rect.left + zone) {
          const depth = Math.min(1, (rect.left + zone - lastClientX) / zone);
          scroller.scrollLeft -= 3 + depth * 9;
        } else if (lastClientX > rect.right - zone) {
          const depth = Math.min(1, (lastClientX - (rect.right - zone)) / zone);
          scroller.scrollLeft += 3 + depth * 9;
        }
      }
      update();
      frame = requestAnimationFrame(autoScrollTick);
    };

    const move = (moveEvent: PointerEvent) => {
      lastClientX = moveEvent.clientX;
      if (!started) {
        if (Math.abs(moveEvent.clientX - startClientX) < 5) {
          return;
        }
        started = true;
        suppressClickRef.current = true;
        closeMenu();
        setDraggingId(id);

        const trackRect = track.getBoundingClientRect();
        startTrackX = startClientX - trackRect.left;
        trackWidth = trackRect.width;
        const rects = [...track.querySelectorAll<HTMLElement>("[data-design-id]")].map((el) => ({
          el,
          rect: el.getBoundingClientRect(),
        }));
        slots = rects.map(({ el, rect }) => ({
          id: el.dataset.designId ?? "",
          el,
          mid: rect.left - trackRect.left + rect.width / 2,
        }));
        startIndex = slots.findIndex((slot) => slot.id === id);
        targetIndex = startIndex;
        dragged = slots[startIndex];
        const neighbour = rects[startIndex + 1] ?? rects[startIndex - 1];
        step = neighbour
          ? Math.abs(neighbour.rect.left - rects[startIndex].rect.left)
          : rects[startIndex].rect.width;
        reach = rects[startIndex].rect.width / 2;

        for (const slot of slots) {
          if (slot === dragged) {
            // Above its displaced neighbours while it rides the pointer.
            slot.el.style.zIndex = "5";
            slot.el.style.position = "relative";
          } else {
            slot.el.style.transition = "transform 160ms ease";
          }
        }
        frame = requestAnimationFrame(autoScrollTick);
      }
      update();
    };

    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      cancelAnimationFrame(frame);
      if (started && dragged) {
        const order = slots.filter((slot) => slot !== dragged).map((slot) => slot.id);
        order.splice(targetIndex, 0, id);
        // Styles off and order committed in one task: React flushes the new
        // order before the browser paints, so the pills go straight from
        // their translated positions to their new slots.
        for (const slot of slots) {
          slot.el.style.transform = "";
          slot.el.style.transition = "";
          slot.el.style.zIndex = "";
          slot.el.style.position = "";
        }
        void reorderDesigns(order);
      }
      setDraggingId(undefined);
      // The suppressed click is delivered before timers run, so this frees the
      // NEXT click, not the one that ended the drag.
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  if (!isHydrated) {
    return <div className="h-8 shrink-0 border-b border-line bg-surface" />;
  }

  return (
    <>
      {/*
        Only the tab list scrolls. The actions sit outside it because an
        `overflow` container clips absolutely-positioned children, which is what
        was hiding the export menu when this bar was one scrolling row.
      */}
      <div
        data-help-anchor="tabs"
        // h-8, not the 44px this bar used to run: a tab's name is 12px text in
        // a 24px pill, so the row was carrying 20px of nothing above and below
        // it. The board gets the difference.
        className="flex h-8 min-w-0 shrink-0 items-center gap-1 border-b border-line bg-surface px-2"
      >
        {/*
          Welcome rides at the head of the strip and outside the scroller, so it
          never scrolls out of reach. It is not a design: it covers the board
          rather than switching what is on it, which is why the design tabs read
          their active state off `welcome.active` too - exactly one tab in this
          row can look current.
        */}
        {welcome.open ? (
          <div
            data-tour-anchor="welcome-tab"
            className={[
              "group flex h-6 shrink-0 items-center rounded-t border-b-2 pl-2 pr-1",
              welcome.active
                ? "border-cyan-500 bg-surface-raised text-fg"
                : "border-transparent text-fg-muted hover:bg-surface-sunken hover:text-fg",
            ].join(" ")}
          >
            <button
              type="button"
              onClick={openWelcomeTab}
              title="Welcome"
              className="flex items-center gap-1 text-xs font-medium"
            >
              <Compass className="h-3 w-3" aria-hidden />
              Welcome
            </button>
            <button
              type="button"
              onClick={closeWelcomeTab}
              aria-label="Close the Welcome tab"
              title="Close tab"
              className="ml-1 rounded px-1 text-xs text-fg-muted opacity-0 hover:bg-surface hover:text-fg focus:opacity-100 group-hover:opacity-100"
            >
              ✕
            </button>
          </div>
        ) : null}

        {/*
          Sized to its tabs (`shrink`), not to the whole bar (`flex-1`): with a
          couple of designs the strip is only as wide as they are, so the `+`
          sits against the last tab instead of being stranded at the far right.
          Once the tabs outgrow the bar it shrinks and scrolls instead.

          More-tabs-this-way is said with edge FADES, not buttons: they overlay
          the strip's ends, always mounted and only changing opacity, so the
          row never shifts when one lights up. (The arrows this replaces popped
          in and out of the flex row, walking every tab sideways each time.)
          Scrolling itself already has the wheel, the trackpad, a finger, and
          dragging a tab against either end.
        */}
        <div className="relative min-w-0 shrink">
          <div
            ref={scrollerRef}
            onScroll={syncOverflow}
            className="no-scrollbar min-w-0 overflow-x-auto"
          >
          <nav
            ref={trackRef}
            aria-label="Designs"
            className="flex w-max select-none items-center gap-1"
          >
            {designs.map((design, index) => {
              const isActive = design.id === activeDesignId && !welcome.active;

              return (
                <Fragment key={design.id}>
                  {/* A faint seam between neighbours: names alone run together
                      once a few tabs sit side by side. Hidden while a drag is
                      on: the pills slide with transforms and the seams do not,
                      so mid-drag they would sit in the wrong gaps. */}
                  {index > 0 ? (
                    <span
                      aria-hidden
                      className={[
                        "h-3.5 w-px shrink-0 bg-line transition-opacity",
                        draggingId ? "opacity-0" : "",
                      ].join(" ")}
                    />
                  ) : null}
                <div
                  data-design-id={design.id}
                  onPointerDown={(event) => beginTabDrag(event, design.id)}
                  className={[
                    "group flex h-6 shrink-0 items-center rounded-t border-b-2 pl-2 pr-1",
                    isActive
                      ? "border-cyan-500 bg-surface-raised text-fg"
                      : "border-transparent text-fg-muted hover:bg-surface-sunken hover:text-fg",
                    draggingId === design.id ? "opacity-75" : "",
                  ].join(" ")}
                >
                  {renamingId === design.id ? (
                    <RenameInput
                      initialName={design.name}
                      onCommit={(name) => {
                        void renameDesign(design.id, name);
                        setRenamingId(undefined);
                      }}
                      onCancel={() => setRenamingId(undefined)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (suppressClickRef.current) {
                          return;
                        }
                        // Clicking a design is also how you step off Welcome,
                        // including when it is the design already loaded.
                        leaveWelcomeTab();
                        void switchToDesign(design.id);
                      }}
                      onDoubleClick={() => setRenamingId(design.id)}
                      title={design.name}
                      className="flex max-w-[166px] items-center gap-1.5 text-xs font-medium"
                    >
                      {hasDrawableFace(design.icon) ? <TabFace icon={design.icon} /> : null}
                      {isActive ? <TabSolvingSpinner /> : null}
                      <span className="truncate">{design.name}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    aria-label={`Design options for ${design.name}`}
                    aria-expanded={openMenu?.id === design.id}
                    onClick={(event) => {
                      if (openMenu?.id === design.id) {
                        closeMenu();
                        return;
                      }

                      // Measured off the trigger because the menu renders in a
                      // portal: the tab strip scrolls horizontally, and an
                      // overflow container clips absolutely-positioned children
                      // whatever their z-index.
                      const rect = event.currentTarget.getBoundingClientRect();
                      setArmed(undefined);
                      setOpenMenu({
                        id: design.id,
                        name: design.name,
                        left: Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8),
                        top: rect.bottom + 4,
                      });
                    }}
                    className="ml-1 rounded px-1 text-xs text-fg-muted opacity-0 hover:bg-surface hover:text-fg focus:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100"
                  >
                    ⋯
                  </button>
                </div>
                </Fragment>
              );
            })}
          </nav>
          </div>

          <span
            aria-hidden
            className={[
              "pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-surface to-transparent transition-opacity duration-200",
              overflow.left ? "opacity-100" : "opacity-0",
            ].join(" ")}
          />
          <span
            aria-hidden
            className={[
              "pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-surface to-transparent transition-opacity duration-200",
              overflow.right ? "opacity-100" : "opacity-0",
            ].join(" ")}
          />
        </div>

        {/* Just outside the scroller: next to the last tab, but never scrolled
            out of reach the way it would be inside the list. */}
        <button
          type="button"
          onClick={() => {
            leaveWelcomeTab();
            void addDesign();
          }}
          title="New design"
          aria-label="New design"
          className="shrink-0 rounded px-2 py-0.5 text-sm text-fg-muted hover:bg-surface-sunken hover:text-fg"
        >
          +
        </button>

        {/* Everything from here is pinned to the right edge. */}
        <span className="ml-auto shrink-0 pl-1 text-[11px] text-fg-muted">
          {saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed" : "Saved"}
        </span>
      </div>

      {openMenu ? (
        <DesignMenu
          menu={openMenu}
          armed={armed}
          // Counted off the tab ORDER, so "to the right" means what the user
          // can see rather than anything about when a design was made.
          neighbours={splitNeighbours(
            designs.map((design) => design.id),
            openMenu.id,
          )}
          onClose={closeMenu}
          onArm={setArmed}
          onRename={() => {
            setRenamingId(openMenu.id);
            closeMenu();
          }}
          onDuplicate={() => {
            void copyDesign(openMenu.id);
            closeMenu();
          }}
          onDelete={() => {
            void removeDesign(openMenu.id);
            closeMenu();
          }}
          onCloseMany={(ids) => {
            void removeDesigns(ids, openMenu.id);
            closeMenu();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Rendered into `document.body` so no ancestor's `overflow` can clip it, and
 * positioned in viewport coordinates from the trigger's rect.
 */
function DesignMenu({
  menu,
  armed,
  neighbours,
  onClose,
  onArm,
  onRename,
  onDuplicate,
  onDelete,
  onCloseMany,
}: {
  menu: OpenMenu;
  armed?: ArmedAction;
  neighbours: { left: string[]; right: string[]; others: string[] };
  onClose: () => void;
  onArm: (action: ArmedAction) => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onCloseMany: (ids: string[]) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    // Capture phase, and pointerdown rather than mousedown: the board's pan
    // handler stops the event dead on the way up (d3-zoom calls
    // stopImmediatePropagation), so a bubble-phase listener here never heard a
    // press on the canvas and the menu just sat there. Pointer events also
    // cover a finger without waiting for the synthesized mouse press.
    document.addEventListener("pointerdown", closeOnOutsideClick, true);
    document.addEventListener("keydown", closeOnEscape);
    // A fixed menu does not travel with the strip, so it is dismissed rather
    // than left floating somewhere it no longer points at.
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick, true);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  // The menu only ever opens from a click, so this is really just a guard for
  // any render that happens without a DOM.
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Design options for ${menu.name}`}
      style={{ left: menu.left, top: menu.top, width: MENU_WIDTH }}
      className="fixed z-[100] overflow-hidden rounded border border-line bg-surface-raised shadow-lg"
    >
      <MenuItem label="Rename" onClick={onRename} />
      <MenuItem label="Duplicate" onClick={onDuplicate} />

      {/*
        Every item below closes designs for good, so each one arms on the first
        click and fires on the second — two steps rather than a native confirm
        dialog, because closing cannot be undone and the second click lands
        where the first did. Labels stay short enough to sit on one line; a
        count in the label pushed them onto two.

        An item with nothing to close is left out rather than shown disabled;
        on the first or last tab half this menu would otherwise be dead text.
      */}
      {neighbours.left.length > 0 ? (
        <BulkCloseItem
          label="Close tabs to left"
          armed={armed === "left"}
          onArm={() => onArm("left")}
          onFire={() => onCloseMany(neighbours.left)}
        />
      ) : null}
      {neighbours.right.length > 0 ? (
        <BulkCloseItem
          label="Close tabs to right"
          armed={armed === "right"}
          onArm={() => onArm("right")}
          onFire={() => onCloseMany(neighbours.right)}
        />
      ) : null}
      {neighbours.others.length > 0 ? (
        <BulkCloseItem
          label="Close other tabs"
          armed={armed === "others"}
          onArm={() => onArm("others")}
          onFire={() => onCloseMany(neighbours.others)}
        />
      ) : null}

      {armed === "delete" ? (
        <MenuItem label="Confirm close" tone="danger" onClick={onDelete} />
      ) : (
        <MenuItem label="Close" tone="danger" onClick={() => onArm("delete")} />
      )}
    </div>,
    document.body,
  );
}

/** One armed-then-fires close. */
function BulkCloseItem({
  label,
  armed,
  onArm,
  onFire,
}: {
  label: string;
  armed: boolean;
  onArm: () => void;
  onFire: () => void;
}) {
  return (
    <MenuItem
      label={armed ? "Confirm close" : label}
      tone={armed ? "danger" : undefined}
      onClick={armed ? onFire : onArm}
    />
  );
}

/**
 * Which tabs sit either side of one tab, by tab order.
 *
 * The anchor is never in any of the three lists: the menu belongs to that tab,
 * so the one thing every item here leaves standing is the tab it opened from.
 */
function splitNeighbours(ids: string[], anchorId: string) {
  const index = ids.indexOf(anchorId);
  if (index < 0) {
    return { left: [], right: [], others: [] };
  }

  const left = ids.slice(0, index);
  const right = ids.slice(index + 1);
  return { left, right, others: [...left, ...right] };
}

function MenuItem({
  label,
  onClick,
  tone = "default",
}: {
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={[
        "block w-full whitespace-nowrap px-2 py-1.5 text-left text-xs hover:bg-surface-sunken",
        tone === "danger" ? "text-red-400" : "text-fg",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function RenameInput({
  initialName,
  onCommit,
  onCancel,
}: {
  initialName: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialName);

  return (
    <input
      autoFocus
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.target.select()}
      // Committing on blur keeps a click elsewhere from silently discarding the
      // edit, which is what a rename field that only listens for Enter does.
      onBlur={() => onCommit(value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          onCommit(value);
        } else if (event.key === "Escape") {
          onCancel();
        }
      }}
      aria-label="Design name"
      className="w-[140px] rounded border border-cyan-500 bg-surface px-1 text-xs text-fg outline-none"
    />
  );
}

/**
 * Whether the saved face would actually draw. An item icon with no sprite and
 * no atlas entry renders as nothing, and reserving space for nothing just
 * indents the name.
 */
function hasDrawableFace(icon: EntryIcon | undefined): icon is EntryIcon {
  return Boolean(icon && (icon.iconPath || icon.iconAtlas || icon.kind === "fluid"));
}

/** The face's box: the pill's full height, the way a browser tab wears a favicon. */
const TAB_FACE_PX = 24;

/**
 * The design's saved one-item face at the pill's full height. Same rendering
 * as the setup shelf's icon slot: the padded source art drawn oversized and
 * cropped by the wrapper, so the sprite fills the little box. Nudged down a
 * pixel because every pill carries a 2px bottom border (the active underline,
 * transparent on the rest), which centres content a pixel above the pill's
 * visual middle.
 */
function TabFace({ icon }: { icon: EntryIcon }) {
  return (
    <span
      aria-hidden
      className="flex h-6 w-6 shrink-0 translate-y-[1px] items-center justify-center overflow-hidden"
    >
      <ResourceIcon
        resource={{
          id: icon.resourceId,
          kind: icon.kind,
          amount: 1,
          displayName: icon.displayName,
          iconPath: icon.iconPath,
          iconAtlas: icon.iconAtlas,
          dominantColor: icon.dominantColor,
        }}
        bare
        tooltip={false}
        showAmount={false}
        // Both kinds are drawn oversized so the ART fills the box, not the
        // art plus its padding. A rendered item texture is 256px with the art
        // in the middle 128 (measured across the set), so exactly 2x the box
        // puts the art at box size, cropped by the wrapper. A fluid draws as
        // a swatch inset to FLUID_ICON_SCALE of its cell so it weighs the
        // same as items in a slot grid; here that inset is inverted away and
        // the swatch itself fills the box.
        iconPixelSize={
          icon.kind === "fluid"
            ? Math.round(TAB_FACE_PX / FLUID_ICON_SCALE)
            : TAB_FACE_PX * 2
        }
        className="!h-full !w-full"
      />
    </span>
  );
}

/**
 * A tiny spinner on the ACTIVE tab while its books are still computing in
 * the worker - the canvas holds only one plan at a time, so the active tab
 * is the only one that can be mid-solve. Its own component so the whole tab
 * strip does not resubscribe to the solve flag; it renders nothing the
 * moment the real numbers land.
 */
function TabSolvingSpinner() {
  const solving = useSolvingBooks();
  if (!solving) {
    return null;
  }
  return (
    <span
      aria-label="Still working out this plan's numbers"
      className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-neutral-600 border-t-cyan-400"
    />
  );
}

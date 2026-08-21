"use client";

import { ChevronLeft, ChevronRight, Compass } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  closeWelcomeTab,
  leaveWelcomeTab,
  openWelcomeTab,
  useWelcomeTab,
} from "@/lib/tour/welcome-tab";
import { useDesignStore } from "@/store/design-store";

// Wide enough for the longest item on one line ("Close tabs to right"); the
// menu clips rather than wraps, so this and the labels move together.
const MENU_WIDTH = 230;

/** How far one arrow press travels — roughly one tab. */
const SCROLL_STEP = 160;

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
  const welcome = useWelcomeTab();

  const [renamingId, setRenamingId] = useState<string>();
  const [openMenu, setOpenMenu] = useState<OpenMenu>();
  const [armed, setArmed] = useState<ArmedAction>();
  const [overflow, setOverflow] = useState({ left: false, right: false });
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
    setOverflow({
      // A pixel of slack: fractional widths otherwise leave an arrow enabled
      // with nowhere left to go.
      left: scroller.scrollLeft > 1,
      right: scroller.scrollLeft < maxScroll - 1,
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
  }, [syncOverflow]);

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

  const scrollTabs = (direction: -1 | 1) => {
    scrollerRef.current?.scrollBy({ left: direction * SCROLL_STEP, behavior: "smooth" });
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

        {overflow.left ? <ScrollArrow direction={-1} onClick={() => scrollTabs(-1)} /> : null}

        {/*
          Sized to its tabs (`shrink`), not to the whole bar (`flex-1`): with a
          couple of designs the strip is only as wide as they are, so the `+`
          sits against the last tab instead of being stranded at the far right.
          Once the tabs outgrow the bar it shrinks and scrolls instead.
        */}
        <div
          ref={scrollerRef}
          onScroll={syncOverflow}
          className="no-scrollbar min-w-0 shrink overflow-x-auto"
        >
          <nav ref={trackRef} aria-label="Designs" className="flex w-max items-center gap-1">
            {designs.map((design) => {
              const isActive = design.id === activeDesignId && !welcome.active;

              return (
                <div
                  key={design.id}
                  data-design-id={design.id}
                  className={[
                    "group flex h-6 shrink-0 items-center rounded-t border-b-2 pl-2 pr-1",
                    isActive
                      ? "border-cyan-500 bg-surface-raised text-fg"
                      : "border-transparent text-fg-muted hover:bg-surface-sunken hover:text-fg",
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
                        // Clicking a design is also how you step off Welcome,
                        // including when it is the design already loaded.
                        leaveWelcomeTab();
                        void switchToDesign(design.id);
                      }}
                      onDoubleClick={() => setRenamingId(design.id)}
                      title={design.name}
                      className="max-w-[150px] truncate text-xs font-medium"
                    >
                      {design.name}
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
              );
            })}
          </nav>
        </div>

        {overflow.right ? <ScrollArrow direction={1} onClick={() => scrollTabs(1)} /> : null}

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

/**
 * Rendered only when there is something to scroll to in that direction, so the
 * strip stays clean at the common case of a handful of designs.
 */
function ScrollArrow({ direction, onClick }: { direction: -1 | 1; onClick: () => void }) {
  const Icon = direction === -1 ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === -1 ? "Scroll tabs left" : "Scroll tabs right"}
      title={direction === -1 ? "Scroll tabs left" : "Scroll tabs right"}
      className="inline-flex h-7 w-5 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-surface-sunken hover:text-fg"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
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

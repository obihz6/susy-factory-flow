"use client";

import { Menu, Settings, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AccountMenu } from "./community/AccountMenu";
import { AppIdentity } from "./AppIdentity";
import { BoardActions } from "./BoardActions";
import { MenuLinks } from "./HeaderLinks";

interface AppMenuProps {
  onLoadDatasetVersion: (versionId: string) => void;
  /** Opens the share dialog, which the header owns; see AppHeader. */
  onShare: () => void;
  /** Opens the export-image dialog, also owned by the header. */
  onExportImage: () => void;
  /** Opens the settings dialog, also owned by the header. */
  onOpenSettings: () => void;
}

/**
 * The whole top bar, folded into one button.
 *
 * On a narrow window the bar's contents — a pack picker, five plan actions, two
 * brand links, a bug report and an account — ran a good 600px past the edge of
 * the screen, which in a mobile browser widens the layout viewport and shrinks
 * everything on the page to fit. So below the compact threshold the bar keeps
 * only the app's name and its version chip, and everything else moves in here.
 *
 * A sheet under the header rather than a full-screen overlay: it is a handful of
 * rows, the board stays visible behind it, and a tap anywhere else puts it away.
 */
export function AppMenu({
  onLoadDatasetVersion,
  onShare,
  onExportImage,
  onOpenSettings,
}: AppMenuProps) {
  const [isOpen, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!sheetRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-label={isOpen ? "Close the menu" : "Open the menu"}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-line-strong bg-surface text-fg-subtle hover:bg-surface-raised"
      >
        {isOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>
      {isOpen ? (
        <div
          ref={sheetRef}
          // Anchored to the header, which is the app's one `relative` bar, so
          // the sheet hangs off the button that opened it at any width.
          // `text-sm` up here because buttons inherit their font (the global
          // reset outranks text-* on the control): without it the sheet's
          // button rows render a size up from its link rows.
          className="absolute right-2 top-full z-[90] mt-1 flex w-[min(320px,calc(100vw-16px))] flex-col gap-1 rounded border border-line-strong bg-surface p-2 text-sm shadow-[0_12px_28px_rgba(0,0,0,0.5)]"
        >
          <MenuSection label="Pack">
            <div className="px-2 py-1">
              <AppIdentity onLoadDatasetVersion={onLoadDatasetVersion} />
            </div>
          </MenuSection>
          <MenuSection label="This plan">
            <BoardActions
              variant="list"
              onAction={() => setOpen(false)}
              onShare={onShare}
              onExportImage={onExportImage}
            />
          </MenuSection>
          <MenuSection label="Planner">
            <button
              type="button"
              onClick={() => {
                onOpenSettings();
                setOpen(false);
              }}
              className="flex h-10 w-full items-center gap-2.5 rounded px-2 text-left text-sm text-fg-subtle hover:bg-surface-sunken"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                <Settings className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span className="truncate">Settings</span>
            </button>
            <MenuLinks onAction={() => setOpen(false)} />
            <div className="flex px-2 py-1">
              <AccountMenu />
            </div>
          </MenuSection>
        </div>
      ) : null}
    </>
  );
}

function MenuSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-1 first:border-t-0 first:pt-0">
      <h2 className="px-2 pb-0.5 text-[10px] font-semibold uppercase tracking-widest text-fg-muted">
        {label}
      </h2>
      {children}
    </section>
  );
}

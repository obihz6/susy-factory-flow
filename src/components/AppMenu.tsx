"use client";

import { useDropdownDismiss } from "@/lib/hooks/use-dropdown-dismiss";

import { Menu, Settings, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { AccountMenu } from "./community/AccountMenu";
import { SHOW_PACK_PICKER } from "./AppHeader";
import { AppIdentity } from "./AppIdentity";
import { BoardActions } from "./BoardActions";
import { MenuLinks } from "./HeaderLinks";

interface AppMenuProps {
  onLoadDatasetVersion: (versionId: string) => void;
  onShare: () => void;
  onExportImage: () => void;
  onOpenSettings: () => void;
}

/** The compact version of the planner's top bar. */
export function AppMenu({
  onLoadDatasetVersion,
  onShare,
  onExportImage,
  onOpenSettings,
}: AppMenuProps) {
  const [isOpen, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useDropdownDismiss(isOpen, { refs: [sheetRef, triggerRef], onClose: () => setOpen(false) });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-label={isOpen ? "Close the menu" : "Open the menu"}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-line-strong bg-surface text-fg-subtle hover:bg-surface-raised"
      >
        {isOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>
      {isOpen ? (
        <div
          ref={sheetRef}
          className="absolute right-2 top-full z-[90] mt-1 flex w-[min(320px,calc(100*var(--ui-vw)-16px))] flex-col gap-1 rounded border border-line-strong bg-surface p-2 text-sm shadow-[0_12px_28px_rgba(0,0,0,0.5)]"
        >
          {SHOW_PACK_PICKER && (
            <MenuSection label="Pack">
              <div className="px-2 py-1">
                <AppIdentity onLoadDatasetVersion={onLoadDatasetVersion} />
              </div>
            </MenuSection>
          )}
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

function MenuSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-1 first:border-t-0 first:pt-0">
      <h2 className="px-2 pb-0.5 text-[10px] font-semibold uppercase tracking-widest text-fg-muted">
        {label}
      </h2>
      {children}
    </section>
  );
}

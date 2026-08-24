"use client";

import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { isPerfHudEnabled, setPerfHudEnabled } from "./flow/PerfHud";

/**
 * The dev menu, behind a shift-click on the version chip.
 *
 * The chip's shift-click used to jump straight to the update-popup preview;
 * that preview now lives in here as one row among the dev tools, so new ones
 * get a home instead of each claiming its own secret click. Deliberately
 * undocumented in the UI - it is a workbench, not a feature.
 */
export function DevMenu({
  onClose,
  onPreviewUpdatePopup,
}: {
  onClose: () => void;
  /** Opens the update-popup preview (WhatsNewPreview), replacing this menu. */
  onPreviewUpdatePopup: () => void;
}) {
  const [perfHud, setPerfHud] = useState<boolean>(() => isPerfHudEnabled());

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      // Same no-backdrop-filter-on-a-phone rule as every other overlay.
      className="fixed inset-0 z-[120] grid place-items-center bg-neutral-950/75 p-4 backdrop-blur-sm compact:bg-neutral-950/92 compact:[backdrop-filter:none]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Dev menu"
        className="flex max-h-[88vh] w-full max-w-sm flex-col overflow-hidden rounded-lg border border-line-strong bg-surface shadow-2xl compact:max-h-[92vh]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative shrink-0 border-b border-line bg-gradient-to-br from-surface-raised to-surface px-5 py-4 compact:px-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 rounded p-1.5 text-fg-subtle hover:bg-surface-raised hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
          <h2 className="text-xl font-black leading-none tracking-tight">Dev menu</h2>
          <p className="mt-1.5 text-sm text-fg-muted">
            Tools for working on the planner. Saved on this device.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 compact:p-3">
          <button
            type="button"
            onClick={() => {
              const next = !perfHud;
              setPerfHudEnabled(next);
              setPerfHud(next);
            }}
            aria-pressed={perfHud}
            className={[
              "flex w-full items-center gap-3 rounded border px-3 py-2.5 text-left",
              perfHud
                ? "border-cyan-600 bg-cyan-500/10"
                : "border-line hover:border-line-strong hover:bg-surface-raised",
            ].join(" ")}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-base leading-tight text-fg">Performance readout</span>
              <span className="mt-0.5 block text-xs text-fg-muted">
                Frame times, stutter counts and what is mounted, in the bottom left corner of the
                board.
              </span>
            </span>
            <Check
              aria-hidden
              className={["h-4 w-4 shrink-0", perfHud ? "text-cyan-400" : "invisible"].join(" ")}
            />
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onPreviewUpdatePopup();
            }}
            className="mt-2 flex w-full items-center gap-3 rounded border border-line px-3 py-2.5 text-left hover:border-line-strong hover:bg-surface-raised"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-base leading-tight text-fg">
                Preview the update popup
              </span>
              <span className="mt-0.5 block text-xs text-fg-muted">
                Shows the what&apos;s-new popup exactly as a returning player sees it.
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

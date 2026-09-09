"use client";

import { useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { useDeployedVersion } from "@/lib/use-deployed-version";

/**
 * Telling somebody the app moved under them WHILE THE TAB WAS OPEN.
 *
 * The page is running the OLD code and cannot fix that itself, so this is a
 * quiet strip offering the reload. Nothing else arrives by itself: the notes
 * for a release that shipped while you were away used to open as a popup
 * here, with a second "you have not read the heads up" box guarding its
 * close, and both were REMOVED (Jack, 2026-09-08). The version chip in the
 * header opens the notes on request and wears a dot while any are unread;
 * that is the whole announcement now.
 *
 * Mounted once, at the app shell.
 */
export function WhatsNewGate() {
  const [dismissedReload, setDismissedReload] = useState(false);
  const deployed = useDeployedVersion();

  if (!deployed || dismissedReload) {
    return null;
  }

  return (
    <div className="pointer-events-auto fixed bottom-3 left-1/2 z-[130] flex -translate-x-1/2 items-center gap-3 rounded border border-cyan-500/60 bg-surface px-3 py-2 text-sm shadow-xl">
      <span className="text-fg-subtle">
        v{deployed} is out. Reload to pick it up.
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="flex items-center gap-1.5 rounded border border-cyan-500/60 bg-cyan-500/15 px-2.5 py-1 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25"
      >
        <RefreshCw aria-hidden className="h-3.5 w-3.5" />
        Reload
      </button>
      <button
        type="button"
        onClick={() => setDismissedReload(true)}
        aria-label="Dismiss"
        className="rounded p-1 text-fg-muted hover:bg-surface-raised"
      >
        <X aria-hidden className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

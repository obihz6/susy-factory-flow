"use client";

import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { ChangelogDialog } from "@/components/ChangelogDialog";
import { CHANGELOG, type ChangelogEntry } from "@/lib/changelog";
import { useDeployedVersion } from "@/lib/use-deployed-version";
import {
  isUpdatePopupEnabled,
  markVersionSeenAndNotify,
  needsInterrupting,
  pendingForcedEntries,
  subscribeToVersionSeen,
  unseenEntries,
} from "@/lib/whats-new";

/**
 * Telling somebody the app moved under them.
 *
 * Two cases, two treatments, and conflating them would be wrong in both
 * directions:
 *
 * - AWAY WHILE IT SHIPPED. The page is already running the new code, so there
 *   is nothing to do about it and nothing to ask - just show what changed. It
 *   is a popup rather than a badge because the whole reason to bother is the
 *   releases that change what the board MEANS, and someone who does not read
 *   those goes looking for a bug that is really a new rule.
 * - OPEN WHILE IT SHIPPED. The page is running the OLD code and cannot fix
 *   that itself. Showing the notes here would describe an app the reader is
 *   not using. So this one is a quiet strip offering the reload, and the notes
 *   come after it, on the way back in.
 *
 * Mounted once, at the app shell.
 */
export function WhatsNewGate() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [dismissedReload, setDismissedReload] = useState(false);
  const deployed = useDeployedVersion();

  // After mount, never during render: it reads localStorage, and a server
  // render has none, so deciding this any earlier is a hydration mismatch.
  useEffect(() => {
    // The settings mute. Nothing is stamped seen or shown on its account:
    // the releases stay unread and the header dot still announces them, this
    // browser has just asked not to be interrupted about it.
    if (!isUpdatePopupEnabled()) {
      return;
    }
    // Two questions, and the second one exists because the first cannot always
    // be answered. `unseenEntries` needs a stamp to compare against and treats
    // a browser without one as a first visit; `pendingForcedEntries` is for the
    // releases that must not be missed on that account.
    const unseen = unseenEntries();
    const forced = pendingForcedEntries();
    const shown = new Set([...unseen, ...forced].map((entry) => entry.version));
    // Rebuilt from CHANGELOG rather than concatenated, so the two sources
    // cannot double up an entry or land it out of order.
    const combined = CHANGELOG.filter((entry) => shown.has(entry.version));
    // Only the releases that change what a saved plan MEANS get a dialog. The
    // rest are announced by the dot on the header button, which is there to be
    // noticed rather than answered.
    setEntries(needsInterrupting(combined) ? combined : []);
  }, []);

  useEffect(() => subscribeToVersionSeen(() => setEntries([])), []);

  const closeNotes = () => {
    markVersionSeenAndNotify();
    setEntries([]);
  };

  if (entries.length > 0) {
    return (
      <ChangelogDialog
        // Which versions are new TO THIS READER. The dialog opens on those and
        // keeps the rest of the history behind a button - handing it a
        // pre-filtered list made the popup and the header button two different
        // documents, and neither of them was "the changelog".
        unseenVersions={new Set(entries.map((entry) => entry.version))}
        tone="interrupt"
        onClose={closeNotes}
      />
    );
  }

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

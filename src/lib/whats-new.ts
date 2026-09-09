"use client";

import { APP_VERSION } from "@/lib/version";

/**
 * Noticing that the app changed under you.
 *
 * Two different situations, and they want two different answers:
 *
 * - you were away and it shipped while you were gone. The code running is the
 *   new code, so the only question is whether this browser has been here
 *   before and what it has already been shown. That is the version stamp
 *   below, read by `pickSpotlight` in release-spotlight.ts, and the answer is
 *   the release notice that arrives once.
 * - you had the tab open and it shipped. The code running is the OLD code and
 *   cannot become the new one on its own, so the honest thing is to say a new
 *   version exists and offer a reload. `useDeployedVersion` asks the server.
 *
 * THE PLAYER-FACING CHANGELOG IS GONE (Jack, 2026-09-08): no dialog, no
 * unread dot, and the header's version chip opens nothing. `CHANGELOG` in
 * changelog.ts survives as a record in the code, read by nothing the player
 * can reach. So the only reader of the stamp is the release notice, and the
 * only writer is the header, which stamps on every load after asking whether
 * a notice is due.
 */
const LAST_SEEN_KEY = "susy-factory-flow.last-seen-version.v1";

/**
 * Which `showToEveryone` releases this browser has already been shown.
 *
 * A SECOND record, deliberately, rather than a special case on the stamp. The
 * stamp answers "what have you seen"; this answers "have you been handed this
 * particular release once". Folding them together would mean the forced
 * showing had to lie about the stamp to work, and then a browser that had
 * genuinely read the notes would be told about them again.
 */
const FORCED_SHOWN_KEY = "susy-factory-flow.forced-notes.v1";

/**
 * The settings dialog's mute for the update popup. "off" means the notes
 * never arrive by themselves; the dot on the What's new button still marks
 * unread releases, so nothing goes unannounced, just uninterrupted. Absent
 * means on, so a fresh profile and a never-touched setting are the same.
 */
export function readLastSeenVersion(): string | undefined {
  try {
    return window.localStorage.getItem(LAST_SEEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function markVersionSeen(version = APP_VERSION): void {
  try {
    window.localStorage.setItem(LAST_SEEN_KEY, version);
  } catch {
    // A blocked or full quota must never break the app. The cost is one
    // repeated notice, which is the harmless direction to fail in.
  }
}

/** Newest-first compare of two `1.2.3` strings. */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

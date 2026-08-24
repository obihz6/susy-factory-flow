"use client";

import { CHANGELOG, type ChangelogEntry } from "@/lib/changelog";
import { APP_VERSION } from "@/lib/version";

/**
 * Noticing that the app changed under you.
 *
 * Two different situations, and they want two different answers:
 *
 * - you were away and it shipped while you were gone. The code running is the
 *   new code, so the only question is what you have already seen. That is a
 *   version stamped in localStorage, and the answer is a what's-new popup.
 * - you had the tab open and it shipped. The code running is the OLD code and
 *   cannot become the new one on its own, so the honest thing is to say a new
 *   version exists and offer a reload. `useDeployedVersion` asks the server.
 *
 * The stamp is written when the popup is DISMISSED, not when it is shown, so
 * closing the tab mid-read does not lose the notes.
 */
const LAST_SEEN_KEY = "gtnh-factory-flow.last-seen-version.v1";

/**
 * Which `showToEveryone` releases this browser has already been shown.
 *
 * A SECOND record, deliberately, rather than a special case on the stamp. The
 * stamp answers "what have you seen"; this answers "have you been handed this
 * particular release once". Folding them together would mean the forced
 * showing had to lie about the stamp to work, and then a browser that had
 * genuinely read the notes would be told about them again.
 */
const FORCED_SHOWN_KEY = "gtnh-factory-flow.forced-notes.v1";

/**
 * The settings dialog's mute for the update popup. "off" means the notes
 * never arrive by themselves; the dot on the What's new button still marks
 * unread releases, so nothing goes unannounced, just uninterrupted. Absent
 * means on, so a fresh profile and a never-touched setting are the same.
 */
const POPUP_MUTED_KEY = "gtnh-factory-flow.update-popup.v1";

export function isUpdatePopupEnabled(): boolean {
  try {
    return window.localStorage.getItem(POPUP_MUTED_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setUpdatePopupEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      window.localStorage.removeItem(POPUP_MUTED_KEY);
    } else {
      window.localStorage.setItem(POPUP_MUTED_KEY, "off");
    }
  } catch {
    // A blocked quota must never break the app.
  }
}

function readLastSeen(): string | undefined {
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
    // A blocked or full quota must never break the app. The cost is being
    // shown the notes again, which is the harmless direction to fail in.
  }
}

function readForcedShown(): string[] {
  try {
    const raw = window.localStorage.getItem(FORCED_SHOWN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    // Unreadable or corrupt reads as "shown nothing". The cost is one extra
    // popup, which is the harmless direction to fail in.
    return [];
  }
}

/**
 * Releases flagged `showToEveryone` that this browser has not been handed yet.
 *
 * Independent of the stamp on purpose: the whole point is the browsers whose
 * stamp cannot answer the question, either because they have never had one or
 * because it was written for them silently on arrival.
 */
export function pendingForcedEntries(): ChangelogEntry[] {
  const shown = new Set(readForcedShown());
  return CHANGELOG.filter(
    (entry) =>
      entry.showToEveryone &&
      !shown.has(entry.version) &&
      compareVersions(entry.version, APP_VERSION) <= 0,
  );
}

export function markForcedShown(versions: string[]): void {
  if (versions.length === 0) {
    return;
  }
  try {
    const merged = [...new Set([...readForcedShown(), ...versions])];
    window.localStorage.setItem(FORCED_SHOWN_KEY, JSON.stringify(merged));
  } catch {
    // As above: a blocked quota must never break the app.
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

/**
 * What has shipped since this browser last looked, or an empty list.
 *
 * Empty on a FIRST visit, deliberately. Somebody arriving for the first time
 * has no idea what any of it used to do, so a list of changes is noise in
 * front of the thing they came to see - the stamp is written silently instead
 * and they hear about the next release like everyone else.
 */
export function unseenEntries(): ChangelogEntry[] {
  const lastSeen = readLastSeen();
  if (!lastSeen) {
    markVersionSeen();
    return [];
  }
  return entriesSince(lastSeen);
}

/**
 * Everything between a given stamp and the running version.
 *
 * Split out of `unseenEntries` so the dev preview can ask the same question
 * about a version this browser never had. If the two ever answered
 * differently, the preview would be showing a popup nobody gets.
 */
export function entriesSince(lastSeen: string): ChangelogEntry[] {
  if (compareVersions(lastSeen, APP_VERSION) >= 0) {
    return [];
  }
  return CHANGELOG.filter(
    (entry) =>
      compareVersions(entry.version, lastSeen) > 0 &&
      compareVersions(entry.version, APP_VERSION) <= 0,
  );
}

/**
 * Whether this lot is worth putting a dialog in front of somebody, or whether
 * a dot on the button will do.
 *
 * A modal on every version bump is how a product teaches people to dismiss it
 * without reading, and then the one release that genuinely changes the rules
 * gets dismissed with all the others. So the interruption is spent only on a
 * release carrying a `warning` - the ones where a plan somebody already saved
 * now behaves differently. Everything else is a typo fix, a nicer tooltip, a
 * faster board: real work, and none of it anybody's emergency.
 */
export function needsInterrupting(entries: ChangelogEntry[]): boolean {
  return entries.some((entry) => Boolean(entry.warning));
}

/**
 * A version stamp is browser-wide, so the header button and the popup have to
 * agree about it within the same page. Nothing here is worth a store; it is
 * one string and two readers.
 */
const listeners = new Set<() => void>();

export function subscribeToVersionSeen(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function markVersionSeenAndNotify(): void {
  markVersionSeen();
  // Reading the notes by ANY route spends the forced showing, including the
  // header button. Somebody who went looking and read v2.0.0 at the top of the
  // list does not then want it thrown at them on the next load; that reads as
  // the app having lost track rather than as care.
  markForcedShown(pendingForcedEntries().map((entry) => entry.version));
  for (const listener of [...listeners]) {
    listener();
  }
}

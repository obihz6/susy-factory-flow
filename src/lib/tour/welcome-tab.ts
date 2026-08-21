"use client";

import { useSyncExternalStore } from "react";
import { readSharedPlanId } from "@/lib/community/shared-link";

/**
 * The Welcome tab: whether it sits in the tab strip, and whether it is the one
 * showing.
 *
 * It is not a design. It rides at the head of the same strip because that is
 * where people already look for "what am I working on", and it covers the board
 * rather than replacing it, so nothing about the plan is unmounted while it is
 * up.
 *
 * `open` and `showOnStartup` are permanent (localStorage); `active` is not.
 * Coming back to a page that had opened over your factory a week ago and
 * finding it still there reads as the app losing your work. So a fresh visit
 * starts on the Welcome tab if the checkbox says so, and stepping onto a design
 * puts it away for the rest of the session.
 *
 * "The rest of the session" includes RELOADS, which is why stepping off is
 * recorded in sessionStorage rather than only in memory: reloading while you
 * work is not a new visit, and being thrown back onto Welcome every time is
 * indistinguishable from the app forgetting where you were. sessionStorage is
 * the exact scope wanted - it survives a reload and a navigation, and a new tab
 * or a later visit starts clean.
 */
export interface WelcomeTabState {
  /** The tab is in the strip. */
  open: boolean;
  /** It is the tab being shown, covering the board. */
  active: boolean;
  /** Land here on every visit. Unticking it is how a regular gets rid of it. */
  showOnStartup: boolean;
}

const WELCOME_TAB_STORAGE_KEY = "susy-factory-flow-welcome-tab";

/** Set once the user has stepped off Welcome in this browser session. */
const WELCOME_LEFT_SESSION_KEY = "susy-factory-flow-welcome-left";

const CLOSED: WelcomeTabState = { open: false, active: false, showOnStartup: true };

let state: WelcomeTabState = CLOSED;
let loaded = false;
const listeners = new Set<() => void>();

function hasLeftThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(WELCOME_LEFT_SESSION_KEY) === "1";
  } catch {
    // Blocked storage just means every reload looks like a fresh visit.
    return false;
  }
}

function rememberLeftThisSession(left: boolean) {
  try {
    if (left) {
      window.sessionStorage.setItem(WELCOME_LEFT_SESSION_KEY, "1");
    } else {
      window.sessionStorage.removeItem(WELCOME_LEFT_SESSION_KEY);
    }
  } catch {
    // Never let a storage failure break the tab strip.
  }
}

function readStored(): WelcomeTabState {
  // A link to someone's setup is a visit that already has somewhere to be, and
  // the greeting would land on top of the very thing the link was for. It
  // counts as stepped off before anything renders, so there is no flash of
  // Welcome while the setup downloads. What makes it stick across the reload
  // after the import is `leaveWelcomeTab`, called once the plan is on the
  // board: by then `?plan=` has been taken back out of the address bar.
  const left = hasLeftThisSession() || readSharedPlanId() !== undefined;

  try {
    const raw = window.localStorage.getItem(WELCOME_TAB_STORAGE_KEY);
    if (!raw) {
      // Nobody has been here before: the tab is in the strip and open on it.
      return { open: true, active: !left, showOnStartup: true };
    }
    const parsed = JSON.parse(raw) as Partial<Record<keyof WelcomeTabState, unknown>>;
    // An absent key takes the default, so a blob saved before a setting existed
    // does not silently opt out of it.
    const flag = (value: unknown, fallback: boolean) =>
      typeof value === "boolean" ? value : fallback;
    const open = flag(parsed.open, true);
    const showOnStartup = flag(parsed.showOnStartup, true);
    return { open, showOnStartup, active: open && showOnStartup && !left };
  } catch {
    return { open: true, active: !left, showOnStartup: true };
  }
}

function getSnapshot(): WelcomeTabState {
  if (!loaded) {
    loaded = true;
    state = readStored();
  }
  return state;
}

function getServerSnapshot(): WelcomeTabState {
  return CLOSED;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function write(patch: Partial<WelcomeTabState>) {
  state = { ...getSnapshot(), ...patch };
  // Whichever tab you moved to is the one a reload should land on, so the
  // session flag tracks `active` rather than being set only when leaving.
  if (patch.active !== undefined) {
    rememberLeftThisSession(!state.active);
  }
  try {
    window.localStorage.setItem(
      WELCOME_TAB_STORAGE_KEY,
      JSON.stringify({ open: state.open, showOnStartup: state.showOnStartup }),
    );
  } catch {
    // A full or blocked storage quota must never break the tab strip.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function useWelcomeTab(): WelcomeTabState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** The current state without subscribing. For tests and one-shot reads. */
export function readWelcomeTabState(): WelcomeTabState {
  return getSnapshot();
}

/** Put the Welcome tab in the strip and show it. */
export function openWelcomeTab() {
  write({ open: true, active: true });
}

/** Step off it onto a design. The tab stays in the strip. */
export function leaveWelcomeTab() {
  if (!getSnapshot().active) {
    // Nothing to step off, but the session still has to hear about it: a visit
    // that came in on a shared link never activated Welcome in the first place,
    // and the reload after that import must not put it back over the setup.
    rememberLeftThisSession(true);
    return;
  }
  write({ active: false });
}

/** The tab's own close button: out of the strip entirely. */
export function closeWelcomeTab() {
  write({ open: false, active: false });
}

export function setWelcomeOnStartup(showOnStartup: boolean) {
  write({ showOnStartup });
}

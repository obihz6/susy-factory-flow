"use client";

import { useSyncExternalStore } from "react";
import { readSharedPlanId } from "@/lib/community/shared-link";

/**
 * The Welcome tab: whether it sits in the tab strip, and whether it is the one
 * showing.
 *
 * It is not a design. It rides at the head of the design strip and covers the
 * board rather than replacing it, so nothing about the plan unmounts.
 *
 * `open` and `showOnStartup` are permanent (localStorage); `active` is per
 * browser session. A fresh visit starts on Welcome if the checkbox says so,
 * and stepping onto a design puts it away for the rest of the session,
 * RELOADS included, which is why stepping off is kept in sessionStorage.
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
  // A visit on a shared setup link counts as stepped off before anything
  // renders, so Welcome never flashes over it. `leaveWelcomeTab`, called once
  // the plan is on the board, makes that stick across reloads (by then
  // `?plan=` has left the address bar).
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

"use client";

import { useSyncExternalStore } from "react";
import { isCompactViewport } from "./compact-view";

/**
 * Workspace preferences: which of the three columns are open, and how the
 * resource panel is filtered.
 *
 * Same mechanism as `board-view.ts`: personal taste rather than part of a
 * plan, kept in localStorage outside any store and read through
 * useSyncExternalStore so the server can render defaults without a hydration
 * mismatch. Opening a shared setup is the exception (see `plan-view.ts`).
 *
 * Hidden and favourite resources are keyed by `ResourceKey` (`item:iron_ingot`)
 * and apply across all designs on purpose.
 */
export interface WorkspaceView {
  /** Per-plan list order in the Pool view, independent of canvas order. */
  poolWorksheetOrder: Record<string, string[]>;
  /** Collapsed Pool machine groups, keyed by plan; never changes the plan. */
  poolCollapsedMachines: Record<string, string[]>;
  poolCollapsedProductionGroups: Record<string, string[]>;
  /** The column on the left. */
  leftPanelOpen: boolean;
  /** The resource flow panel on the right. */
  rightPanelOpen: boolean;
  /** Hidden resources stay listed, greyed out, instead of dropping away. */
  showHiddenResources: boolean;
  /** Only favourites are listed. */
  favouritesOnly: boolean;
  /**
   * Net the resource panel's boundary: an item in Need and Outputs at once
   * shows as one signed figure instead of both. Display arithmetic only.
   */
  netFlowRates: boolean;
  /**
   * The build list's power figures, weighted by how hard each machine
   * actually runs instead of every machine at full draw at once. Display
   * arithmetic only.
   */
  averageMachineDraw: boolean;
  /** The trend graphs at the foot of the resource panel. */
  trendsOpen: boolean;
  /** Resources the user has hidden, by ResourceKey. */
  hiddenResourceKeys: string[];
  /** Resources the user has starred, by ResourceKey. */
  favouriteResourceKeys: string[];
}

const WORKSPACE_VIEW_STORAGE_KEY = "susy-factory-flow-workspace-view";

export const DEFAULT_WORKSPACE_VIEW: WorkspaceView = {
  poolWorksheetOrder: {},
  poolCollapsedMachines: {},
  poolCollapsedProductionGroups: {},
  leftPanelOpen: true,
  rightPanelOpen: true,
  showHiddenResources: false,
  favouritesOnly: false,
  netFlowRates: false,
  averageMachineDraw: false,
  trendsOpen: true,
  hiddenResourceKeys: [],
  favouriteResourceKeys: [],
};

/**
 * Whether the side columns start open.
 *
 * On a compact window they start closed so the board gets the screen; the
 * choice is then remembered like any other.
 *
 * A media query rather than `window.innerWidth`: a mobile browser widens the
 * layout viewport when a page overflows it, so `innerWidth` on a 390px phone
 * can report 935.
 */
function defaultPanelsOpen(): boolean {
  return typeof window === "undefined" || !isCompactViewport();
}

function defaultWorkspaceView(): WorkspaceView {
  const open = defaultPanelsOpen();
  return { ...DEFAULT_WORKSPACE_VIEW, leftPanelOpen: open, rightPanelOpen: open };
}

let workspaceViewState: WorkspaceView = DEFAULT_WORKSPACE_VIEW;
let workspaceViewLoaded = false;
const listeners = new Set<() => void>();

function readWorkspaceView(): WorkspaceView {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_VIEW_STORAGE_KEY);
    if (!raw) {
      return defaultWorkspaceView();
    }
    const parsed = JSON.parse(raw) as Partial<Record<keyof WorkspaceView, unknown>>;
    // An ABSENT key takes the default; only an explicit `false` means off, so
    // a blob saved before a setting existed cannot silently opt out of it.
    const flag = (value: unknown, fallback: boolean) =>
      typeof value === "boolean" ? value : fallback;
    const keys = (value: unknown) =>
      Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

    // A starred resource is never hidden (see toggleResourceFavourite). If a
    // stored blob has a key in both lists, the star wins here on the way in.
    const favouriteResourceKeys = keys(parsed.favouriteResourceKeys);
    const starred = new Set(favouriteResourceKeys);

    return {
      poolCollapsedMachines: parsed.poolCollapsedMachines && typeof parsed.poolCollapsedMachines === "object"
        ? Object.fromEntries(Object.entries(parsed.poolCollapsedMachines).map(([key, value]) => [key, keys(value)]))
        : {},
      poolCollapsedProductionGroups: parsed.poolCollapsedProductionGroups && typeof parsed.poolCollapsedProductionGroups === "object"
        ? Object.fromEntries(Object.entries(parsed.poolCollapsedProductionGroups).map(([key, value]) => [key, keys(value)]))
        : {},
      poolWorksheetOrder: parsed.poolWorksheetOrder && typeof parsed.poolWorksheetOrder === "object"
        ? Object.fromEntries(Object.entries(parsed.poolWorksheetOrder).map(([key, value]) => [key, keys(value)]))
        : {},
      favouriteResourceKeys,
      hiddenResourceKeys: keys(parsed.hiddenResourceKeys).filter((key) => !starred.has(key)),
      leftPanelOpen: flag(parsed.leftPanelOpen, defaultPanelsOpen()),
      rightPanelOpen: flag(parsed.rightPanelOpen, defaultPanelsOpen()),
      showHiddenResources: flag(
        parsed.showHiddenResources,
        DEFAULT_WORKSPACE_VIEW.showHiddenResources,
      ),
      favouritesOnly: flag(parsed.favouritesOnly, DEFAULT_WORKSPACE_VIEW.favouritesOnly),
      netFlowRates: flag(parsed.netFlowRates, DEFAULT_WORKSPACE_VIEW.netFlowRates),
      averageMachineDraw: flag(
        parsed.averageMachineDraw,
        DEFAULT_WORKSPACE_VIEW.averageMachineDraw,
      ),
      trendsOpen: flag(parsed.trendsOpen, DEFAULT_WORKSPACE_VIEW.trendsOpen),
    };
  } catch {
    return defaultWorkspaceView();
  }
}

export function subscribeWorkspaceView(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Identity stays stable between writes, which is what useSyncExternalStore
// needs to avoid an infinite render loop.
function getSnapshot(): WorkspaceView {
  if (!workspaceViewLoaded) {
    workspaceViewLoaded = true;
    workspaceViewState = readWorkspaceView();
  }
  return workspaceViewState;
}

function getServerSnapshot(): WorkspaceView {
  return DEFAULT_WORKSPACE_VIEW;
}

export function writeWorkspaceView(patch: Partial<WorkspaceView>) {
  workspaceViewState = { ...getSnapshot(), ...patch };
  try {
    window.localStorage.setItem(
      WORKSPACE_VIEW_STORAGE_KEY,
      JSON.stringify(workspaceViewState),
    );
  } catch {
    // A full or blocked storage quota must never break the workspace.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function useWorkspaceView(): WorkspaceView {
  return useSyncExternalStore(subscribeWorkspaceView, getSnapshot, getServerSnapshot);
}

/** The same value the hook returns, for callers outside React. */
export function readWorkspaceViewSnapshot(): WorkspaceView {
  return getSnapshot();
}

/** Flip one resource in or out of a saved key list. */
function toggleKey(list: string[], resourceKey: string): string[] {
  return list.includes(resourceKey)
    ? list.filter((entry) => entry !== resourceKey)
    : [...list, resourceKey];
}

export function toggleResourceHidden(resourceKey: string) {
  const current = getSnapshot();
  writeWorkspaceView({
    hiddenResourceKeys: toggleKey(current.hiddenResourceKeys, resourceKey),
  });
}

/**
 * Star or unstar a resource. Starring one that was hidden UNHIDES it.
 *
 * A starred resource is unhideable (its row offers no hide button), and this
 * is the one path that could put a resource in both lists, so the two states
 * are kept mutually exclusive here and readers need no tie-break.
 */
export function toggleResourceFavourite(resourceKey: string) {
  const current = getSnapshot();
  const favouriteResourceKeys = toggleKey(current.favouriteResourceKeys, resourceKey);
  writeWorkspaceView({
    favouriteResourceKeys,
    hiddenResourceKeys: favouriteResourceKeys.includes(resourceKey)
      ? current.hiddenResourceKeys.filter((key) => key !== resourceKey)
      : current.hiddenResourceKeys,
  });
}

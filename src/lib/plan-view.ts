"use client";

import {
  CANVAS_PATTERNS,
  readBoardViewSnapshot,
  writeBoardView,
  type CanvasPattern,
} from "@/components/flow/board-view";
import { isCanvasThemeId } from "@/components/flow/canvas-themes";
import { isCompactViewport } from "./compact-view";
import type { BoardCamera } from "./designs/design-camera";
import type { PlanViewState } from "./model/types";
import { readWorkspaceViewSnapshot, writeWorkspaceView } from "./workspace-view";
import { getActiveRateUnit } from "./model/rate-unit";
import { useFactoryStore } from "@/store/factory-store";

/**
 * Reading and restoring the workspace arrangement a shared setup carries.
 *
 * Three separate homes feed this: the board's own view settings, the resource
 * panel's marks and toggles, and the board-wide rate unit. Gathering them in
 * one place means the share dialog and the open-a-setup path each deal with a
 * single object rather than knowing where each setting lives.
 */

/** Everything the current workspace would hand to someone opening this plan. */
export function capturePlanView(): PlanViewState {
  const board = readBoardViewSnapshot();
  const workspace = readWorkspaceViewSnapshot();

  return {
    canvasPattern: board.canvasPattern,
    canvasTheme: board.canvasTheme,
    // No `lineHeatMode` any more: line colour rides the status glance mode,
    // which the snapshot already carries.
    fixedEdgeWidth: board.fixedEdgeWidth,
    linePulseMode: board.linePulseMode,
    // The smart view (bottom-right tray) is deliberately NOT captured: it is
    // a personal reading of the board, not part of its dress, and a saved
    // setup always opens on the default identity view.
    rateUnit: getActiveRateUnit(),
    leftPanelOpen: workspace.leftPanelOpen,
    rightPanelOpen: workspace.rightPanelOpen,
    showHiddenResources: workspace.showHiddenResources,
    favouritesOnly: workspace.favouritesOnly,
    trendsOpen: workspace.trendsOpen,
    hiddenResourceKeys: workspace.hiddenResourceKeys,
    favouriteResourceKeys: workspace.favouriteResourceKeys,
  };
}

/**
 * How much of a saved arrangement to put back.
 *
 * `all` is someone OPENING a shared setup: they asked to see it the way its
 * author left it, columns and resource marks included.
 *
 * `board` is switching between your own tabs. The board's own look belongs to
 * the plan - a build you dressed in rate labels and thick lines should still be
 * wearing them when you come back to it - but the COLUMNS do not. Those are
 * where you are working, not what you are working on, and having them slide
 * open and shut every time you touch a tab is the kind of help nobody asked
 * for. Hidden and starred resources stay out for the same reason: someone who
 * never wants to see Water never wants to see it on any board.
 */
export type PlanViewScope = "all" | "board";

/**
 * Put a saved arrangement, and the plan itself, on screen.
 *
 * `camera` is where this tab was last left (see `design-camera.ts`), and it is
 * only ever passed for one of YOUR OWN tabs coming back up. Without one, the
 * plan is framed.
 */
export function applyPlanView(
  view: PlanViewState | undefined,
  scope: PlanViewScope = "all",
  camera?: BoardCamera,
): void {
  applyViewSettings(view, scope);

  // Last, so the panel toggles above have already given the board its width.
  if (camera) {
    useFactoryStore.getState().moveBoardCamera(camera);
    return;
  }

  // A shared plan carries its author's card positions and nothing at all about
  // where their camera was, and plenty of factories are built thousands of
  // cells from the origin. Opening one used to drop the viewer wherever they
  // happened to be looking, with the whole build off the edge of the board.
  useFactoryStore.getState().frameBoardNodes();
}

/**
 * The view settings themselves. Values the running build does not recognise
 * are dropped rather than written through, so a plan from a newer version
 * cannot leave the board in a state with no control that undoes it. Absent
 * fields leave the viewer's own setting alone.
 */
function applyViewSettings(view: PlanViewState | undefined, scope: PlanViewScope): void {
  // The smart view is never taken from a plan — not even from an older one
  // that recorded it. Opening a setup lands on the default identity view
  // (the cube button) whether or not the plan carries a view at all;
  // switching your own tabs leaves your choice alone.
  if (scope === "all") {
    writeBoardView({ glanceMode: "identity" });
  }
  if (!view) {
    return;
  }

  const flag = (value: boolean | undefined) => (typeof value === "boolean" ? { value } : undefined);
  const boardPatch: Parameters<typeof writeBoardView>[0] = {};

  if (typeof view.fixedEdgeWidth === "boolean") boardPatch.fixedEdgeWidth = view.fixedEdgeWidth;
  if (view.canvasPattern && CANVAS_PATTERNS.includes(view.canvasPattern as CanvasPattern)) {
    boardPatch.canvasPattern = view.canvasPattern as CanvasPattern;
  }
  if (isCanvasThemeId(view.canvasTheme)) {
    boardPatch.canvasTheme = view.canvasTheme;
  }
  // `glanceMode` from an older plan is skipped for the same reason the reset
  // above exists; `lineHeatMode` is deliberately NOT applied either: line
  // colour rides the status glance mode now, and the old flag would arrive
  // with no control that turns it off. `linePulseMode` is skipped since the
  // dashes were retired (board-view.ts): a plan saved with them on must not
  // switch on a layer that no longer exists.
  // `lineLabelsMode` is not applied either: the rate pills on wires are
  // gone (2026-09-08), so a plan saved with them on changes nothing. Nor is
  // `calmMode`: the board's switch for it went the same day (it is the
  // export dialog's "presentation" tick now), so a plan saved with it on
  // would leave a viewer in softened colours with nothing to turn them off.
  if (Object.keys(boardPatch).length > 0) {
    writeBoardView(boardPatch);
  }

  if (scope === "board") {
    // Everything below here is the workspace around the board rather than the
    // board itself, and a tab switch leaves it alone. See PlanViewScope.
    if (view.rateUnit) {
      useFactoryStore.getState().setRateUnit(view.rateUnit);
    }
    return;
  }

  const workspacePatch: Parameters<typeof writeWorkspaceView>[0] = {};
  // Which columns the author had open is advice for a window with columns. On a
  // phone they are drawers over the board, one at a time, so a plan that carries
  // both would land the reader under two stacked panels with nothing to look at.
  const panelKeys = isCompactViewport() ? [] : (["leftPanelOpen", "rightPanelOpen"] as const);
  for (const key of [
    ...panelKeys,
    "showHiddenResources",
    "favouritesOnly",
    "trendsOpen",
  ] as const) {
    const set = flag(view[key]);
    if (set) {
      workspacePatch[key] = set.value;
    }
  }
  if (view.favouriteResourceKeys) {
    workspacePatch.favouriteResourceKeys = [...view.favouriteResourceKeys];
  }
  if (view.hiddenResourceKeys) {
    // Starred always wins over hidden - the same rule the marks are written
    // under - so a plan that somehow carries a key in both cannot land the
    // viewer in a state the UI has no button for.
    const starred = new Set(workspacePatch.favouriteResourceKeys ?? []);
    workspacePatch.hiddenResourceKeys = view.hiddenResourceKeys.filter(
      (key) => !starred.has(key),
    );
  }
  if (Object.keys(workspacePatch).length > 0) {
    writeWorkspaceView(workspacePatch);
  }

  if (view.rateUnit) {
    // Through the store, not the module singleton: flipping the unit also
    // re-solves, which is what gives every rate on screen a fresh identity.
    useFactoryStore.getState().setRateUnit(view.rateUnit);
  }
}

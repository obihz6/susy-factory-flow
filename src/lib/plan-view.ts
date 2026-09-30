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
    fixedEdgeWidth: board.fixedEdgeWidth,
    linePulseMode: board.linePulseMode,
    // The smart view (glanceMode) is deliberately NOT captured: it is a
    // personal reading of the board, and a saved setup always opens on the
    // default identity view.
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
 * the plan, but the side COLUMNS and the hidden/starred resource marks belong
 * to the person, so a tab switch leaves them alone.
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

  // A shared plan carries card positions but no camera, and factories can sit
  // thousands of cells from the origin, so frame the cards.
  useFactoryStore.getState().frameBoardNodes();
}

/**
 * The view settings themselves. Values the running build does not recognise
 * are dropped rather than written through, so a plan from a newer version
 * cannot leave the board in a state with no control that undoes it. Absent
 * fields leave the viewer's own setting alone.
 */
function applyViewSettings(view: PlanViewState | undefined, scope: PlanViewScope): void {
  // The smart view is never taken from a plan, even one that recorded it.
  // Opening a setup lands on the default identity view; switching your own
  // tabs leaves your choice alone.
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
  // Deliberately NOT applied from a plan: `glanceMode` (see the reset above),
  // `lineHeatMode`, `linePulseMode` and `lineLabelsMode` (retired features
  // that would arrive with no control to turn them off), and `calmMode` (session-only: a stored value would strand the
  // viewer in softened colours with no control to turn it off).
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
  // On compact windows the columns are drawers over the board, so the
  // author's open columns would bury the board; skip them there.
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
    // Starred always wins over hidden (the rule the marks are written under),
    // so a key in both cannot reach a state the UI has no button for.
    const starred = new Set(workspacePatch.favouriteResourceKeys ?? []);
    workspacePatch.hiddenResourceKeys = view.hiddenResourceKeys.filter((key) => !starred.has(key));
  }
  if (Object.keys(workspacePatch).length > 0) {
    writeWorkspaceView(workspacePatch);
  }

  if (view.rateUnit) {
    // Through the store, not the module singleton, so the store's rateUnit
    // and the formatters' singleton stay in step.
    useFactoryStore.getState().setRateUnit(view.rateUnit);
  }
}

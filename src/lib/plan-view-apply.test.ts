// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { readBoardViewSnapshot, writeBoardView } from "@/components/flow/board-view";
import { getActiveRateUnit } from "./model/rate-unit";
import type { PlanViewState } from "./model/types";
import { applyPlanView, capturePlanView } from "./plan-view";
import { readWorkspaceViewSnapshot, writeWorkspaceView } from "./workspace-view";
import { useFactoryStore } from "@/store/factory-store";

describe("applying a shared plan's view", () => {
  beforeEach(() => {
    writeBoardView({
      canvasPattern: "dots",
      calmMode: false,
      glanceMode: "identity",
    });
    writeWorkspaceView({
      leftPanelOpen: true,
      rightPanelOpen: true,
      showHiddenResources: false,
      favouritesOnly: false,
      trendsOpen: true,
      hiddenResourceKeys: [],
      favouriteResourceKeys: [],
    });
    useFactoryStore.getState().setRateUnit("second");
  });

  it("puts the author's whole arrangement on screen", () => {
    applyPlanView({
      canvasPattern: "cross",
      // Historical flags: older plans carry them, and they must arrive as
      // nothing at all — line colour rides the status glance mode now, and
      // the smart view is personal.
      lineHeatMode: true,
      glanceMode: "status",
      calmMode: true,
      rateUnit: "hour",
      leftPanelOpen: false,
      showHiddenResources: true,
      trendsOpen: false,
      hiddenResourceKeys: ["item:cobblestone"],
      favouriteResourceKeys: ["item:iron_ingot"],
    });

    const board = readBoardViewSnapshot();
    const workspace = readWorkspaceViewSnapshot();

    expect(board.canvasPattern).toBe("cross");
    // calmMode is deliberately NOT applied: no switch turns it back off.
    expect(board.calmMode).toBe(false);
    expect(board.glanceMode).toBe("identity");
    expect("lineHeatMode" in board).toBe(false);
    expect(workspace.leftPanelOpen).toBe(false);
    expect(workspace.showHiddenResources).toBe(true);
    expect(workspace.trendsOpen).toBe(false);
    expect(workspace.hiddenResourceKeys).toEqual(["item:cobblestone"]);
    expect(workspace.favouriteResourceKeys).toEqual(["item:iron_ingot"]);
    expect(getActiveRateUnit()).toBe("hour");
  });

  it("leaves settings the plan says nothing about alone", () => {
    writeBoardView({ calmMode: true });
    applyPlanView({ rateUnit: "minute" });

    expect(getActiveRateUnit()).toBe("minute");
    // Untouched, because the plan never mentioned it.
    expect(readBoardViewSnapshot().calmMode).toBe(true);
  });

  it("does nothing at all for a plan with no view", () => {
    applyPlanView(undefined);

    expect(readBoardViewSnapshot().canvasPattern).toBe("dots");
    expect(getActiveRateUnit()).toBe("second");
  });

  it("drops values this build does not recognise", () => {
    // A plan from a newer build must not leave the board in a state no control
    // can undo.
    applyPlanView({ canvasPattern: "hexagons", glanceMode: "x-ray" } as PlanViewState);

    expect(readBoardViewSnapshot().canvasPattern).toBe("dots");
    expect(readBoardViewSnapshot().glanceMode).toBe("identity");
  });

  it("resets the smart view to identity when a setup is opened", () => {
    // The bottom-right view choice is personal, never part of the plan:
    // whatever the viewer had picked, and whatever an older plan recorded,
    // an opened setup starts on the identity view.
    writeBoardView({ glanceMode: "power" });
    applyPlanView({ glanceMode: "status" });
    expect(readBoardViewSnapshot().glanceMode).toBe("identity");

    // Even a plan with no view at all lands there.
    writeBoardView({ glanceMode: "usage" });
    applyPlanView(undefined);
    expect(readBoardViewSnapshot().glanceMode).toBe("identity");
  });

  it("keeps your smart view across your own tabs", () => {
    writeBoardView({ glanceMode: "power" });
    applyPlanView({ calmMode: true }, "board");
    expect(readBoardViewSnapshot().glanceMode).toBe("power");
  });

  it("never lands the viewer with a resource both starred and hidden", () => {
    applyPlanView({
      favouriteResourceKeys: ["item:iron_ingot"],
      hiddenResourceKeys: ["item:iron_ingot", "item:cobblestone"],
    });

    const workspace = readWorkspaceViewSnapshot();
    expect(workspace.favouriteResourceKeys).toEqual(["item:iron_ingot"]);
    // A starred row shows no hide button, so a key in both would be stuck.
    expect(workspace.hiddenResourceKeys).toEqual(["item:cobblestone"]);
  });

  it("frames the plan when it is not told where the camera was", () => {
    applyPlanView({ calmMode: true });

    expect(useFactoryStore.getState().boardFocusRequest?.mode).toBe("fit");
  });

  it("lands on a remembered camera instead of framing", () => {
    // How a design tab comes back up where you left it: the camera wins, and
    // the plan is NOT reframed on top of it.
    applyPlanView({ calmMode: true }, "board", { x: -400, y: 120, zoom: 0.5 });

    const request = useFactoryStore.getState().boardFocusRequest;
    expect(request?.mode).toBe("viewport");
    expect(request?.camera).toEqual({ x: -400, y: 120, zoom: 0.5 });
  });

  it("captures what it applies, so a re-share carries the same arrangement", () => {
    const view: PlanViewState = {
      canvasPattern: "none",
      rateUnit: "minute",
      rightPanelOpen: false,
      favouritesOnly: true,
      hiddenResourceKeys: ["fluid:water"],
      favouriteResourceKeys: ["item:tin"],
    };
    applyPlanView(view);

    const captured = capturePlanView();
    expect(captured).toMatchObject(view);
    // And never the smart view: a re-share must not start pinning a reading
    // the original never carried.
    expect("glanceMode" in captured).toBe(false);
  });
});

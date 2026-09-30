import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOARD_MAX_ZOOM, BOARD_MIN_ZOOM } from "@/components/flow/board-camera";
import {
  beginDesignCameraHandover,
  forgetDesignCameras,
  isDesignCameraSettled,
  keepDesignCameras,
  readDesignCamera,
  settleDesignCamera,
  writeDesignCamera,
} from "./design-camera";

/**
 * Per-tab cameras. The module talks to localStorage directly, so the tests hand
 * it a window with one.
 */

let store: Map<string, string>;
let writes: number;

function installStorage(overrides?: { setItem?: () => never; getItem?: () => never }) {
  store = new Map();
  writes = 0;
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: overrides?.getItem ?? ((key: string) => store.get(key) ?? null),
      setItem:
        overrides?.setItem ??
        ((key: string, value: string) => {
          writes += 1;
          store.set(key, value);
        }),
      removeItem: (key: string) => void store.delete(key),
    },
  };
}

/** Every write gets its own timestamp, so "the oldest" is well defined. */
function installClock() {
  let now = 1_000;
  vi.spyOn(Date, "now").mockImplementation(() => (now += 1_000));
}

beforeEach(() => {
  installStorage();
  installClock();
  settleDesignCamera();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { window?: unknown }).window;
});

describe("design cameras", () => {
  it("hands a tab back the camera it was left at", () => {
    writeDesignCamera("alpha", { x: -1200, y: 340.5, zoom: 0.62 });
    expect(readDesignCamera("alpha")).toEqual({ x: -1200, y: 340.5, zoom: 0.62 });
  });

  it("has nothing for a tab that has never been looked at", () => {
    expect(readDesignCamera("never-opened")).toBeUndefined();
  });

  it("keeps each tab's camera apart", () => {
    writeDesignCamera("alpha", { x: 0, y: 0, zoom: 1 });
    writeDesignCamera("beta", { x: 900, y: -80, zoom: 0.25 });

    expect(readDesignCamera("alpha")).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(readDesignCamera("beta")).toEqual({ x: 900, y: -80, zoom: 0.25 });
  });

  it("clamps a zoom the board could not get back from", () => {
    writeDesignCamera("tiny", { x: 0, y: 0, zoom: 0.0001 });
    writeDesignCamera("huge", { x: 0, y: 0, zoom: 400 });

    expect(readDesignCamera("tiny")?.zoom).toBe(BOARD_MIN_ZOOM);
    expect(readDesignCamera("huge")?.zoom).toBe(BOARD_MAX_ZOOM);
  });

  it("ignores a camera that is not one", () => {
    writeDesignCamera("nan", { x: Number.NaN, y: 0, zoom: 1 });
    expect(readDesignCamera("nan")).toBeUndefined();

    store.set(
      "susy-factory-flow.design-cameras.v1",
      JSON.stringify({ good: { x: 1, y: 2, zoom: 1 }, bad: { x: "left", y: 2, zoom: 1 } }),
    );
    expect(readDesignCamera("good")).toEqual({ x: 1, y: 2, zoom: 1 });
    expect(readDesignCamera("bad")).toBeUndefined();
  });

  it("shrugs off a corrupt blob", () => {
    store.set("susy-factory-flow.design-cameras.v1", "not json at all");
    expect(readDesignCamera("alpha")).toBeUndefined();

    writeDesignCamera("alpha", { x: 5, y: 5, zoom: 1 });
    expect(readDesignCamera("alpha")).toEqual({ x: 5, y: 5, zoom: 1 });
  });

  it("does not write the same camera twice", () => {
    writeDesignCamera("alpha", { x: 10, y: 20, zoom: 0.5 });
    const after = writes;

    writeDesignCamera("alpha", { x: 10, y: 20, zoom: 0.5 });
    expect(writes).toBe(after);

    writeDesignCamera("alpha", { x: 10, y: 21, zoom: 0.5 });
    expect(writes).toBe(after + 1);
  });

  it("forgets closed tabs", () => {
    writeDesignCamera("alpha", { x: 1, y: 1, zoom: 1 });
    writeDesignCamera("beta", { x: 2, y: 2, zoom: 1 });

    forgetDesignCameras(["alpha"]);
    expect(readDesignCamera("alpha")).toBeUndefined();
    expect(readDesignCamera("beta")).toBeDefined();
  });

  it("keeps only the designs that still exist", () => {
    writeDesignCamera("alpha", { x: 1, y: 1, zoom: 1 });
    writeDesignCamera("beta", { x: 2, y: 2, zoom: 1 });
    writeDesignCamera("gone", { x: 3, y: 3, zoom: 1 });

    keepDesignCameras(["alpha", "beta"]);
    expect(readDesignCamera("gone")).toBeUndefined();
    expect(readDesignCamera("alpha")).toBeDefined();
    expect(readDesignCamera("beta")).toBeDefined();
  });

  it("drops the oldest once it is full", () => {
    for (let index = 0; index < 61; index += 1) {
      writeDesignCamera(`design-${index}`, { x: index, y: 0, zoom: 1 });
    }

    // 60 kept, and the one dropped is the one written longest ago.
    expect(readDesignCamera("design-0")).toBeUndefined();
    expect(readDesignCamera("design-1")).toBeDefined();
    expect(readDesignCamera("design-60")).toBeDefined();
  });

  it("survives storage being unavailable", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    installStorage({ getItem: blocked, setItem: blocked });

    expect(() => writeDesignCamera("alpha", { x: 1, y: 1, zoom: 1 })).not.toThrow();
    expect(readDesignCamera("alpha")).toBeUndefined();
  });
});

describe("the design handover latch", () => {
  it("is open until a handover starts", () => {
    expect(isDesignCameraSettled()).toBe(true);

    beginDesignCameraHandover();
    expect(isDesignCameraSettled()).toBe(false);

    settleDesignCamera();
    expect(isDesignCameraSettled()).toBe(true);
  });

  it("stays shut while handovers keep arriving", () => {
    // Two tab switches in a row, with only the second one served: the board is
    // still on its way, so nothing it reports belongs to the tab that is up.
    beginDesignCameraHandover();
    beginDesignCameraHandover();
    expect(isDesignCameraSettled()).toBe(false);

    settleDesignCamera();
    expect(isDesignCameraSettled()).toBe(true);
  });
});

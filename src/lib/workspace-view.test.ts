// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  toggleResourceFavourite,
  toggleResourceHidden,
  writeWorkspaceView,
} from "./workspace-view";

/**
 * The module caches its snapshot after the first read, so these drive it
 * through the same writers the UI uses rather than reloading it.
 */
function current() {
  return JSON.parse(
    window.localStorage.getItem("susy-factory-flow-workspace-view") ?? "{}",
  ) as { hiddenResourceKeys: string[]; favouriteResourceKeys: string[] };
}

describe("workspace view resource marks", () => {
  beforeEach(() => {
    writeWorkspaceView({ hiddenResourceKeys: [], favouriteResourceKeys: [] });
  });

  it("hides and unhides a resource", () => {
    toggleResourceHidden("item:iron");
    expect(current().hiddenResourceKeys).toEqual(["item:iron"]);

    toggleResourceHidden("item:iron");
    expect(current().hiddenResourceKeys).toEqual([]);
  });

  it("unhides a resource when it is starred", () => {
    toggleResourceHidden("item:iron");
    toggleResourceFavourite("item:iron");

    // The whole point: a star means "keep this in front of me", so it cannot
    // leave the resource sitting in the hidden list waiting to vanish again.
    expect(current().favouriteResourceKeys).toEqual(["item:iron"]);
    expect(current().hiddenResourceKeys).toEqual([]);
  });

  it("leaves other hidden resources alone when starring one", () => {
    toggleResourceHidden("item:iron");
    toggleResourceHidden("fluid:water");
    toggleResourceFavourite("item:iron");

    expect(current().hiddenResourceKeys).toEqual(["fluid:water"]);
  });

  it("does not re-hide a resource when its star is taken away", () => {
    toggleResourceHidden("item:iron");
    toggleResourceFavourite("item:iron");
    toggleResourceFavourite("item:iron");

    // Unstarring returns it to the plain list, not to the hidden one it left.
    expect(current().favouriteResourceKeys).toEqual([]);
    expect(current().hiddenResourceKeys).toEqual([]);
  });

  it("keeps the two lists exclusive across several resources", () => {
    toggleResourceHidden("item:a");
    toggleResourceHidden("item:b");
    toggleResourceFavourite("item:b");
    toggleResourceFavourite("item:c");

    const state = current();
    const overlap = state.hiddenResourceKeys.filter((key) =>
      state.favouriteResourceKeys.includes(key),
    );
    expect(overlap).toEqual([]);
    expect(state.hiddenResourceKeys).toEqual(["item:a"]);
    expect(state.favouriteResourceKeys).toEqual(["item:b", "item:c"]);
  });
});

import { describe, expect, it } from "vitest";
import { toolbarFoldFor } from "./toolbar-fold";

describe("toolbarFoldFor", () => {
  it("steps from labels to icons before folding the build tools", () => {
    expect(toolbarFoldFor(1200, false)).toMatchObject({ build: false, paint: false, modeIconsOnly: false });
    expect(toolbarFoldFor(1000, false)).toMatchObject({ build: false, paint: false, modeIconsOnly: true });
    expect(toolbarFoldFor(850, false)).toMatchObject({ build: true, paint: false, modeIconsOnly: true });
  });

  it("fits Firefox's larger text without folding while the icons still fit", () => {
    expect(toolbarFoldFor(1400, false, 1.5)).toMatchObject({ build: false, modeIconsOnly: false });
    expect(toolbarFoldFor(1250, false, 1.5)).toMatchObject({ build: false, modeIconsOnly: true });
    expect(toolbarFoldFor(1150, false, 1.5)).toMatchObject({ build: true, modeIconsOnly: true });
  });

  it("keeps the right tools visible until the folded left tools crowd them", () => {
    expect(toolbarFoldFor(600, false)).toMatchObject({ build: true, paint: false });
    expect(toolbarFoldFor(290, false)).toMatchObject({ build: true, paint: true });
  });

  it("folds both on a compact viewport", () => {
    expect(toolbarFoldFor(2000, true)).toEqual({ build: true, paint: true, paintFoldsAll: true, modeIconsOnly: true });
  });

  it("does not let an invalid text size corrupt the layout", () => {
    expect(toolbarFoldFor(1000, false, NaN)).toEqual(toolbarFoldFor(1000, false));
  });
});

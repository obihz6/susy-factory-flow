import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { getMachineStructureArt, getPowerStructureArt } from "./structure-art";

const ART_DIR = path.join(process.cwd(), "public", "power-art");

/**
 * The renders are hand-shot files listed by name in structure-art.ts, so the
 * two halves drift apart in silence: an id with no file leaves a card with a
 * broken picture, and a file no id claims is a render nobody ever sees. The
 * ids are read back out of the source because they are deliberately private -
 * exporting them only so a test could see them would be the tail wagging the
 * dog.
 */
const listedIds = [
  ...fs
    .readFileSync(path.join(process.cwd(), "src", "lib", "power", "structure-art.ts"), "utf8")
    .matchAll(/^\s*"([a-z0-9-]+)",$/gm),
].map((match) => match[1]);

/** Renders reached from somewhere other than structure-art.ts. */
const CLAIMED_ELSEWHERE = new Set([
  // RecipeNode gives the Industrial Farm's crop handler this one directly.
  "industrial-farm",
]);

describe("the multiblock structure renders", () => {
  it("lists no id without a render on disk", () => {
    const missing = listedIds.filter((id) => !fs.existsSync(path.join(ART_DIR, `${id}.png`)));
    expect(missing).toEqual([]);
  });

  it("ships no render no machine can reach", () => {
    const listed = new Set(listedIds);
    const orphans = fs
      .readdirSync(ART_DIR)
      .filter((file) => file.endsWith(".png"))
      .map((file) => file.replace(/\.png$/, ""))
      .filter((id) => !listed.has(id) && !CLAIMED_ELSEWHERE.has(id));
    expect(orphans).toEqual([]);
  });

  it("found some ids to check", () => {
    // Guards the regex above: a refactor that reshapes the sets must not turn
    // both tests into vacuous passes.
    expect(listedIds.length).toBeGreaterThan(50);
  });

  it("gives the thorium reactor and its fuel plant separate renders", () => {
    // They were one render until 2026-09-09: the grey tower filed as the LFTR
    // is the fuel plant, and the reactor had no picture of its own.
    expect(getPowerStructureArt("lftr")).toBe("/power-art/lftr.png");
    expect(getMachineStructureArt("liquid-fluoride-thorium-reactor")).toBe("/power-art/lftr.png");
    expect(getMachineStructureArt("reactor-fuel-processing-plant")).toBe(
      "/power-art/reactor-fuel-processing-plant.png",
    );
  });

  it("leaves a machine with no render of its own to its item icon", () => {
    // The old cube filed under Vacuum Furnace was not the 3x5x3 coil-lined
    // Utupu-Tanuri. Both modes use the actual controller until we have its art.
    expect(getMachineStructureArt("vacuum-furnace")).toBeUndefined();
    expect(getMachineStructureArt("multiblock-dehydrator")).toBeUndefined();
    expect(getMachineStructureArt("acid-generator")).toBeUndefined();
    expect(getMachineStructureArt(undefined)).toBeUndefined();
  });
});

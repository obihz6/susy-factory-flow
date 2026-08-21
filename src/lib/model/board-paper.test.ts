import { describe, expect, it } from "vitest";
import { BOARD_PAPER_IDS, paperForBoardId, pickBoardPaper } from "./board-paper";

describe("paperForBoardId", () => {
  it("gives every board a paper, and the same one every time", () => {
    const first = paperForBoardId("pocket-7f3a");
    expect(BOARD_PAPER_IDS).toContain(first);
    expect(paperForBoardId("pocket-7f3a")).toBe(first);
  });

  it("spreads ids across the papers rather than parking on one", () => {
    const seen = new Set(
      Array.from({ length: 200 }, (_, index) => paperForBoardId(`pocket-${index}`)),
    );
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("pickBoardPaper", () => {
  it("takes a paper nobody else is wearing", () => {
    const worn = BOARD_PAPER_IDS.slice(0, BOARD_PAPER_IDS.length - 1);
    expect(pickBoardPaper(worn, () => 0.5)).toBe(BOARD_PAPER_IDS[BOARD_PAPER_IDS.length - 1]);
  });

  it("ignores boards with no paper of their own", () => {
    expect(BOARD_PAPER_IDS).toContain(pickBoardPaper([undefined, undefined], () => 0));
  });

  it("falls back to the whole set once every paper is worn", () => {
    expect(BOARD_PAPER_IDS).toContain(pickBoardPaper(BOARD_PAPER_IDS, () => 0.99));
  });

  it("never runs off the end of the list", () => {
    // Math.random() may return values arbitrarily close to 1.
    expect(BOARD_PAPER_IDS).toContain(pickBoardPaper([], () => 0.999999999));
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "gtnh-factory-flow-board-view";

/**
 * Calm (presentation) colours must never survive a page load.
 *
 * The board's own switch for it was removed on 2026-09-08, and the image
 * export borrows the setting for the length of a capture — writing it to
 * localStorage and putting it back in a `finally`. A `finally` is not a
 * promise: close the tab mid-export and `true` is the last thing written.
 * With nothing on the board to turn it off, players were stranded in
 * softened colours permanently (reported 2026-09-09).
 *
 * Two guarantees, and this file exists so neither is quietly undone: a
 * stored `true` is never honoured, and `calmMode` never reaches storage.
 */
describe("board view: calm mode cannot outlive the session", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });

  it("ignores a stored calmMode:true, which is what freed the stuck players", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ calmMode: true }));
    const { readBoardViewSnapshot } = await import("./board-view");
    expect(readBoardViewSnapshot().calmMode).toBe(false);
  });

  it("never writes calmMode to storage, so an interrupted export strands nobody", async () => {
    const { writeBoardView } = await import("./board-view");
    writeBoardView({ calmMode: true });
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<
      string,
      unknown
    >;
    expect(stored).not.toHaveProperty("calmMode");
  });

  it("still turns calm on IN MEMORY, which is all the export capture needs", async () => {
    const { readBoardViewSnapshot, writeBoardView } = await import("./board-view");
    writeBoardView({ calmMode: true });
    expect(readBoardViewSnapshot().calmMode).toBe(true);
    writeBoardView({ calmMode: false });
    expect(readBoardViewSnapshot().calmMode).toBe(false);
  });

  it("keeps writing the settings that ARE preferences", async () => {
    const { writeBoardView } = await import("./board-view");
    writeBoardView({ canvasPattern: "cross", calmMode: true });
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<
      string,
      unknown
    >;
    expect(stored.canvasPattern).toBe("cross");
  });
});

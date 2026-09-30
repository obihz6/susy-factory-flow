import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Welcome tab across page loads.
 *
 * A reload is not a fresh visit: the regression these cover is refreshing while
 * you work and being thrown back onto Welcome, over the design you were on.
 * localStorage outlives the browser session, sessionStorage does not, so a
 * "reload" here re-imports the module against the same sessionStorage and a
 * "new visit" hands it an empty one.
 */

function makeStorage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
  };
}

type Storage = ReturnType<typeof makeStorage>;

let local: Storage;
let session: Storage;

function visit(localStorage: Storage, sessionStorage: Storage, search = "") {
  (globalThis as { window?: unknown }).window = {
    localStorage,
    sessionStorage,
    location: { search },
  };
  vi.resetModules();
  // Fresh module registry each time, so the module-level cache is a page load.
  return import("./welcome-tab");
}

beforeEach(() => {
  local = makeStorage();
  session = makeStorage();
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("welcome tab", () => {
  it("greets a first-time visitor", async () => {
    const mod = await visit(local, session);
    expect(mod.readWelcomeTabState()).toEqual({
      open: true,
      active: true,
      showOnStartup: true,
    });
  });

  it("stays off Welcome when the page is reloaded mid-session", async () => {
    const first = await visit(local, session);
    first.leaveWelcomeTab();
    expect(first.readWelcomeTabState().active).toBe(false);

    const reloaded = await visit(local, session);
    expect(reloaded.readWelcomeTabState().active).toBe(false);
    // Stepping off is not closing: the tab is still there to go back to.
    expect(reloaded.readWelcomeTabState().open).toBe(true);
  });

  it("greets a new session again", async () => {
    const first = await visit(local, session);
    first.leaveWelcomeTab();

    const laterVisit = await visit(local, makeStorage());
    expect(laterVisit.readWelcomeTabState().active).toBe(true);
  });

  it("reloads back onto Welcome when that is the tab you are on", async () => {
    const first = await visit(local, session);
    first.leaveWelcomeTab();
    first.openWelcomeTab();

    const reloaded = await visit(local, session);
    expect(reloaded.readWelcomeTabState().active).toBe(true);
  });

  it("does not greet a visitor who followed a link to a setup", async () => {
    const mod = await visit(local, session, "?plan=abc123");
    const state = mod.readWelcomeTabState();
    // Straight onto the setup the link was for, with the tab still in the strip.
    expect(state.active).toBe(false);
    expect(state.open).toBe(true);
  });

  it("stays on a linked setup when the page is reloaded", async () => {
    // The import takes ?plan= back out of the address bar, so the reload that
    // follows looks like an ordinary visit and would land back on Welcome. The
    // setup landing on the board is what tells the session otherwise.
    const linked = await visit(local, session, "?plan=abc123");
    linked.leaveWelcomeTab();

    const reloaded = await visit(local, session);
    expect(reloaded.readWelcomeTabState().active).toBe(false);
  });

  it("keeps the tab out of the strip once it is closed", async () => {
    const first = await visit(local, session);
    first.closeWelcomeTab();

    const reloaded = await visit(local, session);
    expect(reloaded.readWelcomeTabState()).toEqual({
      open: false,
      active: false,
      showOnStartup: true,
    });
  });

  it("does not open on startup once the box is unticked", async () => {
    const first = await visit(local, session);
    first.setWelcomeOnStartup(false);

    const reloaded = await visit(local, makeStorage());
    const state = reloaded.readWelcomeTabState();
    expect(state.showOnStartup).toBe(false);
    expect(state.active).toBe(false);
    expect(state.open).toBe(true);
  });

  it("survives storage being unavailable", async () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };

    const mod = await visit(blocked, blocked);
    expect(mod.readWelcomeTabState().active).toBe(true);
    expect(() => mod.leaveWelcomeTab()).not.toThrow();
    expect(mod.readWelcomeTabState().active).toBe(false);
  });
});

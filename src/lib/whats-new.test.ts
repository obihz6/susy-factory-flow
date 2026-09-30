// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/version", () => ({ APP_VERSION: "1.46.0" }));

const { compareVersions, markVersionSeen, readLastSeenVersion } = await import(
  "@/lib/whats-new"
);

const KEY = "susy-factory-flow.last-seen-version.v1";
const FORCED_KEY = "susy-factory-flow.forced-notes.v1";

describe("compareVersions", () => {
  it("orders by number, not by string", () => {
    // The reason this is not localeCompare: "1.9.0" sorts ABOVE "1.10.0" as
    // text, so a tenth minor release would silently show nobody anything.
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.46.0", "1.46.0")).toBe(0);
    expect(compareVersions("1.44.0", "1.45.0")).toBeLessThan(0);
    expect(compareVersions("1.46", "1.46.0")).toBe(0);
  });
});

describe("the version stamp", () => {
  beforeEach(() => window.localStorage.clear());

  it("reads nothing on a browser that has never been here", () => {
    expect(readLastSeenVersion()).toBeUndefined();
  });

  it("stamps the running version by default", () => {
    markVersionSeen();
    expect(window.localStorage.getItem(KEY)).toBe("1.46.0");
    expect(readLastSeenVersion()).toBe("1.46.0");
  });

  it("stamps a given version", () => {
    markVersionSeen("1.44.0");
    expect(readLastSeenVersion()).toBe("1.44.0");
  });
});

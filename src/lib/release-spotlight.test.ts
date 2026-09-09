import { describe, expect, it } from "vitest";
import { CHANGELOG } from "@/lib/changelog";
import { APP_VERSION } from "@/lib/version";
import { RELEASE_SPOTLIGHTS, pickSpotlight, type ReleaseSpotlight } from "@/lib/release-spotlight";
import { compareVersions } from "@/lib/whats-new";

const poster = (version: string): ReleaseSpotlight => ({
  version,
  title: `v${version}`,
  items: [{ icon: "sparkle", title: "Something" }],
});

const spotlights = [poster("3.0.0"), poster("2.58.0"), poster("2.50.0")];

describe("pickSpotlight", () => {
  it("shows nothing on a first visit", () => {
    expect(
      pickSpotlight({ lastSeenVersion: undefined, seen: [], appVersion: "2.58.0", spotlights }),
    ).toBeUndefined();
  });

  it("shows the poster for a release this browser missed", () => {
    expect(
      pickSpotlight({ lastSeenVersion: "2.57.0", seen: [], appVersion: "2.58.0", spotlights })
        ?.version,
    ).toBe("2.58.0");
  });

  it("never shows one twice", () => {
    expect(
      pickSpotlight({
        lastSeenVersion: "2.57.0",
        seen: ["2.58.0"],
        appVersion: "2.58.0",
        spotlights,
      }),
    ).toBeUndefined();
  });

  it("shows only the newest to somebody back after several releases", () => {
    expect(
      pickSpotlight({ lastSeenVersion: "2.40.0", seen: [], appVersion: "2.58.0", spotlights })
        ?.version,
    ).toBe("2.58.0");
  });

  it("never shows a poster for a release that has not shipped", () => {
    expect(
      pickSpotlight({ lastSeenVersion: "2.58.0", seen: [], appVersion: "2.58.0", spotlights }),
    ).toBeUndefined();
  });

  it("shows nothing for a release nobody wrote one for", () => {
    expect(
      pickSpotlight({
        lastSeenVersion: "2.56.0",
        seen: [],
        appVersion: "2.57.0",
        spotlights: [poster("2.50.0")],
      }),
    ).toBeUndefined();
  });
});

describe("the posters we ship", () => {
  it("each names a real release", () => {
    for (const spotlight of RELEASE_SPOTLIGHTS) {
      expect(CHANGELOG.map((entry) => entry.version)).toContain(spotlight.version);
    }
  });

  it("never announces a version that has not shipped", () => {
    for (const spotlight of RELEASE_SPOTLIGHTS) {
      expect(compareVersions(spotlight.version, APP_VERSION)).toBeLessThanOrEqual(0);
    }
  });

  it("keeps every tile a title, not a sentence", () => {
    for (const spotlight of RELEASE_SPOTLIGHTS) {
      expect(spotlight.items.length).toBeLessThanOrEqual(8);
      for (const item of spotlight.items) {
        expect(item.title).not.toMatch(/[.!]$/);
        expect(item.title.split(" ").length).toBeLessThanOrEqual(8);
      }
    }
  });
});

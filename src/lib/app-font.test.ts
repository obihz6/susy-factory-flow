import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_FONTS, DEFAULT_APP_FONT, isAppFontId } from "./app-font";

describe("app fonts", () => {
  it("has unique ids and includes the default", () => {
    const ids = APP_FONTS.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_APP_FONT);
  });

  it("recognises exactly its own ids", () => {
    for (const option of APP_FONTS) {
      expect(isAppFontId(option.id)).toBe(true);
    }
    expect(isAppFontId("comic-sans")).toBe(false);
    expect(isAppFontId(null)).toBe(false);
  });

  // The stacks live twice on purpose: once here for the picker's previews and
  // once in globals.css as the rules the <html> attribute switches between.
  // This is the tripwire for editing one and not the other.
  it("matches the globals.css rules stack for stack", () => {
    const css = readFileSync(
      path.resolve(__dirname, "../app/globals.css"),
      "utf8",
    );

    for (const option of APP_FONTS) {
      if (option.id === DEFAULT_APP_FONT) {
        expect(css).toContain(`--app-font: ${option.stack};`);
        continue;
      }
      const rule = new RegExp(
        `html\\[data-app-font="${option.id}"\\]\\s*\\{\\s*--app-font:\\s*${escapeRegExp(
          option.stack,
        )};`,
      );
      expect(css).toMatch(rule);
    }
  });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

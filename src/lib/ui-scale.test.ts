// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function stubMatchMedia(answer: (media: string) => boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (media: string) =>
      ({
        matches: answer(media),
        media,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}

describe("interface size", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    document.documentElement.removeAttribute("style");
    document.documentElement.removeAttribute("data-compact");
    document.documentElement.removeAttribute("data-snug");
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("renders 100% at 1.17 on a desktop window", async () => {
    stubMatchMedia(() => false);
    const { getUiScale, getUiScalePercent } = await import("./ui-scale");
    expect(getUiScalePercent()).toBe(100);
    expect(getUiScale()).toBe(1.17);
  });

  it("renders 100% at 0.9 on a phone", async () => {
    stubMatchMedia((media) => media.includes("899.98px"));
    const { getUiScale } = await import("./ui-scale");
    expect(getUiScale()).toBe(0.9);
  });

  it("is 1 where there is no matchMedia to ask", async () => {
    const { getUiScale } = await import("./ui-scale");
    expect(getUiScale()).toBe(1);
  });

  it("steps in tens, clamps, persists and stamps the document", async () => {
    stubMatchMedia(() => false);
    const { setUiScalePercent, getUiScale, getUiScalePercent, clampUiScalePercent } = await import(
      "./ui-scale"
    );
    expect(clampUiScalePercent(125)).toBe(130);
    expect(clampUiScalePercent(10)).toBe(60);
    expect(clampUiScalePercent(999)).toBe(200);
    expect(clampUiScalePercent(Number.NaN)).toBe(100);

    setUiScalePercent(120);
    expect(getUiScalePercent()).toBe(120);
    expect(getUiScale()).toBe(1.404);
    expect(window.localStorage.getItem("gtnh-factory-flow.ui-scale.v1")).toBe("120");
    expect(document.documentElement.style.getPropertyValue("--ui-scale")).toBe("1.404");
    // The exact reciprocal as a calc(), so the board's inverse zoom cancels
    // the shell's to exactly 1 (a rounded decimal left sub-pixel geometry
    // that doubled the compositor's per-frame work).
    expect(document.documentElement.style.getPropertyValue("--ui-scale-inverse")).toBe(
      "calc(1 / 1.404)",
    );
  });

  it("reads a stored percent back", async () => {
    stubMatchMedia(() => false);
    window.localStorage.setItem("gtnh-factory-flow.ui-scale.v1", "80");
    const { getUiScale } = await import("./ui-scale");
    expect(getUiScale()).toBe(0.936);
  });

  it("builds the breakpoint queries from the factor and stamps the attributes", async () => {
    // 1400px window at 1.3: 1077 shell px, so snug (under 1280) but not compact.
    stubMatchMedia((media) => {
      const width = Number(/max-width: ([\d.]+)px/.exec(media)?.[1] ?? 0);
      return media.includes("899.98px") ? false : 1400 <= width;
    });
    const { compactMediaQuery, snugMediaQuery, stampViewportAttributes, isCompactViewport } =
      await import("./compact-view");
    expect(compactMediaQuery(1.3)).toBe("(max-width: 1169.98px), (max-height: 727.98px)");
    expect(snugMediaQuery(1.3)).toBe("(max-width: 1663.98px)");
    stampViewportAttributes();
    expect(isCompactViewport()).toBe(false);
    expect(document.documentElement.hasAttribute("data-compact")).toBe(false);
    expect(document.documentElement.hasAttribute("data-snug")).toBe(true);
  });

  it("writes a boot script that repeats the same numbers", async () => {
    const { uiScaleBootScript } = await import("./ui-scale-boot");
    const script = uiScaleBootScript({ compactMaxWidth: 900, compactMaxHeight: 560, snugMaxWidth: 1280 });
    expect(script).toContain("gtnh-factory-flow.ui-scale.v1");
    expect(script).toContain("899.98px");
    expect(script).toContain("900*s-0.02");
    expect(script).toContain("1280*s-0.02");
    expect(script).toContain('"--ui-scale"');
    // It must be plain script: no template literal or module syntax survives.
    expect(script).not.toContain("import ");
    expect(() => new Function(script)).not.toThrow();
  });
});

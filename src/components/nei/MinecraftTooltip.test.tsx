// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MinecraftTooltip } from "./MinecraftTooltip";

describe("MinecraftTooltip", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  it.each([
    [40, 180, "below", "items-start"],
    [550, 680, "above", "items-end"],
  ])("places a card tooltip with top %s on the roomy side", async (top, bottom, side, alignment) => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(240);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(240);
    const { container } = render(
      <div className="react-flow__node">
        <MinecraftTooltip placement="above-card" content={<div>Power details</div>} companion={<div>Controls guide</div>}>
          <button>Power</button>
        </MinecraftTooltip>
      </div>,
    );
    vi.spyOn(container.firstElementChild!, "getBoundingClientRect").mockReturnValue({
      top, bottom, left: 200, right: 500, width: 300, height: bottom - top, x: 200, y: top, toJSON: () => ({}),
    });
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Power" }), { clientX: 300, clientY: top + 10 });
    await screen.findByText("Power details");
    const panel = document.querySelector("[data-card-placement]")!;
    expect(panel.getAttribute("data-card-placement")).toBe(side);
    expect(panel.classList.contains(alignment)).toBe(true);
    expect(Number.parseFloat((panel as HTMLElement).style.maxHeight)).toBeGreaterThanOrEqual(240);
  });

  it("clears an open tooltip when a scroll puts something else under the pointer", async () => {
    render(
      <>
        <MinecraftTooltip label="Tooltip line">
          <button type="button">Hover target</button>
        </MinecraftTooltip>
        <p>Something else</p>
      </>,
    );
    const elsewhere = screen.getByText("Something else");
    (document as Document & { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint =
      () => elsewhere;

    fireEvent.mouseMove(screen.getByRole("button", { name: "Hover target" }), {
      clientX: 120,
      clientY: 80,
      buttons: 0,
    });

    expect(await screen.findByText("Tooltip line")).toBeTruthy();

    fireEvent.wheel(window);

    await waitFor(() => {
      expect(screen.queryByText("Tooltip line")).toBeNull();
    });
  });

  it("keeps the tooltip when the hovered thing is still under the pointer after a wheel", async () => {
    // A board zoom keeps the card under the pointer, a rotating slot steps in
    // place, a setting tile steps its count: none of them moved the thing
    // being read, so the tip must not blink out on every notch.
    render(
      <MinecraftTooltip label="Oak Log">
        <button type="button">Hover target</button>
      </MinecraftTooltip>,
    );

    const target = screen.getByRole("button", { name: "Hover target" });
    (document as Document & { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint =
      () => target;
    fireEvent.mouseMove(target, { clientX: 120, clientY: 80, buttons: 0 });
    expect(await screen.findByText("Oak Log")).toBeTruthy();

    fireEvent.wheel(target);
    fireEvent.wheel(window);

    expect(screen.getByText("Oak Log")).toBeTruthy();
  });

  it("keeps the tooltip when the document cannot say what is under the pointer", async () => {
    render(
      <MinecraftTooltip label="Oak Log">
        <button type="button">Hover target</button>
      </MinecraftTooltip>,
    );
    delete (document as Partial<Document>).elementFromPoint;

    const target = screen.getByRole("button", { name: "Hover target" });
    fireEvent.mouseMove(target, { clientX: 120, clientY: 80, buttons: 0 });
    expect(await screen.findByText("Oak Log")).toBeTruthy();

    fireEvent.wheel(window);

    expect(screen.getByText("Oak Log")).toBeTruthy();
  });

  it("keeps the tooltip while one of its own controls is clicked", async () => {
    // The tier chip and hatch counter live under the power tooltip and change
    // the very numbers it shows: clicking them must leave the panel up so each
    // click's result is readable without re-hovering.
    render(
      <MinecraftTooltip label="Power story">
        <button type="button">Raise tier</button>
      </MinecraftTooltip>,
    );

    const target = screen.getByRole("button", { name: "Raise tier" });
    fireEvent.mouseMove(target, { clientX: 120, clientY: 80, buttons: 0 });
    expect(await screen.findByText("Power story")).toBeTruthy();

    // pointerType matters: the pointer-kind singleton reads it, and an
    // unlabelled pointerdown registers as a finger and mutes hover for the
    // rest of the suite.
    fireEvent.pointerDown(target, { pointerType: "mouse" });
    expect(screen.getByText("Power story")).toBeTruthy();

    // The click's own micro-drag: a mousemove with the button still down on
    // the control must not blink the panel out either.
    fireEvent.mouseMove(target, { clientX: 121, clientY: 80, buttons: 1 });
    expect(screen.getByText("Power story")).toBeTruthy();
  });

  it("survives an element blur but clears when the window loses focus", async () => {
    // Clicking a control under the tooltip blurs whatever held focus before
    // it; only the window itself going unfocused ends the hover story.
    render(
      <MinecraftTooltip label="Power story">
        <button type="button">Raise tier</button>
      </MinecraftTooltip>,
    );

    const target = screen.getByRole("button", { name: "Raise tier" });
    fireEvent.mouseMove(target, { clientX: 120, clientY: 80, buttons: 0 });
    expect(await screen.findByText("Power story")).toBeTruthy();

    fireEvent.blur(target);
    expect(screen.getByText("Power story")).toBeTruthy();

    fireEvent.blur(window);
    await waitFor(() => {
      expect(screen.queryByText("Power story")).toBeNull();
    });
  });

  it("clears an open tooltip when panning starts", async () => {
    render(
      <MinecraftTooltip label="Tooltip line">
        <button type="button">Hover target</button>
      </MinecraftTooltip>,
    );

    fireEvent.mouseMove(screen.getByRole("button", { name: "Hover target" }), {
      clientX: 120,
      clientY: 80,
      buttons: 0,
    });

    expect(await screen.findByText("Tooltip line")).toBeTruthy();

    fireEvent.pointerDown(window);

    await waitFor(() => {
      expect(screen.queryByText("Tooltip line")).toBeNull();
    });
  });
});

describe("MinecraftTooltip fast pass", () => {
  afterEach(() => {
    cleanup();
  });

  it("never commits open when the pointer left before the opening frame ran", async () => {
    // The open lands on an animation frame; a fast sweep leaves the target
    // before that frame. The leave must still win, or the panel commits open
    // with nobody left to close it.
    vi.restoreAllMocks();
    let queued: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      queued = callback;
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {
      queued = undefined;
    });
    render(
      <MinecraftTooltip label="Quick line">
        <button type="button">Hover target</button>
      </MinecraftTooltip>,
    );
    const target = screen.getByRole("button", { name: "Hover target" });
    fireEvent.mouseMove(target, { clientX: 120, clientY: 80, buttons: 0 });
    const frame = queued;
    // The frame fires, but React has not re-rendered when the leave arrives.
    if (frame) frame(0);
    fireEvent.mouseLeave(target);
    await waitFor(() => {
      expect(screen.queryByText("Quick line")).toBeNull();
    });
  });
});

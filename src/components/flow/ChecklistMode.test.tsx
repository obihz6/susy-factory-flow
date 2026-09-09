// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useFactoryStore } from "@/store/factory-store";
import { useChecklistBoard } from "./ChecklistMode";

const originalToggle = useFactoryStore.getState().toggleChecklist;
afterEach(() => {
  cleanup();
  useFactoryStore.setState({ checklistMode: false, toggleChecklist: originalToggle });
});

describe("checklist gesture ownership", () => {
  it("captures checks but lets middle-button pan and wheel navigation through", () => {
    const toggle = vi.fn();
    const mouseDown = vi.fn();
    const wheel = vi.fn();
    useFactoryStore.setState({ checklistMode: true, toggleChecklist: toggle });
    function Board() {
      const capture = useChecklistBoard([]);
      return <div onMouseDownCapture={capture} onClickCapture={capture} onWheelCapture={capture}>
        <div data-testid="card" data-id="machine" className="react-flow__node checklist-done"
          onMouseDown={mouseDown} onWheel={wheel}>Machine</div>
      </div>;
    }
    const card = render(<Board />).getByTestId("card");
    fireEvent.mouseDown(card, { button: 1 });
    expect(mouseDown).toHaveBeenCalledOnce();
    fireEvent.wheel(card, { deltaY: 100 });
    expect(wheel).toHaveBeenCalledOnce();
    fireEvent.mouseDown(card, { button: 0 });
    expect(mouseDown).toHaveBeenCalledOnce();
    fireEvent.click(card, { button: 0 });
    expect(toggle).toHaveBeenCalledExactlyOnceWith("cards", ["machine"]);
    fireEvent.click(card, { button: 1 });
    expect(toggle).toHaveBeenCalledOnce();
  });
});

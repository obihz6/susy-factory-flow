"use client";

import { useEffect, type RefObject, type SyntheticEvent } from "react";

/** Native inert controls also stay out of keyboard focus. Board-window
 * navigation opts in; the factory store is the edit backstop. */
export function useViewerLock(ref: RefObject<HTMLDivElement | null>, locked: boolean) {
  useEffect(() => {
    const root = ref.current;
    if (!locked || !root) return;
    const touched = new Map<HTMLElement, string | null>();
    const disableControls = () => {
      for (const control of root.querySelectorAll<HTMLElement>(
        '.react-flow__node button, .react-flow__node input, .react-flow__node select, .react-flow__node textarea, .react-flow__node [role="button"], .react-flow__node [contenteditable="true"]',
      )) {
        if (control.closest("[data-viewer-inspect]") || control.inert) continue;
        touched.set(control, control.getAttribute("aria-disabled"));
        control.inert = true;
        control.setAttribute("aria-disabled", "true");
        control.setAttribute("data-viewer-disabled", "");
      }
    };
    disableControls();
    const observer = new MutationObserver(disableControls);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      for (const [control, ariaDisabled] of touched) {
        control.inert = false;
        if (ariaDisabled === null) control.removeAttribute("aria-disabled");
        else control.setAttribute("aria-disabled", ariaDisabled);
        control.removeAttribute("data-viewer-disabled");
      }
    };
  }, [ref, locked]);

  return (event: SyntheticEvent): boolean => {
    if (!locked || !(event.target instanceof Element)) return false;
    const target = event.target;
    if (target.closest("[data-viewer-inspect]")) return false;
    if (target.closest(".react-flow__node") || event.type === "contextmenu") {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    return false;
  };
}

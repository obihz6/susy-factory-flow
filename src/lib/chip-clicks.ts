/**
 * Whether the power chips' click gestures are swapped.
 *
 * Default: click opens the dropdown, shift-click steps. Inverted: click
 * steps, shift-click opens the dropdown. Right click steps down in BOTH
 * modes, shift or not - it conflicts with nothing.
 *
 * Read at EVENT time by the handlers rather than subscribed to: clicks are
 * rare, cards are many, and the setting applying instantly with zero render
 * cost beats a hook.
 */
const KEY = "gtnh-factory-flow.chip-clicks-inverted.v1";

export function areChipClicksInverted(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

export function setChipClicksInverted(inverted: boolean): void {
  try {
    if (inverted) {
      window.localStorage.setItem(KEY, "on");
    } else {
      window.localStorage.removeItem(KEY);
    }
  } catch {
    // A blocked quota must never break the app.
  }
}

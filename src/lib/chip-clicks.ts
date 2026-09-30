/**
 * Whether power-chip click gestures are swapped.
 *
 * The setting is read at event time by chip handlers, so changing it applies
 * immediately without subscribing every recipe card to another store value.
 */
const KEY = "susy-factory-flow.chip-clicks-inverted.v1";

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
    // A blocked storage quota must never break the planner.
  }
}

/**
 * The bridge that lets far-away buttons (the account menu, the share dialog)
 * land the sidebar on the Setups shelf. The panel may not be mounted when the
 * click happens, so the requested scope waits in module state until either
 * the mounted panel's listener or the next mount collects it.
 */
export const OPEN_SETUPS_EVENT = "susy:open-setups";

/**
 * Fired when a share lands on the network, wherever it was posted from (the
 * shelf's own button or the top bar). A mounted Setups panel refetches so the
 * new post is already on the shelf when the dialog closes.
 */
export const SETUPS_CHANGED_EVENT = "susy:setups-changed";

export function notifySetupsChanged(): void {
  window.dispatchEvent(new Event(SETUPS_CHANGED_EVENT));
}

export type SetupsScope = "network" | "mine";

let pendingScope: SetupsScope | undefined;

export function openSetupsTab(scope?: SetupsScope): void {
  pendingScope = scope;
  window.dispatchEvent(new Event(OPEN_SETUPS_EVENT));
}

/** One-shot read of the scope the last open asked for, if any. */
export function takePendingSetupsScope(): SetupsScope | undefined {
  const scope = pendingScope;
  pendingScope = undefined;
  return scope;
}

/**
 * Landing the left column on one of its three tabs from anywhere else in the
 * app.
 *
 * Same bargain as `setups-tab.ts`, generalised: the panel may not be mounted
 * when the request is made (on a phone it is a closed drawer), so the wanted
 * tab waits in module state until either the mounted panel's listener or the
 * next mount collects it.
 *
 * `openSetupsTab` stays where it is. It carries a shelf SCOPE as well as a tab,
 * and the Setups panel listens for that separately.
 */
export const OPEN_SIDEBAR_TAB_EVENT = "susy:open-sidebar-tab";

export type SidebarTab = "items" | "blueprints" | "setups";

let pendingTab: SidebarTab | undefined;

export function openSidebarTab(tab: SidebarTab): void {
  pendingTab = tab;
  window.dispatchEvent(new Event(OPEN_SIDEBAR_TAB_EVENT));
}

/** One-shot read of the tab the last request asked for, if any. */
export function takePendingSidebarTab(): SidebarTab | undefined {
  const tab = pendingTab;
  pendingTab = undefined;
  return tab;
}

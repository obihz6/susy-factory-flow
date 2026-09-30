/**
 * Landing the left column on a tab from anywhere else in the app.
 *
 * The panel may not be mounted when the request is made (on a phone it is a
 * closed drawer), so the wanted tab waits in module state until either the
 * mounted panel's listener or the next mount collects it.
 */
export const OPEN_SIDEBAR_TAB_EVENT = "susy:open-sidebar-tab";

/** The column's only tab; boards and setups live in the library. */
export type SidebarTab = "items";

let pendingTab: SidebarTab | undefined;
let pendingFocusSearch = false;

/**
 * `focusSearch` also puts the cursor in the Items tab's search box (used by
 * the Welcome page's "Find a recipe", where the column may already be open,
 * so reopening it alone would show nothing).
 */
export function openSidebarTab(tab: SidebarTab, options: { focusSearch?: boolean } = {}): void {
  pendingTab = tab;
  pendingFocusSearch = Boolean(options.focusSearch) && tab === "items";
  window.dispatchEvent(new Event(OPEN_SIDEBAR_TAB_EVENT));
}

/** One-shot read of the tab the last request asked for, if any. */
export function takePendingSidebarTab(): SidebarTab | undefined {
  const tab = pendingTab;
  pendingTab = undefined;
  return tab;
}

/** One-shot read of whether that request wanted the search box focused. */
export function takePendingSearchFocus(): boolean {
  const focus = pendingFocusSearch;
  pendingFocusSearch = false;
  return focus;
}

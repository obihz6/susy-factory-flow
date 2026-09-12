import type { LibrarySyncStatus } from "./library-sync";

export function accountSaveStatus(
  signedIn: boolean,
  sync: LibrarySyncStatus,
): { text: string; error: boolean } {
  if (sync.state === "error" || (signedIn && sync.state === "off" && sync.message)) {
    return { text: "Not saved to account — retrying", error: true };
  }
  if (!signedIn) return { text: "Saved on this device", error: false };
  if (sync.state === "idle" && sync.lastSyncedAt) {
    return { text: "Saved to account", error: false };
  }
  return { text: "Saving to account…", error: false };
}

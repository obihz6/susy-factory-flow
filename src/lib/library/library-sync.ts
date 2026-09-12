"use client";

import { create } from "zustand";
import { forgetDesignCameras } from "@/lib/designs/design-camera";
import type { DesignFolder, DesignSummary } from "@/lib/designs/design-library";
import {
  deleteDesign,
  deleteDesignFolder,
  listDesignFolders,
  listDesignSummaries,
  readDesign,
  writeDesign,
  writeDesignFolder,
  writeDesignSummary,
} from "@/lib/designs/design-storage";
import { parseFactoryProjectJson } from "@/lib/import-export";
import { useCommunityAuthStore } from "@/store/community-auth-store";
import { useDesignStore } from "@/store/design-store";
import {
  deleteRemoteDesign,
  deleteRemoteFolder,
  fetchRemoteDesignPlan,
  fetchRemoteLibrary,
  pushRemoteDesign,
  pushRemoteFolder,
} from "./client";
import {
  forgetLibraryDeletion,
  readPendingDeletes,
  subscribeToLibraryDeletions,
} from "./library-deletes";
import type { RemoteDesignMeta, RemoteFolder } from "./sync-types";

/**
 * Keeps the browser's library and the account's copy the same.
 *
 * THE RULES, all in `reconcileDesigns` / `reconcileFolders` (pure, tested):
 * - Every record carries `remoteUpdatedAt`: the account's `updatedAt` as of
 *   the last time both sides agreed. Absent means never synced.
 * - A local record is DIRTY when it changed since that agreement; a remote
 *   record has MOVED when its `updatedAt` is past it.
 * - Neither moved: nothing. Only one moved: that side wins. Both moved: the
 *   later write wins, by the writers' own clocks. No merging of plans.
 * - A tombstone deletes the local copy unless the local copy was edited
 *   after the delete, in which case the edit brings the design back.
 * - A local record the account has never seen is pushed, so signing in on a
 *   new browser ADDS its designs to the account rather than losing either.
 * - Plans are fetched only when `planUpdatedAt` moved; a rename or a close
 *   costs one small row.
 *
 * WHEN: on sign-in, on load, when the tab comes back to the front, every
 * half minute, and a few seconds after any change to the library (which is
 * how autosave reaches the account). One run at a time; a request during a
 * run queues one more.
 *
 * WHEN NOT: signed out. Database and network failures stay visible and retry
 * on the next poll, focus or connection recovery.
 */

export interface LibrarySyncStatus {
  state: "off" | "pending" | "idle" | "syncing" | "error";
  /** Why it is off, or what failed. */
  message?: string;
  lastSyncedAt?: string;
  /** Set after a pull replaced the plan that was on the canvas. */
  reloadedActiveAt?: string;
}

export const useLibrarySyncStore = create<LibrarySyncStatus>(() => ({ state: "off" }));

const PUSH_DEBOUNCE_MS = 500;
const POLL_MS = 30000;

/* ------------------------------------------------------------------ */
/* The pure part. */

export type DesignAction =
  | { kind: "pull-plan"; id: string; remote: RemoteDesignMeta }
  | { kind: "pull-meta"; id: string; remote: RemoteDesignMeta }
  | { kind: "delete-local"; id: string }
  | { kind: "push"; id: string; withPlan: boolean };

export type FolderAction =
  | { kind: "pull"; id: string; remote: RemoteFolder }
  | { kind: "delete-local"; id: string }
  | { kind: "push"; id: string };

type LocalDesign = Pick<DesignSummary, "id" | "updatedAt" | "metaUpdatedAt" | "remoteUpdatedAt">;

const ts = (value: string | undefined): number => (value ? Date.parse(value) : 0);

export function reconcileDesigns(local: LocalDesign[], remote: RemoteDesignMeta[]): DesignAction[] {
  const actions: DesignAction[] = [];
  const localById = new Map(local.map((design) => [design.id, design]));
  const seen = new Set<string>();

  for (const r of remote) {
    seen.add(r.id);
    const l = localById.get(r.id);
    const remoteAt = ts(r.updatedAt);

    if (!l) {
      if (!r.deletedAt) {
        actions.push({ kind: "pull-plan", id: r.id, remote: r });
      }
      continue;
    }

    const synced = ts(l.remoteUpdatedAt);
    const localAt = Math.max(ts(l.metaUpdatedAt), ts(l.updatedAt));
    const dirty = !l.remoteUpdatedAt || localAt > synced;
    const planDirty = !l.remoteUpdatedAt || ts(l.updatedAt) > synced;

    if (r.deletedAt) {
      // An edit made after the delete brings it back; otherwise it goes.
      if (dirty && localAt > remoteAt) {
        actions.push({ kind: "push", id: l.id, withPlan: true });
      } else {
        actions.push({ kind: "delete-local", id: l.id });
      }
      continue;
    }

    const remoteMoved = remoteAt > synced;
    if (remoteMoved && (!dirty || remoteAt >= localAt)) {
      const planMoved = !l.remoteUpdatedAt || ts(r.planUpdatedAt) > synced;
      actions.push({ kind: planMoved ? "pull-plan" : "pull-meta", id: r.id, remote: r });
    } else if (dirty) {
      actions.push({ kind: "push", id: l.id, withPlan: planDirty || remoteMoved });
    }
  }

  for (const l of local) {
    if (!seen.has(l.id)) {
      actions.push({ kind: "push", id: l.id, withPlan: true });
    }
  }
  return actions;
}

type LocalFolder = Pick<DesignFolder, "id" | "createdAt" | "updatedAt" | "remoteUpdatedAt">;

export function reconcileFolders(local: LocalFolder[], remote: RemoteFolder[]): FolderAction[] {
  const actions: FolderAction[] = [];
  const localById = new Map(local.map((folder) => [folder.id, folder]));
  const seen = new Set<string>();

  for (const r of remote) {
    seen.add(r.id);
    const l = localById.get(r.id);
    const remoteAt = ts(r.updatedAt);
    if (!l) {
      if (!r.deletedAt) {
        actions.push({ kind: "pull", id: r.id, remote: r });
      }
      continue;
    }
    const synced = ts(l.remoteUpdatedAt);
    const localAt = ts(l.updatedAt ?? l.createdAt);
    const dirty = !l.remoteUpdatedAt || localAt > synced;
    if (r.deletedAt) {
      if (dirty && localAt > remoteAt) {
        actions.push({ kind: "push", id: l.id });
      } else {
        actions.push({ kind: "delete-local", id: l.id });
      }
      continue;
    }
    const remoteMoved = remoteAt > synced;
    if (remoteMoved && (!dirty || remoteAt >= localAt)) {
      actions.push({ kind: "pull", id: r.id, remote: r });
    } else if (dirty) {
      actions.push({ kind: "push", id: l.id });
    }
  }
  for (const l of local) {
    if (!seen.has(l.id)) {
      actions.push({ kind: "push", id: l.id });
    }
  }
  return actions;
}

/* ------------------------------------------------------------------ */
/* Running it. */

let running: Promise<void> | undefined;
let runAgain = false;
let pushTimer: number | undefined;

function setStatus(patch: Partial<LibrarySyncStatus>) {
  useLibrarySyncStore.setState(patch);
}

function isSignedIn(): boolean {
  return Boolean(useCommunityAuthStore.getState().user);
}

/** Sync now, or queue one more run if one is under way. */
export function syncLibraryNow(): Promise<void> {
  if (!isSignedIn()) {
    return Promise.resolve();
  }
  if (running) {
    runAgain = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        runAgain = false;
        await runOnce();
      } while (runAgain && isSignedIn());
    } finally {
      running = undefined;
    }
  })();
  return running;
}

function scheduleSync(delayMs = PUSH_DEBOUNCE_MS) {
  if (!isSignedIn()) {
    return;
  }
  if (pushTimer !== undefined) {
    return;
  }
  if (useLibrarySyncStore.getState().state !== "error") setStatus({ state: "pending" });
  pushTimer = window.setTimeout(() => {
    pushTimer = undefined;
    void syncLibraryNow();
  }, delayMs);
}

async function runOnce(): Promise<void> {
  setStatus({ state: "syncing" });
  try {
    await drainDeletions();
    const remote = await fetchRemoteLibrary();
    const [designs, folders] = await Promise.all([listDesignSummaries(), listDesignFolders()]);
    // Folders first, so a pulled design's folder exists when it lands.
    const folderActions = reconcileFolders(folders, remote.folders);
    for (const action of folderActions) {
      await applyFolderAction(action, folders);
    }
    const designActions = reconcileDesigns(designs, remote.designs);
    let touched = folderActions.length > 0;
    for (const action of designActions) {
      await applyDesignAction(action);
      touched = true;
    }
    if (touched) {
      await useDesignStore.getState().refreshLibrary();
    }
    setStatus({ state: "idle", message: undefined, lastSyncedAt: new Date().toISOString() });
  } catch (error) {
    // A repaired schema, restored connection or renewed session must recover
    // without requiring the player to reload a page holding unsaved work.
    setStatus({
      state: "error",
      message: error instanceof Error ? error.message : "Sync failed.",
    });
  }
}

async function drainDeletions(): Promise<void> {
  const pending = readPendingDeletes();
  for (const id of pending.designs) {
    await deleteRemoteDesign(id);
    forgetLibraryDeletion("design", id);
  }
  for (const id of pending.folders) {
    await deleteRemoteFolder(id);
    forgetLibraryDeletion("folder", id);
  }
}

async function applyFolderAction(action: FolderAction, local: DesignFolder[]): Promise<void> {
  switch (action.kind) {
    case "pull": {
      const existing = local.find((folder) => folder.id === action.id);
      await writeDesignFolder({
        ...existing,
        id: action.remote.id,
        name: action.remote.name,
        createdAt: action.remote.createdAt,
        updatedAt: action.remote.updatedAt,
        remoteUpdatedAt: action.remote.updatedAt,
      });
      return;
    }
    case "delete-local":
      await deleteDesignFolder(action.id);
      return;
    case "push": {
      const folder = local.find((entry) => entry.id === action.id);
      if (!folder) {
        return;
      }
      const updatedAt = folder.updatedAt ?? folder.createdAt;
      const result = await pushRemoteFolder(folder.id, {
        name: folder.name,
        createdAt: folder.createdAt,
        updatedAt,
      });
      if (result.behind) {
        // The account has a newer row; the next run pulls it.
        runAgain = true;
        return;
      }
      await writeDesignFolder({ ...folder, updatedAt, remoteUpdatedAt: result.folder.updatedAt });
    }
  }
}

async function applyDesignAction(action: DesignAction): Promise<void> {
  const store = useDesignStore.getState();
  switch (action.kind) {
    case "pull-plan": {
      const { design, plan } = await fetchRemoteDesignPlan(action.id);
      const project = parseFactoryProjectJson(JSON.stringify(plan));
      const existing = await readDesign(action.id);
      await writeDesign({
        ...existing,
        ...remoteMetaToSummary(design),
        project: { ...project, name: design.name },
      });
      if (action.id === store.activeDesignId) {
        await store.reloadActiveDesign();
        setStatus({ reloadedActiveAt: new Date().toISOString() });
      }
      if (design.closed && action.id === store.activeDesignId) {
        await store.closeDesign(action.id);
      }
      return;
    }
    case "pull-meta": {
      const existing = await readDesign(action.id);
      if (!existing) {
        return;
      }
      const wasClosed = Boolean(existing.closed);
      await writeDesignSummary({
        ...existing,
        ...remoteMetaToSummary(action.remote),
        // The plan did not move: keep the local plan's own stamp and the
        // marks derived from it.
        updatedAt: existing.updatedAt,
        icon: existing.icon,
        communityPlanId: existing.communityPlanId,
      });
      if (action.id === store.activeDesignId) {
        if (action.remote.name !== existing.name) {
          await store.refreshLibrary();
          store.syncActiveName();
        }
        if (action.remote.closed && !wasClosed) {
          await store.refreshLibrary();
          await store.closeDesign(action.id);
        }
      }
      return;
    }
    case "delete-local": {
      if (action.id === store.activeDesignId) {
        await store.removeDesign(action.id, { fromSync: true });
      } else {
        await deleteDesign(action.id);
        forgetDesignCameras([action.id]);
      }
      return;
    }
    case "push": {
      const record = await readDesign(action.id);
      if (!record) {
        return;
      }
      const updatedAt = record.metaUpdatedAt ?? record.updatedAt;
      const result = await pushRemoteDesign(record.id, {
        name: record.name,
        icon: record.icon ?? null,
        folderId: record.folderId ?? null,
        closed: Boolean(record.closed),
        favorite: Boolean(record.favorite),
        order: record.order ?? null,
        communityPlanId: record.communityPlanId ?? null,
        createdAt: record.createdAt,
        updatedAt,
        planUpdatedAt: record.updatedAt,
        ...(action.withPlan ? { plan: record.project } : {}),
      });
      if (result.behind) {
        runAgain = true;
        return;
      }
      // Re-read before stamping: autosave may have written since.
      const fresh = await readDesign(record.id);
      if (fresh) {
        await writeDesignSummary({
          ...toSummaryOf(fresh),
          remoteUpdatedAt: result.design.updatedAt,
        });
      }
    }
  }
}

function toSummaryOf(record: DesignSummary & { project?: unknown }): DesignSummary {
  const summary: DesignSummary = { ...record };
  delete (summary as { project?: unknown }).project;
  return summary;
}

function remoteMetaToSummary(remote: RemoteDesignMeta): DesignSummary {
  const summary: DesignSummary = {
    id: remote.id,
    name: remote.name,
    createdAt: remote.createdAt,
    updatedAt: remote.planUpdatedAt,
    metaUpdatedAt: remote.updatedAt,
    remoteUpdatedAt: remote.updatedAt,
  };
  if (remote.icon) {
    summary.icon = remote.icon;
  }
  if (remote.folderId) {
    summary.folderId = remote.folderId;
  }
  if (remote.closed) {
    summary.closed = true;
  }
  if (remote.favorite) {
    summary.favorite = true;
  }
  if (remote.order !== null) {
    summary.order = remote.order;
  }
  if (remote.communityPlanId) {
    summary.communityPlanId = remote.communityPlanId;
  }
  return summary;
}

/* ------------------------------------------------------------------ */

/**
 * Wires the engine to the app: sign-in starts it, sign-out stops it, the
 * library's own changes push, and the tab coming back pulls. Returns the
 * teardown. Mounted once by the app shell.
 */
export function startLibrarySync(): () => void {
  let pollTimer: number | undefined;
  let lastUser: string | undefined;

  const onUser = () => {
    const user = useCommunityAuthStore.getState().user?.username;
    if (user === lastUser) {
      return;
    }
    lastUser = user;
    if (pollTimer !== undefined) {
      window.clearInterval(pollTimer);
      pollTimer = undefined;
    }
    if (!user) {
      setStatus({ state: "off", message: undefined, lastSyncedAt: undefined });
      return;
    }
    setStatus({ state: "pending", message: undefined, lastSyncedAt: undefined });
    void syncLibraryNow();
    pollTimer = window.setInterval(() => void syncLibraryNow(), POLL_MS);
  };
  onUser();
  const unsubscribeAuth = useCommunityAuthStore.subscribe(onUser);

  // The library changed here: push a few seconds after the last change.
  let lastDesigns = useDesignStore.getState().designs;
  let lastFolders = useDesignStore.getState().folders;
  const unsubscribeDesigns = useDesignStore.subscribe((state) => {
    if (state.designs !== lastDesigns || state.folders !== lastFolders) {
      lastDesigns = state.designs;
      lastFolders = state.folders;
      scheduleSync();
    }
  });
  const unsubscribeDeletes = subscribeToLibraryDeletions(() => scheduleSync(500));

  const onVisible = () => {
    if (document.visibilityState === "visible") {
      void syncLibraryNow();
    }
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  const onOnline = () => {
    void syncLibraryNow();
  };
  window.addEventListener("online", onOnline);

  return () => {
    unsubscribeAuth();
    unsubscribeDesigns();
    unsubscribeDeletes();
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
    window.removeEventListener("online", onOnline);
    if (pollTimer !== undefined) {
      window.clearInterval(pollTimer);
    }
    if (pushTimer !== undefined) {
      window.clearTimeout(pushTimer);
      pushTimer = undefined;
    }
  };
}

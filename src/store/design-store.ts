"use client";

import { create } from "zustand";
import { createEmptyProject } from "@/examples";
import {
  UNTITLED_DESIGN_NAME,
  createDesign as createDesignRecord,
  duplicateDesign as duplicateDesignRecord,
  normalizeDesignName,
  pickDesignAfterDelete,
  sortDesigns,
  stampDesignOrder,
  toDesignSummary,
  updateDesignProject,
  type DesignRecord,
  type DesignSummary,
} from "@/lib/designs/design-library";
import {
  deleteDesign,
  listDesignSummaries,
  readActiveDesignId,
  readDesign,
  writeActiveDesignId,
  writeDesign,
  writeDesignSummary,
} from "@/lib/designs/design-storage";
import {
  beginDesignCameraHandover,
  forgetDesignCameras,
  keepDesignCameras,
  readDesignCamera,
} from "@/lib/designs/design-camera";
import { parseFactoryProjectJson } from "@/lib/import-export";
import { applyPlanView, capturePlanView } from "@/lib/plan-view";
import { leaveWelcomeTab } from "@/lib/tour/welcome-tab";
import type { FactoryProject } from "@/lib/model/types";
import { LOCAL_STORAGE_KEY, useFactoryStore } from "./factory-store";

export type DesignSaveState = "idle" | "saving" | "saved" | "error";

interface DesignStore {
  designs: DesignSummary[];
  activeDesignId?: string;
  isHydrated: boolean;
  saveState: DesignSaveState;
  error?: string;
  hydrate: () => Promise<void>;
  switchToDesign: (id: string) => Promise<void>;
  addDesign: () => Promise<void>;
  /** Adds `project` as a new design tab and switches to it (community imports). */
  importProjectAsDesign: (project: FactoryProject, name: string) => Promise<void>;
  copyDesign: (id: string) => Promise<void>;
  renameDesign: (id: string, name: string) => Promise<void>;
  removeDesign: (id: string) => Promise<void>;
  /**
   * Close a run of tabs in one go.
   *
   * Not `removeDesign` in a loop: that re-reads the whole library and settles
   * the active design after every single delete, so closing eight tabs would
   * hand the canvas around eight times on the way. `keepActiveId` is the tab
   * the menu was opened from, which always survives, so the canvas lands there
   * when the active design is among the closed.
   */
  removeDesigns: (ids: string[], keepActiveId?: string) => Promise<void>;
  /**
   * Rearranges the strip to `orderedIds`, stamping each summary's `order`.
   * State updates first so the drop lands instantly; the writes follow.
   */
  reorderDesigns: (orderedIds: string[]) => Promise<void>;
  /**
   * Saves `project` into `designId`.
   *
   * The design is named rather than read from state at call time: autosave is
   * debounced, so a save scheduled just before a tab switch would otherwise
   * resolve against the newly-active design and write the previous tab's plan
   * over it. Naming the pair lets a stale save be dropped instead.
   */
  saveActiveProject: (designId: string | undefined, project: FactoryProject) => Promise<void>;
}

/**
 * Loads a plan onto the canvas without marking it edited, dressed the way that
 * plan was last left and pointed at whatever you were looking at on it.
 *
 * A tab is a whole factory, and how a factory is DRAWN is part of it: one build
 * wants rate labels and fat lines, the next wants a clean board. Sharing a
 * setup has always carried those settings along with it, so a tab not carrying
 * them between switches was the odd one out. See PlanViewScope for the line
 * between the board's look (per plan) and the workspace around it (yours).
 *
 * Where the CAMERA lands is `design-camera.ts`: a tab you have been on before
 * comes back up exactly where you left it, and one you have not is framed, which
 * is what every tab used to get. Framing a tab you know your way around means
 * scrolling back to the corner you were working in every single time.
 */
function showProject(project: FactoryProject, designId?: string) {
  useFactoryStore.getState().markHydratedProject(project);
  applyPlanView(project.view, "board", designId ? readDesignCamera(designId) : undefined);
}

/**
 * Hand the canvas to another design: the store points at it, and its plan goes
 * up dressed and framed, or back where its camera was left.
 *
 * The handover is opened BEFORE the active id changes, because the board reports
 * camera moves it makes itself and the outgoing tab's last one can land after
 * the switch. See `design-camera.ts`.
 */
function landOnDesign(
  set: (partial: Partial<DesignStore>) => void,
  designId: string,
  project: FactoryProject,
  rest?: Partial<DesignStore>,
) {
  beginDesignCameraHandover();
  writeActiveDesignId(designId);
  set({ ...rest, activeDesignId: designId });
  showProject(project, designId);
}

function currentProject(): FactoryProject {
  return useFactoryStore.getState().project;
}

/**
 * The plan as it should be SAVED: what is on the canvas, plus how the canvas is
 * dressed right now.
 *
 * Stamped at the moment of writing rather than tracked as the settings change:
 * every path that persists a design comes through here, and the view is cheap
 * to read.
 */
function withCurrentView(project: FactoryProject): FactoryProject {
  return { ...project, view: capturePlanView() };
}

/**
 * Writes whatever is on the canvas into `summary`'s record.
 *
 * Runs before every switch, copy and delete: autosave is debounced, and those
 * actions land inside that window often enough that skipping this would quietly
 * drop the last few edits of the design being left behind.
 */
async function flushCanvasInto(summary: DesignSummary | undefined): Promise<void> {
  if (!summary) {
    return;
  }

  const project = withCurrentView(currentProject());
  await writeDesign(updateDesignProject({ ...summary, project }, project));
}

export const useDesignStore = create<DesignStore>((set, get) => ({
  designs: [],
  activeDesignId: undefined,
  isHydrated: false,
  saveState: "idle",
  error: undefined,

  hydrate: async () => {
    try {
      let summaries = sortDesigns(await listDesignSummaries());

      if (summaries.length === 0) {
        summaries = [await seedFirstDesign()];
      } else {
        summaries = await backfillSummaryIcons(summaries);
      }

      const remembered = readActiveDesignId();
      const activeId =
        summaries.find((design) => design.id === remembered)?.id ?? summaries[0].id;

      const active = await readDesign(activeId);

      // Designs can also go away without this tab hearing about it, and a camera
      // for a plan nothing can open is dead weight.
      keepDesignCameras(summaries.map((design) => design.id));

      if (active) {
        landOnDesign(set, activeId, active.project, { designs: summaries, isHydrated: true });
      } else {
        writeActiveDesignId(activeId);
        set({ designs: summaries, activeDesignId: activeId, isHydrated: true });
      }
    } catch (error) {
      // A browser with IndexedDB blocked still gets a working canvas — it just
      // cannot keep anything beyond the session.
      set({
        isHydrated: true,
        error: error instanceof Error ? error.message : "Designs could not be loaded.",
      });
    }
  },

  switchToDesign: async (id) => {
    const { activeDesignId, designs } = get();
    if (id === activeDesignId) {
      return;
    }

    const target = await readDesign(id);
    if (!target) {
      return;
    }

    await flushCanvasInto(designs.find((design) => design.id === activeDesignId));
    // Point the store at the new design *before* its plan reaches the canvas.
    // Autosave keys off the two together, so a canvas holding the new plan while
    // the store still names the old design is exactly the pairing that would
    // save one design's work into another.
    landOnDesign(set, id, target.project);
    set({ designs: sortDesigns(await listDesignSummaries()) });
  },

  addDesign: async () => {
    const { activeDesignId, designs } = get();
    await flushCanvasInto(designs.find((design) => design.id === activeDesignId));

    const record = createDesignRecord(createEmptyProject(), UNTITLED_DESIGN_NAME);
    await writeDesign(record);
    landOnDesign(set, record.id, record.project);
    set({ designs: sortDesigns(await listDesignSummaries()) });
  },

  importProjectAsDesign: async (project, name) => {
    const { activeDesignId, designs } = get();
    await flushCanvasInto(designs.find((design) => design.id === activeDesignId));

    const record = createDesignRecord(project, name || UNTITLED_DESIGN_NAME);
    await writeDesign(record);
    landOnDesign(set, record.id, record.project);
    // A plan that arrives is a plan meant to be LOOKED at, whichever door it
    // came through: a shared link, the setup shelf beside the board, a lesson.
    // Leaving the greeting up would put it over the board it just landed on,
    // with the strip still naming Welcome as the tab you are on.
    leaveWelcomeTab();
    set({ designs: sortDesigns(await listDesignSummaries()) });
  },

  copyDesign: async (id) => {
    const { activeDesignId, designs } = get();
    // Copying the tab you are editing has to copy what is on screen, not the
    // last debounced write, so the canvas is flushed first either way.
    await flushCanvasInto(designs.find((design) => design.id === activeDesignId));

    const source = await readDesign(id);
    if (!source) {
      return;
    }

    const copy = duplicateDesignRecord(
      source,
      designs.map((design) => design.name),
    );
    await writeDesign(copy);
    landOnDesign(set, copy.id, copy.project);
    set({ designs: sortDesigns(await listDesignSummaries()) });
  },

  renameDesign: async (id, name) => {
    const summary = get().designs.find((design) => design.id === id);
    if (!summary) {
      return;
    }

    const renamed: DesignSummary = {
      ...summary,
      name: normalizeDesignName(name),
      updatedAt: new Date().toISOString(),
    };

    // Only the metadata is rewritten — the stored plan can be megabytes, and a
    // rename does not touch it. The plan's own `name` field, which the JSON
    // export uses for its filename, is realigned through the canvas below and
    // saved by the autosave that follows.
    await writeDesignSummary(renamed);

    if (id === get().activeDesignId) {
      useFactoryStore.getState().renameProject(renamed.name);
    }

    set({ designs: sortDesigns(await listDesignSummaries()) });
  },

  removeDesign: async (id) => {
    const { designs, activeDesignId } = get();
    const nextActiveId = pickDesignAfterDelete(designs, id);

    await deleteDesign(id);
    forgetDesignCameras([id]);
    let summaries = sortDesigns(await listDesignSummaries());

    if (summaries.length === 0) {
      // The strip is never empty: closing the last design leaves a fresh one
      // rather than a canvas backed by nothing.
      const seeded = createDesignRecord(createEmptyProject(), UNTITLED_DESIGN_NAME);
      await writeDesign(seeded);
      summaries = [seeded];
      landOnDesign(set, seeded.id, seeded.project, { designs: summaries });
      return;
    }

    if (id === activeDesignId && nextActiveId) {
      const next = await readDesign(nextActiveId);
      if (next) {
        landOnDesign(set, nextActiveId, next.project, { designs: summaries });
      } else {
        writeActiveDesignId(nextActiveId);
        set({ designs: summaries, activeDesignId: nextActiveId });
      }
      return;
    }

    set({ designs: summaries });
  },

  removeDesigns: async (ids, keepActiveId) => {
    const doomed = new Set(ids);
    doomed.delete(keepActiveId ?? "");
    if (doomed.size === 0) {
      return;
    }

    const { activeDesignId } = get();
    for (const id of doomed) {
      await deleteDesign(id);
    }
    forgetDesignCameras(doomed);

    let summaries = sortDesigns(await listDesignSummaries());
    if (summaries.length === 0) {
      // The strip is never empty, same as closing the last design one at a time.
      const seeded = createDesignRecord(createEmptyProject(), UNTITLED_DESIGN_NAME);
      await writeDesign(seeded);
      summaries = [seeded];
      landOnDesign(set, seeded.id, seeded.project, { designs: summaries });
      return;
    }

    if (!activeDesignId || !doomed.has(activeDesignId)) {
      // The canvas is showing a design that survived, so it stays put and
      // nothing has to be loaded.
      set({ designs: summaries });
      return;
    }

    const nextId = summaries.some((design) => design.id === keepActiveId)
      ? keepActiveId!
      : summaries[0].id;
    const next = await readDesign(nextId);
    if (next) {
      landOnDesign(set, nextId, next.project, { designs: summaries });
    } else {
      writeActiveDesignId(nextId);
      set({ designs: summaries, activeDesignId: nextId });
    }
  },

  reorderDesigns: async (orderedIds) => {
    const stamped = stampDesignOrder(get().designs, orderedIds);
    set({ designs: stamped });
    for (const summary of stamped) {
      await writeDesignSummary(summary);
    }
  },

  saveActiveProject: async (designId, project) => {
    const { activeDesignId, designs } = get();
    if (!designId || designId !== activeDesignId) {
      return;
    }

    const summary = designs.find((design) => design.id === designId);
    if (!summary) {
      return;
    }

    set({ saveState: "saving" });
    try {
      const saved = withCurrentView(project);
      await writeDesign(updateDesignProject({ ...summary, project: saved }, saved));
      set({ saveState: "saved", designs: sortDesigns(await listDesignSummaries()) });
    } catch (error) {
      set({
        saveState: "error",
        error: error instanceof Error ? error.message : "Design could not be saved.",
      });
    }
  },
}));

/**
 * Summaries written before they carried an icon never get one until their plan
 * happens to be saved again, so tabs would sit blank for exactly the designs
 * that have been around longest. Once per browser, every plan is read and its
 * summary restamped; new writes keep the copy fresh from then on.
 */
const ICON_BACKFILL_KEY = "gtnh-factory-flow.design-summary-icons.v1";

async function backfillSummaryIcons(summaries: DesignSummary[]): Promise<DesignSummary[]> {
  try {
    if (window.localStorage.getItem(ICON_BACKFILL_KEY)) {
      return summaries;
    }
  } catch {
    // No localStorage means no way to remember the pass ran; skip it rather
    // than reread every plan on every load.
    return summaries;
  }

  for (const summary of summaries) {
    const record = await readDesign(summary.id);
    if (record?.project.icon) {
      await writeDesignSummary(toDesignSummary(record));
    }
  }

  try {
    window.localStorage.setItem(ICON_BACKFILL_KEY, "done");
  } catch {
    // A failed flag just means the pass runs again next load.
  }
  return sortDesigns(await listDesignSummaries());
}

/**
 * First run: adopt the plan the app used to keep under a single localStorage
 * key, so existing work becomes the first tab instead of being stranded behind a
 * storage change. The old key is read, never cleared — if anything here goes
 * wrong the original is still sitting where it was.
 */
async function seedFirstDesign(): Promise<DesignSummary> {
  const legacy = readLegacyProject();
  const record = createDesignRecord(
    legacy ?? createEmptyProject(),
    legacy?.name ?? UNTITLED_DESIGN_NAME,
  );
  await writeDesign(record);
  return record;
}

function readLegacyProject(): FactoryProject | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    return stored ? parseFactoryProjectJson(stored) : undefined;
  } catch {
    return undefined;
  }
}

export type { DesignRecord, DesignSummary };

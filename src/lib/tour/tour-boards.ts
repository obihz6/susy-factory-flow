"use client";

import { loadBiodieselDemoProject } from "@/examples";
import { downloadCommunityPlan, tagPlanWithCommunityId } from "@/lib/community/client";
import { parseFactoryProjectJson } from "@/lib/import-export";
import type { FactoryProject } from "@/lib/model/types";
import { prepareTourProject } from "./tour-plan-prep";
import { getStorageRoles, type StorageRole } from "@/lib/model/storage-role";
import { deriveNodeVerdict } from "@/components/flow/node-verdict";
import { readWorkspaceViewSnapshot, writeWorkspaceView } from "@/lib/workspace-view";
import { useDesignStore } from "@/store/design-store";
import { useFactoryStore, type BoardFraming } from "@/store/factory-store";

/**
 * Putting a factory on the board for a lesson to point at.
 *
 * The first lesson deliberately points at an empty board: it is about where
 * everything IS, and a plan under the spotlight is just noise. The second one
 * is about reading a plan, so it opens a real posted setup - the same titanium
 * line anyone can pull off the Setups shelf.
 *
 * It arrives as a design of its OWN, never over whatever the user had open.
 * Running the lesson twice reuses that tab rather than stacking copies up, and
 * closing it afterwards is the ordinary tab close.
 */
export const TOUR_PLAN_DESIGN_NAME = "Titanium Line (tour)";

/** The posted setup the second lesson walks. */
const TOUR_PLAN_COMMUNITY_ID = "bbb75edc-74fc-4fc5-b5a3-f44623c9a94b";

/**
 * The one in flight, if any.
 *
 * Opening the design is several awaits long, and "is it already there?" is
 * answered at the start of it. Two overlapping calls - which is exactly what
 * React's development double-invoke of an effect produces - would both find
 * nothing and both create one, so the second waits on the first instead.
 */
let opening: Promise<void> | undefined;

/**
 * The card the second lesson reads, and the two cards either side of it.
 *
 * Worked out lazily, the first time a step asks: picking needs the solver's
 * verdict on every card, and that has not run at the moment the plan lands.
 */
interface TourPicks {
  cardId: string;
  /** Who feeds it. A storage drawer first, if one does. */
  supplierIds: string[];
  /** Fed fine and still short: the one card where "build more" is the answer. */
  bottleneckId?: string;
  /** Short itself, several inputs low, one of them actually setting the pace. */
  blockedId?: string;
  /**
   * EVERY drawer of each job, not one specimen. A step that says "these are
   * your byproducts" and rings one of the two on the board has told a small
   * lie, and the reader is left wondering what is different about the other.
   */
  sourceDrawerIds: string[];
  productDrawerIds: string[];
  byproductDrawerIds: string[];
  bufferDrawerIds: string[];
}

let picks: TourPicks | undefined;

export function openTourPlan(): Promise<void> {
  opening ??= openPlan().finally(() => {
    opening = undefined;
  });
  return opening;
}

async function openPlan(): Promise<void> {
  const store = useDesignStore.getState();
  const existing = store.designs.find((design) => design.name === TOUR_PLAN_DESIGN_NAME);

  if (existing) {
    if (existing.id !== store.activeDesignId) {
      await store.switchToDesign(existing.id);
    }
    // Back to the posted original, every single time. The lesson reads real
    // numbers off this plan and half its steps are about a machine that is
    // short, so a tab somebody edited last week would quietly make the words
    // wrong. It is also how a re-upload of the setup reaches the lesson.
    useFactoryStore.getState().markHydratedProject(await fetchTourProject());
  } else {
    await store.importProjectAsDesign(await fetchTourProject(), TOUR_PLAN_DESIGN_NAME);
  }

  // A fresh plan is a fresh set of picks: the hydrate above rebuilt the
  // pristine board, so picks held over from an earlier run would only lie
  // about it.
  picks = undefined;
  moveCamera(() => {
    if (useFactoryStore.getState().project.nodes.length === 0) {
      return false;
    }
    useFactoryStore.getState().frameBoardNodes(undefined, WHOLE_BOARD);
    return true;
  });
}

/**
 * Both side columns out of the way for the duration of a canvas lesson, and
 * back exactly as they were afterwards.
 *
 * Not tidiness: room. The lesson's whole job is to magnify one card until it
 * fills the eye, and with both columns open the board is a third of the window
 * and there is nothing left to magnify INTO. What they were is captured, so a
 * lesson never decides someone's layout for them.
 */
let columnsBefore: { leftPanelOpen: boolean; rightPanelOpen: boolean } | undefined;

export function clearTheDecks(): void {
  const view = readWorkspaceViewSnapshot();
  columnsBefore ??= { leftPanelOpen: view.leftPanelOpen, rightPanelOpen: view.rightPanelOpen };
  writeWorkspaceView({ leftPanelOpen: false, rightPanelOpen: false });
}

export function restoreTheDecks(): void {
  if (columnsBefore) {
    writeWorkspaceView(columnsBefore);
    columnsBefore = undefined;
  }
}

/**
 * The tour's camera moves: the newest one wins, and it keeps trying until the
 * board is in a state where it can actually happen.
 *
 * Both halves were bugs. A move cannot fire the instant a step asks for it -
 * framing reads the cards the BOARD has laid out, and the plan is at least one
 * render behind the request - so every move waits a beat, which means a second
 * step can ask while the first is still pending. The whole-board fit is queued
 * the moment a plan lands, and pressing Next inside that window used to fire
 * the fly-to-one-card and then let the fit land on top and undo it.
 *
 * And a step reached before the download finished found no cards to frame, did
 * nothing, and never looked again: the close-up was simply skipped, and the
 * next four steps talked about a card the camera had never gone to.
 *
 * So intentions are numbered and retried. `run` reports whether it managed it;
 * a newer intention silently abandons every older one, mid-retry or not.
 */
let cameraIntent = 0;

const CAMERA_SETTLE_MS = 80;
/** About three seconds of patience, which covers a slow shelf download. */
const CAMERA_ATTEMPTS = 40;

function moveCamera(run: () => boolean) {
  const mine = ++cameraIntent;
  const attempt = (left: number) => {
    if (mine !== cameraIntent) {
      return;
    }
    if (run() || left <= 0) {
      return;
    }
    window.setTimeout(() => attempt(left - 1), CAMERA_SETTLE_MS);
  };
  window.setTimeout(() => attempt(CAMERA_ATTEMPTS), CAMERA_SETTLE_MS);
}

/**
 * The posted setup, or the packaged demo if the network is not having it.
 *
 * A lesson that cannot reach the shelf is still worth walking, and a board with
 * SOMETHING on it is the whole point of this module, so a failed download falls
 * back rather than leaving the tour pointing at nothing.
 */
async function fetchTourProject(): Promise<FactoryProject> {
  // Both routes go through prepareTourProject: boundaries closed (a plan
  // authored before plans declared their own edges is a board of NO WIRES at
  // 0%, and nobody learns to read a factory from a dead one) and strict
  // buffer flags unset, so the buffer the lesson describes is the plain one.
  // The repairs and their reasons live in tour-plan-prep.ts, next to the
  // test that pins what they must produce.
  try {
    const { plan } = await downloadCommunityPlan(TOUR_PLAN_COMMUNITY_ID);
    const project = parseFactoryProjectJson(
      JSON.stringify(tagPlanWithCommunityId(plan, TOUR_PLAN_COMMUNITY_ID)),
    );
    return prepareTourProject({ ...project, name: TOUR_PLAN_DESIGN_NAME });
  } catch {
    const project = loadBiodieselDemoProject();
    return prepareTourProject({ ...project, name: TOUR_PLAN_DESIGN_NAME });
  }
}

/**
 * Which card the lesson reads.
 *
 * The most wired-up machine that is NOT running flat out. Both halves matter: a
 * card with one wire has nothing to say about who asks and who gives, and a
 * card sitting at a happy 100% has nothing to say about why a number is low,
 * which is the whole second half of the lesson. A board where everything is
 * fine falls back to the busiest card and the lesson still reads.
 */
function pickCards(): TourPicks | undefined {
  const { project, lastResult: result } = useFactoryStore.getState();
  // Not until the plan has landed AND been solved. Picking off a half-arrived
  // board would answer, and the answer would be memoised: every card would look
  // like it was running flat out, so the "not flat out" half of the rule would
  // be decided by nothing. An undefined answer is retried on the next ask.
  if (!result || project.nodes.length === 0) {
    return undefined;
  }

  const machineIds = new Set(project.nodes.map((node) => node.id));

  // Picked by the STATE each step exists to teach, not by a general "most
  // interesting card" score. A BOTTLENECK is the one place where "build more
  // of this" is the answer; a BLOCKED card is the opposite lesson, and needs
  // several inputs for the point to be visible - that only one of the low ones
  // is actually setting the speed.
  const verdicts = new Map(
    project.nodes.map((node) => [node.id, deriveNodeVerdict(project, result, node.id)]),
  );
  const inputCount = (id: string) => Object.keys(result.nodes[id]?.inputs ?? {}).length;

  const bottleneckId = project.nodes.find(
    (node) => verdicts.get(node.id)?.kind === "bottleneck",
  )?.id;

  // A truly BLOCKED card first: the step's chip says BLOCKED and its copy says
  // the next machine goes short, neither of which is true of a starved card,
  // which only stands in when the board has nothing better to show.
  const blockedId = project.nodes
    .filter((node) => {
      const kind = verdicts.get(node.id)?.kind;
      return kind === "blocked" || kind === "starved";
    })
    .sort((a, b) => {
      const blockedFirst =
        Number(verdicts.get(b.id)?.kind === "blocked") -
        Number(verdicts.get(a.id)?.kind === "blocked");
      return blockedFirst || inputCount(b.id) - inputCount(a.id);
    })[0]?.id;

  const cardId = bottleneckId ?? blockedId ?? project.nodes[0]?.id;
  if (!cardId) {
    return undefined;
  }

  const roles = getStorageRoles(project);
  const drawersOf = (role: StorageRole) =>
    (project.storages ?? [])
      .filter((storage) => roles.get(storage.id) === role)
      .map((storage) => storage.id);

  // A drawer first among the suppliers: "this comes out of a pile you say you
  // have" is the one supply story the board cannot tell by itself.
  const supplierIds = project.edges
    .filter((edge) => edge.target === cardId)
    .map((edge) => edge.source)
    .sort((a, b) => Number(machineIds.has(a)) - Number(machineIds.has(b)));

  return {
    cardId,
    supplierIds,
    bottleneckId,
    blockedId,
    sourceDrawerIds: drawersOf("source"),
    productDrawerIds: drawersOf("product"),
    byproductDrawerIds: drawersOf("byproduct"),
    bufferDrawerIds: drawersOf("buffer"),
  };
}

function ensurePicks(): TourPicks | undefined {
  picks ??= pickCards();
  return picks;
}

/**
 * How a tour frames what it is talking about.
 *
 * A tour is allowed to magnify, which the board's own framing is not: "look at
 * THIS card" has to fill the eye, and at the board's 1:1 ceiling one card is a
 * third of the screen and the move reads as a pan. The inset is the strip the
 * step's own card sits in, kept clear and framed around, so the subject lands
 * beside the words about it rather than underneath them.
 */
const CLOSE_UP: BoardFraming = { maxZoom: 2, padding: 0.35, insetRight: 600 };
const GROUP_SHOT: BoardFraming = { maxZoom: 1.2, padding: 0.25, insetRight: 600 };
/** The opening wide shot. Never magnified, and it keeps the card's strip free. */
const WHOLE_BOARD: BoardFraming = { padding: 0.15, insetRight: 600 };

/**
 * Fly the camera in on that one card.
 *
 * The picks are resolved inside the move, not before it: a step reached while
 * the plan is still arriving would otherwise find no cards to choose between.
 */
export function focusTourCard(): void {
  moveCamera(() => {
    const cardId = ensurePicks()?.cardId;
    if (!cardId) {
      return false;
    }
    useFactoryStore.getState().frameBoardNodes([cardId], CLOSE_UP);
    return true;
  });
}

/** Pull back until the card and everything feeding it are both on screen. */
export function frameTourSuppliers(): void {
  moveCamera(() => {
    const found = ensurePicks();
    if (!found) {
      return false;
    }
    useFactoryStore.getState().frameBoardNodes([found.cardId, ...found.supplierIds], GROUP_SHOT);
    return true;
  });
}

function cardSelector(id: string | undefined): string | undefined {
  return id ? `.react-flow__node[data-id="${CSS.escape(id)}"]` : undefined;
}

/**
 * The read card as a live CSS selector, for a step that has to ring something
 * the board only rendered a moment ago and that has no anchor of its own.
 */
export function tourCardSelector(): string | undefined {
  return cardSelector(ensurePicks()?.cardId);
}

/** One part of it: the column of asks, the column of makes, the usage strip. */
export function tourCardPartSelector(part: "inputs" | "outputs"): () => string | undefined {
  return () => {
    const card = tourCardSelector();
    return card ? `${card} [data-tour-part="${part}"]` : undefined;
  };
}

export function tourCardUsageSelector(): string | undefined {
  const card = tourCardSelector();
  return card ? `${card} .flow-usage-stat` : undefined;
}

/** The first thing feeding it. */
export function tourSupplierSelector(): string | undefined {
  return cardSelector(ensurePicks()?.supplierIds[0]);
}

/**
 * The two machines the walk reads, and one drawer of each job.
 *
 * Each gets a selector AND a camera move, because a step that rings a card the
 * camera never flew to is pointing at nothing. A pick the board cannot supply
 * (no byproduct drawer on it, say) resolves to undefined, and the step's card
 * then sits in the middle of a dimmed screen with its words intact rather than
 * ringing the wrong thing.
 */
type MachineKey = "bottleneckId" | "blockedId";
type DrawerKey = "sourceDrawerIds" | "productDrawerIds" | "byproductDrawerIds" | "bufferDrawerIds";

function pickSelector(key: MachineKey): () => string | undefined {
  return () => cardSelector(ensurePicks()?.[key]);
}

function pickPartSelector(key: MachineKey, part: "inputs" | "outputs"): () => string | undefined {
  return () => {
    const card = cardSelector(ensurePicks()?.[key]);
    return card ? `${card} [data-tour-part="${part}"]` : undefined;
  };
}

function pickUsageSelector(key: MachineKey): () => string | undefined {
  return () => {
    const card = cardSelector(ensurePicks()?.[key]);
    return card ? `${card} .flow-usage-stat` : undefined;
  };
}

function framePick(key: MachineKey): () => void {
  return () => {
    moveCamera(() => {
      const id = ensurePicks()?.[key];
      if (!id) {
        return false;
      }
      useFactoryStore.getState().frameBoardNodes([id], CLOSE_UP);
      return true;
    });
  };
}

/**
 * Every drawer of one job at once, comma-joined: the overlay unions the
 * rectangles into a single hole (see `measureSelector`), so a board with two
 * byproducts rings both rather than picking a favourite.
 */
function drawerSelector(key: DrawerKey): () => string | undefined {
  return () => {
    const ids = ensurePicks()?.[key] ?? [];
    const selectors = ids.map((id) => cardSelector(id)).filter(Boolean);
    return selectors.length > 0 ? selectors.join(", ") : undefined;
  };
}

function frameDrawers(key: DrawerKey): () => void {
  return () => {
    moveCamera(() => {
      const ids = ensurePicks()?.[key] ?? [];
      if (ids.length === 0) {
        return false;
      }
      // One drawer can be flown right up to; two sitting apart on the board
      // need the wider shot or the pair does not fit the hole.
      useFactoryStore
        .getState()
        .frameBoardNodes(ids, ids.length === 1 ? CLOSE_UP : GROUP_SHOT);
      return true;
    });
  };
}

export const tourBottleneckSelector = pickSelector("bottleneckId");
export const tourBottleneckInputsSelector = pickPartSelector("bottleneckId", "inputs");
export const tourBottleneckOutputsSelector = pickPartSelector("bottleneckId", "outputs");
export const tourBottleneckUsageSelector = pickUsageSelector("bottleneckId");
export const frameTourBottleneck = framePick("bottleneckId");

export const tourBlockedSelector = pickSelector("blockedId");
export const tourBlockedInputsSelector = pickPartSelector("blockedId", "inputs");
export const tourBlockedOutputsSelector = pickPartSelector("blockedId", "outputs");
export const tourBlockedUsageSelector = pickUsageSelector("blockedId");
export const frameTourBlocked = framePick("blockedId");

export const tourSourceDrawerSelector = drawerSelector("sourceDrawerIds");
export const frameTourSourceDrawer = frameDrawers("sourceDrawerIds");
export const tourProductDrawerSelector = drawerSelector("productDrawerIds");
export const frameTourProductDrawer = frameDrawers("productDrawerIds");
export const tourByproductDrawerSelector = drawerSelector("byproductDrawerIds");
export const frameTourByproductDrawer = frameDrawers("byproductDrawerIds");
export const tourBufferDrawerSelector = drawerSelector("bufferDrawerIds");
export const frameTourBufferDrawer = frameDrawers("bufferDrawerIds");

/**
 * The lesson reads its rates per MINUTE. The titanium line's numbers are
 * honest but small - a freezer sipping 0.006/s reads as noise, while 0.38/m
 * reads as a rate - so the lesson turns the dial for the duration and puts
 * it back exactly as it found it, the same contract as the columns.
 */
let rateUnitBefore: ReturnType<(typeof useFactoryStore)["getState"]>["rateUnit"] | undefined;

export function tuneTourRateUnit(): void {
  const store = useFactoryStore.getState();
  rateUnitBefore ??= store.rateUnit;
  if (store.rateUnit !== "minute") {
    store.setRateUnit("minute");
  }
}

export function restoreTourRateUnit(): void {
  if (rateUnitBefore === undefined) {
    return;
  }
  const store = useFactoryStore.getState();
  if (store.rateUnit !== rateUnitBefore) {
    store.setRateUnit(rateUnitBefore);
  }
  rateUnitBefore = undefined;
}

/** The whole line at once, for the steps that talk about all of it. */
export function frameTourWholeBoard(): void {
  moveCamera(() => {
    if (useFactoryStore.getState().project.nodes.length === 0) {
      return false;
    }
    useFactoryStore.getState().frameBoardNodes(undefined, WHOLE_BOARD);
    return true;
  });
}

/**
 * A drawer that is TOPPING UP an input, rather than being its only source.
 *
 * The two drawers teach different halves of the same thing. A drawer that is
 * the only source of an ingredient is just a NEED drawn on the board. A drawer
 * wired into an input a machine is ALSO feeding is the interesting one: that
 * input would be the thing holding the line back, and the drawer is what stops
 * it being that. Which is the whole reason to reach for one.
 *
 * Found by resource rather than by handle: the two wires legitimately land on
 * different handle ids for the same slot, so grouping on the handle finds
 * nothing.
 */
function findSupplementDrawer(): { drawerId: string; machineId: string } | undefined {
  const project = useFactoryStore.getState().project;
  const storageIds = new Set((project.storages ?? []).map((storage) => storage.id));
  const machineIds = new Set(project.nodes.map((node) => node.id));

  const fromDrawers = project.edges.filter(
    (edge) => storageIds.has(edge.source) && machineIds.has(edge.target),
  );

  const supplementing = fromDrawers.find((drawerEdge) =>
    project.edges.some(
      (other) =>
        other !== drawerEdge &&
        other.target === drawerEdge.target &&
        machineIds.has(other.source) &&
        other.resourceId === drawerEdge.resourceId &&
        other.resourceKind === drawerEdge.resourceKind,
    ),
  );

  // Failing that, any drawer feeding a machine: the copy still holds, it just
  // has a plainer example to point at.
  const chosen = supplementing ?? fromDrawers[0];
  return chosen ? { drawerId: chosen.source, machineId: chosen.target } : undefined;
}

/**
 * The topped-up machine AND the drawer topping it up, as one selector.
 *
 * Ringing only the drawer would leave the point half made: the interesting
 * thing is not the drawer, it is the arrangement. Two selectors comma-joined,
 * and the overlay unions their rectangles into one hole (see `measureSelector`).
 */
export function tourSupplementPairSelector(): string | undefined {
  const found = findSupplementDrawer();
  if (!found) {
    return undefined;
  }
  return [cardSelector(found.machineId), cardSelector(found.drawerId)].join(", ");
}

/** The topped-up machine and the drawer doing it, side by side. */
export function frameTourSupplement(): void {
  moveCamera(() => {
    const found = findSupplementDrawer();
    if (!found) {
      return false;
    }
    useFactoryStore.getState().frameBoardNodes([found.machineId, found.drawerId], GROUP_SHOT);
    return true;
  });
}



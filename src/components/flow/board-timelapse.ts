import { playBoardSound } from "@/lib/board-sounds";
import { computeBoardLevelView } from "@/lib/model/board-windows";
import type { FactoryProject } from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { getBoardTiltSnapshot, writeBoardTilt, type BoardTilt } from "./board-tilt";
import {
  isNodeDetailGlanceForced,
  NODE_GLANCE_LEAVE_ZOOM,
  setNodeDetailGlanceForced,
} from "./node-detail";

/**
 * The build timelapse's SCRIPT: the order the board's cards, wires and ink
 * would appear in if someone were building the plan by hand. A dev-menu toy
 * (see DevMenu), so it is entirely a VIEW: the player's plan, selection and
 * undo history are never touched — playback only decides which already-built
 * canvas nodes and edges are hidden on a given beat.
 *
 * The order is "sources first, flowing downstream": start on a card nothing
 * feeds, then repeatedly reveal the card whose inputs are most complete,
 * preferring one wired to something already on the board and, among those,
 * the nearest — so the camera walks the factory the way a builder would
 * instead of teleporting across it. Wires appear on the beat their second
 * endpoint does; an open board's frame appears just before its first member;
 * ink (annotations) is drawn last, in reading order.
 */

export interface TimelapseBeat {
  /** Canvas node ids revealed this beat; empty for a pure wire beat. */
  nodeIds: string[];
  /** Project edge ids whose both endpoints are now on the canvas. */
  edgeIds: string[];
  /**
   * What the beat does, for pacing and sound. A machine lands as a `card`
   * beat and its wires follow as a separate `wire` beat - placing and
   * wiring are two acts. A storage is the exception: the app's own drawer
   * gesture creates drawer and wire together, so its card beat carries its
   * edges. A `board` beat stands an open frame up AFTER everything in it
   * is on the table.
   */
  kind: "card" | "wire" | "board" | "ink";
  /**
   * What the camera should watch during this beat when that is not the
   * revealed nodes themselves. A wire beat names only its NEAR end - the
   * card whose wiring pass this is. The far end already stands, often a
   * screen away, and a shot stretched to hold both ends of every dock
   * was what kept the camera cutting instead of holding its vantage.
   */
  focusNodeIds?: string[];
  /**
   * Nodes that POP VISIBLE this beat. Usually the same ids as `nodeIds` -
   * a machine lands and pops at once - but an attachment MOUNTS invisibly
   * on its wire-lead beat (its wire needs both endpoints to render at
   * all, so the card must exist while the ink travels toward it) and pops
   * on the following beat, once the wire has arrived. A node in `nodeIds`
   * with its pop in a later beat is PENDING in between.
   */
  popNodeIds?: string[];
  /** Which island (script.scenes entry) this beat belongs to. */
  sceneIndex?: number;
}

export interface TimelapseScript {
  beats: TimelapseBeat[];
  /**
   * The islands, in play order: every unit id of each connected component.
   * The cinematic camera frames the CURRENT scene whole instead of chasing
   * beats, so each island is one slow pan.
   */
  scenes: string[][];
  /** Every canvas node id the playback hides before the first beat. */
  hiddenNodeIds: string[];
  /** Every edge id the playback hides before the first beat. */
  hiddenEdgeIds: string[];
}

type ProjectSlice = Pick<
  FactoryProject,
  "nodes" | "storages" | "annotations" | "pockets" | "edges"
>;

interface Point {
  x: number;
  y: number;
}

export function buildTimelapseScript(
  project: ProjectSlice,
  /** Absolute flow-space position of a canvas node; stored position fallback. */
  positionOf?: (nodeId: string) => Point | undefined,
): TimelapseScript {
  const view = computeBoardLevelView(project);
  const pocketById = new Map((project.pockets ?? []).map((pocket) => [pocket.id, pocket]));

  // Fallback positions from the plan itself. Members of open boards store
  // frame-relative positions, so absolute geometry from the caller is better,
  // but the order only uses positions as a tie-break and a rough one is fine.
  const storedPositionById = new Map<string, Point>();
  for (const node of project.nodes) {
    storedPositionById.set(node.id, node.position);
  }
  for (const storage of project.storages ?? []) {
    storedPositionById.set(storage.id, storage.position);
  }
  for (const annotation of project.annotations ?? []) {
    storedPositionById.set(annotation.id, annotation.position);
  }
  for (const pocket of project.pockets ?? []) {
    storedPositionById.set(pocket.id, pocket.position);
  }
  const pointFor = (id: string): Point =>
    positionOf?.(id) ?? storedPositionById.get(id) ?? { x: 0, y: 0 };

  // The UNITS are what the canvas actually shows as cards: every node and
  // storage whose owner chain is open, and every collapsed board bar (which
  // stands for everything folded behind it). Open frames are not units — they
  // reveal alongside their first member.
  const units = new Set<string>();
  for (const node of project.nodes) {
    const representative = view.representativeOf(node.id);
    if (representative) {
      units.add(representative);
    }
  }
  for (const storage of project.storages ?? []) {
    const representative = view.representativeOf(storage.id);
    if (representative) {
      units.add(representative);
    }
  }
  // Collapsed boards with no members still have a bar to reveal.
  for (const pocket of view.collapsedBoards) {
    units.add(pocket.id);
  }

  // The unit graph: project edges mapped through their representatives.
  // Edges internal to one collapsed board vanish (same unit both ends).
  const predecessors = new Map<string, Set<string>>();
  const neighbours = new Map<string, Set<string>>();
  const edgesByUnitPair = new Map<string, string[]>();
  for (const edge of project.edges) {
    const source = view.representativeOf(edge.source);
    const target = view.representativeOf(edge.target);
    if (!source || !target || source === target || !units.has(source) || !units.has(target)) {
      continue;
    }
    let preds = predecessors.get(target);
    if (!preds) {
      predecessors.set(target, (preds = new Set()));
    }
    preds.add(source);
    let forward = neighbours.get(source);
    if (!forward) {
      neighbours.set(source, (forward = new Set()));
    }
    forward.add(target);
    let backward = neighbours.get(target);
    if (!backward) {
      neighbours.set(target, (backward = new Set()));
    }
    backward.add(source);
    const pairKey = `${source}|${target}`;
    const pair = edgesByUnitPair.get(pairKey);
    if (pair) {
      pair.push(edge.id);
    } else {
      edgesByUnitPair.set(pairKey, [edge.id]);
    }
  }

  // Which open board a unit sits in directly (undefined = the root), and
  // how many completion members each open board still waits on. A frame
  // does NOT stand before its members - it is drawn AROUND them once the
  // last one is on the table, the way Ctrl+G wraps a finished selection.
  // Annotations deliberately do not hold a frame up; ink comes last.
  const storageIds = new Set((project.storages ?? []).map((storage) => storage.id));
  const unitOwner = new Map<string, string | undefined>();
  for (const node of project.nodes) {
    if (units.has(node.id)) {
      unitOwner.set(node.id, node.pocketId);
    }
  }
  for (const storage of project.storages ?? []) {
    if (units.has(storage.id)) {
      unitOwner.set(storage.id, storage.pocketId);
    }
  }
  for (const pocket of view.collapsedBoards) {
    unitOwner.set(pocket.id, pocket.parentPocketId);
  }
  const pendingMembers = new Map<string, number>();
  for (const pocket of view.openBoards) {
    pendingMembers.set(pocket.id, 0);
  }
  const countMemberOf = (ownerId: string | undefined) => {
    if (ownerId !== undefined && pendingMembers.has(ownerId)) {
      pendingMembers.set(ownerId, (pendingMembers.get(ownerId) ?? 0) + 1);
    }
  };
  for (const [, ownerId] of unitOwner) {
    countMemberOf(ownerId);
  }
  for (const pocket of view.openBoards) {
    // A child board's frame is itself a member its parent waits on.
    countMemberOf(pocket.parentPocketId);
  }

  const revealedNodes = new Set<string>();
  const revealedEdges = new Set<string>();
  const beats: TimelapseBeat[] = [];

  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

  // A member landed: any open board whose last member this was gets its
  // frame drawn, which can in turn finish the board above it.
  const settleFrames = (ownerId: string | undefined) => {
    while (ownerId !== undefined && pendingMembers.has(ownerId)) {
      const left = (pendingMembers.get(ownerId) ?? 0) - 1;
      pendingMembers.set(ownerId, left);
      if (left > 0) {
        return;
      }
      revealedNodes.add(ownerId);
      beats.push({ nodeIds: [ownerId], edgeIds: [], kind: "board", popNodeIds: [ownerId] });
      ownerId = pocketById.get(ownerId)?.parentPocketId;
    }
  };

  // MACHINES anchor the show; sources and products are their attendants. A
  // drawer, tank or custom-rate card never leads - it spins in beside the
  // machine that wants it, wire attached, the way the drawer gesture makes
  // both at once. Everything else lands bare and wires up beat by beat.
  const attachmentIds = new Set<string>();
  for (const id of storageIds) {
    if (units.has(id)) {
      attachmentIds.add(id);
    }
  }
  for (const node of project.nodes) {
    if (units.has(node.id) && node.customRate) {
      attachmentIds.add(node.id);
    }
  }
  const machineIds = [...units].filter((id) => !attachmentIds.has(id));

  // A machine's REAL feeders for the build order: upstream machines, seen
  // directly or through one attachment (a buffer between two machines). A
  // pure source drawer is not a feeder - it spawns on demand, so a machine
  // fed only by sources counts as ready.
  const machinePreds = new Map<string, Set<string>>();
  for (const machineId of machineIds) {
    const preds = new Set<string>();
    for (const pred of predecessors.get(machineId) ?? []) {
      if (!attachmentIds.has(pred)) {
        preds.add(pred);
      } else {
        for (const behind of predecessors.get(pred) ?? []) {
          if (!attachmentIds.has(behind)) {
            preds.add(behind);
          }
        }
      }
    }
    machinePreds.set(machineId, preds);
  }

  // Every wire is its own action: one edge per beat, drawn only once both
  // ends stand.
  const revealWiresOf = (unitId: string) => {
    for (const other of neighbours.get(unitId) ?? []) {
      if (!revealedNodes.has(other)) {
        continue;
      }
      for (const pairKey of [`${unitId}|${other}`, `${other}|${unitId}`]) {
        for (const edgeId of edgesByUnitPair.get(pairKey) ?? []) {
          if (!revealedEdges.has(edgeId)) {
            revealedEdges.add(edgeId);
            beats.push({
              nodeIds: [],
              edgeIds: [edgeId],
              kind: "wire",
              focusNodeIds: [unitId],
            });
          }
        }
      }
    }
  };

  // An attendant is SUMMONED: its wire draws over from the machine first,
  // and the card pops in where the ink arrives. The card still MOUNTS on
  // the wire's beat - pending, invisible - because a wire cannot render
  // without both its endpoints on the canvas.
  const revealAttachment = (unitId: string) => {
    revealedNodes.add(unitId);
    const edgeIds: string[] = [];
    for (const other of neighbours.get(unitId) ?? []) {
      if (!revealedNodes.has(other)) {
        continue;
      }
      for (const pairKey of [`${unitId}|${other}`, `${other}|${unitId}`]) {
        for (const edgeId of edgesByUnitPair.get(pairKey) ?? []) {
          if (!revealedEdges.has(edgeId)) {
            revealedEdges.add(edgeId);
            edgeIds.push(edgeId);
          }
        }
      }
    }
    if (edgeIds.length === 0) {
      // A loose drawer: nothing draws toward it, it just lands.
      beats.push({ nodeIds: [unitId], edgeIds, kind: "card", popNodeIds: [unitId] });
    } else {
      beats.push({ nodeIds: [unitId], edgeIds, kind: "wire", focusNodeIds: [unitId] });
      beats.push({
        nodeIds: [],
        edgeIds: [],
        kind: "card",
        focusNodeIds: [unitId],
        popNodeIds: [unitId],
      });
    }
    settleFrames(unitOwner.get(unitId));
  };

  const readingOrder = (left: string, right: string) => {
    const a = pointFor(left);
    const b = pointFor(right);
    return a.y - b.y || a.x - b.x || (left < right ? -1 : 1);
  };

  // A machine already wired to the standing build is SUMMONED like an
  // attendant: its lead wire sweeps over from the build first (the card
  // mounting pending at the far end), the machine pops where the ink
  // lands, and only then do its remaining wires dock and its attendants
  // spin in. The first machine of an island has nothing to sweep from and
  // simply lands.
  const revealMachine = (unitId: string) => {
    revealedNodes.add(unitId);
    let leadEdgeId: string | undefined;
    // Prefer an incoming wire - the build flows downstream, so the sweep
    // should arrive WITH the material.
    for (const direction of ["in", "out"] as const) {
      for (const other of neighbours.get(unitId) ?? []) {
        if (leadEdgeId || !revealedNodes.has(other)) {
          continue;
        }
        const pairKey = direction === "in" ? `${other}|${unitId}` : `${unitId}|${other}`;
        for (const edgeId of edgesByUnitPair.get(pairKey) ?? []) {
          if (!revealedEdges.has(edgeId)) {
            leadEdgeId = edgeId;
            break;
          }
        }
      }
    }
    if (leadEdgeId) {
      revealedEdges.add(leadEdgeId);
      beats.push({
        nodeIds: [unitId],
        edgeIds: [leadEdgeId],
        kind: "wire",
        focusNodeIds: [unitId],
      });
      beats.push({
        nodeIds: [],
        edgeIds: [],
        kind: "card",
        focusNodeIds: [unitId],
        popNodeIds: [unitId],
      });
    } else {
      beats.push({ nodeIds: [unitId], edgeIds: [], kind: "card", popNodeIds: [unitId] });
    }
    revealWiresOf(unitId);
    const sources: string[] = [];
    const products: string[] = [];
    for (const other of neighbours.get(unitId) ?? []) {
      if (!attachmentIds.has(other) || revealedNodes.has(other)) {
        continue;
      }
      (edgesByUnitPair.has(`${other}|${unitId}`) ? sources : products).push(other);
    }
    sources.sort(readingOrder);
    products.sort(readingOrder);
    for (const attachment of [...sources, ...products]) {
      revealAttachment(attachment);
    }
    settleFrames(unitOwner.get(unitId));
  };

  // NO ISLAND-HOPPING. The units split into their connected components,
  // and each island is built to COMPLETION before the next one starts -
  // biggest first, so the main line is the opening act and the loose odds
  // and ends are the coda. Within an island the machine walk is the same
  // greedy: feeders-complete first, then wired-to-standing, then nearest.
  const componentIndexOf = new Map<string, number>();
  const components: string[][] = [];
  for (const unit of units) {
    if (componentIndexOf.has(unit)) {
      continue;
    }
    const index = components.length;
    const member: string[] = [];
    const queue = [unit];
    componentIndexOf.set(unit, index);
    while (queue.length > 0) {
      const current = queue.pop()!;
      member.push(current);
      for (const other of neighbours.get(current) ?? []) {
        if (!componentIndexOf.has(other)) {
          componentIndexOf.set(other, index);
          queue.push(other);
        }
      }
    }
    components.push(member);
  }
  components.sort((left, right) => {
    if (left.length !== right.length) {
      return right.length - left.length;
    }
    const a = left.reduce((min, id) => Math.min(min, pointFor(id).y * 4 + pointFor(id).x), Infinity);
    const b = right.reduce(
      (min, id) => Math.min(min, pointFor(id).y * 4 + pointFor(id).x),
      Infinity,
    );
    return a - b || (left[0] < right[0] ? -1 : 1);
  });

  const scenes: string[][] = [];
  let lastPoint: Point | undefined;
  for (const component of components) {
    const sceneIndex = scenes.length;
    scenes.push(component);
    const beatsBefore = beats.length;
    const remaining = new Set(component.filter((id) => !attachmentIds.has(id)));
    while (remaining.size > 0) {
      let best: string | undefined;
      let bestKey: [number, number, number, string] | undefined;
      for (const unitId of remaining) {
        let missingFeeders = 0;
        for (const pred of machinePreds.get(unitId) ?? []) {
          if (!revealedNodes.has(pred)) {
            missingFeeders += 1;
          }
        }
        let adjacent = 0;
        if (revealedNodes.size > 0) {
          adjacent = 1;
          for (const other of neighbours.get(unitId) ?? []) {
            if (revealedNodes.has(other)) {
              adjacent = 0;
              break;
            }
          }
        }
        const point = pointFor(unitId);
        const travel = lastPoint ? distance(point, lastPoint) : point.y * 4 + point.x;
        const key: [number, number, number, string] = [missingFeeders, adjacent, travel, unitId];
        if (
          !bestKey ||
          key[0] < bestKey[0] ||
          (key[0] === bestKey[0] &&
            (key[1] < bestKey[1] ||
              (key[1] === bestKey[1] &&
                (key[2] < bestKey[2] || (key[2] === bestKey[2] && key[3] < bestKey[3])))))
        ) {
          bestKey = key;
          best = unitId;
        }
      }
      if (!best) {
        break;
      }
      remaining.delete(best);
      revealMachine(best);
      lastPoint = pointFor(best);
    }

    // This island's attendants nothing summoned: loose drawers, or
    // attachment-only chains. In reading order, wires included, before the
    // NEXT island - an island is finished before the show moves on.
    const strayAttachments = component
      .filter((id) => attachmentIds.has(id) && !revealedNodes.has(id))
      .sort(readingOrder);
    for (const attachment of strayAttachments) {
      revealAttachment(attachment);
    }
    for (let i = beatsBefore; i < beats.length; i += 1) {
      beats[i].sceneIndex = sceneIndex;
    }
  }

  // Boards holding no completion members (empty, or ink-only) still have a
  // frame to draw. Deepest last in view.openBoards order is parents-first;
  // reversing it stands children before the parent that waits on nothing.
  for (const pocket of [...view.openBoards].reverse()) {
    if (!revealedNodes.has(pocket.id)) {
      revealedNodes.add(pocket.id);
      beats.push({ nodeIds: [pocket.id], edgeIds: [], kind: "board", popNodeIds: [pocket.id] });
      // An empty child was the member its parent still waited on.
      settleFrames(pocket.parentPocketId);
    }
  }

  // Ink last, ALL AT ONCE: the annotations pop in together as one closing
  // flourish, and the finale's pull-back follows right behind them.
  const inkUnits = (project.annotations ?? [])
    .map((annotation) => view.representativeOf(annotation.id))
    .filter((id): id is string => Boolean(id && !revealedNodes.has(id)));
  if (inkUnits.length > 0) {
    for (const inkId of inkUnits) {
      revealedNodes.add(inkId);
    }
    beats.push({ nodeIds: inkUnits, edgeIds: [], kind: "ink", popNodeIds: [...inkUnits] });
    // The curtain: an empty beat so the pull-back is its own moment AFTER
    // the ink has landed, not the same breath.
    beats.push({ nodeIds: [], edgeIds: [], kind: "card" });
  }

  // Any edge the walk never claimed (dangling endpoints, edges into units
  // that never revealed) rides the last beat so nothing is left hidden.
  const strayEdges = project.edges
    .map((edge) => edge.id)
    .filter((id) => !revealedEdges.has(id));
  if (strayEdges.length > 0 && beats.length > 0) {
    beats[beats.length - 1].edgeIds.push(...strayEdges);
  }

  // Leftover frames and ink belong to the last act.
  for (const beat of beats) {
    if (beat.sceneIndex === undefined) {
      beat.sceneIndex = Math.max(0, scenes.length - 1);
    }
  }

  return {
    beats,
    scenes,
    hiddenNodeIds: [...revealedNodes],
    hiddenEdgeIds: project.edges.map((edge) => edge.id),
  };
}

/**
 * Absolute flow-space positions from the plan alone: a member of an open
 * board stores a frame-relative position, so its absolute point is its own
 * plus every ancestor frame's corner. Good enough for the script's
 * nearest-card tie-breaks; the camera resolves its own geometry.
 */
function absolutePositionLookup(project: ProjectSlice): (id: string) => Point | undefined {
  const pocketById = new Map((project.pockets ?? []).map((pocket) => [pocket.id, pocket]));
  const entries = new Map<string, { position: Point; ownerId: string | undefined }>();
  for (const node of project.nodes) {
    entries.set(node.id, { position: node.position, ownerId: node.pocketId });
  }
  for (const storage of project.storages ?? []) {
    entries.set(storage.id, { position: storage.position, ownerId: storage.pocketId });
  }
  for (const annotation of project.annotations ?? []) {
    entries.set(annotation.id, { position: annotation.position, ownerId: annotation.pocketId });
  }
  for (const pocket of project.pockets ?? []) {
    entries.set(pocket.id, { position: pocket.position, ownerId: pocket.parentPocketId });
  }
  return (id: string) => {
    const entry = entries.get(id);
    if (!entry) {
      return undefined;
    }
    let x = entry.position.x;
    let y = entry.position.y;
    let ownerId = entry.ownerId;
    const seen = new Set<string>();
    while (ownerId !== undefined && !seen.has(ownerId)) {
      seen.add(ownerId);
      const owner = pocketById.get(ownerId);
      if (!owner) {
        break;
      }
      x += owner.position.x;
      y += owner.position.y;
      ownerId = owner.parentPocketId;
    }
    return { x, y };
  };
}

// ---------------------------------------------------------------------------
// Playback: a module store in the PerfHud shape. DevMenu starts it, the board
// subscribes for the hidden sets, and everything runs off setTimeout beats -
// no React state of its own, no project mutation, one snapshot per beat.
// ---------------------------------------------------------------------------

export interface BoardTimelapseSnapshot {
  revealedNodeIds: ReadonlySet<string>;
  revealedEdgeIds: ReadonlySet<string>;
  /**
   * Revealed nodes whose POP has not fired yet: mounted so their wires can
   * render and draw toward them, but visually held at nothing until their
   * pop beat (see TimelapseBeat.popNodeIds). The board dresses these with
   * the `timelapse-pending` class.
   */
  pendingNodeIds: ReadonlySet<string>;
  /**
   * What the camera should be watching, as an ordered lookahead: the
   * current beat's action first, then the next beats'. The follower in
   * FactoryFlow plans a SHOT from these - a vantage covering as much of
   * the upcoming action as fits without dropping to glance zoom - and then
   * HOLDS it while beats land inside the view, so ten things happening in
   * one vicinity get one steady shot, not ten micro-moves. The final beat
   * hands over one group holding everything for the pull-back ending.
   */
  focusGroups: ReadonlyArray<readonly string[]>;
  /**
   * Every unit of the island currently being built, for the cinematic
   * camera: it frames this whole and drifts with the action's centre
   * instead of chasing shots. Absent on the finale.
   */
  sceneNodeIds?: readonly string[];
  /**
   * The last beat's pull-back over the whole board. Until it, the follow
   * camera holds a zoom floor above the glance threshold - the cards must
   * never drop to their zoomed-out faces mid-show.
   */
  finale: boolean;
  /** The live playback speed multiplier, for the overlay chip. */
  speed: number;
}

/** The speeds the menu offers. 1 is the scripted pace. */
export const BOARD_TIMELAPSE_SPEEDS = [0.25, 0.5, 1, 2, 4, 8] as const;

const TIMELAPSE_SPEED_KEY = "gtnh-factory-flow.dev.timelapse-speed";

let timelapseSpeed = readStoredTimelapseSpeed();

function readStoredTimelapseSpeed(): number {
  if (typeof window === "undefined") {
    return 1;
  }
  try {
    const stored = Number(window.localStorage.getItem(TIMELAPSE_SPEED_KEY));
    if (BOARD_TIMELAPSE_SPEEDS.some((speed) => speed === stored)) {
      return stored;
    }
  } catch {
    // Storage blocked: run at the scripted pace.
  }
  return 1;
}

export function getBoardTimelapseSpeed(): number {
  return timelapseSpeed;
}

/**
 * The timelapse's own sound level, 0..1, on top of the app's master volume.
 * 0.5 plays the shuffle voices as authored; the dial reaches double that,
 * and 0 skips scheduling entirely.
 */
const TIMELAPSE_VOLUME_KEY = "gtnh-factory-flow.dev.timelapse-volume";
const DEFAULT_TIMELAPSE_VOLUME = 0.5;

let timelapseVolume = readStoredTimelapseVolume();

function readStoredTimelapseVolume(): number {
  if (typeof window === "undefined") {
    return DEFAULT_TIMELAPSE_VOLUME;
  }
  try {
    const raw = window.localStorage.getItem(TIMELAPSE_VOLUME_KEY);
    if (raw !== null) {
      const value = Number(raw);
      if (Number.isFinite(value)) {
        return Math.min(1, Math.max(0, value));
      }
    }
  } catch {
    // Storage blocked: author's level.
  }
  return DEFAULT_TIMELAPSE_VOLUME;
}

export function getBoardTimelapseVolume(): number {
  return timelapseVolume;
}

export function setBoardTimelapseVolume(volume: number): void {
  timelapseVolume = Math.min(1, Math.max(0, volume));
  try {
    window.localStorage.setItem(TIMELAPSE_VOLUME_KEY, String(timelapseVolume));
  } catch {
    // Session-only volume is fine.
  }
}

/**
 * How briskly the camera travels between shots, as a multiplier on the
 * chase's pace: 1 is the authored glide, higher is snappier, lower is
 * lazier. Its own dial because it is taste separate from beat speed - a
 * slow build can still want quick cuts, and the other way round.
 */
const TIMELAPSE_CAMERA_PACE_KEY = "gtnh-factory-flow.dev.timelapse-camera-pace";
export const TIMELAPSE_CAMERA_PACE_MIN = 0.05;
export const TIMELAPSE_CAMERA_PACE_MAX = 6;

let timelapseCameraPace = readStoredCameraPace();

function readStoredCameraPace(): number {
  if (typeof window === "undefined") {
    return 1;
  }
  try {
    const raw = window.localStorage.getItem(TIMELAPSE_CAMERA_PACE_KEY);
    if (raw !== null) {
      const value = Number(raw);
      if (Number.isFinite(value)) {
        return Math.min(
          TIMELAPSE_CAMERA_PACE_MAX,
          Math.max(TIMELAPSE_CAMERA_PACE_MIN, value),
        );
      }
    }
  } catch {
    // Storage blocked: authored pace.
  }
  return 1;
}

export function getBoardTimelapseCameraPace(): number {
  return timelapseCameraPace;
}

export function setBoardTimelapseCameraPace(pace: number): void {
  timelapseCameraPace = Math.min(
    TIMELAPSE_CAMERA_PACE_MAX,
    Math.max(TIMELAPSE_CAMERA_PACE_MIN, pace),
  );
  try {
    window.localStorage.setItem(TIMELAPSE_CAMERA_PACE_KEY, String(timelapseCameraPace));
  } catch {
    // Session-only pace is fine.
  }
}

/**
 * How long a wire takes to DRAW itself in, milliseconds at 1x playback.
 * The reveal animation (globals.css) and the beat scheduler share this
 * number: a beat that drew wires holds until the ink is dry before the
 * next thing happens.
 */
const TIMELAPSE_WIRE_DRAW_KEY = "gtnh-factory-flow.dev.timelapse-wire-draw";
export const TIMELAPSE_WIRE_DRAW_MIN_MS = 40;
export const TIMELAPSE_WIRE_DRAW_MAX_MS = 4000;
const TIMELAPSE_WIRE_DRAW_DEFAULT_MS = 450;
/** A breath after the ink dries before the next beat. */
const TIMELAPSE_WIRE_SETTLE_MS = 70;

let timelapseWireDrawMs = readStoredWireDrawMs();

function readStoredWireDrawMs(): number {
  if (typeof window === "undefined") {
    return TIMELAPSE_WIRE_DRAW_DEFAULT_MS;
  }
  try {
    const raw = window.localStorage.getItem(TIMELAPSE_WIRE_DRAW_KEY);
    if (raw !== null) {
      const value = Number(raw);
      if (Number.isFinite(value)) {
        return Math.min(TIMELAPSE_WIRE_DRAW_MAX_MS, Math.max(TIMELAPSE_WIRE_DRAW_MIN_MS, value));
      }
    }
  } catch {
    // Storage blocked: authored draw time.
  }
  return TIMELAPSE_WIRE_DRAW_DEFAULT_MS;
}

export function getBoardTimelapseWireDrawMs(): number {
  return timelapseWireDrawMs;
}

export function setBoardTimelapseWireDrawMs(ms: number): void {
  timelapseWireDrawMs = Math.min(
    TIMELAPSE_WIRE_DRAW_MAX_MS,
    Math.max(TIMELAPSE_WIRE_DRAW_MIN_MS, ms),
  );
  try {
    window.localStorage.setItem(TIMELAPSE_WIRE_DRAW_KEY, String(timelapseWireDrawMs));
  } catch {
    // Session-only draw time is fine.
  }
}

/**
 * How long a card takes to POP in - the fade-and-grow, milliseconds at 1x.
 * Shared, like the wire draw, between the CSS (via --timelapse-pop) and
 * the scheduler, so a slow luxurious pop is part of the show's arithmetic
 * rather than something the next beat tramples.
 */
const TIMELAPSE_POP_KEY = "gtnh-factory-flow.dev.timelapse-pop";
export const TIMELAPSE_POP_MIN_MS = 40;
export const TIMELAPSE_POP_MAX_MS = 3000;
const TIMELAPSE_POP_DEFAULT_MS = 260;

let timelapsePopMs = readStoredPopMs();

function readStoredPopMs(): number {
  if (typeof window === "undefined") {
    return TIMELAPSE_POP_DEFAULT_MS;
  }
  try {
    const raw = window.localStorage.getItem(TIMELAPSE_POP_KEY);
    if (raw !== null) {
      const value = Number(raw);
      if (Number.isFinite(value)) {
        return Math.min(TIMELAPSE_POP_MAX_MS, Math.max(TIMELAPSE_POP_MIN_MS, value));
      }
    }
  } catch {
    // Storage blocked: authored pop.
  }
  return TIMELAPSE_POP_DEFAULT_MS;
}

export function getBoardTimelapsePopMs(): number {
  return timelapsePopMs;
}

export function setBoardTimelapsePopMs(ms: number): void {
  timelapsePopMs = Math.min(TIMELAPSE_POP_MAX_MS, Math.max(TIMELAPSE_POP_MIN_MS, ms));
  try {
    window.localStorage.setItem(TIMELAPSE_POP_KEY, String(timelapsePopMs));
  } catch {
    // Session-only pop is fine.
  }
}

/**
 * The camera's working zoom range while following the action: how close a
 * shot may get and how wide it may go. Defaults are what the camera always
 * did - wide stops exactly at the glance threshold, close stops well under
 * 1:1 so shots stay roomy. Both are the player's now; the finale ignores
 * the wide limit, as it always framed everything.
 */
const TIMELAPSE_ZOOM_KEY = "gtnh-factory-flow.dev.timelapse-zoom-range";
export const TIMELAPSE_ZOOM_MIN_DEFAULT = NODE_GLANCE_LEAVE_ZOOM;
export const TIMELAPSE_ZOOM_MAX_DEFAULT = 0.8;
export const TIMELAPSE_ZOOM_FLOOR = 0.05;
export const TIMELAPSE_ZOOM_CEILING = 1.8;

let timelapseZoomRange = readStoredZoomRange();

function clampZoom(value: number, fallback: number): number {
  return Number.isFinite(value)
    ? Math.min(TIMELAPSE_ZOOM_CEILING, Math.max(TIMELAPSE_ZOOM_FLOOR, value))
    : fallback;
}

function readStoredZoomRange(): { min: number; max: number } {
  if (typeof window === "undefined") {
    return { min: TIMELAPSE_ZOOM_MIN_DEFAULT, max: TIMELAPSE_ZOOM_MAX_DEFAULT };
  }
  try {
    const raw = window.localStorage.getItem(TIMELAPSE_ZOOM_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { min?: number; max?: number };
      return {
        min: clampZoom(Number(parsed.min), TIMELAPSE_ZOOM_MIN_DEFAULT),
        max: clampZoom(Number(parsed.max), TIMELAPSE_ZOOM_MAX_DEFAULT),
      };
    }
  } catch {
    // Storage blocked: authored range.
  }
  return { min: TIMELAPSE_ZOOM_MIN_DEFAULT, max: TIMELAPSE_ZOOM_MAX_DEFAULT };
}

export function getBoardTimelapseZoomRange(): { min: number; max: number } {
  return timelapseZoomRange;
}

export function setBoardTimelapseZoomRange(patch: { min?: number; max?: number }): void {
  timelapseZoomRange = {
    min:
      patch.min !== undefined
        ? clampZoom(patch.min, timelapseZoomRange.min)
        : timelapseZoomRange.min,
    max:
      patch.max !== undefined
        ? clampZoom(patch.max, timelapseZoomRange.max)
        : timelapseZoomRange.max,
  };
  try {
    window.localStorage.setItem(TIMELAPSE_ZOOM_KEY, JSON.stringify(timelapseZoomRange));
  } catch {
    // Session-only range is fine.
  }
}

/**
 * The camera's STYLE. `follow` is the cameraman: shots planned around the
 * action, held, cut. `cinematic` is the crane: each island framed whole
 * from afar, the camera drifting slowly with the action's centre - one
 * long pan per island, dissolving to the next.
 */
export type TimelapseCameraMode = "follow" | "cinematic";

const TIMELAPSE_CAMERA_MODE_KEY = "gtnh-factory-flow.dev.timelapse-camera-mode";

let timelapseCameraMode: TimelapseCameraMode = readStoredCameraMode();

function readStoredCameraMode(): TimelapseCameraMode {
  if (typeof window === "undefined") {
    return "follow";
  }
  try {
    return window.localStorage.getItem(TIMELAPSE_CAMERA_MODE_KEY) === "cinematic"
      ? "cinematic"
      : "follow";
  } catch {
    return "follow";
  }
}

export function getBoardTimelapseCameraMode(): TimelapseCameraMode {
  return timelapseCameraMode;
}

export function setBoardTimelapseCameraMode(mode: TimelapseCameraMode): void {
  timelapseCameraMode = mode;
  try {
    window.localStorage.setItem(TIMELAPSE_CAMERA_MODE_KEY, mode);
  } catch {
    // Session-only mode is fine.
  }
}

/**
 * HOLD THE ENDING: when the last thing lands, the camera does nothing -
 * no finale pull-back, no closing fit-to-screen, the shot simply stays
 * where the build left it. A dev switch for endings meant to be framed
 * by hand or recorded mid-scene; cancelling a run still reframes.
 */
const TIMELAPSE_HOLD_END_KEY = "gtnh-factory-flow.dev.timelapse-hold-end";

let timelapseHoldEnding = readStoredHoldEnding();

function readStoredHoldEnding(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(TIMELAPSE_HOLD_END_KEY) === "on";
  } catch {
    return false;
  }
}

export function getBoardTimelapseHoldEnding(): boolean {
  return timelapseHoldEnding;
}

export function setBoardTimelapseHoldEnding(hold: boolean): void {
  timelapseHoldEnding = hold;
  try {
    if (hold) {
      window.localStorage.setItem(TIMELAPSE_HOLD_END_KEY, "on");
    } else {
      window.localStorage.removeItem(TIMELAPSE_HOLD_END_KEY);
    }
  } catch {
    // Session-only hold is fine.
  }
}

/**
 * The cinematic crane's own zoom dial: a multiplier on the frame-the-
 * whole-island fit. 1 shows the island exactly; above 1 the crane sits
 * closer and the pan crosses a cropped view; below 1 it hangs back with
 * air around the island. Cinematic deliberately ignores the follow
 * camera's Widest floor - from afar is its whole point - so this is its
 * one zoom control (Closest still caps it).
 */
const TIMELAPSE_CINE_ZOOM_KEY = "gtnh-factory-flow.dev.timelapse-cine-zoom";
export const TIMELAPSE_CINE_ZOOM_MIN = 0.4;
export const TIMELAPSE_CINE_ZOOM_MAX = 3;

let timelapseCineZoom = readStoredCineZoom();

function readStoredCineZoom(): number {
  if (typeof window === "undefined") {
    return 1;
  }
  try {
    const raw = window.localStorage.getItem(TIMELAPSE_CINE_ZOOM_KEY);
    if (raw !== null) {
      const value = Number(raw);
      if (Number.isFinite(value)) {
        return Math.min(TIMELAPSE_CINE_ZOOM_MAX, Math.max(TIMELAPSE_CINE_ZOOM_MIN, value));
      }
    }
  } catch {
    // Storage blocked: island-exact framing.
  }
  return 1;
}

export function getBoardTimelapseCineZoom(): number {
  return timelapseCineZoom;
}

export function setBoardTimelapseCineZoom(zoom: number): void {
  timelapseCineZoom = Math.min(TIMELAPSE_CINE_ZOOM_MAX, Math.max(TIMELAPSE_CINE_ZOOM_MIN, zoom));
  try {
    window.localStorage.setItem(TIMELAPSE_CINE_ZOOM_KEY, String(timelapseCineZoom));
  } catch {
    // Session-only zoom is fine.
  }
}

/**
 * THE CAMERA SETS THE PACE. The board's follower reports how far the
 * viewport still is from its shot every frame; a beat whose gap has
 * elapsed does not fire until the camera has essentially arrived, so a
 * slow camera stretches the whole show and a parked one lets a 4x run
 * blaze. A staleness check and a hard cap keep a missing or wedged
 * follower from stalling the run forever.
 */
let cameraRemainingPx = 0;
let cameraUpcomingOnScreen = false;
let cameraReportedAt = 0;

export function reportTimelapseCameraProgress(
  remainingPx: number,
  upcomingOnScreen: boolean,
): void {
  cameraRemainingPx = remainingPx;
  cameraUpcomingOnScreen = upcomingOnScreen;
  cameraReportedAt = Date.now();
}

/**
 * The gate's PRINCIPLE: a beat may fire once the place it happens is on
 * screen. The follower reports whether the upcoming action's rect sits
 * inside the live viewport; mid-glide is fine - if the camera is sweeping
 * PAST where the next card lands, the card may land while it sweeps. The
 * arrive radius is the fallback for a shot whose action never quite fits
 * (a cropped wide cluster), and the cap is pathology insurance only - a
 * glacial camera pace is legitimate travel, not a stall.
 */
const TIMELAPSE_CAMERA_ARRIVE_PX = 120;
const TIMELAPSE_CAMERA_REPORT_FRESH_MS = 400;
const TIMELAPSE_CAMERA_WAIT_CAP_MS = 120_000;
const TIMELAPSE_CAMERA_POLL_MS = 70;

function playTimelapseSound(kind: Parameters<typeof playBoardSound>[0]): void {
  if (timelapseVolume <= 0) {
    return;
  }
  playBoardSound(kind, { gain: timelapseVolume * 2 });
}

/** Takes effect from the next beat; mid-run changes are the point. */
export function setBoardTimelapseSpeed(speed: number): void {
  if (!BOARD_TIMELAPSE_SPEEDS.some((allowed) => allowed === speed)) {
    return;
  }
  timelapseSpeed = speed;
  try {
    window.localStorage.setItem(TIMELAPSE_SPEED_KEY, String(speed));
  } catch {
    // Session-only speed is fine.
  }
  if (activeSnapshot) {
    activeSnapshot = { ...activeSnapshot, speed };
    emit();
  }
}

/** The whole run aims at about this long, whatever the board's size... */
const TIMELAPSE_TARGET_MS = 16_000;
/** ...held between these per-card beats, so tiny boards still read as a
 * sequence and huge ones do not run for minutes. */
const TIMELAPSE_MIN_BEAT_MS = 160;
const TIMELAPSE_MAX_BEAT_MS = 650;
/** Ink is a flourish at the end, not the show. */
const TIMELAPSE_INK_BEAT_MS = 220;
/** The finished board holds for a breath before the overlay lifts. */
const TIMELAPSE_FINISH_HOLD_MS = 1600;
/** How far ahead the camera may read the script when planning a shot. Deep
 * enough to cover a machine with all its attendants and wires plus the
 * next machine or two when they are close; the zoom floor is what stops a
 * shot from swallowing a distant cluster. */
const TIMELAPSE_SHOT_LOOKAHEAD = 14;

let activeSnapshot: BoardTimelapseSnapshot | undefined;
const listeners = new Set<() => void>();
let stepTimer: ReturnType<typeof setTimeout> | undefined;
let soundTimer: ReturnType<typeof setTimeout> | undefined;
let playToken = 0;

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeBoardTimelapse(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBoardTimelapseSnapshot(): BoardTimelapseSnapshot | undefined {
  return activeSnapshot;
}

/** SSR half of the useSyncExternalStore pair: never active on the server. */
export function getServerBoardTimelapseSnapshot(): BoardTimelapseSnapshot | undefined {
  return undefined;
}

/**
 * Stops the run and lifts every hidden flag at once. Safe to call idle.
 * Every ending reframes to the ordinary fit-to-screen: a cancelled run's
 * camera was mid-shot somewhere tight, and a finished run's finale was
 * framed for the TILTED view - far wider than a flat fit - so the fit
 * glides in while the tilt eases off, one closing motion.
 */
/**
 * Whether the LAST run ended on a held final shot (see the hold switch):
 * the natural finish with the hold on is the only path that skips the
 * reframe, and the board keeps the show's tilt on too - flattening at
 * 27 degrees of turn reads as an enormous zoom, which is exactly the
 * camera movement the hold promises not to make. Cleared by the next run.
 */
let lastRunEndedHeld = false;

export function didBoardTimelapseEndHeld(): boolean {
  return lastRunEndedHeld;
}

export function stopBoardTimelapse(options?: { reframe?: boolean }): void {
  if (activeSnapshot) {
    lastRunEndedHeld = options?.reframe === false;
  }
  playToken += 1;
  if (stepTimer !== undefined) {
    clearTimeout(stepTimer);
    stepTimer = undefined;
  }
  if (soundTimer !== undefined) {
    clearTimeout(soundTimer);
    soundTimer = undefined;
  }
  if (activeSnapshot) {
    activeSnapshot = undefined;
    emit();
    if (options?.reframe !== false) {
      useFactoryStore.getState().frameBoardNodes();
    }
  }
  // A preset run hands the player's own settings back however it ended.
  if (restorePresetSettings) {
    const restore = restorePresetSettings;
    restorePresetSettings = undefined;
    restore();
  }
}

/**
 * The two PLAYER-FACING shows, tuned by hand (Jack, 2026-08-29): complete
 * configurations - dials, tilt, glance faces - applied for the run and
 * restored when it ends, so pressing play never rewires anyone's settings.
 * The dev menu remains the workbench; this is the finished act.
 */
export interface BoardTimelapsePreset {
  id: string;
  /** Player-facing name and one plain line on what the camera does. */
  name: string;
  line: string;
  speed: number;
  volume: number;
  mode: TimelapseCameraMode;
  cineZoom?: number;
  cameraPace: number;
  wireDrawMs: number;
  popMs: number;
  zoom: { min: number; max: number };
  tilt: BoardTilt;
  forceGlance: boolean;
}

export const BOARD_TIMELAPSE_PRESETS: BoardTimelapsePreset[] = [
  {
    id: "afar",
    name: "From afar",
    line: "One slow shot of the whole build.",
    speed: 2,
    volume: 0.15,
    mode: "cinematic",
    cineZoom: 1.95,
    cameraPace: 0.7,
    wireDrawMs: 660,
    popMs: 260,
    zoom: { min: 0.54, max: 0.42 },
    tilt: { pitch: 11, yaw: -27, drift: true, always: false },
    forceGlance: true,
  },
  {
    id: "close",
    name: "Up close",
    line: "The camera follows each machine as it lands.",
    speed: 4,
    volume: 0.15,
    mode: "follow",
    cameraPace: 0.15,
    wireDrawMs: 1440,
    popMs: 2160,
    zoom: { min: 0.4, max: 0.7 },
    tilt: { pitch: 11, yaw: -27, drift: true, always: false },
    forceGlance: true,
  },
];

/** Set while a preset run is live; stopBoardTimelapse hands settings back. */
let restorePresetSettings: (() => void) | undefined;

export function runBoardTimelapsePreset(preset: BoardTimelapsePreset): boolean {
  // A live preset run restores its settings first, so `prior` is always
  // the player's own configuration, never a half-applied show's.
  stopBoardTimelapse();
  const prior = {
    speed: timelapseSpeed,
    volume: timelapseVolume,
    mode: timelapseCameraMode,
    cineZoom: timelapseCineZoom,
    pace: timelapseCameraPace,
    wireDrawMs: timelapseWireDrawMs,
    popMs: timelapsePopMs,
    zoom: timelapseZoomRange,
    tilt: getBoardTiltSnapshot(),
    glance: isNodeDetailGlanceForced(),
  };
  setBoardTimelapseSpeed(preset.speed);
  setBoardTimelapseVolume(preset.volume);
  setBoardTimelapseCameraMode(preset.mode);
  if (preset.cineZoom !== undefined) {
    setBoardTimelapseCineZoom(preset.cineZoom);
  }
  setBoardTimelapseCameraPace(preset.cameraPace);
  setBoardTimelapseWireDrawMs(preset.wireDrawMs);
  setBoardTimelapsePopMs(preset.popMs);
  setBoardTimelapseZoomRange(preset.zoom);
  writeBoardTilt(preset.tilt);
  setNodeDetailGlanceForced(preset.forceGlance);
  const restore = () => {
    setBoardTimelapseSpeed(prior.speed);
    setBoardTimelapseVolume(prior.volume);
    setBoardTimelapseCameraMode(prior.mode);
    setBoardTimelapseCineZoom(prior.cineZoom);
    setBoardTimelapseCameraPace(prior.pace);
    setBoardTimelapseWireDrawMs(prior.wireDrawMs);
    setBoardTimelapsePopMs(prior.popMs);
    setBoardTimelapseZoomRange(prior.zoom);
    writeBoardTilt(prior.tilt);
    setNodeDetailGlanceForced(prior.glance);
  };
  const started = startBoardTimelapse();
  if (started) {
    // Installed only AFTER the start: startBoardTimelapse begins by
    // stopping any prior run, and the stop path is what fires this.
    restorePresetSettings = restore;
  } else {
    restore();
  }
  return started;
}

/**
 * Plays the current plan as a build timelapse. Returns false when there is
 * nothing worth playing (fewer than two cards on the canvas).
 */
export function startBoardTimelapse(): boolean {
  const store = useFactoryStore.getState();
  const project = store.project;
  const script = buildTimelapseScript(project, absolutePositionLookup(project));
  const cardBeats = script.beats.filter((beat) => beat.kind === "card").length;
  if (cardBeats < 2) {
    return false;
  }

  stopBoardTimelapse();
  const token = ++playToken;
  const projectId = project.id;
  // Cards and frames pace at a full beat, wires at their half-step - and
  // with every wire its own beat now they are the bulk of the show, so the
  // target length is spread over the WEIGHTED count, not the card count.
  const paceUnits = script.beats.reduce(
    (sum, beat) =>
      sum + (beat.kind === "wire" ? 0.55 : beat.kind === "ink" ? 0 : 1),
    0,
  );
  const beatMs = Math.min(
    TIMELAPSE_MAX_BEAT_MS,
    Math.max(TIMELAPSE_MIN_BEAT_MS, Math.round(TIMELAPSE_TARGET_MS / Math.max(1, paceUnits))),
  );
  const delayBefore = (beat: TimelapseBeat) =>
    beat.kind === "wire"
      ? beatMs * 0.55
      : beat.kind === "ink"
        ? TIMELAPSE_INK_BEAT_MS
        : beatMs;

  // The camera's reading of the script from a given beat: the action of
  // that beat and the next few, in order, empties skipped.
  const focusGroupsAt = (startIndex: number): string[][] => {
    const groups: string[][] = [];
    for (
      let i = startIndex;
      i < script.beats.length && groups.length <= TIMELAPSE_SHOT_LOOKAHEAD;
      i += 1
    ) {
      const focus = script.beats[i].focusNodeIds ?? script.beats[i].nodeIds;
      if (focus.length > 0) {
        groups.push([...focus]);
      }
    }
    return groups;
  };

  activeSnapshot = {
    revealedNodeIds: new Set(),
    revealedEdgeIds: new Set(),
    pendingNodeIds: new Set(),
    // The approach shot: planned over the opening beats while the board is
    // still empty, so the camera is already standing where the first
    // machines will land.
    focusGroups: focusGroupsAt(0),
    sceneNodeIds: script.scenes[script.beats[0].sceneIndex ?? 0],
    finale: false,
    speed: timelapseSpeed,
  };
  emit();

  let index = 0;
  // The beat gap, then the camera: once the time has elapsed, what happens
  // next still waits until its stage is IN VIEW (or the camera has all but
  // arrived) - the camera is the star, and nothing happens off-screen
  // while it is still travelling there. The finale rides the same gate, so
  // the pull-back finishes before the show ends.
  const scheduleGated = (gapMs: number, run: () => void) => {
    const waitedFrom = Date.now();
    const attempt = () => {
      stepTimer = undefined;
      if (token !== playToken) {
        return;
      }
      const reportIsFresh = Date.now() - cameraReportedAt < TIMELAPSE_CAMERA_REPORT_FRESH_MS;
      if (
        reportIsFresh &&
        !cameraUpcomingOnScreen &&
        cameraRemainingPx > TIMELAPSE_CAMERA_ARRIVE_PX &&
        Date.now() - waitedFrom < TIMELAPSE_CAMERA_WAIT_CAP_MS
      ) {
        stepTimer = setTimeout(attempt, TIMELAPSE_CAMERA_POLL_MS);
        return;
      }
      run();
    };
    stepTimer = setTimeout(attempt, gapMs);
  };
  const scheduleNext = (gapMs: number) => scheduleGated(gapMs, step);
  const step = () => {
    stepTimer = undefined;
    if (token !== playToken) {
      return;
    }
    const state = useFactoryStore.getState();
    // A different plan under the same playback means the script is about a
    // board that no longer exists; stop rather than hide the new one.
    if (state.project.id !== projectId || !activeSnapshot) {
      stopBoardTimelapse();
      return;
    }

    const beat = script.beats[index];
    const revealedNodeIds = new Set(activeSnapshot.revealedNodeIds);
    const revealedEdgeIds = new Set(activeSnapshot.revealedEdgeIds);
    const pendingNodeIds = new Set(activeSnapshot.pendingNodeIds);
    const popped = new Set(beat.popNodeIds ?? []);
    for (const id of beat.nodeIds) {
      revealedNodeIds.add(id);
      if (!popped.has(id)) {
        pendingNodeIds.add(id);
      }
    }
    for (const id of popped) {
      pendingNodeIds.delete(id);
    }
    for (const id of beat.edgeIds) {
      revealedEdgeIds.add(id);
    }
    const isLastBeat = index === script.beats.length - 1;
    activeSnapshot = {
      revealedNodeIds,
      revealedEdgeIds,
      pendingNodeIds,
      // This beat's action first, the upcoming beats' behind it; the last
      // beat hands over everything for the pull-back ending.
      focusGroups: isLastBeat ? [[...revealedNodeIds]] : focusGroupsAt(index),
      sceneNodeIds: isLastBeat
        ? undefined
        : script.scenes[beat.sceneIndex ?? script.scenes.length - 1],
      finale: isLastBeat,
      speed: timelapseSpeed,
    };
    emit();

    // The shuffle family: brushes, not thumps. A storage's combined beat
    // slides the drawer in and whisks its wire a half-beat later. An empty
    // beat (the curtain before the finale) makes no sound at all.
    const beatHasContent =
      beat.nodeIds.length > 0 || beat.edgeIds.length > 0 || (beat.popNodeIds?.length ?? 0) > 0;
    if (!beatHasContent) {
      // Nothing landed; nothing sounds.
    } else
    switch (beat.kind) {
      case "card":
        playTimelapseSound("shuffle");
        if (beat.edgeIds.length > 0) {
          soundTimer = setTimeout(
            () => {
              soundTimer = undefined;
              if (token === playToken) {
                playTimelapseSound("shuffleWire");
              }
            },
            Math.round(beatMs / 2 / timelapseSpeed),
          );
        }
        break;
      case "wire":
        playTimelapseSound("shuffleWire");
        break;
      case "board":
        playTimelapseSound("shuffleBoard");
        break;
      case "ink":
        playTimelapseSound("shuffleWire");
        break;
    }

    index += 1;
    if (index >= script.beats.length) {
      // Camera-gated like every other beat: the ending waits for the
      // pull-back to actually show everything - stopping on a bare timer
      // cut the finale off mid-flight on any big board.
      scheduleGated(TIMELAPSE_FINISH_HOLD_MS / timelapseSpeed, () => {
        playTimelapseSound("sweep");
        // The closing move: the finale's frame was sized for the TILTED
        // view, which is far wider than a flat fit needs - so the stop
        // reframes to the ordinary fit-to-screen while the tilt eases
        // off, one motion into the exact view the fit button gives.
        // Unless the ending is HELD, in which case the camera does not
        // move at all.
        stopBoardTimelapse({ reframe: !timelapseHoldEnding });
      });
      return;
    }
    // Speed and the NEXT beat's kind decide the gap, read at scheduling
    // time, so a chip press mid-run changes the pace from the very next
    // beat and a wire follows its card quickly. A beat that drew wires
    // holds until the ink is dry, however short its own gap would be.
    const inkDryMs =
      beat.edgeIds.length > 0 ? timelapseWireDrawMs + TIMELAPSE_WIRE_SETTLE_MS : 0;
    // A pop is part of the arithmetic too: a beat that landed something
    // holds until the grow-and-fade has mostly played.
    const popMs = popped.size > 0 ? timelapsePopMs * 0.9 : 0;
    scheduleNext(
      Math.max(delayBefore(script.beats[index]), inkDryMs, popMs) / timelapseSpeed,
    );
  };

  // One quiet moment on the emptied board before the first card lands.
  scheduleNext(420 / timelapseSpeed);
  return true;
}

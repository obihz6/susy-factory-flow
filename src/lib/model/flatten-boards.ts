import type { FactoryProject } from "./types";

/**
 * THE DUMP BEFORE THE ARRANGE (Jack, 2026-09-08: the arrange "should have
 * no respect for player-made boards" unless the Keep boards switch says
 * so). Every board's members surface onto the canvas where the frame
 * stood - exactly what dissolving each board by hand would do - and the
 * boards themselves go, so the arrange sees one flat set of cards.
 *
 * Pure: returns a new project, touches nothing in the store. The store's
 * `applyBoardArrangement` with `removeBoards` set to every board id makes
 * the same change for real, in the arrange's own undo entry.
 */
export function flattenBoards(project: FactoryProject): FactoryProject {
  const pockets = project.pockets ?? [];
  if (pockets.length === 0) {
    return project;
  }
  const byId = new Map(pockets.map((pocket) => [pocket.id, pocket]));
  // A board that has ever been fitted (it carries a `size`) holds
  // frame-relative member positions, so its corner is added back; a legacy
  // pocket that never stood open keeps its members' own coordinates.
  // Nested boards add every frame on the way up.
  const offsetOf = (pocketId: string | undefined): { x: number; y: number } => {
    let x = 0;
    let y = 0;
    const seen = new Set<string>();
    for (let id = pocketId; id !== undefined && !seen.has(id); ) {
      seen.add(id);
      const pocket = byId.get(id);
      if (!pocket) break;
      if (pocket.size !== undefined) {
        x += pocket.position.x;
        y += pocket.position.y;
      }
      id = pocket.parentPocketId;
    }
    return { x, y };
  };
  const surface = <T extends { pocketId?: string; position: { x: number; y: number } }>(
    items: T[],
  ): T[] =>
    items.map((item) => {
      if (item.pocketId === undefined) return item;
      const offset = offsetOf(item.pocketId);
      return {
        ...item,
        pocketId: undefined,
        position: { x: item.position.x + offset.x, y: item.position.y + offset.y },
      };
    });
  return {
    ...project,
    nodes: surface(project.nodes),
    storages: project.storages ? surface(project.storages) : project.storages,
    annotations: project.annotations ? surface(project.annotations) : project.annotations,
    pockets: [],
  };
}

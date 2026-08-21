/**
 * The paper a board is drawn on.
 *
 * There is no house colour for a board and no "unpapered" look: every board
 * wears one of the canvas papers, and a new one takes a paper nobody else on
 * the plan is wearing, at random. A board that predates papers is given one
 * from its OWN ID, so it looks the same on every reload and on everybody's
 * screen without a migration writing anything.
 *
 * Only DARK papers are listed. A pale sheet under a board's dark cards reads
 * as a hole cut in the plan rather than as a surface the cards sit on, which
 * is why the picker does not offer the light canvas themes either.
 */

/** Canvas theme ids a board may be laid on, darkest family first. */
export const BOARD_PAPER_IDS: readonly string[] = [
  "slate",
  "blueprint",
  "chalkboard",
  "graphite",
  "gunmetal",
  "midnight",
  "charcoal",
  "void",
];

/**
 * A paper for a board that has never been given one. Chosen from the id, so
 * it is stable across reloads, shares and undo — a board that changed colour
 * every time the plan loaded would read as a bug, and picking at random here
 * would do exactly that.
 */
export function paperForBoardId(boardId: string): string {
  let hash = 0;
  for (let index = 0; index < boardId.length; index += 1) {
    hash = (hash * 31 + boardId.charCodeAt(index)) | 0;
  }
  return BOARD_PAPER_IDS[Math.abs(hash) % BOARD_PAPER_IDS.length];
}

/**
 * A paper for a NEW board: random, but never one already in use if any is
 * free. Two boards side by side in the same colour look like one board with
 * a line through it, and cycling in order would make every plan's first four
 * zones the same four colours.
 */
export function pickBoardPaper(
  wornPapers: Iterable<string | undefined>,
  random: () => number = Math.random,
): string {
  const worn = new Set<string>();
  for (const paper of wornPapers) {
    if (paper !== undefined) {
      worn.add(paper);
    }
  }
  const free = BOARD_PAPER_IDS.filter((paper) => !worn.has(paper));
  const pool = free.length > 0 ? free : BOARD_PAPER_IDS;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

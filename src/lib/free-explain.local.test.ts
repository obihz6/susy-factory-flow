import { appendFileSync, readFileSync } from "node:fs";
import { it } from "vitest";
import { explainFreeScore, FREE_DIALS } from "./board-arrange-free";
import { parseLayout } from "./board-layout-string";
import { makeRouteJudge } from "./route-judge";

/**
 * EXPLAIN LAYOUTS: CAPTURE=audit.json LAYOUTS=a.json,b.json REPORT=out.txt
 * prints every term of the free placer's objective, and the router's
 * verdict, for each layout string - so a weight can be judged by what it
 * did to a real board rather than by a synthetic case.
 */
const say = (line: string) => {
  if (process.env.REPORT) appendFileSync(process.env.REPORT, `${line}\n`);
};

it("explains layouts under the free objective and the router", { timeout: 600000 }, () => {
  const capture = JSON.parse(readFileSync(process.env.CAPTURE!, "utf8"));
  const { cards, wires } = capture.arrangeInput;
  const judgeInput = capture.judgeInput;
  const judge = makeRouteJudge(judgeInput.obstacles, judgeInput.requests, judgeInput.tuning);
  if (process.env.DIALS) Object.assign(FREE_DIALS, JSON.parse(process.env.DIALS));
  say(`dials ${JSON.stringify(FREE_DIALS)}`);
  for (const file of (process.env.LAYOUTS ?? "").split(",").filter(Boolean)) {
    const layout = parseLayout(readFileSync(file, "utf8"));
    // Layout strings key cards by the shortest distinct id prefix.
    const positions = new Map<string, { x: number; y: number }>();
    for (const card of layout.cards) {
      const full = (cards as Array<{ id: string }>).filter((c) => c.id.startsWith(card.id));
      if (full.length === 1) positions.set(full[0].id, { x: card.x, y: card.y });
    }
    if (positions.size !== cards.length) say(`${file}: matched ${positions.size} of ${cards.length}`);
    const terms = explainFreeScore(cards, wires, positions, judgeInput.tuning);
    const verdict = judge(positions);
    const rounded = Object.fromEntries(Object.entries(terms).map(([k, v]) => [k, Math.round(v)]));
    say(
      `${file.split(/[\\/]/).pop()} free=${JSON.stringify(rounded)} router: ${verdict.crossings} crossings ${Math.round(verdict.points)} pts ${Math.round(verdict.length)} px`,
    );
  }
});

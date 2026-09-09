import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { arrangeBoard } from "./board-arrange";
import { encodeLayout } from "./board-layout-string";
import { makeRouteJudge } from "./route-judge";
import { FREE_DIALS } from "./board-arrange-free";

/**
 * ARRANGE A CAPTURE: an audit.json from tools/audit-board.mjs carries the
 * exact arrange input (cards, wires, taste) and judge input (obstacles,
 * requests, tuning) the app handed the worker. This runs the arranger on
 * them offline, reports the router's verdict on the answer (and on the
 * board as captured, for reference) to REPORT=file, and writes the answer
 * as a layout string (OUT=file) for `audit-board.mjs --layout` or the dev
 * menu.
 *
 *   CAPTURE=artifacts/route-audit/x.audit.json OUT=x.layout.json REPORT=x.txt \
 *     npx vitest run src/lib/arrange-capture.local.test.ts --config vitest.local.config.ts
 */
const say = (line: string) => {
  console.log(line);
  if (process.env.REPORT) {
    appendFileSync(process.env.REPORT, `${line}\n`);
  }
};

it("arranges a captured board and judges the answer", { timeout: 900000 }, () => {
  const capture = JSON.parse(readFileSync(process.env.CAPTURE ?? "capture.json", "utf8"));
  const { cards, wires, taste } = capture.arrangeInput;
  const judgeInput = capture.judgeInput;
  const judge = makeRouteJudge(judgeInput.obstacles, judgeInput.requests, judgeInput.tuning);
  const asIs = new Map<string, { x: number; y: number }>(
    cards.map((card: { id: string; x: number; y: number }) => [card.id, { x: card.x, y: card.y }]),
  );
  const before = judge(asIs);
  say(
    `captured: ${before.crossings} crossings, ${Math.round(before.points)} points, ${Math.round(before.length)} px`,
  );
  if (process.env.DIALS) Object.assign(FREE_DIALS, JSON.parse(process.env.DIALS));
  say(`dials ${JSON.stringify(FREE_DIALS)}`);
  const started = performance.now();
  const result = arrangeBoard({ cards, wires, taste, judge, tuning: judgeInput.tuning });
  const ms = Math.round(performance.now() - started);
  say(`candidates ${JSON.stringify((globalThis as { __arrangeCandidates?: unknown }).__arrangeCandidates)}`);
  const positions = new Map(result.moves.map((move) => [move.id, move.position]));
  const after = judge(positions);
  say(
    `arranged: ${after.crossings} crossings, ${Math.round(after.points)} points, ${Math.round(after.length)} px in ${ms} ms`,
  );
  if (process.env.OUT) {
    const snapshot = {
      planId: capture.displayed?.project?.id ?? "capture",
      cards: cards.map((card: { id: string; width: number; height: number }) => ({
        id: card.id,
        x: positions.get(card.id)?.x ?? 0,
        y: positions.get(card.id)?.y ?? 0,
        width: card.width,
        height: card.height,
      })),
      wires,
      score: { crossings: after.crossings, length: after.length, points: after.points },
    };
    writeFileSync(process.env.OUT, encodeLayout(snapshot));
    say(`wrote ${process.env.OUT}`);
  }
});

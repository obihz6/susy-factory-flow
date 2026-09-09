import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { arrangeBoard } from "./board-arrange";
import { encodeLayout, parseLayout } from "./board-layout-string";
import { makeRouteJudge } from "./route-judge";
import { BOARD_GRID } from "./board-grid";
import type { GridEndpoint, GridObstacle, GridRouteRequest } from "@/components/flow/grid-edge-router";
import { DEFAULT_ROUTER_TUNING } from "@/components/flow/router-tuning";

/**
 * VERSUS: a layout string from the dev menu (LAYOUT=file) is rebuilt into
 * the router's problem - cards as obstacles, wires with free-dock rims (or
 * fixed ports, PORTS=1) - scored as it stands, then arranged, and the
 * arranger's layout string is written beside it (OUT=file) for the player
 * to paste back. No app, no plan, no recipes.
 */
it("scores a layout string and answers with the arranger's", { timeout: 900000 }, () => {
  const text = readFileSync(process.env.LAYOUT ?? "layout.json", "utf8");
  const layout = parseLayout(text);
  const rim = (rect: GridObstacle): GridEndpoint[] => {
    const out: GridEndpoint[] = [];
    const keepOut = (span: number) => (span >= 2 * BOARD_GRID ? BOARD_GRID : 0);
    const kx = keepOut(rect.right - rect.left);
    const ky = keepOut(rect.bottom - rect.top);
    for (let x = rect.left + kx; x <= rect.right - kx; x += BOARD_GRID) {
      out.push({ x, y: rect.top, side: "top" }, { x, y: rect.bottom, side: "bottom" });
    }
    for (let y = rect.top + ky; y <= rect.bottom - ky; y += BOARD_GRID) {
      out.push({ x: rect.left, y, side: "left" }, { x: rect.right, y, side: "right" });
    }
    return out;
  };
  const obstacles: GridObstacle[] = layout.cards.map((card) => ({
    id: card.id,
    left: card.x,
    top: card.y,
    right: card.x + (card.width ?? 440),
    bottom: card.y + (card.height ?? 300),
  }));
  const byId = new Map(obstacles.map((o) => [o.id, o]));
  const requests: GridRouteRequest[] = (layout.wires ?? []).map((wire, index) => {
    const source = byId.get(wire.source)!;
    const target = byId.get(wire.target)!;
    const ports = process.env.PORTS === "1";
    return {
      edgeId: wire.id ?? `w${index}`,
      order: index,
      sources:
        ports && wire.sourcePortY !== undefined
          ? [{ x: source.right, y: source.top + wire.sourcePortY, side: "right" }]
          : rim(source),
      targets:
        ports && wire.targetPortY !== undefined
          ? [{ x: target.left, y: target.top + wire.targetPortY, side: "left" }]
          : rim(target),
      sourceCardId: wire.source,
      targetCardId: wire.target,
      strokeWidth: wire.width ?? 6,
    };
  });
  const tuning = { ...DEFAULT_ROUTER_TUNING, ...JSON.parse(process.env.TUNING ?? "{}") };
  const judge = makeRouteJudge(obstacles, requests, tuning);
  const theirs = judge(new Map(obstacles.map((o) => [o.id, { x: o.left, y: o.top }])));
  console.log(
    `player: crossings ${theirs.crossings} points ${Math.round(theirs.points)} length ${Math.round(theirs.length)}` +
      (layout.score ? ` (their screen said ${layout.score.crossings} / ${layout.score.points ?? "?"} pts / ${layout.score.length} px)` : ""),
  );
  const t0 = performance.now();
  const arranged = arrangeBoard({
    cards: layout.cards.map((card) => ({
      id: card.id,
      x: card.x,
      y: card.y,
      width: card.width ?? 440,
      height: card.height ?? 300,
      role: card.id.startsWith("storage") ? "storage" : "machine",
    })),
    wires: (layout.wires ?? []).map((wire, index) => ({
      id: wire.id ?? `w${index}`,
      source: wire.source,
      target: wire.target,
      sourcePortY: wire.sourcePortY,
      targetPortY: wire.targetPortY,
      width: wire.width,
    })),
    origin: { x: 0, y: 0 },
    taste: { spacing: "compact" },
    judge,
    tuning,
  });
  const positions = new Map(arranged.moves.map((move) => [move.id, move.position]));
  const mine = judge(positions);
  console.log(`arranger: crossings ${mine.crossings} points ${Math.round(mine.points)} length ${Math.round(mine.length)} in ${Math.round(performance.now() - t0)} ms`);
  const answer = encodeLayout({
    planId: layout.planId,
    cards: layout.cards.map((card) => ({ ...card, ...(positions.get(card.id) ?? {}) })),
    wires: layout.wires,
    score: { crossings: mine.crossings, length: mine.length, points: mine.points },
  });
  writeFileSync(process.env.OUT ?? "layout-answer.json", answer);
  console.log(`answer written: ${process.env.OUT ?? "layout-answer.json"} (${answer.length} chars)`);
});

/**
 * Browser-agnostic "is the picture actually moving" measurement.
 *
 * The two metrics used so far are both unusable here. rAF deltas measure
 * whether the main thread is free — on the machine that reported this bug it
 * said 65fps while the board felt like 5. Compositor `Commit` events are a
 * Chromium trace category and do not exist in Firefox, which is the browser
 * that actually has the problem.
 *
 * So this measures the only thing that is true in every browser: whether
 * successive screenshots DIFFER. During a steady pan every presented frame
 * should look different from the last; a board whose compositor is lagging
 * repeats the same picture several samples in a row. Sampling costs ~50ms, so
 * this can resolve up to roughly 20fps — which is plenty to tell 5fps from 60,
 * and 5fps from 60 is the entire question.
 *
 * The screenshot overhead perturbs the result, but identically in both arms of
 * an A/B, so comparisons hold even though absolute values are conservative.
 *
 * Usage:
 *   node tools/perf/feel-firefox.mjs --plan plan.json --browser firefox
 *                                    [--css "<style to inject>"] [--label name]
 */
import { chromium, firefox } from "playwright";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}
const project = JSON.parse(readFileSync(args.get("plan") ?? "plan.json", "utf8"));
const BASE = args.get("base") ?? "http://localhost:3000";
const LABEL = args.get("label") ?? "run";
const CSS = args.get("css");
const engine = args.get("browser") === "chromium" ? chromium : firefox;
// The reporter's board column was 697px wide — a tall narrow board, which is
// not what a default viewport gives you, and layer sizes depend on it.
const WIDTH = Number(args.get("width") ?? 1500);
const HEIGHT = Number(args.get("height") ?? 1400);

const browser = await engine.launch({ headless: args.get("headed") !== "1" });
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow", { timeout: 90_000 });
await page.waitForTimeout(6000);
await page.evaluate(async (plan) => {
  const db = await new Promise((res, rej) => {
    const request = indexedDB.open("susy-factory-flow-designs", 1);
    request.onupgradeneeded = () => {
      const d = request.result;
      if (!d.objectStoreNames.contains("design-meta")) d.createObjectStore("design-meta", { keyPath: "id" });
      if (!d.objectStoreNames.contains("design-plans")) d.createObjectStore("design-plans", { keyPath: "id" });
    };
    request.onsuccess = () => res(request.result);
    request.onerror = () => rej(request.error);
  });
  const now = new Date().toISOString();
  await new Promise((res) => {
    const t = db.transaction(["design-meta", "design-plans"], "readwrite");
    t.objectStore("design-meta").put({ id: plan.id, name: plan.name, createdAt: now, updatedAt: now });
    t.objectStore("design-plans").put({ id: plan.id, project: plan });
    t.oncomplete = () => res();
  });
  db.close();
  localStorage.setItem("susy-factory-flow.active-design.v1", plan.id);
  // Match the reporting session's board view exactly: thickness and pulse off.
  localStorage.setItem(
    "susy-factory-flow-board-view",
    JSON.stringify({
      snapToGrid: false,
      canvasPattern: "dots",
      heatmapMode: false,
      lineHeatMode: false,
      lineThicknessMode: false,
      linePulseMode: false,
    }),
  );
}, project);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 180_000 });
await page.waitForTimeout(14_000);

if (CSS) {
  await page.addStyleTag({ content: CSS });
  await page.waitForTimeout(500);
}

const board = await page.$(".react-flow");
const box = await board.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

const onScreen = await page.evaluate(() => ({
  nodes: document.querySelectorAll(".react-flow__node").length,
  edges: document.querySelectorAll(".react-flow__edge").length,
  zoom: Number(
    new DOMMatrixReadOnly(
      getComputedStyle(document.querySelector(".react-flow__viewport")).transform,
    ).a.toFixed(2),
  ),
}));

// Pan continuously in the background while sampling the screen.
let panning = true;
const pan = (async () => {
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  let step = 0;
  while (panning) {
    step += 1;
    await page.mouse.move(cx + Math.sin(step / 8) * 320, cy + Math.cos(step / 11) * 220);
  }
  await page.mouse.up();
})();

const hashes = [];
const startedAt = Date.now();
while (Date.now() - startedAt < 6000) {
  // Small and JPEG: encoding dominates the sample cost, and the ceiling this
  // sets is the ceiling on what the measurement can resolve.
  const shot = await page.screenshot({
    type: "jpeg",
    quality: 20,
    clip: { x: box.x + 40, y: box.y + 40, width: Math.min(280, box.width - 80), height: 200 },
  });
  hashes.push(createHash("sha1").update(shot).digest("hex"));
}
const elapsed = Date.now() - startedAt;
panning = false;
await pan;

let distinct = 0;
let longestRepeat = 0;
let currentRepeat = 0;
for (let i = 1; i < hashes.length; i += 1) {
  if (hashes[i] !== hashes[i - 1]) {
    distinct += 1;
    longestRepeat = Math.max(longestRepeat, currentRepeat);
    currentRepeat = 0;
  } else {
    currentRepeat += 1;
  }
}
longestRepeat = Math.max(longestRepeat, currentRepeat);

console.log(
  `${LABEL.padEnd(34)} zoom ${onScreen.zoom}  ${onScreen.nodes} nodes / ${onScreen.edges} edges  |  ` +
    `sampled ${hashes.length} times in ${(elapsed / 1000).toFixed(1)}s, ` +
    `${distinct} changed => ~${((distinct / elapsed) * 1000).toFixed(1)} updates/sec, ` +
    `longest identical run ${longestRepeat}`,
);

await browser.close();

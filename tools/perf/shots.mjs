/**
 * Seeds a plan and takes board screenshots at a few zoom levels, so a
 * perf change can be checked against "does it still look the same".
 *
 * Usage: node tools/perf/shots.mjs --plan plan.json --out shots/after
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
const project = JSON.parse(readFileSync(args.get("plan") ?? "plan.json", "utf8"));
const BASE = args.get("base") ?? "http://localhost:3000";
const OUT = args.get("out") ?? "shots";
const BOARD_VIEW = args.get("boardView") ? JSON.parse(args.get("boardView")) : undefined;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow", { timeout: 60_000 });
await page.waitForTimeout(6000);
await page.evaluate(async ({ plan, view }) => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("susy-factory-flow-designs", 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("design-meta")) database.createObjectStore("design-meta", { keyPath: "id" });
      if (!database.objectStoreNames.contains("design-plans")) database.createObjectStore("design-plans", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const now = new Date().toISOString();
  await new Promise((resolve) => {
    const transaction = db.transaction(["design-meta", "design-plans"], "readwrite");
    transaction.objectStore("design-meta").put({ id: plan.id, name: plan.name, createdAt: now, updatedAt: now });
    transaction.objectStore("design-plans").put({ id: plan.id, project: plan });
    transaction.oncomplete = () => resolve();
  });
  db.close();
  localStorage.setItem("susy-factory-flow.active-design.v1", plan.id);
  if (view) {
    const raw = localStorage.getItem("susy-factory-flow-board-view");
    localStorage.setItem(
      "susy-factory-flow-board-view",
      JSON.stringify({ ...(raw ? JSON.parse(raw) : {}), ...view }),
    );
  }
}, { plan: project, view: BOARD_VIEW });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 120_000 });
await page.waitForTimeout(14_000);

const board = await page.$(".react-flow");
await board.screenshot({ path: `${OUT}/00-fitview.png` });

// Zoom in on the first node so wires, hops and dashes are legible.
const node = await page.$(".react-flow__node");
const box = await node.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
for (let step = 0; step < 6; step += 1) {
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(2500);
await board.screenshot({ path: `${OUT}/01-zoomed-in.png` });
// A second shot a moment later: the dashes must have visibly moved.
await page.waitForTimeout(450);
await board.screenshot({ path: `${OUT}/02-zoomed-in-later.png` });

for (let step = 0; step < 10; step += 1) {
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(2500);
await board.screenshot({ path: `${OUT}/03-zoomed-out.png` });

console.log(`shots written to ${OUT}`);
await browser.close();

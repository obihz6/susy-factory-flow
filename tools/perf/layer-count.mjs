/** Counts composited layers for a seeded plan. Layer count drives Layerize
 *  cost, which shows up as a per-frame main-thread tax on the whole board. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const project = JSON.parse(readFileSync(process.argv[2], "utf8"));
const view = process.argv[3] ? JSON.parse(process.argv[3]) : undefined;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow", { timeout: 60000 });
await page.waitForTimeout(6000);
await page.evaluate(async ({ plan, view }) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open("susy-factory-flow-designs", 1);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("design-meta")) d.createObjectStore("design-meta", {keyPath:"id"}); if (!d.objectStoreNames.contains("design-plans")) d.createObjectStore("design-plans", {keyPath:"id"}); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const now = new Date().toISOString();
  await new Promise((res) => { const t = db.transaction(["design-meta","design-plans"],"readwrite");
    t.objectStore("design-meta").put({ id: plan.id, name: plan.name, createdAt: now, updatedAt: now });
    t.objectStore("design-plans").put({ id: plan.id, project: plan }); t.oncomplete = () => res(); });
  db.close(); localStorage.setItem("susy-factory-flow.active-design.v1", plan.id);
  if (view) { const raw = localStorage.getItem("susy-factory-flow-board-view");
    localStorage.setItem("susy-factory-flow-board-view", JSON.stringify({ ...(raw ? JSON.parse(raw) : {}), ...view })); }
}, { plan: project, view });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 120000 });
await page.waitForTimeout(14000);
const cdp = await context.newCDPSession(page);
let latest = [];
cdp.on("LayerTree.layerTreeDidChange", ({ layers = [] }) => {
  latest = layers;
});
await cdp.send("LayerTree.enable");
// Nudge the board so a tree change is guaranteed to be emitted, then give the
// event a bounded window rather than waiting on it forever.
await page.mouse.move(900, 500);
await page.mouse.wheel(0, -120);
await page.waitForTimeout(1500);
await page.mouse.wheel(0, 120);
await page.waitForTimeout(3000);
console.log(`view=${JSON.stringify(view ?? "default")} -> layers: ${latest.length}`);
await browser.close();
process.exit(0);

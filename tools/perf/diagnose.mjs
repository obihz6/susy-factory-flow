/**
 * Ablation probe: seeds a plan, then measures idle/pan FPS while hiding one
 * layer of the board at a time. Whatever the browser stops paying for tells us
 * where the cost actually lives - DOM weight, SVG raster, or script.
 *
 * Usage: node tools/perf/diagnose.mjs --plan plan.json
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}
const PLAN_PATH = args.get("plan") ?? "plan.json";
const BASE = args.get("base") ?? "http://localhost:3000";
const project = JSON.parse(readFileSync(PLAN_PATH, "utf8"));

const browser = await chromium.launch({ args: ["--disable-frame-rate-limit"] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow", { timeout: 60_000 });
await page.waitForTimeout(6000);
await page.evaluate(async (plan) => {
  const open = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open("susy-factory-flow-designs", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("design-meta")) db.createObjectStore("design-meta", { keyPath: "id" });
        if (!db.objectStoreNames.contains("design-plans")) db.createObjectStore("design-plans", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const db = await open();
  const now = new Date().toISOString();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(["design-meta", "design-plans"], "readwrite");
    transaction.objectStore("design-meta").put({ id: plan.id, name: plan.name, createdAt: now, updatedAt: now });
    transaction.objectStore("design-plans").put({ id: plan.id, project: plan });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  localStorage.setItem("susy-factory-flow.active-design.v1", plan.id);
}, project);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 120_000 });
await page.waitForTimeout(12_000);

const inventory = await page.evaluate(() => {
  const count = (selector) => document.querySelectorAll(selector).length;
  return {
    allElements: document.querySelectorAll("*").length,
    nodes: count(".react-flow__node"),
    edges: count(".react-flow__edge"),
    paths: count("path"),
    svgs: count("svg"),
    handles: count(".react-flow__handle"),
    images: count("img"),
    edgeLabels: count(".react-flow__edgelabel-renderer > *"),
    perNodeElements: Math.round(
      (document.querySelector(".react-flow__node")?.querySelectorAll("*").length ?? 0),
    ),
  };
});
console.log("DOM inventory:", JSON.stringify(inventory, null, 2));

await page.evaluate(() => {
  window.__frames = [];
  window.__sampling = false;
  const tick = (time) => {
    if (window.__sampling) window.__frames.push(time);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const board = await page.$(".react-flow");
const box = await board.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

async function fps(action) {
  await page.evaluate(() => {
    window.__frames = [];
    window.__sampling = true;
  });
  await action();
  const frames = await page.evaluate(() => {
    window.__sampling = false;
    return window.__frames;
  });
  if (frames.length < 3) return 0;
  const span = frames[frames.length - 1] - frames[0];
  return Number(((frames.length - 1) / (span / 1000)).toFixed(1));
}

const idle = () => page.waitForTimeout(1500);
async function pan() {
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let step = 0; step < 40; step += 1) {
    await page.mouse.move(cx + Math.sin(step / 6) * 400, cy + Math.cos(step / 9) * 260);
  }
  await page.mouse.up();
}

async function withCss(css, label) {
  await page.addStyleTag({ content: css, id: "ablation" });
  const idleFps = await fps(idle);
  const panFps = await fps(pan);
  await page.evaluate(() => {
    document.querySelectorAll("style").forEach((style) => {
      if (style.textContent?.includes("/*ablation*/")) style.remove();
    });
  });
  console.log(`${label.padEnd(34)} idle=${String(idleFps).padStart(7)} pan=${String(panFps).padStart(7)}`);
  await page.waitForTimeout(700);
}

console.log("\nablation (higher = that layer was the cost)");
await withCss("/*ablation*/", "baseline");
await withCss("/*ablation*/ *{animation:none!important}", "pulse animation off");
await withCss(
  "/*ablation*/ *{animation:none!important} .react-flow__edges{display:none!important}",
  "pulse off + edges hidden",
);
await withCss("/*ablation*/ .react-flow__edges{display:none!important}", "edges hidden");
await withCss("/*ablation*/ .react-flow__node{display:none!important}", "nodes hidden");
await withCss(
  "/*ablation*/ .react-flow__node *{visibility:hidden!important}",
  "node contents invisible",
);
await withCss("/*ablation*/ .react-flow__edgelabel-renderer{display:none!important}", "edge labels hidden");
await withCss("/*ablation*/ .react-flow__handle{display:none!important}", "handles hidden");
await withCss(
  "/*ablation*/ .react-flow__node img{visibility:hidden!important}",
  "node images invisible",
);
await withCss(
  "/*ablation*/ .react-flow__node{box-shadow:none!important;filter:none!important;text-shadow:none!important} .react-flow__node *{box-shadow:none!important;filter:none!important;text-shadow:none!important}",
  "shadows/filters off",
);
await withCss(
  "/*ablation*/ .react-flow__edges path{filter:none!important}",
  "edge filters off",
);

await browser.close();

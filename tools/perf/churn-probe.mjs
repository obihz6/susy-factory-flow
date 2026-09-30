/**
 * Is panning spending its time mounting and unmounting nodes?
 *
 * Counts node and edge elements added to / removed from the board during a pan,
 * and lines that up against the long frames. If the spikes are culling churn,
 * the two should track each other; if they don't, the fix is somewhere else.
 *
 * Usage: node tools/perf/churn-probe.mjs --plan plan.json
 */
import { chromium, firefox } from "playwright";
import { readFileSync } from "node:fs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}
const project = JSON.parse(readFileSync(args.get("plan") ?? "plan.json", "utf8"));
const BASE = args.get("base") ?? "http://localhost:3000";

const engine = args.get("browser") === "firefox" ? firefox : chromium;
const browser = await engine.launch({
  headless: args.get("headed") !== "1",
  args: ["--disable-frame-rate-limit"],
});
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow", { timeout: 60_000 });
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
  localStorage.setItem("susy-factory-flow-board-view", JSON.stringify({snapToGrid:false,canvasPattern:"dots",heatmapMode:false,lineHeatMode:false,lineThicknessMode:false,linePulseMode:false}));
}, project);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 120_000 });
await page.waitForTimeout(14_000);

const board = await page.$(".react-flow");
const box = await board.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

await page.evaluate(() => {
  window.__churn = { nodeAdds: 0, nodeRemoves: 0, edgeAdds: 0, edgeRemoves: 0, frames: [] };
  const nodesLayer = document.querySelector(".react-flow__nodes");
  const edgesLayer = document.querySelector(".react-flow__edges");
  window.__observers = [];
  const watch = (layer, addKey, removeKey) => {
    if (!layer) return;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        window.__churn[addKey] += record.addedNodes.length;
        window.__churn[removeKey] += record.removedNodes.length;
      }
    });
    observer.observe(layer, { childList: true });
    window.__observers.push(observer);
  };
  watch(nodesLayer, "nodeAdds", "nodeRemoves");
  watch(edgesLayer, "edgeAdds", "edgeRemoves");
  const tick = (time) => {
    window.__churn.frames.push(time);
    window.__raf = requestAnimationFrame(tick);
  };
  window.__raf = requestAnimationFrame(tick);
});

await page.mouse.move(cx, cy);
await page.mouse.down();
for (let step = 0; step < 60; step += 1) {
  await page.mouse.move(cx + Math.sin(step / 6) * 500, cy + Math.cos(step / 9) * 320);
}
await page.mouse.up();
await page.waitForTimeout(400);

const churn = await page.evaluate(() => {
  cancelAnimationFrame(window.__raf);
  for (const observer of window.__observers) observer.disconnect();
  const frames = window.__churn.frames;
  const deltas = [];
  for (let i = 1; i < frames.length; i += 1) deltas.push(frames[i] - frames[i - 1]);
  const sorted = [...deltas].sort((a, b) => a - b);
  return {
    ...window.__churn,
    frames: deltas.length,
    medianMs: sorted.length ? Number(sorted[Math.floor(sorted.length / 2)].toFixed(2)) : 0,
    p95Ms: sorted.length ? Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(1)) : 0,
    over50ms: deltas.filter((d) => d > 50).length,
    mountedNodes: document.querySelectorAll(".react-flow__node").length,
  };
});

console.log(`
during one pan (${churn.frames} frames, median ${churn.medianMs}ms, p95 ${churn.p95Ms}ms, ${churn.over50ms} frames over 50ms)
  nodes mounted:   ${churn.nodeAdds}
  nodes unmounted: ${churn.nodeRemoves}
  edges mounted:   ${churn.edgeAdds}
  edges unmounted: ${churn.edgeRemoves}
  nodes on screen at the end: ${churn.mountedNodes}`);

await browser.close();

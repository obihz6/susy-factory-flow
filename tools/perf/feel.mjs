/**
 * Presented-frame measurement, across zoom levels.
 *
 * The rAF-delta metric this replaces was measuring the wrong thing. rAF fires
 * when the MAIN THREAD is free, so a board whose compositor is drowning still
 * reports beautiful numbers — it reported 7,000fps for an idle board, which is
 * the tell. What a user feels is how often a frame is actually presented, and
 * that is the compositor's `Commit`, which the devtools trace records.
 *
 * It also sweeps zoom rather than testing one level. Wins that only exist when
 * the whole plan is on screen are not wins a user who works zoomed in will ever
 * feel, and reporting a single fit-view number hides that.
 *
 * Usage: node tools/perf/feel.mjs --plan plan.json --label main
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}
const project = JSON.parse(readFileSync(args.get("plan") ?? "plan.json", "utf8"));
const BASE = args.get("base") ?? "http://localhost:3000";
const LABEL = args.get("label") ?? "run";
const ZOOMS = (args.get("zooms") ?? "1.0,0.7,0.45,0.25").split(",").map(Number);

const browser = await chromium.launch({
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
}, project);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 120_000 });
await page.waitForTimeout(14_000);

const cdp = await context.newCDPSession(page);
const board = await page.$(".react-flow");
const box = await board.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

const readZoom = () =>
  page.evaluate(() => {
    const viewport = document.querySelector(".react-flow__viewport");
    return new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a;
  });

async function setZoom(target) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const zoom = await readZoom();
    if (Math.abs(zoom - target) / target < 0.06) break;
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, zoom > target ? 120 : -120);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(2500);
}

/** Runs `action` under a trace and returns presented frames per second. */
async function presentedFps(action) {
  const events = [];
  const onData = ({ value }) => events.push(...value);
  cdp.on("Tracing.dataCollected", onData);
  await cdp.send("Tracing.start", {
    traceConfig: {
      includedCategories: [
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "disabled-by-default-devtools.timeline.frame",
      ],
    },
    transferMode: "ReportEvents",
  });
  const startedAt = Date.now();
  await action();
  const elapsed = Date.now() - startedAt;
  const finished = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
  await cdp.send("Tracing.end");
  await finished;
  cdp.off("Tracing.dataCollected", onData);

  const commits = events.filter((event) => event.name === "Commit" && event.ph === "X");
  const longest = commits.reduce((worst, event) => Math.max(worst, event.dur ?? 0), 0);
  return {
    fps: elapsed > 0 ? Number(((commits.length / elapsed) * 1000).toFixed(1)) : 0,
    frames: commits.length,
    worstCommitMs: Number((longest / 1000).toFixed(1)),
  };
}

async function pan() {
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let step = 0; step < 45; step += 1) {
    await page.mouse.move(cx + Math.sin(step / 6) * 420, cy + Math.cos(step / 9) * 260);
  }
  await page.mouse.up();
}

async function wheelZoom() {
  await page.mouse.move(cx, cy);
  for (let step = 0; step < 24; step += 1) {
    await page.mouse.wheel(0, step % 12 < 6 ? -120 : 120);
    await page.waitForTimeout(20);
  }
}

console.log(`\n=== ${LABEL} — presented frames per second ===`);
for (const target of ZOOMS) {
  await setZoom(target);
  const actual = Number((await readZoom()).toFixed(2));
  const mounted = await page.evaluate(() => ({
    nodes: document.querySelectorAll(".react-flow__node").length,
    edges: document.querySelectorAll(".react-flow__edge").length,
  }));
  const panned = await presentedFps(pan);
  await setZoom(target);
  const zoomed = await presentedFps(wheelZoom);
  console.log(
    `zoom ${String(actual).padStart(5)}  (${String(mounted.nodes).padStart(4)} nodes / ${String(mounted.edges).padStart(4)} edges on screen)  ` +
      `pan ${String(panned.fps).padStart(6)}fps worst-commit ${String(panned.worstCommitMs).padStart(6)}ms   ` +
      `zoom ${String(zoomed.fps).padStart(6)}fps worst-commit ${String(zoomed.worstCommitMs).padStart(6)}ms`,
  );
}

await browser.close();

/**
 * Side-by-side preview of the rendering options we can trade against, at the
 * zoom levels where the trade actually matters.
 *
 * Variants:
 *   baseline   what ships today
 *   promoted   every card on its own compositor layer (rastered once, then
 *              scaled — fast to pan, softer when zoomed out)
 *   lod-soft   promoted, plus the card interior dropped to a coarse raster
 *   lod        the card interior not drawn at all below the readable zoom,
 *              keeping the shell, the machine strip and the size
 *
 * Screenshots go to <out>/<variant>-<zoom>.png, and each variant is measured
 * with the same pan gesture so the picture and the price sit together.
 *
 * Usage: node tools/perf/lod-preview.mjs --plan plan.json --out preview/
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}
const project = JSON.parse(readFileSync(args.get("plan") ?? "plan.json", "utf8"));
const BASE = args.get("base") ?? "http://localhost:3000";
const OUT = args.get("out") ?? "preview";
mkdirSync(OUT, { recursive: true });

// Everything inside the card, minus the shell itself and the top strip. Kept
// in one place so the mockups and any real implementation agree on what "the
// interior" means.
const CARD_INTERIOR = ".recipe-node-shell > div";

const VARIANTS = {
  baseline: "",
  promoted: `
    .recipe-node-shell, .react-flow__edgelabel-renderer > * { will-change: transform; }
  `,
  "lod-soft": `
    .recipe-node-shell, .react-flow__edgelabel-renderer > * { will-change: transform; }
    /* Exaggerated: the interior is drawn at a fraction of its resolution and
       scaled back up, which is what "rastered once then scaled" looks like
       when pushed hard. */
    ${CARD_INTERIOR} { filter: blur(0.6px); opacity: 0.92; }
  `,
  lod: `
    .recipe-node-shell, .react-flow__edgelabel-renderer > * { will-change: transform; }
    /* The interior keeps its box (node size feeds the router, so it must not
       change) but stops painting. What is left is the card, its colour and
       its outline — which is all you can read at this zoom anyway. */
    ${CARD_INTERIOR} { visibility: hidden; }
    .react-flow__edgelabel-renderer > * { visibility: hidden; }
  `,
};

const browser = await chromium.launch({ args: ["--disable-frame-rate-limit"] });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
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

async function setZoom(target) {
  // Wheel to the requested zoom, then let routing and raster settle.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const zoom = await page.evaluate(() => {
      const viewport = document.querySelector(".react-flow__viewport");
      const matrix = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
      return matrix.a;
    });
    if (Math.abs(zoom - target) / target < 0.08) break;
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, zoom > target ? 120 : -120);
    await page.waitForTimeout(70);
  }
  await page.waitForTimeout(2200);
}

async function panFps() {
  await page.evaluate(() => {
    window.__frames = [];
    window.__sampling = true;
  });
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let step = 0; step < 45; step += 1) {
    await page.mouse.move(cx + Math.sin(step / 6) * 380, cy + Math.cos(step / 9) * 240);
  }
  await page.mouse.up();
  const frames = await page.evaluate(() => {
    window.__sampling = false;
    return window.__frames;
  });
  if (frames.length < 3) return 0;
  const span = frames[frames.length - 1] - frames[0];
  return Number(((frames.length - 1) / (span / 1000)).toFixed(1));
}

const ZOOMS = [0.75, 0.4, 0.2];
for (const [name, css] of Object.entries(VARIANTS)) {
  await page.evaluate(() => {
    document.getElementById("lod-variant")?.remove();
  });
  if (css) {
    await page.addStyleTag({ content: css, id: "lod-variant" });
    await page.evaluate(() => {
      const style = document.querySelector("style:last-of-type");
      if (style) style.id = "lod-variant";
    });
  }
  const row = [];
  for (const zoom of ZOOMS) {
    await setZoom(zoom);
    await board.screenshot({ path: `${OUT}/${name}-zoom${String(zoom).replace(".", "")}.png` });
    row.push(`zoom ${zoom}: ${await panFps()}fps`);
    await setZoom(zoom); // the pan moved us; come back for the next shot
  }
  console.log(`${name.padEnd(10)} ${row.join("   ")}`);
}

await browser.close();

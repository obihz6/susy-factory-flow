import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
const project = JSON.parse(readFileSync(args.get("plan") ?? "plan.json", "utf8"));
const BASE = args.get("base") ?? "http://localhost:3000";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow", { timeout: 60_000 });
await page.waitForTimeout(6000);
await page.evaluate(async (plan) => {
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
}, project);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 120_000 });
await page.waitForTimeout(12_000);

const report = await page.evaluate(() => {
  const running = document.getAnimations().filter((animation) => animation.playState === "running");
  const counts = new Map();
  for (const animation of running) {
    const target = animation.effect?.target;
    const name = animation.animationName ?? animation.transitionProperty ?? "(unknown)";
    const label = `${name} :: ${target ? `${target.tagName.toLowerCase()}.${(target.getAttribute("class") || "").split(" ").slice(0, 3).join(".")}` : "?"}`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return {
    total: document.getAnimations().length,
    running: running.length,
    top: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
  };
});
console.log(JSON.stringify(report, null, 2));
await browser.close();

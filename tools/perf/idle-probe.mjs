/**
 * Why is an untouched board repainting? Watches DOM mutations and captures a
 * Chrome trace during a completely idle period, then reports the busiest
 * trace events and the elements being mutated.
 *
 * Usage: node tools/perf/idle-probe.mjs --plan plan.json
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

const mutations = await page.evaluate(async () => {
  const counts = new Map();
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target;
      const element = target.nodeType === 1 ? target : target.parentElement;
      const label = element
        ? `${element.tagName.toLowerCase()}.${(element.getAttribute("class") || "").split(" ").slice(0, 2).join(".")} [${record.type}${record.attributeName ? ":" + record.attributeName : ""}]`
        : `#text [${record.type}]`;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 3000));
  observer.disconnect();
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
});
console.log("\nDOM mutations over 3s of idle:");
if (mutations.length === 0) console.log("  (none - the DOM is completely still)");
for (const [label, count] of mutations) console.log(`  ${String(count).padStart(6)}  ${label}`);

// Trace an idle window and aggregate event durations by name.
const cdp = await context.newCDPSession(page);
const events = [];
cdp.on("Tracing.dataCollected", ({ value }) => events.push(...value));
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
await page.waitForTimeout(3000);
const done = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
await cdp.send("Tracing.end");
await done;

const byName = new Map();
for (const event of events) {
  if (event.ph !== "X" || !event.dur) continue;
  const entry = byName.get(event.name) ?? { totalUs: 0, count: 0 };
  entry.totalUs += event.dur;
  entry.count += 1;
  byName.set(event.name, entry);
}
console.log("\nidle trace, busiest events (3s window):");
for (const [name, entry] of [...byName.entries()].sort((a, b) => b[1].totalUs - a[1].totalUs).slice(0, 22)) {
  console.log(
    `  ${String((entry.totalUs / 1000).toFixed(1)).padStart(9)}ms  x${String(entry.count).padStart(5)}  ${name}`,
  );
}

const detail = (name, pick) => {
  const counts = new Map();
  for (const event of events) {
    if (event.name !== name) continue;
    const label = pick(event) ?? "(none)";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(`\n${name} breakdown:`);
  for (const [label, count] of rows) console.log(`  ${String(count).padStart(6)}  ${label}`);
};

detail("EventDispatch", (event) => event.args?.data?.type);
detail("FunctionCall", (event) =>
  `${event.args?.data?.functionName || "(anon)"} ${String(event.args?.data?.url || "").split("/").pop()}:${event.args?.data?.lineNumber ?? ""}`,
);
detail("ImageDecodeTask", (event) => event.args?.imageUrl ?? event.args?.data?.url ?? "(no url)");
detail("Paint", (event) => {
  const size = event.args?.data;
  return size ? `${size.clip ? "clip" : ""} layer=${size.layerId ?? "?"} node=${size.nodeId ?? "?"}` : "(no data)";
});
detail("UpdateLayoutTree", (event) => `dirtyObjects=${event.args?.beginData?.dirtyObjects ?? "?"}`);

// Frame cadence: how often does the compositor actually commit?
const commits = events.filter((event) => event.name === "Commit" && event.ph === "X");
if (commits.length > 1) {
  const span = commits[commits.length - 1].ts - commits[0].ts;
  console.log(`\ncommits: ${commits.length} over ${(span / 1000).toFixed(0)}ms => ${((commits.length - 1) / (span / 1e6)).toFixed(1)} fps`);
}

await browser.close();

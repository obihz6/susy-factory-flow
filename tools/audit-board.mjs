// Usage: node tools/audit-board.mjs <plan.json> <output-prefix> [--arrange]
// Uses a fresh isolated browser profile. Does not touch the user's designs.
// Requires the local app at http://localhost:3000 (override AUDIT_URL).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { auditRoutes } from './route-audit.mjs';

const args = process.argv.slice(2);
const layoutAt = args.indexOf('--layout');
const layoutFile = layoutAt >= 0 ? args.splice(layoutAt, 2)[1] : undefined;
const [input, prefixArg, action] = args;
if (!input || !prefixArg || (action && action !== '--arrange')) throw new Error('Usage: node tools/audit-board.mjs <plan.json> <output-prefix> [--arrange] [--layout <layout.json>]');
const plan = JSON.parse(readFileSync(input, 'utf8'));
if (layoutFile) {
  // A layout string (dev menu -> Score -> Copy layout): plan id, cards by
  // id prefix, top-lefts in cells. Applied here so the audit reads the
  // board exactly as the player laid it out.
  const layout = JSON.parse(readFileSync(layoutFile, 'utf8'));
  const cards = [...plan.nodes, ...(plan.storages ?? []), ...(plan.pockets ?? [])];
  let placed = 0;
  for (const [key, [cx, cy]] of Object.entries(layout.c)) {
    const matches = cards.filter((card) => card.id.startsWith(key));
    if (matches.length !== 1) continue;
    matches[0].position = { x: cx * 20, y: cy * 20 };
    placed += 1;
  }
  for (const edge of plan.edges) delete edge.waypoints;
  console.error(`layout: placed ${placed} of ${cards.length} cards`);
}
const prefix = resolve(prefixArg);
mkdirSync(dirname(prefix), { recursive: true });
const cache = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
const executablePath = process.env.AUDIT_CHROME ?? join(cache, readdirSync(cache).filter((n) => /^chromium-\d+$/.test(n)).sort((a,b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))[0], 'chrome-win64', 'chrome.exe');
const browser = await chromium.launch({ executablePath });
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const url = process.env.AUDIT_URL ?? 'http://localhost:3000';
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([p, tuning]) => {
    localStorage.setItem('gtnh-factory-flow.project.v2', JSON.stringify(p));
    // AUDIT_TUNING: a JSON patch of router dials to test a device's setting.
    if (tuning) localStorage.setItem('gtnh-factory-flow.router-tuning.v1', tuning);
    sessionStorage.setItem('gtnh-factory-flow-welcome-left', '1');
  }, [plan, process.env.AUDIT_TUNING ?? null]);
  await page.reload({ waitUntil: 'load' });
  // Wait for matching inputs and ALL installed paths, not a guessed delay
  // or a fresh call to solveGridRoutes with potentially different settings.
  const settled = async () => {
    await page.waitForFunction(() => {
      const cap = window.__gtnhRouteSolve, shown = window.__gtnhReadDisplayedRoutes?.();
      if (!cap || !shown || !window.__gtnhFlow) return false;
      const ids = new Set(shown.routes.map((r) => r.edgeId));
      return cap.signature === shown.signature && shown.signature === shown.wantedSignature &&
        shown.routes.length === cap.requests.length &&
        cap.requests.every((r) => ids.has(r.edgeId)) &&
        shown.routes.every((r) => r.signature === cap.signature && r.points.length >= 2);
    });
    // Geometry can settle again after card measurement; require two seconds
    // of identical board/route content, bounded by the normal tool timeout.
    let previous, stableSince = Date.now();
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const snapshot = await page.evaluate(() => ({ input: window.__gtnhRouteSolve, displayed: window.__gtnhReadDisplayedRoutes(), nodes: window.__gtnhFlow.getNodes(), judgeInput: window.__gtnhArrangeJudgeInput ?? null, arrangeInput: window.__gtnhArrangeInput ?? null }));
      const key = JSON.stringify(snapshot);
      const ids = new Set(snapshot.displayed.routes.map((r) => r.edgeId));
      const complete = snapshot.displayed.routes.length === snapshot.input.requests.length &&
        snapshot.input.requests.every((r) => ids.has(r.edgeId)) &&
        snapshot.displayed.routes.every((r) => r.signature === snapshot.input.signature && r.points.length >= 2);
      if (!complete || key !== previous || snapshot.input.signature !== snapshot.displayed.signature || snapshot.displayed.signature !== snapshot.displayed.wantedSignature) { previous = key; stableSince = Date.now(); }
      else if (Date.now() - stableSince >= 2000) return snapshot;
      await page.waitForTimeout(250);
    }
    throw new Error('Board routes did not settle');
  };
  await settled();
  // Fresh profiles can open the release-notes sheet above the board.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  if (action === '--arrange') {
    const folded = page.getByRole('button', { name: 'Show markup and view tools', exact: true });
    if (await folded.isVisible()) await folded.click({ timeout: 10000 });
    await page.getByRole('button', { name: 'View options', exact: true }).click({ timeout: 10000 });
    await page.getByRole('button', { name: 'Arrange the board', exact: true }).click({ timeout: 180000 });
    // The arrange runs in a worker behind a loader; wait for the loader to
    // leave before reading the board, however long the judged arrange takes.
    await page.waitForTimeout(500);
    await page.locator('[role="status"][aria-live="polite"]').waitFor({ state: 'detached', timeout: 600000 }).catch(() => {});
  }
  const snapshot = await settled();
  if (errors.length) throw new Error(errors.join('\n'));
  const result = auditRoutes(snapshot.displayed.routes);
  const checkedPlan = snapshot.displayed.project;
  if (checkedPlan.id !== plan.id) throw new Error('Displayed plan is not the requested plan');
  writeFileSync(`${prefix}.plan.json`, JSON.stringify(checkedPlan, null, 2));
  writeFileSync(`${prefix}.audit.json`, JSON.stringify({ source: resolve(input), action: action ?? 'load', ...snapshot, result }, null, 2));
  // Deliberately just two integers: pairwise crossings; total length in
  // flow-space pixels, rounded once after summing all displayed wires.
  console.log(`${result.crossings} ${Math.round(result.length)}`);
} finally {
  await browser.close();
}

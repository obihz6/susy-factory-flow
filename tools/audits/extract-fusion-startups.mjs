// Run after the updated GTNH oracle: node tools/audits/extract-fusion-startups.mjs
// <oracle-export.json or fusion-only extract.json> <output.json>
// Only exact recipe shapes are retained; fresh metadata supersedes this snapshot.
import fs from "node:fs";
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Expected oracle export and output JSON paths");
const raw = JSON.parse(fs.readFileSync(input, "utf8"));
const map = raw.domains
  ? raw.domains
      .find((d) => d.recipeMaps)
      ?.recipeMaps.find((m) => m.id === "gt.recipe.fusionreactor")
  : raw;
if (map?.id !== "gt.recipe.fusionreactor") throw new Error("Fusion map missing");
const slots = (entries) =>
  entries
    .map((r) => `${r.kind}:${r.id}@${r.amount}`)
    .sort()
    .join(";");
const records = new Map();
for (const r of map.recipes) {
  if (!Number.isFinite(r.fusionStartupEu) || r.fusionStartupEu < 0)
    throw new Error(`Missing threshold: ${r.id}`);
  const inputs = [...r.itemInputs, ...r.fluidInputs, ...(r.nonConsumedInputs ?? [])];
  const outputs = [...r.itemOutputs, ...r.fluidOutputs];
  const key = `${slots(inputs)}|${slots(outputs)}|${r.durationTicks}|${r.eut}`;
  if (records.has(key) && records.get(key) !== r.fusionStartupEu)
    throw new Error(`Ambiguous threshold: ${key}`);
  records.set(key, r.fusionStartupEu);
}
fs.writeFileSync(
  output,
  JSON.stringify(
    {
      source: "GTNH 2.9.0-beta-2 runtime oracle; GTRecipeConstants.FUSION_THRESHOLD",
      generatedAt: raw.generatedAt,
      recipes: Object.fromEntries([...records].sort(([a], [b]) => a.localeCompare(b))),
    },
    null,
    2,
  ) + "\n",
);
console.log(`Wrote ${records.size} exact fusion recipe thresholds`);

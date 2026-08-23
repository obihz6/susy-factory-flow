# SUSY Dataset Pipeline

How Supersymmetry recipe data gets from the game into the planner. The GTNH
equivalent lives in `docs/dataset-pipeline.md`; this page covers only what
differs.

## Data sources

| What | Source | Notes |
|---|---|---|
| Recipes (machines) | SusyCore `/recipemapdump` → `recipedump.json` | Dumped at runtime by SymmetricDevs/Susy-Core; sees GroovyScript-modified recipes |
| Icons | `susy-hei-oracle` mod (SymmetricDevs fork, `prototype` branch) | HEI ingredient registry + client rendering, flat world for atlas stitching |
| Fuel values | `groovy/prePostInit/Thermodynamics.groovy` in the pack repo | Fixed 32 EUt per burn: EU/L = 32 × duration / fuel_amount |

## Pipeline

```
local SUSY client (susy-hei-oracle injected)
        │  -Dsusy.oracle.autorun=true -Dsusy.oracle.dumpRecipes=true
        ▼
recipedump.json + rendered icons
        ▼
normalize-susy-recipedump.mjs      → RecipeDataset (+ plain recipes.json)
apply-susy-icons.mjs               → stamps iconPath from HEI icon maps,
                                     copies PNGs into textures/rendered/
build-resource-index.mjs           → resource-index.json.gz
build-recipe-index.mjs             → recipe-index/-lookup/shards (.gz)
gzip -c recipes.json > recipes.json.gz   ← LAST, see below
rebuild-manifest.mjs               → datasets.manifest.json
```

Run it end to end:

```bash
SUSY_INSTANCE_DIR=~/path/to/susy \
SUSY_DATASET_OUT_DIR=public/datasets/susy/<version> \
SUSY_RAW_EXPORT_DIR=.pipeline/susy-export \
SUSY_DATASET_VERSION_ID=<version> \
SUSY_DATASET_VERSION_LABEL="SUSY <version>" \
  bash tools/dataset-pipeline/scripts/susy/run-susy-export.sh
```

## Ordering constraint (do not "fix")

`rebuild-manifest.mjs` reads `datasetVersionId`/`gtnhVersion`/`generatedAt`
from `recipes.json.gz` with a **per-line** parser. `build-resource-index.mjs`,
when given a `.gz`, rewrites it as one compact line, which breaks that parser.
So the index builders must run against the plain line-oriented `recipes.json`
(produced by `dataset-json-writer`), and the gzip step must come last.

## Known gaps vs the GTNH export

- No HEI slot layouts: slot positions are synthesized deterministically.
- No localized recipe-map names: derived from the unlocalized map key.
- No `runtimeCalculation`: the solver's own overclock model applies
  (GTCEu ×4/÷2 standard steps).
- Smelting entries get the synthesized GregTech electric-furnace baseline
  (128 ticks @ 4 EU/t), flagged in `metadata.synthesizedDuration`.
- Machine behaviour table (`src/lib/machines/machine-table.ts`) still holds
  GTNH entries only; uncovered machines fall back to dataset statistics,
  which is safe by design. Add curated SUSY entries only after verifying them
  against the game or SusyCore source — never by guessing.

## Self-containedness

Raw export artifacts are archived under this repo's gitignored working area
(`temp/raw-export/recipedump.json`, `temp/icons/`) so every pipeline stage runs
from here; nothing at runtime references another repository or install path.

## First real export (0.1.16.14.1)

SusyCore dump: 171 recipe maps / 44,570 machine recipes (+ crafting/smelting →
59,345 dataset recipes), 68k items, 19.8k resources, 13k ore-dict entries;
HEI renderer produced 36k icons (maps: `icon-map.json`, `fluid-icon-map.json`
keyed `registry@meta#`). Icon coverage after application: 98.9% of resources.

## Version detection

`susy/detect-susy-versions.mjs` mirrors the GTNH detector's output contract:
stable channel from pack GitHub releases, daily channel from the `master-ceu`
branch HEAD. It writes `.pipeline/detected-versions.json`.

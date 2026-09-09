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
 download.mjs                 → resolves/downloads or bootstraps the pack instance
 build-oracle.mjs             → builds the HEI extraction oracle
 extract.mjs                  → client export: recipedump.json + rendered icons
 normalize.mjs                → normalized plain recipes.json
 normalize-textures.mjs      → copied/rendered texture references
 merge-custom.mjs             → validated local recipes and overrides
 indexes.mjs                  → resource/recipe indexes and shards
 package-dataset.mjs          → recipes.json.gz + datasets.manifest.json
```

Run the complete resumable pipeline with one command:

```bash
npm run pipeline
npm run versions:select
```

Use a specific release or branch, or point at an existing instance. The selector remembers its last choice in `temp/version-selection.json` and can include local development versions:

```bash
npm run pipeline -- --version 0.1.16.14.1
npm run pipeline -- --ref master-ceu --version-id daily-local
npm run pipeline -- --instance /path/to/Supersymmetry
npm run versions:select -- --include-local
npm run dev:init -- --name experimental-branch --base-version stable-1.2.0
```

The shared state/config file and every pipeline log are written below `./temp`:

- `temp/susy-pipeline.json` tracks settings, paths, attempts, and completed steps.
- `temp/logs/orchestrator.log` contains the overall run.
- `temp/logs/<step>.log` contains each standalone step and its child output.
- `temp/raw-export/` contains the raw recipe dump, rendered icon maps, and client logs.
- `data/versions/local/<name>/` contains experimental version data and metadata.
- `data/custom-recipes/local-dev.json` contains custom recipes; saves create backups under `history/`.

A failed step is retried three times by default and then halts the pipeline. No later step
runs after a failure. Inspect the step log, perform or repair that step manually, then
resume with `npm run pipeline -- --from <step>`. Use `--force` to rerun completed steps.
The oracle build is automatic, but can also be run independently with `build-oracle.mjs`.

Each step can also be run independently after `temp/susy-pipeline.json` exists:

```bash
node tools/dataset-pipeline/scripts/susy/download.mjs
node tools/dataset-pipeline/scripts/susy/build-oracle.mjs
node tools/dataset-pipeline/scripts/susy/extract.mjs
node tools/dataset-pipeline/scripts/susy/normalize.mjs
node tools/dataset-pipeline/scripts/susy/normalize-textures.mjs
node tools/dataset-pipeline/scripts/susy/merge-custom.mjs
node tools/dataset-pipeline/scripts/susy/indexes.mjs
node tools/dataset-pipeline/scripts/susy/package-dataset.mjs
```

The original full client runner remains available for manual debugging. On Windows,
run the PowerShell runner directly; on Linux/macOS, use the shell runner:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\dataset-pipeline\scripts\susy\run-susy-export.ps1
```

```bash
bash tools/dataset-pipeline/scripts/susy/run-susy-export.sh
```

For a Prism-managed Windows instance, the runner uses Prism's `-l <instance-id>`
launch mode and watches the actual instance log and dump instead of waiting for the
short-lived Prism launch request. Useful commands are:

```powershell
# Complete resumable build
npm run susy -- --force --interactive=false

# Rebuild the oracle after changing its Java source
npm run susy -- build-oracle --force --interactive=false

# Retry extraction only after fixing Prism or the Minecraft instance
npm run susy -- extract --force --interactive=false

# Resume from extraction
npm run susy -- --from extract --force --interactive=false
```

For an instance that is not auto-detected, set the Minecraft game directory explicitly:

```powershell
$env:SUSY_INSTANCE_DIR = "C:\Users\<user>\AppData\Roaming\PrismLauncher\instances\Supersymmetry\minecraft"
npm run susy -- extract --force --interactive=false
```

If Prism is installed outside the standard locations, provide a launch command override:

```powershell
$env:SUSY_LAUNCH_COMMAND = '"C:\Path\To\prismlauncher.exe" -l "Supersymmetry"'
npm run susy -- extract --force --interactive=false
```

If extraction appears stuck, inspect the runner log, client logs, and Prism's latest log:

```text
temp\logs\extract.log
temp\raw-export\export-runner.log
temp\raw-export\susy-runtime.out.log
temp\raw-export\susy-runtime.err.log
<Prism instance>\logs\latest.log
```

The Windows runner clears stale output before each run, reports if the oracle is not
loaded after 180 seconds, and reports if no dump appears after 300 seconds. It also
restores the original Prism `instance.cfg` after completion. The oracle falls back to
recipe-only extraction when HEI is unavailable or the client is not render-ready.

The pipeline uses the downloaded standalone instance by default so extraction is
deterministic and does not depend on Prism or another launcher GUI. The instance
is stored in `temp/.minecraft-fresh` for the current run (or the configured
bootstrap directory) and is pinned into `temp/susy-pipeline.json` after the
download step. To opt back into an explicitly supplied/local instance, set
`SUSY_USE_DOWNLOADED_INSTANCE=0` and use `--instance`/`SUSY_INSTANCE_DIR`.

When a full interactive pipeline finishes, it asks whether the downloaded
instance and its adjacent Java runtime should be deleted. Non-interactive runs
keep them and log their location; this is safe for later resume runs.

The runner resolves the instance itself, in this order:

1. The pinned downloaded instance from the pipeline config (default).
2. `SUSY_INSTANCE_DIR` when set (validated: pack.toml + real mod jars).
3. Auto-detection: `./temp/.minecraft`, repo-local SUSY checkouts under
   `./temp`, known launcher instance roots (Prism/PolyMC/MultiMC/ATLauncher/
   CurseForge/GDLauncher, Linux and Windows paths) and a bounded
   `*supersymmetry*` scan under the home directory.
4. Nothing found: a barebone instance is downloaded into `./temp/.minecraft`
   (`bootstrap-susy-instance.mjs`) — pack repo files, every packwiz-declared
   mod (CurseForge-API-excluded mods are rescued straight from the CDN), a
   local Temurin 8 JRE (1.12.2 Forge cannot run on modern JVMs), the Forge
   client runtime and a generated `launch-susy-client.sh` (+ `.cmd` on
   Windows). Every step is resumable; `SUSY_BOOTSTRAP=0` disables the
   fallback and `SUSY_BOOTSTRAP_REF` pins a release tag or branch.

Version id and label come from the instance's pack.toml unless
`SUSY_DATASET_VERSION_ID`/`SUSY_DATASET_VERSION_LABEL` override them; the
oracle jar comes from `SUSY_HEI_ORACLE_JAR` or the newest build under
`tools/dataset-pipeline/susy-hei-oracle` or `temp/susy-hei-oracle`.
`resolve-susy-instance.mjs --json` prints the same resolution as JSON for
scripts and CI. Windows users run the export under Git Bash; the bootstrap
itself is plain Node and works in cmd/PowerShell too.

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
(`temp/raw-export/recipedump.json`, `temp/raw-export/rendered-icons/`) so every pipeline
stage runs from here; nothing at runtime references another repository or install path.

## First real export (0.1.16.14.1)

SusyCore dump: 171 recipe maps / 44,570 machine recipes (+ crafting/smelting →
59,345 dataset recipes), 68k items, 19.8k resources, 13k ore-dict entries;
HEI renderer produced 36k icons (maps: `icon-map.json`, `fluid-icon-map.json`
keyed `registry@meta#`). Icon coverage after application: 98.9% of resources.

## Version detection

`susy/detect-susy-versions.mjs` mirrors the GTNH detector's output contract:
stable channel from pack GitHub releases, daily channel from the `master-ceu`
branch HEAD. It writes `.pipeline/detected-versions.json`.

# Dataset Pipeline

How SuSy recipe data gets from the game into the planner. This page is the
canonical runbook for the path between "pack released" and "recipe grid
rendered": pipeline → package → publish → runtime load.

The SUSY lane is the only dataset lane. The former GTNH automation
(workflow, export runners, GTNH oracle scripts) has been pruned from the
repository; the shared transform code under `tools/dataset-pipeline/scripts/`
is now consumed only by the SuSy pipeline.

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

## Step write safety

Every final artifact is written through the shared atomic helper
(`tools/dataset-pipeline/lib/atomic-write.mjs`): temp file in the target
directory, fsync, then rename. An interrupted step can no longer leave a
truncated `recipes.json`, index gzip, shard, or manifest at the served path,
and pipeline state JSON is written atomically too.

The dataset file format is line-oriented JSON: every top-level value that can
grow large (notably `oreDictionary`) is emitted per line so streaming readers
stay bounded, while the writer still supports streamed objects with more than
32 keys. Index gzip artifacts are written last and are the cache-immutable
bytes.

## Commands

Complete resumable pipeline:

```bash
npm run pipeline
npm run versions:select
```

Specific version:

```bash
npm run pipeline -- --version 0.1.16.14.1
npm run pipeline -- --ref master-ceu --version-id daily-local
npm run pipeline -- --instance /path/to/Supersymmetry
```

Resume / force / per-step:

```bash
npm run pipeline -- --from <step>        # resume
npm run pipeline -- --force              # rerun completed steps
node tools/dataset-pipeline/scripts/susy/build-oracle.mjs --force --interactive=false
node tools/dataset-pipeline/scripts/susy/extract.mjs --force --interactive=false
```

SuSy entry point with plan/verify modes (new):

```bash
npm run datasets:dry-run   # print the planned steps, touch nothing
npm run datasets:verify    # validate public/datasets/susy (or --dataset-dir) recipes.json.gz
node tools/dataset-pipeline/scripts/generate-dataset.mjs --verify /path/to/dataset-dir
node tools/dataset-pipeline/scripts/generate-dataset.mjs --dry-run
node tools/dataset-pipeline/scripts/generate-dataset.mjs   # -> delegates to the SuSy orchestrator build
```

## Dataset verification

`npm run datasets:verify` (backed by
`tools/dataset-pipeline/scripts/generate-dataset.mjs`) gunzips
`recipes.json.gz`, parses the JSON, and checks the mandatory top-level keys:

`schemaVersion`, `datasetVersionId`, `gtnhVersion`, `sourceInfo`, `recipes`,
`oreDictionary`, `recipeMaps`, `generatedAt`.

A dataset missing any key exits `1` and lists the missing keys; the default
dataset directory is `public/datasets/susy`.

## Publish

1. Run the pipeline (or `npm run datasets:susy`) to produce
   `public/datasets/susy/<version>/recipes.json(.gz)` plus index artifacts.
2. `npm run datasets:manifest` runs `rebuild-manifest.mjs`, which scans the
   dataset root and writes `datasets.manifest.json` atomically.
3. Copy changed artifacts to the server dataset volume, then restart the app
   service so the runtime reloads them.
4. Verify the published manifest and the published gzip before searching.

## Runtime consumption

- Client: fetch the manifest (Zod-validated via the dataset schemas), pick a
  version, hydrate recipes through `/api/datasets/<versionId>/...`.
- Server API: unknown versions and missing required indexes raise
  `DatasetNotFoundError`, which maps to HTTP `404` with an `{ error }` JSON
  body (`src/lib/server/dataset-errors.ts`). All other dataset failures stay
  `500` with a clean `{ error }` message.
- Static assets: `/datasets/susy/<version>/textures/...` served from the
  public dataset tree with traversal guards; missing files answer `404`.

## Troubleshooting

- `npm run datasets:verify` exits non-zero listing missing keys → rebuild the
  dataset or fix the source export.
- API answers `404` with `Dataset <id> was not found in the dataset manifest.` →
  the version is not in the served manifest (stale publish, wrong dataset root).
- API answers `404` with `Dataset <id> has no … index.` → the version is present
  but missing a required index artifact.

## Unverified in an automated environment

Docker/Minecraft export runs, the live droplet behaviour, the downloaded
instance runtime, and Windows runner behaviour cannot be exercised from CI here;
those paths remain operator-verified manually.

## Related documents

- `docs/dataset-install-plan.md` — the robustness plan and problem inventory
  (P-01…P-33) this pipeline hardening is fixing.
- `docs/susy-pipeline.md` — SuSy pipeline quick reference.
- `tools/dataset-pipeline/CLAUDE.md` — operator/agent notes for the pipeline.

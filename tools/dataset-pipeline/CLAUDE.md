# Dataset pipeline (tools/dataset-pipeline)

A Forge mod (`susy-hei-oracle`) running inside a real Supersymmetry client exports
every recipe map, NEI layout, catalyst, multiblock config and rendered icon. Node
scripts in `scripts/susy/` normalize that into the `RecipeDataset` the app reads:
`susy/normalize.mjs`, `susy/normalize-susy-recipedump.mjs`, `susy/merge-custom.mjs`,
`build-resource-index.mjs`, `build-recipe-index.mjs` (recipe index, lookup index,
250-recipe shards), `package-dataset.mjs`.

The former GTNH lane (workflow, export runners, GTNH oracle scripts) has been
removed; the SuSy lane is the only dataset target.

## Rebuild and publish (by hand, in the repo)

The GitHub dataset-pipeline workflow is not a live path; rebuilds run through the
SuSy entry point:

1. `npm run pipeline` (or `node tools/dataset-pipeline/scripts/generate-dataset.mjs`).
2. Raw exports live under `temp/raw-export/<id>/` with `rendered-icons/` beside them;
   reuse them while the pack version stands. Never export with icon rendering off:
   the export stamps icon filenames, and a run without them broke live search.
3. Rebuild writes the plain line-oriented `recipes.json`, then indexes, then gzips
   (`recipes.json.gz`) and rebuilds the manifest.
4. Publish: copy changed artifacts to the server dataset volume, then restart the
   app service; verify the live manifest and the published gzip afterwards.

Only GTNH 2.9 datasets are supported.

Rebuilds must run `normalize-fluid-icon-alpha.mjs` (with `--rename`) after the index
builds and before publishing, or faint fluids ship invisible. Texture URLs are
cache-immutable: fix pixels under a NEW filename (`--rename`), and patch whole
basenames only.

A fresh export is NOT deterministic: crafting, furnace, bee, crop and essentia recipes
reorder, re-minting ~37,000 ids. When an export only ADDS fields, graft them onto the
published export and confirm with a shard diff.

## Atomic writes and dataset contract

- Every final artifact is written via `lib/atomic-write.mjs` (temp file in the target
  directory, fsync, rename). Pipeline state JSON goes through the same helper.
- The line-oriented dataset writer/reader (`lib/line-dataset.mjs`,
  `scripts/dataset-json-writer.mjs`) keeps streamed top-level objects such as
  `oreDictionary` intact, including writers that emit more than 32 top-level keys.
- Index gzip artifacts are written last and are the cache-immutable bytes.

## Import principles

- Prefer data exported from the runtime over hand-written tables and fallbacks.
- A missing recipe: check the raw oracle export first, then the pack source at the
  exact version tag.
- A map with one uncapped machine family carries no `machineHandlers` by design; a
  lone capped singleblock keeps its handler.
- Never parse tooltips globally. Multiblock stats come from tooltips only for
  catalysts flagged `multiblock`; singleblocks read only voltage input and machine
  type.
- Fold singleblock tier variants into one family; multiblocks stay separate handlers.
  A map with one real family keeps the map name. A multiblock whose name collides with
  a singleblock gets its own id.
- Concrete items carry their oredict membership.
- NEI layout: keep exported slot positions and progress bars; empty slots stay
  visible; never replace a real slot with a fake label.
- Every fluid-touching Canner recipe is mirrored into the synthesized "Tank" map
  (`addTankRecipe`, 0 EU, 1 tick, real slots).
- Extreme Entity Crusher mobs come from the `kubatech-eec-mobs` oracle adapter (drop
  chances replayed in `eec-drops.mjs`). Sparge Tower rolled outputs and fusion startup
  EU are per-recipe export fields; `sparge-byproducts.mjs` appends rolled slots AFTER
  the exported ones so recipe ids stay stable.
- Faint fluid icons: repair only captures under 20% mean opacity, starting from the
  original PNGs (`normalize-fluid-icon-alpha.mjs`).

## Operator commands

```bash
npm run pipeline                                   # full resumable build
npm run datasets:verify                            # validate public/datasets/susy
npm run datasets:dry-run                           # print planned steps, write nothing
npm run datasets:manifest                          # rebuild datasets.manifest.json
npm run datasets:detect                           # detect stable/daily versions
```

## Version detection

`susy/detect-susy-versions.mjs` mirrors the version detection contract: stable
channel from pack GitHub releases, daily channel from the pack branch HEAD. It
writes `.pipeline/detected-versions.json`.

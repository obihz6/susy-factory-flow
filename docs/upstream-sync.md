# Upstream Sync Doctrine

This repository is a Supersymmetry retarget of `jackwrichards/gtnh-factory-flow`
(via `SymmetricDevs/susy-factory-flow`). The planner's solver and board code
are meant to stay byte-identical to upstream so periodic merges stay cheap.

## Remotes

- `origin` — `obihz6/susy-factory-flow` (this fork; prototype work)
- `susy` — `SymmetricDevs/susy-factory-flow` (official SUSY adaptation)
- `upstream` — `jackwrichards/gtnh-factory-flow` (fetch-only, never pushed)

Branches: `main` tracks the shared fork chain; `protolocal` carries SUSY
adaptation work until it is promoted.

## Sync procedure

```bash
git fetch upstream && git fetch susy
git checkout protolocal
git merge --no-ff susy/main     # or upstream/main directly when appropriate
npm run typecheck && npm run test && npm run lint
```

Resolve conflicts using the hotspots list below, then verify before pushing.

## Conflict hotspots (the entire SUSY delta)

Everything SUSY-specific lives here; anything else should merge cleanly:

1. `src/lib/pack.ts` — the single seam module (pack id, dataset paths,
   manifest URL env). On conflict, keep ours and re-derive.
2. String seams (~1 line each): `remote.ts` default manifest, server dataset
   roots (`dataset-static-file.ts`, `dataset-query.ts`, moved route files),
   storage namespaces (`susy-factory-flow*` across store/design/tour/browser),
   branding literals (layout, manifest, page, llms.txt, welcome, exports,
   OG card), `instrumentation.ts` prewarm env.
3. `src/app/datasets/susy/…` — moved from upstream's `gtnh` directory; git
   follows the rename but content edits on those routes may need manual care.
4. `src/lib/model/fuels.ts` — SUSY profiles are canonical, GTNH profiles kept
   dormant plus a legacy id map. Upstream edits to GTNH fuel VALUES can be
   taken into the dormant block verbatim.
5. `tools/dataset-pipeline/scripts/rebuild-manifest.mjs` /
   `build-recipe-index.mjs` — DATASETS_ROOT/DATASETS_URL_ROOT parameterization
   (few lines each); take upstream logic changes, keep our defaults.
6. `tools/perf/*.mjs` storage-name literals and the SUSY scripts under
   `tools/dataset-pipeline/scripts/susy/` (new files, no conflicts expected).

## Deliberately NOT changed

- Schema fields `gtnhVersion` and the `gtnh-oracle` exporter/sourceId enum:
  they are dataset-contract names shared with the upstream pipeline format;
  renaming them would break every dataset and index for cosmetics.
- Solver, board, router, renderer internals: zero intended divergence.
- Thaumcraft aspects, bees, crop catalogs: dormant features left intact;
  they simply stay empty because SUSY dumps contain no such domains.

## Validation gate

No push without green `typecheck`, `test`, and `lint`. The lint problem count
must not increase over upstream's baseline (108 errors / ~48 warnings as of
the vendored snapshot) — SUSY patches add zero new findings.

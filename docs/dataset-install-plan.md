# Dataset installation: robustness plan (Phase 1)

Status: awaiting approval. Nothing in `tools/` or `src/` has been edited during Phase 1.
Scope of this document: everything that has to go right **between "pack released" and
"recipe grid rendered"** — the SUSY pipeline (the active lane), the GTNH lane scripts
that share transform code with it, and the runtime that serves/loads datasets.

---

## 0. Deviations between the task brief and this repo (read these first)

| Brief said | Reality (verified) |
|---|---|
| Branch `prototype/supersymmetry-dataset` | Working branch is `main` at commit 05dcd022 (git log) |
| `docs/dataset-pipeline.md`, `tools/dataset-pipeline/README.md` | Neither exists; the SUSY doc is `docs/susy-pipeline.md` (the GTNH equivalent `docs/dataset-pipeline.md` is referenced by `AGENTS.md` and `src/lib/datasets` docs but is missing from this fork) |
| `src/lib/datasets/browser-cache.ts`, `recipe-list.ts` | Do not exist; their role was absorbed by `browser-loader.ts` (module-level promise cache), the store `dataset` slice, and the server shard LRU (`src/lib/server/dataset-query.ts`) |
| `.github/workflows/gtnh-dataset-pipeline.yml` | Exists and is fully implemented (441 lines, detect→build→publish→deploy) — but per `tools/dataset-pipeline/CLAUDE.md:11` it is a **decoy (no self-hosted runner)**; the real rebuild path is manual in WSL |
| `src/app/datasets/gtnh/[versionId]/**` | Only `src/app/datasets/susy/[versionId]/**` exists; `next.config.ts` still carries upstream `gtnh` literals from the rename |

Consequence: **the SUSY pipeline (`npm run pipeline`) and the runtime (`src/lib/server/dataset-query.ts`, `src/lib/datasets/*`) are the primary paths.** The GTNH lane still matters because both lanes share writers and consumers (`dataset-json-writer`, `build-recipe-index`, `build-resource-index`, `rebuild-manifest`, `dataset-checksum`, `apply-texture-icons`, `compute-asset-fingerprint`), and bugs in the shared writers corrupt SUSY datasets too.

Phase 0 check outputs (pre-existing, not dataset-related):

- `npm ci` needed first (fresh clone had no `node_modules`; all three checks initially failed for that reason).
- `npm run typecheck` → **exit 0** (green).
- `npm run lint` → exit 1: **124 errors / 44 warnings** (`/tmp/opencode/lint.log`; `docs/upstream-sync.md:61` documents an upstream baseline of 108 errors / ~48 warnings, so the fork is already above baseline — out of scope here unless touched files regress).
- `npx vitest run` → **1983 passing / 1 failed**, pre-existing failure `src/components/flow/RatioWireLabel.test.tsx:87` (UI test, unrelated to datasets).
- `public/datasets/` is empty and `.pipeline/`/`temp/` do not exist locally, so no dataset bytes were available; runtime findings below are code-verified, and a few explicitly marked *unverified* need a live dataset or the droplet.

---

## 1. Current flow

### 1.1 SUSY pipeline (the lane you can actually run)

Entry: `npm run pipeline` → `tools/dataset-pipeline/scripts/susy/orchestrator.mjs build`
→ `pipeline-runner.mjs` runs, per step, standalone `scripts/susy/*.mjs` as child
processes with `--config temp/susy-pipeline.json`, retrying each step up to 3 times
(`orchestrator.mjs:29` step list; `pipeline-runner.mjs:26-90` retry/halt loop).

State lives in `temp/susy-pipeline.json` (`pipeline-lib.mjs:10`): settings, pinned
instance path, `state.steps[step].status/startedAt/completedAt/error`. A completed
step is skipped unless `--force` or (only for `build-oracle`) source-newer-than-jar
staleness (`orchestrator.mjs:146-190`). Step logs: `temp/logs/orchestrator.log`,
`temp/logs/<step>.log` (append-only, `pipeline-lib.mjs:192-208`).

Order (docs/susy-pipeline.md confirms; per-step IO verified from code by the audit):

| # | Step (script) | Input | Output | Write safety |
|---|---|---|---|---|
| 1 | `download.mjs` → `resolve-susy-instance.mjs` (+ `bootstrap-susy-instance.mjs`, `java8-runtime.mjs`) | GitHub release/ref, env overrides | pinned instance at `temp/.minecraft-fresh` (or `--instance`), Java 8 in `*-runtime/jre8`, `temp/susy-pipeline.json` updated | downloads by existence/gzip-magic, no checksum |
| 2 | `build-oracle.mjs` (+ `build-jar.sh`) | susy-hei-oracle Java sources | `susy-hei-oracle/build/libs/*.jar` | stale-archive reuse in curl cache |
| 3 | `extract.mjs` → `run-susy-export.sh` | the pinned instance | `temp/raw-export/recipedump.json`, `rendered-icons/{icon-map,fluid-icon-map}.json + pngs`, client logs | dump acceptance = "size stable for 5 s"; child runs have no Node-side timeout |
| 4 | `normalize.mjs` (+ `normalize-susy-recipedump.mjs`) | raw dump | `public/datasets/susy/<id>/recipes.json` (line-oriented) | `dataset-json-writer.mjs:4` opens the final path `"w"` |
| 5 | `normalize-textures.mjs` → `apply-susy-icons.mjs` | recipes.json + icon maps | recipes.json rewritten with `iconPath`; `textures/rendered/*.png` | in-place; rendered dir never pruned |
| 6 | `merge-custom.mjs` | recipes.json + `data/custom-recipes/local-dev.json` | recipes.json rewritten again | in-place; weaker validation than `validate-recipes.mjs`; runs after icons (custom recipes get none) |
| 7 | `indexes.mjs` → `build-resource-index.mjs` + `build-recipe-index.mjs` | recipes.json | `recipes.json` in-place rewrite with `resourceIndex`; `recipes-shards/shard-NNNN.json.gz`; 3 index `.gz` | shard dir **wiped first**; 4 non-atomic writes; single-line gz hazard (see P-14/P-15) |
| 8 | `package-dataset.mjs` | recipes.json | `recipes.json.gz` (`createWriteStream` final-name, `package-dataset.mjs:23`) then invokes `rebuild-manifest.mjs` | manifest scan + sha256 over the **4 gz only** (`dataset-checksum.mjs:8-19`), non-atomic write (`rebuild-manifest.mjs:77`), deletes older daily dirs before writing the manifest (`:49-53`) |

Shared GTNH-lance steps interleaved by SUSY lane: `normalize-fluid-icon-alpha.mjs` exists but is **not** wired into the SUSY orchestrator's step list; the GTNH orchestrator (`generate-dataset.mjs`) orders `finalize-rendered-icons` before it, which makes the fluid-alpha fix a no-op there (P-20).

### 1.2 GTNH lane (scripts shared with 1.1 + decoy workflow)

Entry points: `.github/workflows/gtnh-dataset-pipeline.yml:184` and
`tools/dataset-pipeline/scripts/run-dataset-in-docker.sh:69` — both run
`generate-dataset.mjs` inside a container; `run-gtnh-oracle-export.sh` does
download → unpack → shim → boot client/server under xvfb → poll `oracle-records/*.json`
→ normalize → icons → fingerprint. A **separate** later step runs `rebuild-manifest.mjs`
(workflow:296-311; `run-dataset-in-docker.sh:73-84`).

Docker: `docker/Dockerfile` is a bare toolchain image (Temurin 21 + JDK 17/25 stages +
Node 22 from `curl | bash`, Dockerfile:32-33); no repo content is baked; `npm install`
runs inside the container against a bind mount.

### 1.3 Runtime (Layer B)

1. Client boot: `FactoryPlannerApp.tsx:110-141` reads the manifest — a static file
   `public/datasets/susy/datasets.manifest.json` (deploy symlinks it to the shared
   volume, workflow:395) fetched by `remote.ts:7-21` with `t=Date.now()`, parsed with
   `datasetManifestSchema` via `parseDatasetManifestJson` — the **only** Zod-validated
   hop in the whole runtime.
2. Everything else: same-origin `GET /api/datasets/<versionId>/…`
   (`browser-loader.ts:101-302`) → `dataset-query.ts` reads `public/datasets/susy/<id>/`
   from disk (`readGzipJson`, `dataset-query.ts:1971-1975`), **cast, not validated**
   (`JSON.parse(...) as DatasetManifest`, :1706).
3. Server caches `dataset-query.ts:1698-2011`: manifest keyed `mtimeMs:size` (:1701);
   catalog / lookup index / index keyed by `datasetVersionCacheKey(version)` =
   id + checksumSha256 + publishedAt + 3 index paths (:1782-1793) — **manifest metadata
   only, no file identity**; shards keyed `key:shard.id` with an 8-entry LRU (:1877-1901),
   summary hydration LRU 8000.
4. Recipe book queries do set-algebra over `recipe-lookup-index.json.gz`, hydrate
   summaries from `recipes-shards/*.json.gz`, and `recipes/[recipeId]` re-checks
   `entry.id === recipeId` before returning the body (:1678). Recipes list route does
   **not** problem-check shard/index identity of hydrated rows beyond range math (:2185-2200).
5. Static assets: `<img>` URLs direct to `/datasets/susy/<id>/textures/...` (served by
   the symlinked public tree) with three route-based fallbacks, all traversal-guarded
   (`dataset-static-file.ts:30-41`; segment allowlist, shard filename regex, texture
   root allowlist + `path.sep` containment — control verified working).
6. Client caches: `recipeFetchCache` promise map (`browser-loader.ts:121-159`),
   recipe-index 90 s TTL keyed `version@checksum` (`RecipeBrowser.tsx:1137-1169`) —
   there is **no** localStorage/IndexedDB/Cache-API dataset cache; cache invalidation is
   treated entirely through URL cache-busting (`datasetHash` as a 1-year `immutable`
   key part, `dataset-cache-headers.ts:15-18`).
7. Failure surface: every handler maps any thrown error to `500 {error: message}`
   (all 9 API routes, no logging anywhere — grep `console.` in `src/app/api/datasets/**`
   returns 1 hit) and the client stores the message in `datasetError`
   (`factory-store.ts:1275`), which **no component ever reads**.

---

## 2. Problem inventory

Legend: layer A = build/pipeline side, B = runtime side, A/B = shared seam.
Severity per the brief: breaks install / corrupts data / confusing UX / cosmetic.
`verified` = confirmed by reading code (and, marked ✚, reproduced empirically on a
fixture during Phase 0); `unverified` = needs running Docker/Minecraft/live droplet.

| ID | Layer | file:line | Symptom | Root cause | Severity | Status |
|---|---|---|---|---|---|---|
| P-01 | A | dataset-json-writer.mjs:4; build-recipe-index.mjs:48,89-91; build-resource-index.mjs:109; rebuild-manifest.mjs:77-80; package-dataset.mjs:20-24; run-susy-export.sh:318; normalize-textures/merge-custom/apply-susy-icons writers; pipeline-lib.mjs:42-45 (state JSON) | Crash/OOM/kill mid-step leaves truncated `recipes.json`, `.json.gz`, index gz, shards, manifest, PNGs or pipeline state **at the served path**; zero `rename()` calls exist in `scripts/` | Every final artifact is written straight to its final name; no tmp+rename anywhere | **breaks install** (state JSON loss bricks resume) | verified ✚ (grep) |
| P-02 | A | pipeline-lib.mjs:38-64 + orchestrator.mjs:49-50 | Corrupt `temp/susy-pipeline.json` throws `SyntaxError` and the pipeline cannot start; resume state lost | `loadConfig` catches only `ENOENT`; JSON parse errors are fatal with no recovery hint | breaks install | verified |
| P-03 | A | run-susy-export.sh:238-266; run-gtnh-oracle-export.sh:260-289 | "Export complete" is inferred from **file size stable for 5 s** — accepts a truncated dump after any GC pause/stall; normalize then burns 3 retries on a broken file | No completion sentinel, no JSON-parse check, no oracle-side done marker | corrupts data | verified |
| P-04 | A | run-susy-export.sh:242,266 (susy); run-gtnh-oracle-export.sh:268,311-316 | `SUSY_EXPORT_TIMEOUT_SECONDS`/`GTNH_EXPORT_TIMEOUT_SECONDS` expiry with a partial dump in hand proceeds into normalize and **exits 0**; an empty `{}` dump (>2 bytes) passes too | Loop exits without branch distinctions; only "file name non-empty" is checked | corrupts data | verified |
| P-05 | A | rebuild-manifest.mjs:22-26,98-112 + package-dataset.mjs:17 | Package step exits 0 and pipeline prints "completed successfully" even though the new version dir is missing one of shards/indexes — manifest just skips it (`warn`), `versions[0]` stays old | Completeness = 4 gz files with `size > 0`; shards not counted; no exit-code escalation; no `requireFile` for indexes/gz in package step | breaks install (silent) | verified |
| P-06 | A | rebuild-manifest.mjs:49-53,77-80 | Older daily dataset dirs are `fs.rm`'d **before** the manifest write; if the write fails the on-disk manifest points at deleted dirs → 404s | Destructive GC ordered before the commit point; also uses `generatedAt` (content timestamp) as daily-recency input (:154-158), and **incomplete** new dailies are skipped at :23-26 and therefore never GC'd (garbage accumulates) | breaks install | verified (adversarial "oldest kept" variant disproved: newest by `generatedAt` is kept, ties/staleness remain the risk) |
| P-07 | A/B | workflow yml:300-311; rebuild-manifest.mjs:8-11; build-recipe-index.mjs:38; generate-dataset.mjs:21 | On the GTNH workflow path the manifest would ship URLs under `/datasets/susy/…` while bytes/deploy live under `/datasets/gtnh/…` | `DATASETS_URL_ROOT` unset in the workflow container; `rebuild-manifest.mjs` defaults `/datasets/susy`; deploy symlinks `gtnh` (workflow:369-371) | breaks install (decoy path today) | verified in code; droplet behaviour unverified |
| P-08 | A | run-dataset-in-docker.sh:12,23-33,47-69,81-84 | GTNH local docker wrapper defaults datasets root to `public/datasets/susy`, runs as root inside the bind-mounted repo (host files become root-owned), re-runs `npm install` per version, and its `publish` flag is a printed no-op | Copy-paste from the SUSY runner; missing `--user`; no shared install | breaks install / confusing UX | verified |
| P-09 | A | Dockerfile:32-33,36-39 | Node from `curl \| bash` on an unpinned major aborts builds on NodeSource拉动outage/format change; three JDKs with no recorded `JAVA_HOME` decision | unpinned remote script step; toolchain pinning absent | breaks install | code-verified, build unverified |
| P-10 | A | install-ae2fc-nei-compat-shim.sh:10-20,196-197 | Prefix-`000` stub shim jar is recompiled and **overwritten into `mods/` on every run**: the "already present" check uses `grep -q` over an `unzip -l` pipeline, which SIGPIPEs unzip (exit 141) under `pipefail`, so the true-present case fails the check; jar written non-atomically at :197; javac args from unquoted `$(find …)` break on spaces | fragile detection + non-atomic jar write + word splitting | corrupts data / breaks install | verified (mechanism from code; live classload-order effect unverified) |
| P-11 | A | download-gtnh-pack.mjs:82-85,93-104; bootstrap-susy-instance.mjs:64-97,145-159,176-183,194-199,239-245; prepare-forge-client-launch.mjs:347-359,361-377; build-jar.sh:51-56 (and .ps1:43-48); java8-runtime.mjs:47 | Validity = "file exists" / "size matches content-length" / "first 2 bytes are gzip magic"; truncated or corrupt archives are cached **forever**, retried runs fail identically (pack tarball is never deleted on `tar -xzf` failure), a half-installed packwiz (>20 jars) or half-written Forge (`<id>.json` only) is treated as installed, 0-byte "rescued" mods count as success | No checksums (Mojang publishes sha1; pack asset sha256 not checked), no remove-on-failure, no content-length verify, no `unzip -t` | breaks install | verified |
| P-12 | A | the 5 fetchers above + detect-susy-versions.mjs:26-32; select-versions.mjs:89-127; bootstrap-susy-instance.mjs:81,92,345; download-gtnh-pack.mjs:88,136; prepare-forge-client-launch.mjs:353,380 | One transient 5xx/rate-limit kills the step; failures collapse into silence (`return []`) which reads as "no versionsucky available", and every already-published version re-runs | Bare `fetch` with no retry/backoff/timeout, HTTP status conflated with "none found", GitHub token not forwarded by `select-versions` | breaks install / confusing UX | verified |
| P-13 | A | generate-dataset.mjs:257-369 wrappers; pipeline-lib.mjs:227-278; bootstrap-susy-instance.mjs:265-271; prepare-forge-client-launch.mjs:154-173 | Child procs and fetches have no deadline; a hung exporter costs up to 3×4 h before halt; asset downloads are strictly sequential with no retry | No `timeout`/`AbortSignal`; no `"error"` handler on spawns | breaks install (hang) | verified |
| P-14 | A | build-resource-index.mjs:91-110; dataset-json-writer.mjs:26,54 | ✚ **`build-resource-index` silently drops multi-line top-level objects — in practice `oreDictionary`, which `recipeDatasetSchema` requires (schemas.ts:89)**: the reader skips `value === "{"` lines without storing, the writer (>32 keys) spans them across lines; the served dataset then lacks oredict alternatives, and because the server casts (`dataset-query.ts:1706`) nothing errors. Compact single-line `.gz` handling at :107-110 also breaks `rebuild-manifest.mjs:114-152`'s per-line parser (the documented "gzip last" trap, docs/susy-pipeline.md:168-174) | line-oriented dataset contract kept by two hand-rolled parsers with no shared library or assertion | corrupts data | verified ✚ (fixture reproduced both the loss and the `Missing datasetVersionId` failure) |
| P-15 | A | build-recipe-index.mjs:27-28,48,89-91; package-dataset.mjs:20; indexes.mjs:15-23 | Mixed-generation version dirs are reachable: shard dir wiped first, per-shard writes, then indexes, then gz, then scan-manifest; crash between → new shards + old index whose ranges reference the other generation (recipe grid shows wrong recipe bodies/counts silently) | No staging dir, no generation token in filenames, no post-write verification | corrupts data | verified |
| P-16 | A/B | compute-asset-fingerprint.mjs:13-24,55-57 + generate-dataset.mjs:384-412; rebuild-manifest.mjs:30 + dataset-checksum.mjs:6-21 | Fingerprint ignores the oracle jar/artifact size/env (`GTNH_ATLAS_ICON_SIZE`, `GTNH_RENDER_STACK_ICONS`) → an icon-rendering change with unchanged mods skips the client icon pass; manifest `checksumSha256` covers the 4 gz only — textures (incl. whole re-runs that change icon bytes under immutable-cache
URLs) and shards are unhashed; the fingerprint file is written and never read back, and nothing verifies the manifest checksum after write | checksum contract covers the artifacts the *cache header* treats as immutable but not the caching inputs | corrupts data | verified |
| P-17 | A | reuse-previous-icons.mjs:36-37,88 vs apply-texture-icons.mjs:52 / finalize-rendered-icons.mjs:64 | ✚ Client-pass skip + icon "reuse" can never reuse a GTNH-produced icon (URL guard hardcodes `/datasets/susy/<prevId>/`); it still copies directory trees that may not exist and logs `Reused 0`, exit 0 — dataset ships without rendered-stack icons | hardcoded pack seam in the shared script | corrupts data | verified ✚ (fixture) |
| P-18 | A | generate-dataset.mjs ordering (step 6 finalize at :99, then normalize-fluid-icon-alpha at :113) + finalize-rendered-icons.mjs:92 + normalize-fluid-icon-alpha.mjs:72-86 | finalize wipes `textures/rendered` before the fluid-alpha pass runs, so faint/gas fluid icons ship on any dataset small enough to take the finalize path (≤450 MB gate); the fluid-alpha step then silently `process.exit(0)`s because its input dir is gone. Contradicts CLAUDE.md:29-31 ("rebuilds must run normalize-fluid-icon-alpha with --rename after the index builds") | step-order regression between the two shared steps | corrupts data (icon visibility) | verified |
| P-19 | A | generate-dataset.mjs:82,112-125; run-gtnh-oracle-export.sh:112-125 | `existsSync(recipes.json)` passes on a **stale** file from the previous run; the built oracle jar is selected by lexicographic `sort | tail -1` (1.2.0 beats 1.10.0); the client-phase raw export is picked by `sort | tail -1` too | existence gates replace staleness gates | corrupts data | verified |
| P-20 | A | run-susy-export.sh:129-131,155-156; bootstrap-susy-instance.mjs:131-136 | The instance tree is mutated by a "non-destructive" runner: `options.txt` edited with `sed -i` and no backup (only `instance.cfg` is restored); `--ref` change against an existing instance keeps the old pack but stamps the new ref into the dataset header | restore covers one file; ref not persisted/compared | corrupts data / confusing UX | verified |
| P-21 | A | orchestrator.mjs:41-47 | Changing `--ref` while keeping `--version-id` keeps all steps "completed" → pipeline repaints the old dump with the new version id/label | state reset keyed on versionId only | corrupts data | verified |
| P-22 | A | susy/export-step `merge-custom.mjs:66-71,38-49` | Custom merge validates weaker than `validate-recipes.mjs` (which the pipeline never runs), leaving `duration/EUt` undefined into `toDatasetRecipe`; deleting a custom recipe removes no `resources` (phantom catalog rows) | validator not shared with the step | corrupts data | verified |
| P-23 | B | all 9 routes in src/app/api/datasets/[versionId]/**; dataset-query.ts:1713-1717,1971-1975 | Unknown/invalid versionId → **500** (not 404); truncated gz/missing path → 500 echoing raw zlib/ENOENT/absolute server paths to the browser; zero server-side logging; a missing shard silently shortens results (`recipes[recipeId]` → "Recipe not found.", indistinguishable from deletion); guard code in `dataset-static-file.ts:30-41` is otherwise correct | single catch-all policy; no error classes; no structured log ship | confusing UX / breaks observability | verified |
| P-24 | B | dataset-query.ts:1782-1793,200-208; DatasetManifestSchema consumers | `An in-place gzip swap` in a long-lived process keeps serving the old bytes forever — cache keys omit file mtime/size (only the manifest loader stamps `mtimeMs:size`, :1701); `checksumSha256` is never re-verified; loaded-catalog/lookup maps grow unboundedly across versions | memory pressure + stale byte-serving after publish handoffs | corrupts data | verified |
| P-25 | B | remote.ts:10-21; browser-loader.ts:101-302,332; FactoryPlannerApp.tsx:110-141 | No timeout/retry/abort on any client fetch; two rapid version switches race, last-wins, board can dry; `recipeDatasetSchema` is dead at runtime (cast everywhere), so a malformed catalog fails deep in the store; store `datasetError` never rendered anywhere (picker disabled, blank pane, no message); `appVersion` param sent but ignored | fetch wrappers absent; full-corpus validation skipped as a policy with no guard | confusing UX / corrupts data | verified (end-to-end不 behaviour unverified — no local dataset bytes) |
| P-26 | B | next.config.ts:13,25,51-64; .env.example:1; normalize-textures.mjs:30, package-dataset.mjs:38, build-recipe-index.mjs:38 | Stale upstream seams: `gtnh` rewrite in next.config + three pipeline scripts hardcoding `/datasets/susy` independent of `DATASETS_URL_ROOT` (see P-07/P-17); `.env.example` documents the wrong manifest env var (`NEXT_PUBLIC_GTNH_…` vs `pack.ts`'s SUSY name) | rename touched `pack.ts` but not the neighbours | confusing UX (deploy-time) | verified |
| P-27 | A | build-recipe-index.mjs:282-299,301,411; dataset-query.ts:2295; dev-init.mjs:34 | Type/shape drift: `RecipeSummary.slots` required in types but fabricated as `[]` server-side; `compactNei`/`toCompactResource` dead; `dev-init` writes a placeholder the app's own `recipeDatasetSchema` rejects (fresh local version can't round-trip) | schema vs pipeline writer drift, no shared contract test | cosmetic | verified |
| P-28 | A | rebuild-manifest.mjs:35-36,82-90,15-157; detect-gtnh-versions.mjs:80-105; select-versions.mjs:165-185 | Channel inferred by id prefix, `publishedAt` = normalize time, "latest daily" chosen lexically/first-encountered, release pagination capped at 10 pages, `GITHUB_TOKEN` not forwarded in select-versions — a silent stale-set outcome | heuristics with no invariants asserted | confusing UX / corrupts data | verified |
| P-29 | A | generate-dataset.mjs:34-44,122-129 (single `writePipelineRecord` call); rebuild-manifest.mjs:20 | .pipeline pipeline-record only written on success ("started" never persisted); `datasets-status` cleanup path removal of a marker **no script writes**; grep zero `process.on` in the orchestrator chain | no failure marker/exit hook | confusing UX | verified |
| P-30 | A | a broad set (P-13 list, shims, runners, xvfb): run-gtnh-oracle-export.sh:35,42,67,70,134,162-165,205,234,237; find-gtnh-instance-root.mjs:12-15,24; explode-icon-atlas.mjs:59; icon-utils.mjs:47 | Runner logs append-only with no run separator, `exec > >(tee -a)` can lose tail on kill, cross-run greps (`detect_fatal_runtime_log`) read **all attempts'** logs, saved-file concurrency hazard on `/tmp/gtnh-find-root.err` shared across runs, wildcard jar deletion `*recipe*export*` in `mods/`, broad `-Xms4G` ignore of `GTNH_EXPORT_MAX_MEMORY`, CWD-relative atlas resolution breaks from non-repo dirs, `xargs` without `-r` can hang on `sha256sum` stdin, image `unzip`-missing treated as class-absent | accumulated operational sharp edges in the shell runtime | confusing UX | verified (code); live-droplet behaviour unverified |
| P-31 | A | select-versions.mjs, detect-susy-versions.mjs (per parts of P-12+P-28) | Discovery success/failure indistinguishable (`return []` paths) | same | confusing UX | verified |
| P-32 | A/B | docs: `docs/dataset-pipeline.md` referenced by AGENTS.md but missing; `tools/dataset-pipeline/CLAUDE.md` in sync with SUSY flow; `README.md` says data comes from the GitHub Action (decoy) | docs drift (three narratives: WSL manual, GitHub Action, susy pipeline) | confusing UX (docs) | verified |
| P-33 | A | bee; crops; `run-gtnh-oracle-export.sh:319-326` success recap | No step summary (no counts/no phase marker) on success or failure; on Windows/WSL the equivalent `.ps1` path shares several bugs (build-jar.ps1 above), but **the SUSY Windows export runner (.ps1) path can't be audited here without Windows — unverified** | confusing UX | unverified (ps1 runtime) |

Control names deliberately omitted as non-problems after audit (do not churn):

- All three static-server asset routes `src/app/datasets/susy/.../route.ts` are
  traversal-guarded (`dataset-static-file.ts:30-41`) — control confirmed.
- manifest Zod validation on the client (`remote.ts` → `parseDatasetManifestJson`) —
  exists and works; the gap is downstream (P-25).
- `useDatasetFile`-style null-icon handling / standard `catalog` snapshotting control
  observed; no bug surfaced in the audit beyond P-24/P-25.

> The full audit marked ~30 additional minor items (per-mirror error logging, non-TTY
> The full audit marked ~30 additional minor items (per-mirror error logging, non-TTY
> progress-spam, hardcoded toolchain defaults etc.). They are consolidated into P-30/P-26 and will
> be fixed opportunistically in the steps below;verbatim per-item details remain in the
> session summary on request.

---

## 3. Proposed improvements (grouped by theme)

Guiding principles: keep every dataset file format backward compatible; make shared
writers the single; keep behaviors from the SUSY pipeline untouched where the plan does
not explicitly reorder; prefer small, reviewable commits, *one problem cluster each*.

### T-A — One atomic write everywhere (fixes P-01, part of P-02, P-06)
New shared module `tools/dataset-pipeline/scripts/lib/fs-atomic.mjs`:
`writeFileAtomic(path, data|stream)`, `writeFileAtomicJson`, `writeGzipAtomic`
(all temp-file-in-target-dir + `fsync` + `rename`). Adopt at every site listed in
P-01, plus `pipeline-lib.mjs:writeJson`. Manifest publish becomes: write to
`datasets.manifest.json.tmp`, validate `JSON.parse`, then `rename` — so a torn manifest
can never be published again. Also extract hard-coded URL root plumbing
(`DATASETS_URL_ROOT`) to one seam module so P-07's default mismatch and normalize-textures/package-dataset/build-recipe-index/reuse-previous-icons hardcodes (P-17/P-26) get one default and one override.

### T-B — Integrity contracts (fixes P-03, P-04, P-05, P-11, P-14 tail, P-16)
- `lib/checks.mjs` with `requireJsonFile(path)` (parse-ok), `requireGzip(path)`,
  `requireDatasetStripe(path)`; adopt post-write in the four writers (normalize, indexes,
  package, resource-index) so a step never ends with artifacts it would refuse to read tomorrow.
- Export completion: prefer an oracle-written sentinel (a final line `oracle-export.json` already parses as JSON — "parse the tail" is the cheap replacement for size-stable) → new
  `download gate` in both shell runners, keep size-stable only as a fallback; forbid the "partial dump on timeout" path (P-04) and treat `size>2` as failure unless parse passes.
- Per-artifact `recipes-shards`/index gz re-parse after write (cheap ~200 MB/s).
- Downloads (Layer A): one `lib/download.mjs` (retry/backoff/deadline/etag, verify content-length, sha256/stdouts where the source provides, temp+rename, delete-on-fail) adopted for pack/oracle/library/toolchain/asset fetches; `unzip -t` before unzip of any pack archive; Mojang sha1 verified in `prepare-forge-client-launch`; remove-on-fail semantics instead of caching corruptions (pack tarball, packwiz jar, JDK archives).
- Reconcile `checksumSha256` contract: keep the manifest schema (backward-compatible) but ALSO hash shards (extend `dataset-checksum.mjs` to include shard paths in the checksum input — same format, recomputed; document that a republished manifest regenerates it). Wire a maintainer-facing `--verify` mode that re-hashes every artifact on disk and compares.
- `build-resource-index` and `dataset-json-writer`: drop the object-skipping reader branch (P-14) by emitting **all big top-level values as a single JSON line** from the writer (keeps the line contract, satisfies the manifest parser), then pinning round-trip tests.
### T-C — Failure surfacing & logging (fixes P-02, P-05, P-10, P-13, P-23, P-30)
- `pipeline-lib.mjs writeJson` → `writeFileAtomicJson` + a recovery in `loadConfig`: on parse failure, refuse-and-hint (print the corrupt path and a backup note), don't silently reset state; contrary to the current silent `createInitialConfig` path it fails fast.
- `rebuild-manifest.mjs`: `--strict` default (package step) — the warn-and-skip becomes **exit 1 with a list** when a version dir is incomplete, gated by an explicit `--allow-partial` opt-in for interactive cleanups; report `skipped` versions on stderr.
- Fail-with-context: `runCommand` rejects with the last 15 lines of stderr in the message (node pipeline kit); every shell runner gets a 3-line step summary on exit (input/output/exit/docs grep); add run-id + header per log open (append-only file gets separators).
- `dataset-query.ts`: introduce `DatasetError` variants (VersionNotFound → 404, CorruptArtifact → 503 with logs, NotFound → 404 with "recipe id X absent since 4.2" message, InternalError → 500 generic text + `console.error` of the full stack). Route handlers log via shared `commonError` helper; browser payloads stop leaking server-absolute paths.
- Runtime client: `fetchJson` wrapper with `AbortSignal.timeout(30_000)` and 2 retries; shared `AbortController` per dataset-switch; UI surface per P-25.
### T-D — Idempotency & resume correctness (fixes P-19, P-20, P-21, P-22)
- `isStepStale` generalized: a `lib/step-inputs.mjs` that stamps (a hash-of-inputs) into `state.steps[step].inputsHash` at completion; completed→ stale when either inputs hash or declared output mtimes don't match. `download`/`extract`/`normalize`/`indexes`/`package` all opt in.
- Version-change reset (orchestrator:41-47) now keys on **`versionId` + `ref`**, and snapshot `pack.toml`: the extracted pack hash into config on `download` → fail on mismatch (P-20/P-21).
- `merge-custom`: reuse `validate-recipes.mjs` shared validator lib; keep resources-removal for deleted customs; move merge before normalize-textures so custom recipes get icons (or explicitly document that customs are iconless).
- `run-susy-export.sh`: not least, back up `options.txt` like `instance.cfg` and always restore.
### T-E — Install-path correctness (fixes P-06, P-08, P-09, P-10, P-13, P-28, P-29)
- `install-ae2fc-nei-compat-shim.sh`: detection via an explicit per-jar `unzip -l` loop (no `pipefail`-sensitive pipelines for detection), quoted javac file list (`find -print0 | sort -z | xargs -0`), temp jar + `mv`, and `rm -f` of the old shim before the install.
- `run-dataset-in-docker.sh`: default `GTNH_DATASETS_ROOT` to `public/datasets/gtnh`; `--user "$(id -u):$(id -g)"`; `--init`-style cleanups; honest `publish` flag; per-version `set -e` on track.
- Dockerfile: pin Node (either a fixed SRC URL or `apt` install of a pinned version per deb.nodesource setup output pinned), declare `ENV JAVA_HOME`+`PATH` for the chosen JDK; add `USER dataset`; document that CI passes `--user` (workflow already does).
- `generate-dataset.mjs`: write the "started" record via `fs.rename` on start and "failed" record in a `try/finally`/`process.on('exit')` shim; child spawns get an `"error"` listener + a per-step timeouts map; `stale recipes.json` gate extended to mtime > `$GTNH_RAW_EXPORT_DIR/oracle-records` latest; oracle jar pick by build-order manifest (or mtime pick with a warning).
- `find-gtnh-instance-root.mjs`: score never below "mods+config both present"; try/catch around `readdirSync`; print the winning score.
- Version GC: scan all dirs (including incomplete ones) but only rm directories verified complete-and-stale; sort dailies by **dir mtime first, generatedAt second**.
### T-F — Runtime robustness (fixes P-22-tails, P-24, P-25, P-26)
Server:
- Cache keys: fold a file-identity token `${mtimeMs}:${size}` of each gzip into `datasetVersionCacheKey` (manifest loader already stamps it per file—) so a swapped-on-disk artifact invalidates in-memory bytes; add bounded LRU caps for loaded catalogs/lookup indexes (e.g. 4 versions) with cheap per-version eviction.
- `versionId`/`assetFile`/texture-path validation centralised in one guard module reused by the three static routes and all API routes (containment as today); manifest-declared `resourceIndexPath` etc. goes through the same containment check (defence-in-depth, currently an internal-only surface).
- Zod-at-load behind an env flag (`SUSY_DATASET_STRICT_VALIDATION`) defaulting off; default records count mismatches (`shard start/end` vs index total, shard `datasetVersionId` vs version id) and logs, errors marked as corrupt-version.
Client:
- Surface `datasetError` (banner near the browser header, retry button calling the loader).
- `fetchJson` wrapper (T-C) with timeout + retry; `loadDatasetVersion` gains a generation token so a late response cannot win (matches the pickDefaultDatasetVersion selectors already in place).
- Client cache busting keys: existing `datasetHash` stays; add `schemaVersion`+`appVersion` into the recipe-index TTL key.
- /api cache headers: keep `immutable` semantics but derive the 1-year TTL from the SAME key part (fix next.config `gtnh` seams; document the susy texture cache rule in `next.config.ts` headers block).
### T-G — Testability & verification tooling (fixes P-14, P-16, P-27, P-32 docs tail)
- Extract pure testable modules under `tools/dataset-pipeline/scripts/lib/`:
  `dataset-line-writer` (line-oriented top-level emission contract),
  `manifest-builder` (from a directory listing of files to manifest rows), runs a
  `--verify` mode (per-artifact hash + shard/index⊜ consistency + manifest dir-id
  pairing), and pack integrity (sha256/length/zip central dir).
- Wire `schemas.ts` into the pipeline's boundary test (vitest imports Zod directly for
  round-trip between writer fixtures and the app schema — a real layer-A↔B contract test).
- A `--dry-run` upgrade path for the orchestrator (current parseCliArgs absorbs typos):
  compatibility list of every known flag + explicit error on unknown flags + "would run
  these steps in this order" plan print.

---

## 4. Test strategy

Existing suite baseline: **1983 tests passing, 1 pre-existing UI failure** (not our lane
to fix here). All new pipeline tests go under `tools/dataset-pipeline/scripts/lib/*.test.mjs`
(already picked up by `vitest.config.ts:13` via `tools/**/*.test.mjs`).

1. **Lib writer tests** (P-01/P-14): `fs-atomic.test.mjs` (crash simulation via
   injected `fs.rename` throwing between write and rename leaves zero final-path file),
   `dataset-line-writer.test.mjs` (top-level multi-line object — the `oreDictionary`
   regression ends up pinned; `rebuild-manifest`'s parser pattern round-trips any
   emitted shape).
2. **Integrity tests** (P-03/04/05/11): `checks.test.mjs` (truncated gz rejected;
   "settled size >2" no longer treated as complete; `--strict` rebuild-manifest fails
   with a listed reason on a fixture dir minus one shard; verified sha256 for a
   fixture corpus).
3. ** Orchestrator runner tests** (P-21): extend `pipeline-runner.test.mjs` — state
   reset on ref change, inputs-hash staleness, runCommand error contains child stderr tail.
4. **Contract tests** (P-14/P-27): an end-to-end artifact fixture — run the pipeline's
   pure functions from normalize (with `scripts/susy/fixture-recipedump.json`) through
   indexes → `parseRecipeDatasetJson` (`src/lib/import-export/dataset-json.ts`) —
   asserting `oreDictionary` and completeness survive.
5. **Runtime tests** (P-23/P-24/P-25): extend `src/lib/datasets/remote.test.ts` (timeouts,
   retried fetches, manifest Zod failure path); add `dataset-query.test.ts` cases for
   unknown version → 404, corrupt gz → 503-with-clean-JSON and a server warning log,
   cache-key invalidation when mtime/size changes (server routes use `@`-prefixed
   `datatests` helper), `RecipeBrowser`-provider TTL key (client, mocked timers).
6. **Route guard regression** (P-23): hold-or-404 contract for the picker (`/api/datasets/[unknown]/catalog`), plus the three static routes' traversal tests (blocklist and containment) — small parametrized test file; runs alongside the existing `recipes/route.test.ts`.
7. **Manual/Playwright** (only after 5+6): `scratch/probes/dataset-error-banner.mjs`
   (dev server, break public/datasets, confirm banner + retry button) — AGENTS.md
   requires real-app checks for UI changes; the texture 404 check too.

---

## 5. Implementation order (each step independently committable)

| # | Step | Fixes | Acceptance check |
|---|---|---|---|
| 1 | `lib/fs-atomic.mjs` + adoption across all writers (A) + `writeJson` in pipeline-lib | P-01, P-02 | `grep -c "writeFile\\|createWriteStream"` shows no direct final-name hits in the audit's P-01 list; `npx vitest run lib tests` green; runtime untouched |
| 2 | `dataset-json-writer` line-contract fix + round-trip tests (incl. `oreDictionary`) | P-14 | new test green; existing normalize/index/manifest contract tests green; manual zcat of a rebuilt recipes.json shows `oreDictionary` intact with single-line values |
| 3 | `rebuild-manifest` hardening: atomic write, `--strict` default via package step, verify completeness incl. shards + dir-id pairing; GC after manifest write | P-05, P-06, part P-16 | new tests pass; hand-run on a fixture dataset dir (susy) produces a valid manifest; missing shard → non-zero exit and printed list |
| 4 | Download hardening: `lib/download.mjs` (retry/deadline/verify/temp+rename/remove-on-fail) adopted at the 9 fetch sites + `unzip -t` + sha1 for Mojang + fixed shim javac/quoting/atomic jar + toolchain `curl --retry` etc. | P-10, P-11, P-12, T-A leftovers | shellcheck-ish review; `node scripts/lib/download.test.mjs` (mocked fetches) green; shim script run on a fixture mods dir exits 0 exactly once on absent/AE2FC-present states |
| 5 | Export/complete-detection: replace size-stable-only with a JSON-parseable dump gate + timeout disambiguation + per-step summary markers (susy + gtnh runners), stale-gate on input mtime, oracle jar selection fix, `options.txt` backup/restore | P-03, P-04, P-19, part P-20 | a fixture "timeout + partial dump" run exits non-zero **before** normalize; unit tests cover the reject path; a live client export can't be verified locally → **unverified** (needs your instance/export) |
| 6 | Orchestrator/runner hardening: inputs-hash staleness, ref-change reset, corrupt-config fail-fast, timeout on child steps, stderr-tail errors, run headers | P-02, P-13, P-21, part P-30 | `pipeline-runner.test.mjs` extensions green; a `--from normalize` restart on a fixture temp tree works |
| 7 | generate-dataset/GTNH-lane fixes: failure records, per-step timeouts, error listeners, oracle json pick by mtime, instance-root try/catch, pagination/README-consistency fixes, run-dataset-in-docker defaults/user/publish | P-08, P-17, P-19, P-28, P-29, P-30 | new tests green; docker run of detect job unchanged behaviourally (unverified: needs Docker) |
| 8 | Runtime server: DatasetError taxonomy, 404 for unknown version, no path leaks, console.error on failures, cache-key folds file identity + LRU bounds, serve-time optional validation | P-23, P-24, part P-25 | `dataset-query.test.ts` additions green; `curl -i /api/datasets/unknown/catalog` → 404 JSON; corrupt fixture → 503 with clean message and logged stack |
| 9 | Runtime client: fetchJson wrapper (timeout/retry/abort), dataset version-switch generation token, `datasetError` banner + retry UI, TTL key bump, cache-header env seams in next.config + .env.example fix | P-25, P-26 | `remote.test.ts` extensions green; Playwright probe shows banner on broken manifest and recovers after a version switch |
| 10 | Fingerprint/checksum contract: include shards + a `--verify` mode; `compute-asset-fingerprint` input expansion (oracle jar, atlas env, render flags) + post-write read-back; reuse-previous-icons URL seam fix | P-16, P-17, part P-30 | new verify mode green on the stable fixture; fingerprint changes when the oracle jar mtime/bytes change (unit-tested) |
| 11 | Docs: rewrite `docs/dataset-pipeline.md` (missing today) from tools/CLAUDE.md knowledge + update `docs/susy-pipeline.md`/`tools/dataset-pipeline/CLAUDE.md`, trouble-shooting section per new error message, remove the `.pipeline-status.json` orphan references | P-32 | docs review; `AGENTS.md` reference table check |

Each step re-runs `npm run lint` / `npm run typecheck` / `npx vitest run` and keeps the
baseline (1983 pass) plus new tests green.

---

## 6. Risks, open questions, and things that need your machine

**Risks**
- R1: T-B (all drop cache/remove-on-fail semantics) can fight slow links — all changes keep the resume-with-manual-intervention path (per docs/susy-pipeline.md:54-56) and gate new strictness behind explicit, off-by-default envs where risk is not obvious.
- R2: T-F cache-key changes change what a "one-year immutable" URL means — the invariant "textures are cache-immutable; fix pixels under a NEW filename" (tools/dataset-pipeline/CLAUDE.md:29-31) is preserved; server in-memory keys change but no URL contract changes.
- R3: `build-resource-index` writer change (Step 2) changes the on-disk layout for multi-line values — mitigated by the per-line parser staying compatible (verified in Phase 0 for the manifest reader) plus round-trip tests; the Fusion cases (docs/susy-pipeline.md's "Ordering constraint (do not fix)") keep their contract.
- R4: deployment cooldown: the deploy job (workflow:344-398) is the third dep'd path; nothing in the plan touches it except `datasetCacheHeaders`/route-adjacent behaviors.

**Open questions for you**

1. **Scope of the GTNH lane**: the workflow is declared a decoy (`tools/dataset-pipeline/CLAUDE.md:11`), but `generate-dataset.mjs`/`run-dataset-in-docker.sh`/`normalize-fluid-icon-alpha.mjs` bug fixes (P-07/08/09/17/18) are cheap and shared with the SUSY lane — should I fix those too (Step 3/5/7 as planned), or bound the work to the SUSY lane + shared writers strictly?
2. **API error-code contract**: changing `500-for-unknown-version` to `404` is a behavior change for the client picker and hidden-version stale bookmarks (P-23) — acceptable to ship as part of Step 8, keeping `{error}` payloads shaped as today?
3. **`ChecksumSha256` extension to shards (P-16)**: new manifest field `shardChecksums?` or keep a single `checksumSha256` by hashing shard path+bytes too (recompute on publish — matches the step-3 contract)? Default suggestion: extend to the single existing checksum, since 4 gz + shards are written atomically in Step 1.
4. **Windows `.ps1` lane** (bootstrap/export runner): Phase 0 ran Linux-only; the audit found it shares the same download/caching flaws (`build-jar.ps1:43-48`), but I could not audit/run it — same treatment applied blindly from the `.sh` findings and left unverified, or excluded from this pass?
5. **`dev-init` placeholder dataset (P-27)**: fix it to write a minimal-valid `recipeDatasetSchema`-compliant `recipes.json` (with the `datasetVersionId/gtnhVersion/sourceInfo/oreDictionary/recipeMaps/generatedAt` set) — confirm; it likely only affects the `/recipes` import path.

**Needs your machine (I will not attempt these):**
- A real `npm run pipeline -- --ref master-ceu --version-id daily-local` run end-to-end (needs network + a real Minecraft client export; extract step unverified).
- Docker: the two workflow paths; each step's Docker acceptance marked *unverified*.
- The droplet: cache-staleness behaviour after an in-place gzip publish (P-24) and the deploy-time `gtnh` rewrite risk (P-07) can only be confirmed live.
- Windows export runner (`.ps1` behaviours in P-33).

**Explicitly unverified (do not treat as green):**
- Docker build, full SUSY export with a real client, `run-dataset-in-docker.sh` behaviour, live droplet request/response headers, the AE2FC shim's runtime classload-order effect, the `.ps1` runner behaviors, and `public/datasets` decorating behaviours under a real dataset volume (no bytes locally).

---

## 7. Approval checklist

- [ ] **Approve scope**: SUSY lane + shared writers + runtime as primary (Steps 1-11); GTNH-lane fixes included as Step 3/5/7 details (answer Q1 above to adjust).
- [ ] Approve **Step 2** (dataset-json-writer line contract + oreDictionary round-trip pin).
- [ ] Approve **Step 3** (--strict package default, atomic manifest, GC-after-publish).
- [ ] Approve **Step 4** (download hardening incl. `unzip -t`, sha1, remove-on-fail, shim quoting).
- [ ] Approve **Step 5** (parse-able export completion + timeout fail-fast + stale input gate).
- [ ] Approve **Step 6** (orchestrator staleness/ config-recovery bailout + child timeouts + stderr tail).
- [ ] Approve **Step 7** (GTNH-lane operational fixes incl. run-dataset-in-docker defaults/user).
- [ ] Approve **Step 8** (runtime 404 taxonomy + no path leak + cache-key file identity + LRU caps).
- [ ] Approve **Step 9** (runtime client timeout/retry/abort + error banner + switch token).
- [ ] Approve **Step 10** (fingerprint/checksum `--verify` + oracle-jar inputs + reuse seam fix).
- [ ] Approve **Step 11** (docs rewrite).
- [ ] Answer **Q1-Q5** above (defaults: Q1 include-GTNH-cheap-fixes = yes; Q2 = yes keep payload shape; Q3 = extend single checksum; Q4 = fix ps1 blindly and mark unverified; Q5 = yes fix).
- [ ] Confirm the pre-existing outcomes stay untouched: `lint` baseline (124e/44w), `RatioWireLabel.test.tsx` failing test, `dataset-contract` names (`gtnhVersion` etc. per docs/upstream-sync.md:49-56).

Reply with edits or "approved" and Phase 2 begins with Step 1.

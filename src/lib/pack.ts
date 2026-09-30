/**
 * Which modpack this build of the planner serves.
 *
 * The upstream project is bound to GregTech: New Horizons; this fork retargets
 * it at Supersymmetry with the smallest possible surface so upstream merges
 * stay cheap. Everything pack-specific funnels through this module: dataset
 * paths, storage namespaces, branding. If an upstream merge conflicts here,
 * re-derive the values rather than preserving theirs.
 */
export const PACK_ID = "susy";

export const PACK_LABEL = "SUSY Planner";

/** URL path segment under /public where datasets are served from. */
export const DATASET_PUBLIC_ROOT = "/datasets/susy";

export const DEFAULT_DATASET_MANIFEST_URL =
  process.env.NEXT_PUBLIC_SUSY_DATASET_MANIFEST_URL ??
  `${DATASET_PUBLIC_ROOT}/datasets.manifest.json`;

/**
 * Local browser namespace. A fresh name keeps SUSY plans out of any GTNH
 * install's IndexedDB/localStorage on a shared machine.
 */
export const STORAGE_NAMESPACE = "susy-factory-flow";

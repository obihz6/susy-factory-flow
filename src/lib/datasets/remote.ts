import { parseDatasetManifestJson } from "../import-export";
import { DEFAULT_DATASET_MANIFEST_URL } from "../pack";
import type { DatasetManifest, DatasetVersion } from "./types";

export { DEFAULT_DATASET_MANIFEST_URL };

export async function fetchDatasetManifest(
  manifestUrl = DEFAULT_DATASET_MANIFEST_URL,
): Promise<DatasetManifest> {
  const response = await fetch(withCacheBust(manifestUrl), {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Could not load dataset manifest (${response.status}).`);
  }

  return parseDatasetManifestJson(await response.text());
}

/**
 * Dataset versions never offered in the picker, even if a manifest still
 * lists them. 2.8.4 is no longer supported; only 2.9 is.
 */
export const HIDDEN_DATASET_VERSION_IDS = new Set(["local-2.8.4"]);

export function listSelectableDatasetVersions(manifest: DatasetManifest): DatasetVersion[] {
  const selectable = manifest.versions.filter(
    (version) => !HIDDEN_DATASET_VERSION_IDS.has(version.id),
  );
  // A manifest holding only hidden versions still needs to offer something.
  return selectable.length > 0 ? selectable : manifest.versions;
}

export function pickDefaultDatasetVersion(manifest: DatasetManifest): DatasetVersion | undefined {
  const selectable = listSelectableDatasetVersions(manifest);
  const preferredId = manifest.latestStableVersion ?? manifest.latestDailyVersion;
  if (preferredId) {
    const preferred = selectable.find((version) => version.id === preferredId);
    if (preferred) {
      return preferred;
    }
  }

  return selectable[0];
}

function withCacheBust(url: string): string {
  const resolvedUrl = new URL(url, window.location.origin);
  resolvedUrl.searchParams.set("t", String(Date.now()));
  return resolvedUrl.toString();
}

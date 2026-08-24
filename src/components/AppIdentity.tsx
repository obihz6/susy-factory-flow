"use client";

import { listSelectableDatasetVersions } from "@/lib/datasets/remote";
import { useFactoryStore } from "@/store/factory-store";

interface AppIdentityProps {
  onLoadDatasetVersion: (versionId: string) => void;
}

/**
 * Game-version picker, in the top bar beside the app version chip.
 *
 * It used to head the recipe browser column, on the grounds that it decides
 * which pack's recipes exist and so belongs beside the catalogue. It reads
 * better up here: the two version numbers a player might confuse sit together,
 * the top bar had the room going spare, and the browser column gets a whole
 * row of its height back for the list.
 */
export function AppIdentity({ onLoadDatasetVersion }: AppIdentityProps) {
  const manifest = useFactoryStore((state) => state.datasetManifest);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const isDatasetLoading = useFactoryStore((state) => state.isDatasetLoading);
  const versions = manifest ? listSelectableDatasetVersions(manifest) : [];

  return (
    <label
      className="flex min-w-0 items-center gap-1.5"
      title="Pack version"
    >
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
        Game
      </span>
      <select
        value={selectedDatasetVersionId ?? ""}
        disabled={isDatasetLoading || !versions.length}
        onChange={(event) => onLoadDatasetVersion(event.target.value)}
        // In the compact menu it gets the sheet's whole width: a truncated pack
        // version is the one string here nobody can afford to guess at.
        // On the bar it is the opposite: `min-w-0` so a tight window shrinks it
        // instead of letting it slide underneath the right-hand buttons.
        className="h-6 min-w-0 max-w-[220px] compact:h-9 compact:max-w-none compact:flex-1 rounded-[4px] border border-line-strong bg-surface-sunken px-1.5 text-xs compact:text-sm font-normal normal-case tracking-normal text-fg outline-none disabled:cursor-not-allowed disabled:text-fg-muted"
      >
        {versions.length ? (
          versions.map((version) => (
            <option key={version.id} value={version.id}>
              {version.gtnhVersion} ({version.channel})
            </option>
          ))
        ) : (
          <option value="">No versions</option>
        )}
      </select>
    </label>
  );
}

"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle } from "lucide-react";
import type { DatasetVersion, RecipeSummary } from "@/lib/datasets/types";
import { DEFAULT_DATASET_MANIFEST_URL } from "@/lib/datasets/remote";
import { getRecipeDatasetRecipe, listRecipeDatasetCrops } from "@/lib/datasets/browser-loader";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import { useFactoryStore } from "@/store/factory-store";

// One crop catalog fetch per dataset version, shared by every picker.
let cachedCrops: { versionId: string; crops: RecipeSummary[] } | undefined;

export function cropDisplayName(recipeName: string): string {
  const separator = recipeName.indexOf(": ");
  return separator >= 0 ? recipeName.slice(separator + 2) : recipeName;
}

/**
 * Searchable crop list for crop source nodes. Picking a crop swaps the node's
 * recipe to that crop's Crop Farm entry.
 */
export function CropPickerMenu({
  nodeId,
  onClose,
}: {
  nodeId: string;
  onClose: () => void;
}) {
  const datasetManifestUrl = useFactoryStore((state) => state.datasetManifestUrl);
  const datasetManifest = useFactoryStore((state) => state.datasetManifest);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const setNodeRecipe = useFactoryStore((state) => state.setNodeRecipe);
  // On the Crop Manager, a machine-only crop harvests to NOTHING; the tile
  // grays out so the dead pick is visible before it is made (the Industrial
  // Farm tab shows them in full color).
  const onIndustrialFarm = useFactoryStore(
    (state) =>
      state.project.nodes.find((entry) => entry.id === nodeId)?.machineHandlerId ===
      "crop-industrial-farm",
  );
  const version: DatasetVersion | undefined = datasetManifest?.versions.find(
    (entry) => entry.id === selectedDatasetVersionId,
  );
  const manifestUrl = datasetManifestUrl ?? DEFAULT_DATASET_MANIFEST_URL;

  const [crops, setCrops] = useState<RecipeSummary[]>(() => {
    const cached = cachedCrops;
    return cached && cached.versionId === selectedDatasetVersionId ? cached.crops : [];
  });
  const [search, setSearch] = useState("");
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!version || (cachedCrops?.versionId === version.id && cachedCrops.crops.length > 0)) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    listRecipeDatasetCrops(manifestUrl, version)
      .then((result) => {
        cachedCrops = { versionId: version.id, crops: result.crops };
        if (!cancelled) {
          setCrops(result.crops);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load crops.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [manifestUrl, version]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matches = needle
      ? crops.filter((crop) => {
          const haystack = [
            cropDisplayName(crop.name),
            ...crop.outputs.map((output) => output.displayName ?? output.id),
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(needle);
        })
      : crops;
    // Tier order, name inside a tier: the list reads as a progression.
    return [...matches].sort((a, b) => {
      const tierOf = (crop: RecipeSummary) =>
        (crop.metadata as { cropsNh?: { tier?: number } } | undefined)?.cropsNh?.tier ?? 99;
      return (
        tierOf(a) - tierOf(b) || cropDisplayName(a.name).localeCompare(cropDisplayName(b.name))
      );
    });
  }, [crops, search]);

  // Click-away closes the picker: capture phase, because the board's own
  // handlers stop pointer events long before they would bubble up here.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose]);

  // The menu PORTALS to the body: inside the card it lived in the node
  // layer's stacking context, under the marching-dash canvas and every
  // higher card. Measured once from the name bar on open; a board pan
  // closes it anyway through the click-away.
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [anchorAt, setAnchorAt] = useState<{ left: number; top: number }>();
  useEffect(() => {
    const parent = anchorRef.current?.parentElement;
    if (parent) {
      const rect = parent.getBoundingClientRect();
      setAnchorAt({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 372)),
        top: Math.min(rect.bottom + 2, window.innerHeight - 120),
      });
    }
  }, []);

  const handlePick = async (summary: RecipeSummary) => {
    if (!version) {
      return;
    }
    try {
      const recipe = await getRecipeDatasetRecipe(manifestUrl, version, summary.id);
      setNodeRecipe(nodeId, recipe);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the crop.");
    }
  };

  const menu = anchorAt ? (
    <div
      ref={rootRef}
      style={{ position: "fixed", left: anchorAt.left, top: anchorAt.top }}
      // "nowheel" stops React Flow from zooming the canvas when scrolling the
      // list: its native wheel handler runs before React's synthetic one, so
      // stopPropagation alone is not enough.
      className="nodrag nowheel z-[300] w-[360px] border-2 border-[var(--mc-15)] bg-[var(--mc-78)] p-1.5 shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33),4px_4px_0_rgba(0,0,0,0.35)]"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <input
        autoFocus
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
        placeholder="Search crops or drops..."
        className="mb-1 h-7 w-full border border-[var(--mc-33)] bg-[var(--mc-85)] px-2 text-[12px] font-bold text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-54)] outline-none focus:border-cyan-700 focus:bg-[var(--mc-100)]"
        aria-label="Search crops"
      />
      {isLoading ? (
        <div className="flex items-center gap-2 px-2 py-3 text-[12px] font-bold text-[var(--mc-ink)]">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Loading crops...
        </div>
      ) : error ? (
        <div className="px-2 py-3 text-[12px] font-bold text-[var(--mc-bad)]">{error}</div>
      ) : (
        <div className="grid max-h-[420px] grid-cols-5 overflow-y-auto">
          {filtered.map((crop, index) => {
            const tierOf = (entry: RecipeSummary) =>
              (entry.metadata as { cropsNh?: { tier?: number } } | undefined)?.cropsNh?.tier;
            const tier = tierOf(crop);
            const machineOnly =
              (crop.metadata as { cropsNh?: { machineOnly?: boolean } } | undefined)?.cropsNh
                ?.machineOnly === true;
            const name = cropDisplayName(crop.name);
            // The hover is the crop's harvest, drawn: each drop with its
            // icon, name and roll chance, in the tiles' own style.
            const hover = (
              <div className="min-w-[170px]">
                <p className="text-[14px] font-bold leading-4 text-white">
                  {name}
                  {tier ? (
                    <span className="text-[11px] font-normal text-slate-400"> · Tier {tier}</span>
                  ) : null}
                </p>
                <div className="mt-1.5 space-y-1">
                  {crop.outputs.map((output) => (
                    <div key={output.id} className="flex items-center gap-1.5">
                      <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden [filter:drop-shadow(1px_1px_1px_rgba(0,0,0,0.55))]">
                        <ResourceIcon
                          resource={{ ...output, chance: undefined }}
                          bare
                          tooltip={false}
                          showAmount={false}
                          showConsumedState={false}
                          size="sm"
                        />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] leading-4 text-slate-100">
                        {output.displayName ?? output.id}
                      </span>
                      {output.chance !== undefined && output.chance < 1 ? (
                        <span className="shrink-0 text-[12px] tabular-nums text-slate-400">
                          {Math.round(output.chance * 1000) / 10}%
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
                {machineOnly ? (
                  <p className="mt-1.5 text-[12px] leading-4 text-slate-400">
                    Only works in an Industrial Farm.
                  </p>
                ) : null}
              </div>
            );
            // The list is tier-sorted, so a tier's first crop opens its
            // section with a full-width TIER N rule.
            const previous = index > 0 ? filtered[index - 1] : undefined;
            const opensTier = tier !== undefined && (!previous || tierOf(previous) !== tier);
            return (
              <Fragment key={crop.id}>
                {opensTier ? (
                  <div className="col-span-5 flex items-center gap-1.5 px-0.5 pb-0.5 pt-1 text-[10px] uppercase tracking-wide text-[var(--mc-ink-muted)]">
                    <span className="shrink-0">Tier {tier}</span>
                    <span className="h-px min-w-0 flex-1 bg-[var(--mc-56)]" />
                  </div>
                ) : null}
                <MinecraftTooltip content={hover}>
                <button
                  type="button"
                  onClick={() => void handlePick(crop)}
                  // The left item shelf's language: a bare icon over its
                  // name, no box of its own, a quiet hover wash.
                  className={[
                    "flex flex-col items-center gap-0.5 p-0.5 pb-1 text-[var(--mc-ink)] hover:bg-[var(--mc-85)]",
                    machineOnly && !onIndustrialFarm ? "opacity-35 saturate-50" : "",
                  ].join(" ")}
                >
                  <span className="grid h-12 w-12 place-items-center overflow-hidden [filter:drop-shadow(1px_2px_2px_rgba(0,0,0,0.55))]">
                    {crop.outputs[0] ? (
                      <ResourceIcon
                        // Chance badges are spelled out in the hover instead.
                        resource={{ ...crop.outputs[0], chance: undefined }}
                        bare
                        tooltip={false}
                        showAmount={false}
                        showConsumedState={false}
                        size="md"
                        className="scale-[1.4]"
                      />
                    ) : null}
                  </span>
                  <span className="w-full overflow-hidden text-center text-[8px] font-bold leading-[9px]">
                    {name}
                  </span>
                </button>
                </MinecraftTooltip>
              </Fragment>
            );
          })}
          {filtered.length === 0 ? (
            <div className="col-span-5 px-2 py-3 text-[12px] font-bold text-[var(--mc-ink-muted)]">
              No crops match.
            </div>
          ) : null}
        </div>
      )}
    </div>
  ) : null;

  return (
    <>
      <span ref={anchorRef} className="hidden" />
      {menu ? createPortal(menu, document.body) : null}
    </>
  );
}

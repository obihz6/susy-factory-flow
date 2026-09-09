"use client";

import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ItemPickerPopover } from "@/components/ItemPickerPopover";
import { LibraryMenu, MenuItem, MenuRule } from "@/components/library/library-menu";
import { queryRecipeDatasetResources } from "@/lib/datasets/browser-loader";
import { DEFAULT_DATASET_MANIFEST_URL } from "@/lib/datasets/remote";
import type { DatasetResourceIndexEntry } from "@/lib/datasets/types";
import type { ResourceAmount } from "@/lib/model/types";
import { getUiScale } from "@/lib/ui-scale";
import { useFactoryStore } from "@/store/factory-store";

/**
 * THE BOARD'S ONE RIGHT-CLICK MENU (Jack, 2026-09-08: "a universal right
 * click menu ... very simple, easy to use, easy to understand"). Right
 * click the void, a card, a drawer or a wire and the same small menu opens
 * at the pointer with the few things you can do there:
 *
 * - the void: a new product drawer, picked from the item picker the pool
 *   key uses, set down where you clicked;
 * - a machine: clone it, delete it;
 * - a drawer: clone it, delete it;
 * - a wire: add a drawer HERE - the wire is cut at the click and both
 *   halves run through the new drawer - or delete the wire.
 *
 * Controls that already answer a right click (port rows open uses, a tier
 * chip steps down, the count stepper) keep it: they prevent the event's
 * default, and the board's handlers do nothing for a prevented event. No
 * tooltips, no submenus, no second sentence anywhere in it.
 */

export type BoardMenuTarget = {
  /** Where the pointer was, in real px (the menu is a body portal). */
  x: number;
  y: number;
  /** The same point in flow space: where a new drawer lands. */
  flow: { x: number; y: number };
} & (
  | { kind: "pane" }
  | { kind: "node"; id: string }
  | { kind: "storage"; id: string }
  | { kind: "edge"; ids: string[]; resource: ResourceAmount | undefined }
);

export function BoardContextMenu({
  target,
  onClose,
}: {
  target: BoardMenuTarget;
  onClose: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const datasetManifestUrl = useFactoryStore((state) => state.datasetManifestUrl);
  const datasetManifest = useFactoryStore((state) => state.datasetManifest);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const selectedDatasetVersion = useMemo(
    () => datasetManifest?.versions.find((entry) => entry.id === selectedDatasetVersionId),
    [datasetManifest?.versions, selectedDatasetVersionId],
  );
  const searchPickerResources = useCallback(
    async (pickerQuery: string, signal: AbortSignal) => {
      if (!selectedDatasetVersion) {
        return [];
      }
      const result = await queryRecipeDatasetResources(
        datasetManifestUrl ?? DEFAULT_DATASET_MANIFEST_URL,
        selectedDatasetVersion,
        { query: pickerQuery, offset: 0, limit: 48 },
        { signal },
      );
      return result.resources;
    },
    [datasetManifestUrl, selectedDatasetVersion],
  );
  const onPick = useCallback(
    (entry: DatasetResourceIndexEntry) => {
      if (entry.kind === "aspect") {
        return;
      }
      useFactoryStore.getState().addPoolStorage(
        {
          kind: entry.kind,
          id: entry.id,
          displayName: entry.displayName,
          iconPath: entry.iconPath,
          iconAtlas: entry.iconAtlas,
          dominantColor: entry.dominantColor,
        },
        "drain",
        target.flow,
      );
      onClose();
    },
    [onClose, target.flow],
  );

  if (picking) {
    if (typeof document === "undefined") {
      return null;
    }
    // The picker where the menu was: a body portal, so real px become shell
    // px through the interface scale (ui-scale.ts).
    const scale = getUiScale();
    const left = Math.min(target.x / scale, window.innerWidth / scale - 340);
    const top = Math.min(target.y / scale, window.innerHeight / scale - 420);
    return createPortal(
      <div className="ui-zoom fixed z-[100]" style={{ left: Math.max(8, left), top: Math.max(8, top) }}>
        <ItemPickerPopover
          role="makes"
          placement="below"
          onPick={onPick}
          onClose={onClose}
          searchPickerResources={searchPickerResources}
        />
      </div>,
      document.body,
    );
  }

  const store = () => useFactoryStore.getState();
  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  return (
    <LibraryMenu left={target.x} top={target.y} label="Board menu" onClose={onClose}>
      {target.kind === "pane" ? (
        <MenuItem label="New product drawer" onClick={() => setPicking(true)} />
      ) : null}
      {target.kind === "node" ? (
        <>
          <MenuItem label="Clone" onClick={run(() => store().duplicateNode(target.id))} />
          <MenuRule />
          <MenuItem label="Delete" tone="danger" onClick={run(() => store().deleteNode(target.id))} />
        </>
      ) : null}
      {target.kind === "storage" ? (
        <>
          <MenuItem label="Clone" onClick={run(() => store().duplicateStorage(target.id))} />
          <MenuRule />
          <MenuItem label="Delete" tone="danger" onClick={run(() => store().deleteStorage(target.id))} />
        </>
      ) : null}
      {target.kind === "edge" ? (
        <>
          <MenuItem
            label="Add a drawer here"
            disabled={!target.resource}
            onClick={run(() => {
              if (target.resource) {
                store().insertStorageOnEdge(target.ids, target.flow, target.resource);
              }
            })}
          />
          <MenuRule />
          <MenuItem
            label={target.ids.length > 1 ? "Delete wires" : "Delete wire"}
            tone="danger"
            onClick={run(() => store().deleteEdge(target.ids))}
          />
        </>
      ) : null}
    </LibraryMenu>
  );
}

"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ArrowBigUp,
  Boxes,
  Cog,
  Download,
  Globe,
  LoaderCircle,
  Pencil,
  Save,
  Search,
  Share2,
  Tags,
  Trash2,
  User,
  X,
} from "lucide-react";
import {
  blueprintMatchesSearch,
  BLUEPRINT_SORTS,
  normalizeBlueprintTags,
  PUBLIC_BLUEPRINT_SORTS,
  sortBlueprints,
  type BlueprintSort,
  type BlueprintSummary,
  type PublicBlueprintSort,
} from "@/lib/blueprints/types";
import { snapPositionToGrid } from "@/lib/board-grid";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useCommunityUser } from "@/components/community/auth";
import { ControlsCard } from "@/components/ControlsCard";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import { EntryIconSlot, IconPicker, iconSuggestionsFromStats } from "@/components/IconPicker";
import {
  formatRelativeDate,
  renderEntryHoverCard,
  TagChips,
  TierBadge,
} from "@/components/shelf-cards";
import { useBlueprintStore } from "@/store/blueprint-store";
import { captureBoardSelection, useFactoryStore } from "@/store/factory-store";
import type { BoardClipboardPayload } from "@/store/factory-store";

/** The whole story a hovered blueprint row tells. */
function blueprintHoverCard(blueprint: BlueprintSummary): ReactNode {
  return renderEntryHoverCard({
    icon: blueprint.icon,
    name: blueprint.name,
    authorName: blueprint.authorName,
    createdAt: blueprint.publishedAt ?? blueprint.createdAt,
    cardCount: blueprint.nodeCount + blueprint.storageCount,
    machineCount: blueprint.machineCount,
    tier: blueprint.highestTier,
    description: blueprint.description || undefined,
    needs: blueprint.needs,
    outputs: blueprint.outputs,
  });
}

/**
 * The blueprint library, owning the whole left column while the sidebar's
 * master switch points at it. Two shelves: MINE is the account's collection
 * (saved from pocket cards, published with one click, renameable, and
 * OVERWRITABLE — select a pocket on the board and any owned row can adopt it
 * while keeping its id, votes, downloads and publish state); PUBLIC is the
 * network — everyone's published sub-assemblies, searchable, sortable,
 * upvoteable, placeable. Hovering any row reveals the blueprint's stat card:
 * what it needs from outside and what it makes, the same reading the
 * zoomed-out board gives a hovered machine.
 */
export function BlueprintPanel() {
  const { user } = useCommunityUser();
  const refresh = useBlueprintStore((state) => state.refresh);
  const reset = useBlueprintStore((state) => state.reset);
  const [scope, setScope] = useState<"mine" | "public">("mine");

  // Exactly one pocket selected on the board arms the pocket flows: the
  // selection IS the picker, whichever way round the gesture starts. Lives
  // up here (not in MineShelf) so the share button next to the scope tabs
  // can run the same machinery from either shelf.
  const pickedPocketId = useFactoryStore((state) => {
    const pockets = state.project.pockets ?? [];
    const selected = state.selectedBoardIds.filter((id) =>
      pockets.some((pocket) => pocket.id === id),
    );
    return selected.length === 1 ? selected[0] : undefined;
  });
  const [overwriteArmId, setOverwriteArmId] = useState<string | undefined>(undefined);
  // The share flow: pick a pocket, it uploads as a brand-new blueprint.
  const [isShareArmed, setShareArmed] = useState(false);

  useEffect(() => {
    if (!user) {
      reset();
      return;
    }
    void refresh();
  }, [user, refresh, reset]);

  // Signing out mid-pick can't leave the share flow armed.
  if (!user && isShareArmed) {
    setShareArmed(false);
  }

  /**
   * The picked pocket heads into the save dialog, prefilled with its own
   * name and stat card; the upload happens when the dialog confirms.
   */
  const commitShare = useCallback((pocketId: string) => {
    const project = useFactoryStore.getState().project;
    const pocket = project.pockets?.find((entry) => entry.id === pocketId);
    const payload = captureBoardSelection(project, [pocketId]);
    if (payload) {
      useBlueprintStore
        .getState()
        .setSaveRequest({ payload, name: pocket?.name || "Pocket" });
    }
  }, []);

  /**
   * Overwriting: same dialog, aimed at an existing row. A pocket already
   * selected counts as picked; otherwise the button arms the board picker.
   */
  const startOverwrite = useCallback(
    (blueprint: BlueprintSummary) => {
      setShareArmed(false);
      if (overwriteArmId === blueprint.id) {
        setOverwriteArmId(undefined);
        return;
      }
      if (pickedPocketId) {
        const payload = captureBoardSelection(useFactoryStore.getState().project, [
          pickedPocketId,
        ]);
        if (payload) {
          useBlueprintStore.getState().setSaveRequest({
            payload,
            name: blueprint.name,
            icon: blueprint.icon,
            tags: blueprint.tags,
            isPublic: blueprint.isPublic,
            blueprintId: blueprint.id,
          });
        }
        return;
      }
      setOverwriteArmId(blueprint.id);
    },
    [overwriteArmId, pickedPocketId],
  );

  // While overwrite is armed, watch the board for the pocket pick and open
  // the dialog the moment one lands.
  useEffect(() => {
    if (!overwriteArmId) {
      return;
    }
    const unsubscribe = useFactoryStore.subscribe((state) => {
      const pockets = state.project.pockets ?? [];
      const selected = state.selectedBoardIds.filter((id) =>
        pockets.some((pocket) => pocket.id === id),
      );
      if (selected.length !== 1) {
        return;
      }
      const payload = captureBoardSelection(state.project, [selected[0]]);
      const blueprint = useBlueprintStore
        .getState()
        .blueprints.find((entry) => entry.id === overwriteArmId);
      setOverwriteArmId(undefined);
      if (payload && blueprint) {
        useBlueprintStore.getState().setSaveRequest({
          payload,
          name: blueprint.name,
          icon: blueprint.icon,
          tags: blueprint.tags,
          isPublic: blueprint.isPublic,
          blueprintId: blueprint.id,
        });
      }
    });
    return unsubscribe;
  }, [overwriteArmId]);

  // The board wears picker mode while either flow waits for its pocket —
  // banner and ringed pocket cards; cleared the moment anything changes,
  // and always on unmount, so the board can never be left stuck in a mode.
  useEffect(() => {
    const setOverwritePicking = useBlueprintStore.getState().setOverwritePicking;
    if (overwriteArmId && !pickedPocketId) {
      const blueprint = useBlueprintStore
        .getState()
        .blueprints.find((entry) => entry.id === overwriteArmId);
      setOverwritePicking({ blueprintId: overwriteArmId, name: blueprint?.name ?? "" });
    } else if (isShareArmed && !pickedPocketId) {
      setOverwritePicking({ blueprintId: "", name: "", create: true });
    } else {
      setOverwritePicking(undefined);
    }
    return () => setOverwritePicking(undefined);
  }, [overwriteArmId, pickedPocketId, isShareArmed]);

  // Esc backs out of either flow, wherever the pointer happens to be.
  useEffect(() => {
    if (!overwriteArmId && !isShareArmed) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOverwriteArmId(undefined);
        setShareArmed(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overwriteArmId, isShareArmed]);

  // Share commit: while armed, watch the board for a pocket pick and upload
  // the moment one lands. (A pocket already selected at click time commits
  // straight from the button handler and never arms at all.)
  useEffect(() => {
    if (!isShareArmed) {
      return;
    }
    const unsubscribe = useFactoryStore.subscribe((state) => {
      const pockets = state.project.pockets ?? [];
      const selected = state.selectedBoardIds.filter((id) =>
        pockets.some((pocket) => pocket.id === id),
      );
      if (selected.length === 1) {
        setShareArmed(false);
        commitShare(selected[0]);
      }
    });
    return unsubscribe;
  }, [isShareArmed, commitShare]);

  const scopeTabs = (
    <div className="flex gap-1">
      <MinecraftTooltip
        label={
          !user
            ? "Share a pocket\nSign in (top right) first"
            : isShareArmed
              ? "Picking\nClick a pocket on the board, or click again to cancel"
              : "Share a pocket\nPick one on the board; it lands on your Mine shelf"
        }
      >
        <button
          type="button"
          disabled={!user}
          onClick={() => {
            setScope("mine");
            setOverwriteArmId(undefined);
            if (isShareArmed) {
              setShareArmed(false);
            } else if (pickedPocketId) {
              // A pocket already selected counts as picked: upload it now.
              commitShare(pickedPocketId);
            } else {
              setShareArmed(true);
            }
          }}
          aria-label="Share a pocket to my shelf"
          className={[
            "flex h-7 w-9 shrink-0 items-center justify-center rounded-[4px] border",
            isShareArmed
              ? "border-amber-500 bg-amber-500/15 text-amber-300"
              : "border-neutral-700 bg-[#17191d] text-neutral-400 enabled:hover:border-amber-600 enabled:hover:text-amber-300 disabled:opacity-50",
          ].join(" ")}
        >
          <Share2 className="h-3.5 w-3.5" />
        </button>
      </MinecraftTooltip>
      <button
        type="button"
        onClick={() => setScope("mine")}
        className={[
          "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[4px] border text-xs font-medium",
          scope === "mine"
            ? "border-cyan-500 bg-cyan-500/15 text-cyan-300"
            : "border-neutral-700 bg-[#17191d] text-neutral-400 hover:text-neutral-200",
        ].join(" ")}
      >
        <User className="h-3.5 w-3.5" />
        Mine
      </button>
      <button
        type="button"
        onClick={() => setScope("public")}
        className={[
          "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[4px] border text-xs font-medium",
          scope === "public"
            ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
            : "border-neutral-700 bg-[#17191d] text-neutral-400 hover:text-neutral-200",
        ].join(" ")}
      >
        <Globe className="h-3.5 w-3.5" />
        Public
      </button>
    </div>
  );

  return scope === "mine" ? (
    <MineShelf
      scopeTabs={scopeTabs}
      overwriteArmId={overwriteArmId}
      onOverwrite={startOverwrite}
      onCancelOverwrite={() => setOverwriteArmId(undefined)}
    />
  ) : (
    <PublicShelf scopeTabs={scopeTabs} />
  );
}

/**
 * Stamp a fetched payload onto the board, centred on the current view.
 * Returns the pasted top-level ids (also shared with the Setups shelf,
 * whose pocket-drop compacts them right after).
 */
export function placePayload(payload: BoardClipboardPayload): string[] {
  const state = useFactoryStore.getState();
  const centre = payloadCentre(payload) ?? { x: 0, y: 0 };
  const viewCentre = state.flowViewportCenter ?? { x: 0, y: 0 };
  const offset = snapPositionToGrid({
    x: viewCentre.x - centre.x,
    y: viewCentre.y - centre.y,
  });
  const pastedIds = state.pasteBoardItems(payload, offset);
  if (pastedIds.length > 0) {
    // Arrives selected, ready to drag into place — same handoff as paste.
    state.setPendingBoardSelection(pastedIds);
    // And the camera closes in on it. It lands centred on the view, but a
    // board being read from far out would show what arrived as a speck, and a
    // board zoomed right in would only show a corner of it.
    state.frameBoardNodes(pastedIds);
  }
  return pastedIds;
}


// ---------------------------------------------------------------------------
// MINE: the private collection, with publishing.
// ---------------------------------------------------------------------------

function MineShelf({
  scopeTabs,
  overwriteArmId,
  onOverwrite,
  onCancelOverwrite,
}: {
  scopeTabs: ReactNode;
  overwriteArmId?: string;
  onOverwrite: (blueprint: BlueprintSummary) => void;
  onCancelOverwrite: () => void;
}) {
  const { user, isLoading: isAuthLoading } = useCommunityUser();
  const blueprints = useBlueprintStore((state) => state.blueprints);
  const sort = useBlueprintStore((state) => state.sort);
  const setSort = useBlueprintStore((state) => state.setSort);
  const hasLoaded = useBlueprintStore((state) => state.hasLoaded);
  const isLoading = useBlueprintStore((state) => state.isLoading);
  const isSaving = useBlueprintStore((state) => state.isSaving);
  const busyId = useBlueprintStore((state) => state.busyId);
  const error = useBlueprintStore((state) => state.error);
  const load = useBlueprintStore((state) => state.load);
  const remove = useBlueprintStore((state) => state.remove);
  const publish = useBlueprintStore((state) => state.publish);
  const update = useBlueprintStore((state) => state.update);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | undefined>(undefined);
  const [renamingId, setRenamingId] = useState<string | undefined>(undefined);
  const [renameDraft, setRenameDraft] = useState("");
  // The tag editor: edits live locally as chips and save once, on close —
  // one PUT per session, never per keystroke, and no republishing needed.
  const [taggingId, setTaggingId] = useState<string | undefined>(undefined);
  const [tagDraft, setTagDraft] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [query, setQuery] = useState("");
  // The row whose icon is being picked; the picker itself is one modal.
  const [iconEditId, setIconEditId] = useState<string | undefined>(undefined);

  const place = async (blueprintId: string) => {
    const payload = await load(blueprintId);
    if (payload) {
      placePayload(payload);
    }
  };

  const commitRename = (blueprintId: string) => {
    const name = renameDraft.trim();
    setRenamingId(undefined);
    const current = blueprints.find((blueprint) => blueprint.id === blueprintId);
    if (name && current && name !== current.name) {
      void update(blueprintId, { name });
    }
  };

  const openTagEditor = (blueprint: BlueprintSummary) => {
    setTaggingId(blueprint.id);
    setTagDraft(blueprint.tags ?? []);
    setTagInput("");
  };

  const addDraftTag = () => {
    const next = normalizeBlueprintTags([...tagDraft, tagInput]);
    setTagDraft(next);
    setTagInput("");
    return next;
  };

  // Closing saves — whatever is still in the input counts as one last tag.
  const closeTagEditor = (blueprintId: string) => {
    const finalTags = tagInput.trim() ? addDraftTag() : tagDraft;
    setTaggingId(undefined);
    setTagInput("");
    const current = blueprints.find((blueprint) => blueprint.id === blueprintId);
    if (current && JSON.stringify(finalTags) !== JSON.stringify(current.tags ?? [])) {
      void update(blueprintId, { tags: finalTags });
    }
  };

  const filtered = sortBlueprints(blueprints, sort).filter((blueprint) =>
    blueprintMatchesSearch(blueprint, query),
  );
  const isFiltering = query.trim().length > 0;
  // Tag dropdown choices: everything the collection wears, plus the active
  // tag itself so a hand-typed #tag still shows as selected.
  const activeTag = query.trim().startsWith("#") ? query.trim().slice(1).trim() : "";
  const tagOptions = [
    ...new Set([
      ...blueprints.flatMap((blueprint) => blueprint.tags ?? []),
      ...(activeTag ? [activeTag] : []),
    ]),
  ].sort();

  return (
    <>
      <ControlsCard>
        {scopeTabs}
        <label className="mt-2 flex h-9 items-center gap-2 rounded-[4px] border border-neutral-700 bg-[#17191d] px-2 text-sm text-neutral-200 shadow-[inset_1px_1px_0_rgba(255,255,255,0.08)]">
          <Search className="h-4 w-4 text-neutral-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search my pockets... (#tag)"
            className="min-w-0 flex-1 bg-transparent outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              title="Clear search"
              aria-label="Clear pocket search"
              className="text-neutral-500 hover:text-neutral-200"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </label>
        {/* Tags left, sort right — the same two dropdowns as everywhere. */}
        <div className="mt-2 flex items-center gap-1">
          <select
            value={activeTag}
            onChange={(event) => setQuery(event.target.value ? `#${event.target.value}` : "")}
            aria-label="Filter my pockets by tag"
            className="h-7 min-w-0 flex-1 rounded-[4px] border border-neutral-700 bg-[#17191d] px-1 text-xs text-neutral-100 outline-none"
          >
            <option value="">All tags</option>
            {tagOptions.map((tag) => (
              <option key={tag} value={tag}>
                #{tag}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as BlueprintSort)}
            aria-label="Sort pockets"
            className="h-7 min-w-0 flex-1 rounded-[4px] border border-neutral-700 bg-[#17191d] px-1 text-xs text-neutral-100 outline-none"
          >
            {Object.entries(BLUEPRINT_SORTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {isSaving ? (
          <p className="mt-1.5 flex items-center gap-1 px-0.5 text-[10px] text-neutral-500">
            <LoaderCircle className="h-3 w-3 animate-spin" /> Saving…
          </p>
        ) : null}
      </ControlsCard>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {error ? <p className="mb-1.5 px-0.5 text-[11px] text-red-400">{error}</p> : null}

        {isAuthLoading ? null : !user ? (
          <p className="px-0.5 pt-1 text-[11px] leading-relaxed text-neutral-500">
            Sign in (top right) to keep a cloud library of sub-assemblies: hit the save button on
            any pocket card to shelve it here, publish your best to the network.
          </p>
        ) : isLoading && !hasLoaded ? (
          <p className="flex items-center gap-1.5 px-0.5 pt-1 text-[11px] text-neutral-500">
            <LoaderCircle className="h-3 w-3 animate-spin" /> Loading your pockets…
          </p>
        ) : blueprints.length === 0 ? (
          <p className="px-0.5 pt-1 text-[11px] leading-relaxed text-neutral-500">
            Nothing saved yet. Compact cards into a pocket (Ctrl+G), then hit the save button on
            the pocket card. The whole dimension lands here under the pocket&apos;s name.
          </p>
        ) : filtered.length === 0 && isFiltering ? (
          <p className="px-0.5 pt-1 text-[11px] leading-relaxed text-neutral-500">
            No pockets match.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {filtered.map((blueprint) => {
              const isBusy = busyId === blueprint.id;
              const confirming = confirmDeleteId === blueprint.id;
              return (
                <li
                  key={blueprint.id}
                  className="group rounded-[4px] border border-neutral-700 bg-[#25272c] px-1.5 py-1 hover:border-neutral-500"
                  // Double-click anywhere that isn't a control places it —
                  // the download button stays as the single-click way.
                  onDoubleClick={(event) => {
                    if (!isBusy && !(event.target as HTMLElement).closest("button, input")) {
                      void place(blueprint.id);
                    }
                  }}
                >
                  {/* The whole row reveals the blueprint's story; buttons
                      that sit inside it explain THEMSELVES, winning the
                      hover wherever they are (nearest tooltip owns it). */}
                  <MinecraftTooltip content={blueprintHoverCard(blueprint)}>
                  <div className="flex items-center gap-1">
                    <EntryIconSlot
                      icon={blueprint.icon}
                      editable
                      onEdit={() => setIconEditId(blueprint.id)}
                    />
                    {renamingId === blueprint.id ? (
                      <input
                        autoFocus
                        data-tooltip-stop=""
                        value={renameDraft}
                        maxLength={60}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onBlur={() => commitRename(blueprint.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            commitRename(blueprint.id);
                          }
                          if (event.key === "Escape") {
                            setRenamingId(undefined);
                          }
                        }}
                        className="h-6 min-w-0 flex-1 rounded-[4px] border border-cyan-600 bg-[#17191d] px-1.5 text-[13px] text-neutral-100 outline-none"
                      />
                    ) : (
                      <span className="block min-w-0 flex-1 truncate text-[13px] leading-5 text-neutral-100">
                        {blueprint.name}
                      </span>
                    )}
                    <MinecraftTooltip
                      label={
                        overwriteArmId === blueprint.id
                          ? "Overwrite armed\nPick a pocket on the board, or click to cancel"
                          : "Overwrite from the board\nA pocket you pick replaces this one. Votes stay"
                      }
                    >
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onOverwrite(blueprint)}
                        aria-label={`Overwrite pocket ${blueprint.name} from the board`}
                        className={[
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border",
                          overwriteArmId === blueprint.id
                            ? "border-amber-500 bg-amber-500/15 text-amber-300"
                            : "border-neutral-700 bg-[#17191d] text-neutral-400 hover:border-amber-600 hover:text-amber-300",
                        ].join(" ")}
                      >
                        <Save className="h-3 w-3" />
                      </button>
                    </MinecraftTooltip>
                    <MinecraftTooltip label={"Rename\nEnter saves, Esc backs out"}>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setRenamingId(blueprint.id);
                          setRenameDraft(blueprint.name);
                        }}
                        aria-label={`Rename pocket ${blueprint.name}`}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </MinecraftTooltip>
                    <MinecraftTooltip
                      label={
                        taggingId === blueprint.id
                          ? "Save tags\nCloses the editor"
                          : "Edit tags\nClosing saves"
                      }
                    >
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          taggingId === blueprint.id
                            ? closeTagEditor(blueprint.id)
                            : openTagEditor(blueprint)
                        }
                        aria-label={`Edit tags for pocket ${blueprint.name}`}
                        className={[
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border",
                          taggingId === blueprint.id
                            ? "border-cyan-500 bg-cyan-500/15 text-cyan-300"
                            : "border-neutral-700 bg-[#17191d] text-neutral-400 hover:border-cyan-600 hover:text-cyan-300",
                        ].join(" ")}
                      >
                        <Tags className="h-3 w-3" />
                      </button>
                    </MinecraftTooltip>
                    <MinecraftTooltip
                      label={
                        blueprint.isPublic
                          ? "Public\nOn the shelf for everyone. Click to make it private"
                          : "Private\nOnly you see it. Click to publish"
                      }
                    >
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void publish(blueprint.id, !blueprint.isPublic)}
                        aria-label={
                          blueprint.isPublic
                            ? `Unpublish blueprint ${blueprint.name}`
                            : `Publish blueprint ${blueprint.name}`
                        }
                        className={[
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border",
                          blueprint.isPublic
                            ? "border-emerald-600 bg-emerald-500/15 text-emerald-300 hover:border-neutral-500 hover:text-neutral-300"
                            : "border-neutral-700 bg-[#17191d] text-neutral-500 hover:border-emerald-600 hover:text-emerald-300",
                        ].join(" ")}
                      >
                        <Globe className="h-3 w-3" />
                      </button>
                    </MinecraftTooltip>
                    {confirming ? (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteId(undefined);
                          void remove(blueprint.id);
                        }}
                        className="shrink-0 rounded-[4px] border border-red-800 bg-red-950 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-900"
                      >
                        Delete?
                      </button>
                    ) : (
                      <MinecraftTooltip
                        label={"Delete\nA published copy leaves the network too, votes and all"}
                      >
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(blueprint.id)}
                          onBlur={() => setConfirmDeleteId(undefined)}
                          aria-label={`Delete pocket ${blueprint.name}`}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-400 hover:border-red-500 hover:text-red-400"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </MinecraftTooltip>
                    )}
                    <MinecraftTooltip
                      label={"Place on your board\nDouble-clicking the row works too"}
                    >
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void place(blueprint.id)}
                        aria-label={`Place pocket ${blueprint.name} on the board`}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-400 enabled:hover:border-emerald-500 enabled:hover:text-emerald-300 disabled:opacity-50"
                      >
                        {isBusy ? (
                          <LoaderCircle className="h-3 w-3 animate-spin text-emerald-300" />
                        ) : (
                          <Download className="h-3 w-3" />
                        )}
                      </button>
                    </MinecraftTooltip>
                  </div>
                  {overwriteArmId === blueprint.id ? (
                    <div
                      data-tooltip-stop=""
                      className="mt-1 flex items-center gap-1.5 rounded-[4px] border border-amber-700 bg-amber-950/60 px-1.5 py-1"
                    >
                      <span className="min-w-0 flex-1 text-[11px] leading-tight text-amber-200">
                        Now click a pocket on the board. The save dialog opens with it.
                      </span>
                      <button
                        type="button"
                        onClick={onCancelOverwrite}
                        title="Cancel"
                        aria-label="Cancel overwriting"
                        className="shrink-0 rounded-[4px] p-0.5 text-amber-400 hover:text-amber-200"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : null}
                  {taggingId === blueprint.id ? (
                    <div
                      data-tooltip-stop=""
                      className="mt-1 flex flex-wrap items-center gap-1 rounded-[4px] border border-cyan-800 bg-[#17191d] px-1.5 py-1"
                    >
                      {tagDraft.map((tag) => (
                        <span
                          key={tag}
                          className="flex items-center gap-0.5 rounded-[3px] border border-neutral-600 bg-[#25272c] px-1 py-0.5 text-[10px] leading-3 text-neutral-200"
                        >
                          #{tag}
                          <button
                            type="button"
                            onClick={() =>
                              setTagDraft(tagDraft.filter((entry) => entry !== tag))
                            }
                            title={`Remove #${tag}`}
                            aria-label={`Remove tag ${tag}`}
                            className="text-neutral-500 hover:text-red-400"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </span>
                      ))}
                      <input
                        autoFocus
                        value={tagInput}
                        onChange={(event) => setTagInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            if (tagInput.trim()) {
                              addDraftTag();
                            } else {
                              closeTagEditor(blueprint.id);
                            }
                          }
                          if (event.key === "Escape") {
                            closeTagEditor(blueprint.id);
                          }
                          if (
                            event.key === "Backspace" &&
                            !tagInput &&
                            tagDraft.length > 0
                          ) {
                            setTagDraft(tagDraft.slice(0, -1));
                          }
                        }}
                        placeholder={tagDraft.length > 0 ? "add tag…" : "add tags…"}
                        className="h-5 min-w-[72px] flex-1 bg-transparent text-[11px] text-neutral-100 outline-none placeholder:text-neutral-600"
                      />
                      <button
                        type="button"
                        onClick={() => closeTagEditor(blueprint.id)}
                        className="shrink-0 rounded-[4px] border border-cyan-700 bg-cyan-950 px-1.5 py-0.5 text-[10px] text-cyan-300 hover:bg-cyan-900"
                      >
                        Done
                      </button>
                    </div>
                  ) : (
                    <TagChips
                      tags={blueprint.tags ?? []}
                      onTag={(tag) => setQuery(`#${tag}`)}
                      className="pl-0.5"
                    />
                  )}
                  {/* Facts as icon pairs, words in the row's hover card —
                      text rows kept truncating in a narrow column. */}
                  <div className="mt-0.5 flex items-center gap-2 pl-0.5 text-[10px] tabular-nums text-neutral-500">
                    <TierBadge tier={blueprint.highestTier} />
                    <span>{formatRelativeDate(blueprint.createdAt)}</span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <Boxes className="h-3 w-3" /> {blueprint.nodeCount + blueprint.storageCount}
                    </span>
                    {blueprint.machineCount > 0 ? (
                      <span className="flex shrink-0 items-center gap-0.5">
                        <Cog className="h-3 w-3" /> {blueprint.machineCount}
                      </span>
                    ) : null}
                    {blueprint.isPublic ? (
                      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-emerald-500">
                        <ArrowBigUp className="h-3 w-3" /> {blueprint.upvotes}
                        <Download className="h-3 w-3" /> {blueprint.downloads}
                      </span>
                    ) : null}
                  </div>
                  </MinecraftTooltip>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {iconEditId ? (
        <IconPicker
          title="Pick an icon"
          suggestions={iconSuggestionsFromStats(
            blueprints.find((entry) => entry.id === iconEditId)?.needs,
            blueprints.find((entry) => entry.id === iconEditId)?.outputs,
          )}
          onPick={(icon) => {
            setIconEditId(undefined);
            void update(iconEditId, { icon });
          }}
          onClear={
            blueprints.find((entry) => entry.id === iconEditId)?.icon
              ? () => {
                  setIconEditId(undefined);
                  void update(iconEditId, { icon: null });
                }
              : undefined
          }
          onClose={() => setIconEditId(undefined)}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// PUBLIC: the network shelf.
// ---------------------------------------------------------------------------

function PublicShelf({ scopeTabs }: { scopeTabs: ReactNode }) {
  const publicBlueprints = useBlueprintStore((state) => state.publicBlueprints);
  const publicSort = useBlueprintStore((state) => state.publicSort);
  const setPublicSort = useBlueprintStore((state) => state.setPublicSort);
  const setPublicSearch = useBlueprintStore((state) => state.setPublicSearch);
  const refreshPublic = useBlueprintStore((state) => state.refreshPublic);
  const loadMorePublic = useBlueprintStore((state) => state.loadMorePublic);
  const publicHasMore = useBlueprintStore((state) => state.publicHasMore);
  const hasLoadedPublic = useBlueprintStore((state) => state.hasLoadedPublic);
  const isPublicLoading = useBlueprintStore((state) => state.isPublicLoading);
  const publicError = useBlueprintStore((state) => state.publicError);
  const busyId = useBlueprintStore((state) => state.busyId);
  const vote = useBlueprintStore((state) => state.vote);
  const downloadPublic = useBlueprintStore((state) => state.downloadPublic);

  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);

  // First visit loads the shelf; afterwards only the settled search re-hits
  // the network — half-typed words never do.
  useEffect(() => {
    setPublicSearch(debouncedQuery.trim());
  }, [debouncedQuery, setPublicSearch]);
  useEffect(() => {
    if (!hasLoadedPublic && !isPublicLoading) {
      void refreshPublic();
    }
  }, [hasLoadedPublic, isPublicLoading, refreshPublic]);

  const place = async (blueprintId: string) => {
    const payload = await downloadPublic(blueprintId);
    if (payload) {
      placePayload(payload);
    }
  };

  // The tag dropdown offers whatever the loaded shelf wears, plus the active
  // tag itself so a hand-typed #tag still shows as selected.
  const activeTag = query.trim().startsWith("#") ? query.trim().slice(1).trim() : "";
  const tagOptions = [
    ...new Set([
      ...publicBlueprints.flatMap((blueprint) => blueprint.tags ?? []),
      ...(activeTag ? [activeTag] : []),
    ]),
  ].sort();

  return (
    <>
      <ControlsCard>
        {scopeTabs}
        <label className="mt-2 flex h-9 items-center gap-2 rounded-[4px] border border-neutral-700 bg-[#17191d] px-2 text-sm text-neutral-200 shadow-[inset_1px_1px_0_rgba(255,255,255,0.08)]">
          <Search className="h-4 w-4 text-neutral-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the network... (#tag)"
            className="min-w-0 flex-1 bg-transparent outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              title="Clear search"
              aria-label="Clear public pocket search"
              className="text-neutral-500 hover:text-neutral-200"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </label>
        {/* Tags left, sort right — the same two dropdowns as the Setups
            shelf, so no reaching for #tag in the search unless you want to. */}
        <div className="mt-2 flex items-center gap-1">
          <select
            value={activeTag}
            onChange={(event) => setQuery(event.target.value ? `#${event.target.value}` : "")}
            aria-label="Filter public pockets by tag"
            className="h-7 min-w-0 flex-1 rounded-[4px] border border-neutral-700 bg-[#17191d] px-1 text-xs text-neutral-100 outline-none"
          >
            <option value="">All tags</option>
            {tagOptions.map((tag) => (
              <option key={tag} value={tag}>
                #{tag}
              </option>
            ))}
          </select>
          <select
            value={publicSort}
            onChange={(event) => setPublicSort(event.target.value as PublicBlueprintSort)}
            aria-label="Sort public pockets"
            className="h-7 min-w-0 flex-1 rounded-[4px] border border-neutral-700 bg-[#17191d] px-1 text-xs text-neutral-100 outline-none"
          >
            {(Object.entries(PUBLIC_BLUEPRINT_SORTS) as Array<[PublicBlueprintSort, string]>).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ),
            )}
          </select>
        </div>
      </ControlsCard>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {publicError ? (
          <p className="mb-1.5 px-0.5 text-[11px] text-red-400">{publicError}</p>
        ) : null}

        {isPublicLoading && !hasLoadedPublic ? (
          <p className="flex items-center gap-1.5 px-0.5 pt-1 text-[11px] text-neutral-500">
            <LoaderCircle className="h-3 w-3 animate-spin" /> Loading the network…
          </p>
        ) : publicBlueprints.length === 0 && hasLoadedPublic && !publicError ? (
          <p className="px-0.5 pt-1 text-[11px] leading-relaxed text-neutral-500">
            Nothing published{query.trim() ? " that matches" : " yet"}. Save a pocket on the Mine
            shelf and hit its globe. Your build becomes the network&apos;s first.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-1">
              {publicBlueprints.map((blueprint) => (
                <PublicBlueprintRow
                  key={blueprint.id}
                  blueprint={blueprint}
                  isBusy={busyId === blueprint.id}
                  onPlace={() => void place(blueprint.id)}
                  onUpvote={() => void vote(blueprint.id, 1)}
                  onTag={(tag) => setQuery(`#${tag}`)}
                />
              ))}
            </ul>
            {publicHasMore ? (
              <button
                type="button"
                disabled={isPublicLoading}
                onClick={() => void loadMorePublic()}
                className="mt-1.5 flex h-7 w-full items-center justify-center gap-1.5 rounded-[4px] border border-neutral-700 bg-[#17191d] text-[11px] text-neutral-300 enabled:hover:border-neutral-500 disabled:opacity-50"
              >
                {isPublicLoading ? <LoaderCircle className="h-3 w-3 animate-spin" /> : null}
                Load more
              </button>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

function PublicBlueprintRow({
  blueprint,
  isBusy,
  onPlace,
  onUpvote,
  onTag,
}: {
  blueprint: BlueprintSummary;
  isBusy: boolean;
  onPlace: () => void;
  onUpvote: () => void;
  onTag: (tag: string) => void;
}) {
  return (
    <li
      className="group rounded-[4px] border border-neutral-700 bg-[#25272c] px-1.5 py-1 hover:border-neutral-500"
      // Double-click anywhere on the row downloads it onto the board — the
      // button stays as the single-click way. Dblclicks that land on the
      // buttons themselves don't count (an upvote toggled twice must not
      // also place the blueprint).
      onDoubleClick={(event) => {
        if (!isBusy && !(event.target as HTMLElement).closest("button")) {
          onPlace();
        }
      }}
    >
      {/* The whole row reveals the blueprint's story; the vote and place
          buttons explain themselves, tag chips stay silent. */}
      <MinecraftTooltip content={blueprintHoverCard(blueprint)}>
      <div className="flex items-center gap-1">
        <MinecraftTooltip
          label={
            blueprint.myVote === 1
              ? "Upvoted\nClick to take your vote back"
              : "Upvote\nLifts this pocket up the Top sort"
          }
        >
          <button
            type="button"
            onClick={onUpvote}
            aria-label={`Upvote ${blueprint.name}`}
            className={[
              "flex h-5 shrink-0 items-center gap-0.5 rounded-[4px] border px-1 text-[10px] font-bold tabular-nums",
              blueprint.myVote === 1
                ? "border-emerald-600 bg-emerald-500/15 text-emerald-300"
                : "border-neutral-700 bg-[#17191d] text-neutral-400 hover:border-emerald-600 hover:text-emerald-300",
            ].join(" ")}
          >
            <ArrowBigUp className="h-3 w-3" />
            {blueprint.upvotes}
          </button>
        </MinecraftTooltip>
        <EntryIconSlot icon={blueprint.icon} />
        <span className="block min-w-0 flex-1 truncate text-[13px] leading-5 text-neutral-100">
          {blueprint.name}
        </span>
        <MinecraftTooltip label={"Place on your board\nDouble-clicking the row works too"}>
          <button
            type="button"
            disabled={isBusy}
            onClick={onPlace}
            aria-label={`Download pocket ${blueprint.name}`}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-400 enabled:hover:border-emerald-500 enabled:hover:text-emerald-300 disabled:opacity-50"
          >
            {isBusy ? (
              <LoaderCircle className="h-3 w-3 animate-spin text-emerald-300" />
            ) : (
              <Download className="h-3 w-3" />
            )}
          </button>
        </MinecraftTooltip>
      </div>
      {/* Facts as icon pairs, words in the row's hover card. */}
      <div className="mt-0.5 flex items-center gap-2 pl-0.5 text-[10px] tabular-nums text-neutral-500">
        <TierBadge tier={blueprint.highestTier} />
        {blueprint.authorName ? (
          <span className="truncate text-neutral-400">{blueprint.authorName}</span>
        ) : null}
        <span className="shrink-0">
          {formatRelativeDate(blueprint.publishedAt ?? blueprint.createdAt)}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          <Boxes className="h-3 w-3" /> {blueprint.nodeCount + blueprint.storageCount}
        </span>
        {blueprint.machineCount > 0 ? (
          <span className="flex shrink-0 items-center gap-0.5">
            <Cog className="h-3 w-3" /> {blueprint.machineCount}
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          <Download className="h-3 w-3" /> {blueprint.downloads}
        </span>
      </div>
      <TagChips tags={blueprint.tags ?? []} onTag={onTag} className="pl-0.5" />
      </MinecraftTooltip>
    </li>
  );
}

/** Centre of what the payload shows at its own top level. */
function payloadCentre(payload: BoardClipboardPayload): { x: number; y: number } | undefined {
  const capturedPockets = new Set(payload.pockets.map((pocket) => pocket.id));
  const atRoot = (pocketId?: string) => pocketId === undefined || !capturedPockets.has(pocketId);
  const positions = [
    ...payload.nodes.filter((node) => atRoot(node.pocketId)).map((node) => node.position),
    ...payload.storages
      .filter((storage) => atRoot(storage.pocketId))
      .map((storage) => storage.position),
    ...payload.annotations
      .filter((annotation) => atRoot(annotation.pocketId))
      .map((annotation) => annotation.position),
    ...payload.pockets
      .filter((pocket) => atRoot(pocket.parentPocketId))
      .map((pocket) => pocket.position),
  ];
  if (positions.length === 0) {
    return undefined;
  }

  return {
    x: positions.reduce((sum, position) => sum + position.x, 0) / positions.length,
    y: positions.reduce((sum, position) => sum + position.y, 0) / positions.length,
  };
}


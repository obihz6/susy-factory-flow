"use client";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Factory,
  Search,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { PointerEvent, RefObject, WheelEvent } from "react";
import { DEFAULT_DATASET_MANIFEST_URL } from "@/lib/datasets";
import {
  getRecipeDatasetRecipe,
  queryRecipeDatasetResources,
  queryRecipeDatasetRecipes,
  type RecipeDatasetResourceQueryResult,
  type RecipeDatasetQueryResult,
  type RecipeMapSelection,
} from "@/lib/datasets/browser-loader";
import type {
  RecipeQueryClause,
  RecipeQuerySideOp,
} from "@/lib/datasets/recipe-query";
import type { DatasetResourceIndexEntry, RecipeSummary } from "@/lib/datasets/types";
import { resourceLabel, resourceMatchesInput } from "@/lib/model";
import { applyRecipeInputOverrides } from "@/lib/model/recipe-input-overrides";
import {
  buildSearchVocabulary,
  matchSearchEntry,
  parseSearchQuery,
  resolveSearchPhases,
  splitSearchTokens,
  type SearchCorrection,
  type SearchPhase,
} from "@/lib/search";
import { useFactoryStore } from "@/store/factory-store";
import { POWER_EU_CLAUSE_ID } from "@/lib/power/power-search";
import { useDesignStore } from "@/store/design-store";
import { leaveWelcomeTab, readWelcomeTabState } from "@/lib/tour/welcome-tab";
import type { RecipeInputPicks, TierFilter } from "@/store/factory-store";
import type { Recipe, ResourceAmount } from "@/lib/model/types";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { OPEN_SETUPS_EVENT } from "@/lib/setups-tab";
import { OPEN_SIDEBAR_TAB_EVENT, takePendingSidebarTab } from "@/lib/sidebar-tab";
import { writeWorkspaceView } from "@/lib/workspace-view";
import { useIsCompactViewport } from "@/lib/compact-view";
import { isEchoOfTouch } from "@/lib/pointer-kind";
import { isFromBrowseMenu, useBrowseMenu } from "./browse-menu";
import { ControlsCard } from "./ControlsCard";
import { ChevronIcon } from "./PanelDrawer";
import { BlueprintPanel } from "./BlueprintPanel";
import { SetupsPanel } from "./SetupsPanel";
import { MinecraftTooltip } from "./nei/MinecraftTooltip";
import { isSwatchFluid, ResourceIcon, spriteArtPixels } from "./nei/ResourceIcon";
import {
  RecipeSearchOverlay,
  type RecipeMapChip,
  type StencilClause,
} from "./RecipeSearchOverlay";

// The preview helpers used to live here; they moved out with the overlay and
// keep their old import path for everyone already using it.
export {
  contextualizePreviewRecipe,
  summaryToPreviewRecipe,
  type PreviewContextResource,
} from "./recipe-preview";

const RECIPE_QUERY_LIMIT = 120;

const RESOURCE_DEFAULT_PAGE_SIZE = 6;
/**
 * The one way results are drawn: a dense grid of tiles, the icon on top and a
 * quiet gray name under it. It replaced a list view (name plus a mod/recipe-
 * count line nobody asked for, one item per row) and a bare grid view (no
 * names at all) - as many items as the column holds without losing the name
 * (Jack, 2026-08-31). Four columns in the standard panel; two short lines of
 * name, then the hover tooltip carries the rest.
 */
// The height is exactly what the tile holds - a 44px icon cell + two 10px
// name lines + borders - so a wrapped second line is never clipped. Fluid art
// deliberately stays at the previous 40px size inside the bigger cell: a
// solid square at full cell size out-shouts every item around it.
const RESOURCE_TILE_HEIGHT = 66;
const RESOURCE_TILE_MIN_WIDTH = 58;
const RESOURCE_TILE_GAP = 2;
const RESOURCE_GRID_CELL = 56;
const RESOURCE_GRID_GAP = 4;
/**
 * How the art sits in a grid cell.
 *
 * A rendered sprite carries a wide transparent margin: measured across the
 * dataset's textures, the art itself covers a median of 44% of its PNG and as
 * little as 19% on the small piles. Drawn honestly that reads as a stamp
 * floating in a box. So the icon fills the cell, draws well past its own edges,
 * and the cell crops the margin away - big art, same cell.
 *
 * 1.4 puts the median sprite slightly over the cell edge, which is the point of
 * it. The handful of sprites that fill 59% of their PNG do lose their corners
 * here; that is the trade, and much past this even ordinary items start to clip.
 */
const RESOURCE_GRID_ART = "!h-full !w-full scale-[1.4]";
// The pager measures 28px (24 + 4 margin); the extra is slack so a fractional
// device pixel can never clip the last row of tiles.
const RESOURCE_PAGER_HEIGHT = 31;
/** One mouse notch is 100 on most platforms, so one notch is one page. */
const RESOURCE_WHEEL_PAGE_DELTA = 80;
/** Whether the filter block under the search box is folded away. */
const RESOURCE_FILTERS_STORAGE_KEY = "gtnh-factory-flow.resource-filters.v1";
/** The machine chips' multi-select: which maps' recipes the search shows. */
const MAP_SELECTION_STORAGE_KEY = "gtnh-factory-flow.machine-map-selection.v1";

type ResourceSortMode = "relevance" | "popular" | "name" | "mod" | "made" | "uses";

/**
 * The one question the list is answering.
 *
 * Six answers, one at a time, because that is how they are actually used: nobody
 * asks for the fluids a bee makes, they ask for what bees make. Splitting the
 * six across a kind row and a source row made it look like they combined, and
 * the combinations were either the same list or nothing.
 *
 * "Board" is answered from the project rather than the server: the cards are
 * already in memory, and nothing the dataset knows could answer it anyway.
 */
type ResourceFilterMode = "all" | "item" | "fluid" | "board" | "plants" | "bees";

const RESOURCE_FILTER_CHOICES: Array<{
  mode: ResourceFilterMode;
  label: string;
  title: string;
}> = [
  { mode: "all", label: "All", title: "Everything" },
  { mode: "item", label: "Items", title: "Items" },
  { mode: "fluid", label: "Fluids", title: "Fluids" },
  { mode: "board", label: "Placed", title: "On this board" },
  { mode: "plants", label: "Plants", title: "Grown" },
  { mode: "bees", label: "Bees", title: "From bees" },
];

/** The dataset query only knows kinds and sources; this splits the choice up. */
function resourceFilterKind(filter: ResourceFilterMode): "item" | "fluid" | undefined {
  return filter === "item" || filter === "fluid" ? filter : undefined;
}

function resourceFilterSource(filter: ResourceFilterMode): "plants" | "bees" | undefined {
  return filter === "plants" || filter === "bees" ? filter : undefined;
}

/**
 * What a cell with no room for words says when you hover it.
 *
 * The same two lines a list row prints - the name, then where it came from and
 * how many recipes touch it - followed by whatever the dataset itself has to say
 * about the thing. First line white, the rest blue, like every other tooltip in
 * the app.
 */
function resourceTooltipLines(resource: IndexedResource): string[] {
  const subtitle = [
    getResourceModLabel(resource),
    resource.recipeCount > 0 ? `${resource.recipeCount} recipes` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  const name = resourceLabel(resource);
  return [
    name,
    subtitle,
    ...(resource.tooltip ?? []).filter((line) => line.trim() && line !== name),
  ].filter(Boolean);
}

/** Mod is the id prefix ("gregtech:..."); bare fluid ids group as "fluids". */
function getResourceModLabel(resource: { id: string; kind: string }): string {
  if (resource.id === POWER_EU_CLAUSE_ID) {
    return "generators";
  }
  const colon = resource.id.indexOf(":");
  if (colon > 0) {
    return resource.id.slice(0, colon);
  }
  return resource.kind === "fluid" ? "fluids" : "other";
}

/**
 * The item search's power row: typing "power", "energy" or "eu" puts
 * Power (EU) first in the list. Left click asks who makes it (every
 * generator), right click who takes it (the parasitic machines) - the same
 * two questions every item row answers.
 */
function powerSearchRow(query: string): IndexedResource | undefined {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length < 2) {
    return undefined;
  }
  if (!("power".startsWith(trimmed) || "energy".startsWith(trimmed) || trimmed === "eu")) {
    return undefined;
  }
  return {
    kind: "fluid",
    id: POWER_EU_CLAUSE_ID,
    displayName: "Power (EU)",
    recipeCount: 0,
    dominantColor: "#d99a2b",
  } as IndexedResource;
}
const RECIPE_QUERY_CACHE_TTL_MS = 90_000;
const RESOURCE_QUERY_CACHE_TTL_MS = 90_000;
const RESOURCE_SEARCH_DEBOUNCE_MS = 125;
const RECIPE_SEARCH_DEBOUNCE_MS = 200;

interface RecipeBrowserProps {
  onLoadDatasetVersion: (versionId: string) => void;
}

export function RecipeBrowser({ onLoadDatasetVersion }: RecipeBrowserProps) {
  const dataset = useFactoryStore((state) => state.dataset);
  const datasetManifest = useFactoryStore((state) => state.datasetManifest);
  const datasetManifestUrl = useFactoryStore((state) => state.datasetManifestUrl);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const isDatasetLoading = useFactoryStore((state) => state.isDatasetLoading);
  const projectRecipes = useFactoryStore((state) => state.project.recipes);
  const recipeSearch = useFactoryStore((state) => state.recipeSearch);
  const maxTier = useFactoryStore((state) => state.maxTierFilter);
  const browserResource = useFactoryStore((state) => state.recipeBrowserResource);
  const browserMode = useFactoryStore((state) => state.recipeBrowserMode);
  const browserSeed = useFactoryStore((state) => state.recipeBrowserSeed);
  const refactorNodeId = useFactoryStore((state) => state.recipeBrowserRefactorNodeId);
  const seedNonce = useFactoryStore((state) => state.recipeBrowserSeedNonce);
  const selectedRecipeId = useFactoryStore((state) => state.selectedRecipeId);
  const setRecipeSearch = useFactoryStore((state) => state.setRecipeSearch);
  const setHighlightSearch = useFactoryStore((state) => state.setHighlightSearch);
  const setMaxTier = useFactoryStore((state) => state.setMaxTierFilter);
  const browseResource = useFactoryStore((state) => state.browseResource);
  const clearResourceBrowser = useFactoryStore((state) => state.clearResourceBrowser);
  const selectRecipe = useFactoryStore((state) => state.selectRecipe);
  const addNodeForRecipe = useFactoryStore((state) => state.addNodeForRecipeObject);
  const addConnectedNodeForRecipe = useFactoryStore(
    (state) => state.addConnectedNodeForRecipeObject,
  );
  const refactorNodeWithRecipe = useFactoryStore((state) => state.refactorNodeWithRecipe);
  const beginRecipeAdd = useFactoryStore((state) => state.beginRecipeAdd);
  const resolveRecipeAdd = useFactoryStore((state) => state.resolveRecipeAdd);
  const failRecipeAdd = useFactoryStore((state) => state.failRecipeAdd);
  const [recipePage, setRecipePage] = useState(0);
  const [recipeBookSearch, setRecipeBookSearch] = useState("");
  const [filteredRecipes, setFilteredRecipes] = useState<RecipeSummary[]>([]);
  const [recipeTotal, setRecipeTotal] = useState(0);
  const [recipeHasMore, setRecipeHasMore] = useState(false);
  const [availableRecipeMaps, setAvailableRecipeMaps] = useState<string[]>([]);
  const [resourcePage, setResourcePage] = useState(0);
  const [resourcePageSize, setResourcePageSize] = useState(RESOURCE_DEFAULT_PAGE_SIZE);
  const [resourceResults, setResourceResults] = useState<IndexedResource[]>([]);
  const [resourceTotal, setResourceTotal] = useState(0);
  const [resourceMod, setResourceMod] = useState("");
  // Popular is the resting default: with nothing typed it shows what players
  // actually build. A typed query still ranks name relevance first server-side,
  // so the sort only decides the untyped list and ties.
  const [resourceSort, setResourceSort] = useState<ResourceSortMode>("popular");
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [resourceFilter, setResourceFilter] = useState<ResourceFilterMode>("all");
  // The machine chips' selection. Absent means everything is selected (the
  // default); "exclude" carries the unselected chips, "include" the selected
  // ones. Stored rather than derived so a map unselected on one search stays
  // unselected on the next, even across searches where it never appears.
  const [mapSelection, setMapSelection] = useState<RecipeMapSelection | undefined>(undefined);
  // The master switch: what the whole left panel is FOR right now — finding
  // items to build with, stamping saved blueprints, or browsing the network's
  // shared setups. One at a time, full column each; the old bottom-strip
  // library never had room to breathe.
  // A request that arrived before this column was mounted (a phone's drawer is
  // unmounted while closed) is waiting in module state, so the tab it asked for
  // is collected here as well as by the listener below.
  const [sidebarMode, setSidebarMode] = useState<"items" | "blueprints" | "setups">(
    () => takePendingSidebarTab() ?? "items",
  );
  const [resourceMods, setResourceMods] = useState<Array<{ id: string; count: number }>>([]);
  const [resourceSearchOutcome, setResourceSearchOutcome] = useState<SearchOutcome>(EXACT_SEARCH);
  const [resourceQueryLoading, setResourceQueryLoading] = useState(false);
  const [resourceQueryError, setResourceQueryError] = useState<string | undefined>();
  const [recipeMapIcons, setRecipeMapIcons] = useState<Record<string, DatasetResourceIndexEntry>>(
    {},
  );
  const [recipeMapCounts, setRecipeMapCounts] = useState<Record<string, number>>({});
  // The stencil's edits, keyed by the browse that seeded them: a NEW browse
  // (different item or direction) starts the stencil over, while edits made on
  // the open search survive its own refetches. Held as edits-plus-key rather
  // than plain state so a fresh browse can never fire a query against the
  // previous item's conditions.
  const [stencilEdits, setStencilEdits] = useState<
    | {
        key: string;
        clauses: StencilClause[];
        takesOp: RecipeQuerySideOp;
        makesOp: RecipeQuerySideOp;
      }
    | undefined
  >(undefined);
  const [recipeQueryLoading, setRecipeQueryLoading] = useState(false);
  const [recipeQueryError, setRecipeQueryError] = useState<string | undefined>();
  const recipeQueryCacheRef = useRef<Map<string, RecipeQueryCacheEntry>>(new Map());
  const resourceQueryCacheRef = useRef<Map<string, ResourceQueryCacheEntry>>(new Map());
  const pendingRecipePrefetchesRef = useRef<Set<string>>(new Set());
  const debouncedRecipeSearch = useDebouncedValue(recipeSearch, RESOURCE_SEARCH_DEBOUNCE_MS);
  const debouncedRecipeBookSearch = useDebouncedValue(recipeBookSearch, RECIPE_SEARCH_DEBOUNCE_MS);

  const resourceWheelRef = useRef(0);
  const onBoard = resourceFilter === "board";
  // The board filter is answered here, from the cards themselves, so it needs no
  // request and cannot go stale. Everything else comes back from the server.
  const boardResults = useBoardResourceResults(onBoard, {
    query: debouncedRecipeSearch.trim(),
    mod: resourceMod,
    sort: resourceSort,
    offset: resourcePage * resourcePageSize,
    limit: resourcePageSize,
  });
  const powerRow =
    !onBoard && resourceFilter === "all" && resourcePage === 0
      ? powerSearchRow(debouncedRecipeSearch)
      : undefined;
  const displayedResources = onBoard
    ? boardResults.resources
    : powerRow
      ? [powerRow, ...resourceResults]
      : resourceResults;
  const displayedTotal = onBoard ? boardResults.total : resourceTotal;
  const displayedMods = onBoard ? boardResults.mods : resourceMods;
  const displayedOutcome = onBoard ? boardResults.outcome : resourceSearchOutcome;
  const resourcePageCount = Math.max(
    1,
    Math.ceil(displayedTotal / Math.max(1, resourcePageSize)),
  );

  /**
   * The wheel turns the page, anywhere in the column.
   *
   * The list does not scroll - it is paged, a screenful at a time - so a wheel
   * over it did nothing at all, which reads as a dead panel. Notches are
   * accumulated rather than acted on one for one, so a trackpad flick moves a
   * page or two instead of forty.
   */
  const handleResourceWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (!event.deltaY) {
        return;
      }
      // Turning back the other way starts over, or the notches left over from
      // scrolling down would have to be spent before the page moved up.
      if (Math.sign(event.deltaY) !== Math.sign(resourceWheelRef.current)) {
        resourceWheelRef.current = 0;
      }
      resourceWheelRef.current += event.deltaY;
      const steps = Math.trunc(resourceWheelRef.current / RESOURCE_WHEEL_PAGE_DELTA);
      if (steps === 0) {
        return;
      }
      resourceWheelRef.current -= steps * RESOURCE_WHEEL_PAGE_DELTA;
      setResourcePage((page) => clamp(page + steps, 0, resourcePageCount - 1));
    },
    [resourcePageCount],
  );

  // Buttons far from this column ("My setups" in the account menu, the share
  // dialog's shelf link) can land the sidebar on the Setups shelf.
  useEffect(() => {
    const openSetups = () => setSidebarMode("setups");
    window.addEventListener(OPEN_SETUPS_EVENT, openSetups);
    return () => window.removeEventListener(OPEN_SETUPS_EVENT, openSetups);
  }, []);

  // And the general form of the same thing: the guided tour walks all three
  // tabs, so it needs to be able to name one.
  useEffect(() => {
    const openTab = () => {
      const tab = takePendingSidebarTab();
      if (tab) {
        setSidebarMode(tab);
      }
    };
    window.addEventListener(OPEN_SIDEBAR_TAB_EVENT, openTab);
    return () => window.removeEventListener(OPEN_SIDEBAR_TAB_EVENT, openTab);
  }, []);

  // Publish the settled query to the canvas. Highlighting every node, storage and
  // edge against a half-typed word is wasted work the user never sees, so the
  // board only reacts once typing pauses.
  useEffect(() => {
    setHighlightSearch(debouncedRecipeSearch);
  }, [debouncedRecipeSearch, setHighlightSearch]);

  const activeResource = useMemo(() => {
    if (!browserResource) {
      return undefined;
    }

    return {
      ...browserResource,
      recipeCount: 0,
      anchorNodeId: browserResource.anchorNodeId,
    };
  }, [browserResource]);

  const recipeMaps = useMemo(
    () => availableRecipeMaps.filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [availableRecipeMaps],
  );

  const recipeMapTabs = useMemo(
    () => buildRecipeMapTabs(recipeMaps, recipeMapIcons),
    [recipeMapIcons, recipeMaps],
  );

  const recipeMapChips = useMemo<RecipeMapChip[]>(
    () =>
      recipeMapTabs.map((tab) => ({
        ...tab,
        count: recipeMapCounts[tab.id],
        selected: isMapSelectedIn(mapSelection, tab.id),
      })),
    [mapSelection, recipeMapCounts, recipeMapTabs],
  );

  // The All chip reads from what is on screen: lit when every listed chip is
  // selected, whatever out-of-view maps the stored selection also carries.
  const allRecipeMapsSelected = useMemo(
    () => recipeMaps.every((recipeMap) => isMapSelectedIn(mapSelection, recipeMap)),
    [mapSelection, recipeMaps],
  );

  // Opening the search seeds the stencil with exactly the question the click
  // asked: left click = one output condition, right click = one input - or,
  // for a refactor, every input and output of the card being replaced. Edits
  // made after that carry the browse's key and win while it stays open.
  const browseKey = browserResource
    ? [
        // The nonce makes every refactor press a fresh browse: the card's
        // settings may have changed, and old stencil edits must not
        // resurrect over the new seed.
        refactorNodeId ? `refactor:${refactorNodeId}:${seedNonce}` : "",
        browserResource.kind,
        browserResource.id,
        browserMode,
      ].join("|")
    : "";
  const seededStencil = useMemo<StencilClause[]>(() => {
    if (!browserResource) {
      return [];
    }
    if (browserSeed?.length) {
      return browserSeed.map((clause) => ({ ...clause }));
    }
    return [
      {
        role: browserMode === "uses" ? "takes" : "makes",
        kind: browserResource.kind,
        id: browserResource.id,
        displayName: browserResource.displayName,
        iconPath: browserResource.iconPath,
        iconAtlas: browserResource.iconAtlas,
        dominantColor: browserResource.dominantColor ?? browserResource.iconAtlas?.dominantColor,
      },
    ];
  }, [browserMode, browserResource, browserSeed]);
  const editsApply = stencilEdits?.key === browseKey;
  const stencilClauses = editsApply ? stencilEdits.clauses : seededStencil;
  // ALL is the default reading: a fresh stencil holds one condition, where
  // all and any agree, and every added condition is usually meant as "and".
  const takesOp = editsApply ? stencilEdits.takesOp : "all";
  const makesOp = editsApply ? stencilEdits.makesOp : "all";
  const queryClauses = useMemo<RecipeQueryClause[]>(
    () => stencilClauses.map(({ role, kind, id }) => ({ role, kind, id })),
    [stencilClauses],
  );

  const changeStencilClauses = useCallback(
    (clauses: StencilClause[]) => {
      setStencilEdits({ key: browseKey, clauses, takesOp, makesOp });
      setRecipePage(0);
    },
    [browseKey, makesOp, takesOp],
  );
  const changeTakesOp = useCallback(
    (op: RecipeQuerySideOp) => {
      setStencilEdits({ key: browseKey, clauses: stencilClauses, takesOp: op, makesOp });
      setRecipePage(0);
    },
    [browseKey, makesOp, stencilClauses],
  );
  const changeMakesOp = useCallback(
    (op: RecipeQuerySideOp) => {
      setStencilEdits({ key: browseKey, clauses: stencilClauses, takesOp, makesOp: op });
      setRecipePage(0);
    },
    [browseKey, stencilClauses, takesOp],
  );
  const swapStencilSides = useCallback(() => {
    setStencilEdits({
      key: browseKey,
      clauses: stencilClauses.map((clause) => ({
        ...clause,
        role: clause.role === "takes" ? "makes" : "takes",
      })),
      takesOp: makesOp,
      makesOp: takesOp,
    });
    setRecipePage(0);
  }, [browseKey, makesOp, stencilClauses, takesOp]);

  const recipeTotalAcrossMaps = useMemo(() => {
    const counted = Object.values(recipeMapCounts).reduce((sum, count) => sum + count, 0);
    return counted > 0 ? counted : recipeTotal;
  }, [recipeMapCounts, recipeTotal]);
  const activeRecipeQuery = activeResource
    ? debouncedRecipeBookSearch.trim()
    : debouncedRecipeSearch.trim();

  const selectedDatasetVersion = useMemo(
    () => datasetManifest?.versions.find((entry) => entry.id === selectedDatasetVersionId),
    [datasetManifest?.versions, selectedDatasetVersionId],
  );

  const getRecipeQueryKey = useCallback(
    (selection: RecipeMapSelection | undefined, page: number) =>
      selectedDatasetVersion
        ? getRecipeQueryCacheKey({
            versionId: getDatasetVersionCacheKey(selectedDatasetVersion),
            query: activeRecipeQuery,
            resource: activeResource,
            mode: browserMode,
            clauses: queryClauses,
            takesOp,
            makesOp,
            mapSelection: selection,
            maxTier,
            offset: page * RECIPE_QUERY_LIMIT,
            limit: RECIPE_QUERY_LIMIT,
          })
        : "",
    [
      activeRecipeQuery,
      activeResource,
      browserMode,
      makesOp,
      maxTier,
      queryClauses,
      selectedDatasetVersion,
      takesOp,
    ],
  );

  const getResourceQueryKey = useCallback(
    (page: number) =>
      selectedDatasetVersion
        ? getResourceQueryCacheKey({
            versionId: getDatasetVersionCacheKey(selectedDatasetVersion),
            query: debouncedRecipeSearch.trim(),
            offset: page * resourcePageSize,
            limit: resourcePageSize,
            filter: resourceFilter,
            mod: resourceMod,
            sort: resourceSort,
          })
        : "",
    [
      debouncedRecipeSearch,
      resourceFilter,
      resourceMod,
      resourcePageSize,
      resourceSort,
      selectedDatasetVersion,
    ],
  );

  // The filter fold's saved state is applied after mount (deferred) so the SSR
  // markup and first client render agree. Folded is the saved state, never the default,
  // so nobody meets this column with its filters already hidden.
  useEffect(() => {
    if (window.localStorage.getItem(RESOURCE_FILTERS_STORAGE_KEY) === "folded") {
      return deferStateUpdate(() => setFiltersOpen(false));
    }
    return undefined;
  }, []);

  const changeFiltersOpen = useCallback((open: boolean) => {
    setFiltersOpen(open);
    window.localStorage.setItem(RESOURCE_FILTERS_STORAGE_KEY, open ? "open" : "folded");
  }, []);

  // Everything selected is the default; a trimmed selection is a saved
  // preference, applied deferred for the same SSR-agreement reason as the
  // view above.
  useEffect(() => {
    const stored = readStoredMapSelection();
    if (stored) {
      return deferStateUpdate(() => setMapSelection(stored));
    }
    return undefined;
  }, []);

  const changeMapSelection = useCallback((selection: RecipeMapSelection | undefined) => {
    setMapSelection(selection);
    setRecipePage(0);
    if (selection) {
      window.localStorage.setItem(MAP_SELECTION_STORAGE_KEY, JSON.stringify(selection));
    } else {
      window.localStorage.removeItem(MAP_SELECTION_STORAGE_KEY);
    }
  }, []);

  const toggleRecipeMap = useCallback(
    (recipeMap: string) => {
      changeMapSelection(toggledMapSelection(mapSelection, recipeMap, recipeMaps));
    },
    [changeMapSelection, mapSelection, recipeMaps],
  );

  // The All chip is select-all / select-none: lit, a click clears the board;
  // unlit, a click selects everything (and forgets stored exclusions).
  const toggleAllRecipeMaps = useCallback(() => {
    changeMapSelection(allRecipeMapsSelected ? { mode: "include", maps: [] } : undefined);
  }, [allRecipeMapsSelected, changeMapSelection]);

  // A pointer over a chip is probably about to toggle it, so the answer that
  // toggle would show starts travelling now.
  const prefetchRecipeMapToggle = useCallback(
    (recipeMap: string) => {
      if (!selectedDatasetVersion) {
        return;
      }

      const query = activeRecipeQuery;
      // Map chips only exist inside the book, which only opens on a resource.
      if (!activeResource) {
        return;
      }

      const nextSelection = toggledMapSelection(mapSelection, recipeMap, recipeMaps);
      const cacheKey = getRecipeQueryKey(nextSelection, 0);
      if (
        !cacheKey ||
        getCachedRecipeQuery(recipeQueryCacheRef.current, cacheKey) ||
        pendingRecipePrefetchesRef.current.has(cacheKey)
      ) {
        return;
      }

      pendingRecipePrefetchesRef.current.add(cacheKey);
      void queryRecipeDatasetRecipes(
        datasetManifestUrl ?? DEFAULT_DATASET_MANIFEST_URL,
        selectedDatasetVersion,
        {
          query,
          resource: activeResource
            ? {
                kind: activeResource.kind,
                id: activeResource.id,
              }
            : undefined,
          mode: browserMode,
          clauses: queryClauses.length > 0 ? queryClauses : undefined,
          takesOp,
          makesOp,
          allMaps: true,
          mapSelection: nextSelection,
          maxTier,
          offset: 0,
          limit: RECIPE_QUERY_LIMIT,
        },
      )
        .then((result) => {
          setCachedRecipeQuery(recipeQueryCacheRef.current, cacheKey, result);
          trimRecipeQueryCache(recipeQueryCacheRef.current);
        })
        .catch(() => {
          // Prefetch is opportunistic; the real toggle will surface real errors.
        })
        .finally(() => {
          pendingRecipePrefetchesRef.current.delete(cacheKey);
        });
    },
    [
      activeResource,
      activeRecipeQuery,
      browserMode,
      datasetManifestUrl,
      getRecipeQueryKey,
      makesOp,
      mapSelection,
      maxTier,
      queryClauses,
      recipeMaps,
      selectedDatasetVersion,
      takesOp,
    ],
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

  const getFullRecipe = useCallback(
    async (recipeId: string, preferDataset = false): Promise<Recipe> => {
      const projectRecipe = projectRecipes.find((recipe) => recipe.id === recipeId);
      if (!preferDataset && projectRecipe && recipeHasRenderableIcons(projectRecipe)) {
        return projectRecipe;
      }
      if (!selectedDatasetVersion) {
        throw new Error("No dataset version is selected.");
      }

      return getRecipeDatasetRecipe(
        datasetManifestUrl ?? DEFAULT_DATASET_MANIFEST_URL,
        selectedDatasetVersion,
        recipeId,
      );
    },
    [datasetManifestUrl, projectRecipes, selectedDatasetVersion],
  );

  const handleAddRecipe = useCallback(
    async (
      recipeSummary: RecipeSummary,
      machineHandlerId?: string,
      inputPicks?: RecipeInputPicks,
    ) => {
      const currentState = useFactoryStore.getState();
      const currentResource = currentState.recipeBrowserResource
        ? {
            ...currentState.recipeBrowserResource,
            recipeCount: 0,
            anchorNodeId: currentState.recipeBrowserResource.anchorNodeId,
          }
        : activeResource;
      const currentMode = currentState.recipeBrowserResource
        ? currentState.recipeBrowserMode
        : browserMode;
      // A pick made while Welcome covers the board would land on whatever tab
      // is hidden underneath it, unseen. It gets a fresh blank tab instead, so
      // the card arrives on a board the player is actually looking at. Anchor
      // and refactor targets are cards of the covered plan, so they are
      // dropped along with it - on a blank board there is nothing to wire to
      // or replace.
      const welcomeCovered = readWelcomeTabState().active;
      if (welcomeCovered) {
        await useDesignStore.getState().addDesign();
        leaveWelcomeTab();
      }
      const currentRefactorNodeId = welcomeCovered
        ? undefined
        : currentState.recipeBrowserRefactorNodeId;
      const anchorNodeId = welcomeCovered ? undefined : currentResource?.anchorNodeId;
      const contextResource = getRecipeAddContextResource(
        currentResource,
        currentMode,
        recipeSummary,
      );
      // The book closes on the press, not on the response. A click that seems
      // to do nothing gets clicked again; the chip over the board carries the
      // wait instead, and the apology when the fetch fails.
      clearResourceBrowser();
      const pendingId = beginRecipeAdd(recipeSummary.name);
      try {
        const recipe = await getFullRecipe(recipeSummary.id, Boolean(currentResource));
        if (currentRefactorNodeId) {
          // The refactor's landing: the pick replaces the card it came from.
          refactorNodeWithRecipe(currentRefactorNodeId, recipe, { machineHandlerId });
        } else if (anchorNodeId && contextResource) {
          // Opened from a card's port: the pick lands beside that card and
          // wires itself to the clicked resource.
          addConnectedNodeForRecipe(recipe, anchorNodeId, contextResource, {
            machineHandlerId,
            inputPicks,
          });
        } else {
          addNodeForRecipe(recipe, contextResource, {
            machineHandlerId,
            inputPicks,
            focusCamera: true,
          });
        }
        resolveRecipeAdd(pendingId);
      } catch (error) {
        failRecipeAdd(
          pendingId,
          error instanceof Error ? error.message : "The recipe could not be loaded.",
        );
      }
    },
    [
      activeResource,
      addConnectedNodeForRecipe,
      addNodeForRecipe,
      beginRecipeAdd,
      browserMode,
      clearResourceBrowser,
      failRecipeAdd,
      getFullRecipe,
      refactorNodeWithRecipe,
      resolveRecipeAdd,
    ],
  );

  const prefetchRecipeAdd = useCallback(
    (recipeId: string) => {
      // Warm the session cache while the pointer is still hovering, so the
      // plus button usually has its recipe before it is pressed. A failure
      // here is nothing: the click fetches again and reports its own.
      void getFullRecipe(recipeId, true).catch(() => undefined);
    },
    [getFullRecipe],
  );

  useEffect(() => {
    return deferStateUpdate(() => setResourcePage(0));
  }, [
    debouncedRecipeSearch,
    resourceFilter,
    resourceMod,
    resourceSort,
    selectedDatasetVersion?.id,
  ]);

  // A filter or search change can empty the selected mod's scope; drop a stale pick.
  useEffect(() => {
    if (resourceMod && resourceMods.length > 0 && !resourceMods.some((m) => m.id === resourceMod)) {
      return deferStateUpdate(() => setResourceMod(""));
    }
    return undefined;
  }, [resourceMod, resourceMods]);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(resourceTotal / resourcePageSize) - 1);
    if (resourcePage > maxPage) {
      return deferStateUpdate(() => setResourcePage(maxPage));
    }
    return undefined;
  }, [resourcePage, resourcePageSize, resourceTotal]);

  useEffect(() => {
    // The board's own resources are answered from memory, below: no request.
    if (!selectedDatasetVersion || onBoard) {
      return deferStateUpdate(() => {
        setResourceResults([]);
        setResourceTotal(0);
        setResourceQueryLoading(false);
        setResourceQueryError(undefined);
      });
    }

    const query = debouncedRecipeSearch.trim();
    const cacheKey = getResourceQueryKey(resourcePage);
    const cached = getCachedResourceQuery(resourceQueryCacheRef.current, cacheKey);
    if (cached) {
      return deferStateUpdate(() => {
        setResourceResults(cached.resources);
        setResourceTotal(cached.total);
        setResourceMods(cached.mods ?? []);
        setResourceSearchOutcome(searchOutcomeOf(cached));
        setResourceQueryLoading(false);
        setResourceQueryError(undefined);
      });
    }

    const controller = new AbortController();
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setResourceQueryLoading(true);
        setResourceQueryError(undefined);
      }
    });

    queryRecipeDatasetResources(
      datasetManifestUrl ?? DEFAULT_DATASET_MANIFEST_URL,
      selectedDatasetVersion,
      {
        query,
        offset: resourcePage * resourcePageSize,
        limit: resourcePageSize,
        kind: resourceFilterKind(resourceFilter),
        mod: resourceMod || undefined,
        sort: resourceSort,
        source: resourceFilterSource(resourceFilter),
      },
      { signal: controller.signal },
    )
      .then((result) => {
        if (cancelled) {
          return;
        }
        setCachedResourceQuery(resourceQueryCacheRef.current, cacheKey, result);
        trimResourceQueryCache(resourceQueryCacheRef.current);
        setResourceResults(result.resources);
        setResourceTotal(result.total);
        setResourceMods(result.mods ?? []);
        setResourceSearchOutcome(searchOutcomeOf(result));
        setResourceQueryLoading(false);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setResourceResults([]);
        setResourceTotal(0);
        setResourceQueryError(error instanceof Error ? error.message : "Resource query failed.");
        setResourceQueryLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    datasetManifestUrl,
    getResourceQueryKey,
    debouncedRecipeSearch,
    onBoard,
    resourceFilter,
    resourceMod,
    resourcePage,
    resourcePageSize,
    resourceSort,
    selectedDatasetVersion,
  ]);

  useEffect(() => {
    return deferStateUpdate(() => setRecipePage(0));
  }, [
    activeResource?.id,
    activeResource?.kind,
    browserMode,
    maxTier,
    activeRecipeQuery,
    queryClauses,
    takesOp,
    makesOp,
    selectedDatasetVersion?.id,
  ]);

  useEffect(() => {
    return deferStateUpdate(() => setRecipeBookSearch(""));
  }, [activeResource?.id, activeResource?.kind, browserMode, selectedDatasetVersion?.id]);

  useEffect(() => {
    if (!selectedDatasetVersion) {
      return deferStateUpdate(() => {
        setFilteredRecipes([]);
        setRecipeTotal(0);
        setRecipeHasMore(false);
        setAvailableRecipeMaps([]);
        setRecipeMapIcons({});
        setRecipeMapCounts({});
      });
    }

    const query = activeRecipeQuery;
    // Nothing on screen reads these until a resource is being browsed - the
    // search IS the resource view, and it opens with its own filter box.
    // Running the query anyway meant every keystroke in the item box searched
    // 270,000 recipes for a list no one ever saw.
    if (!activeResource) {
      return deferStateUpdate(() => {
        setFilteredRecipes([]);
        setRecipeTotal(0);
        setRecipeHasMore(false);
        setAvailableRecipeMaps([]);
        setRecipeMapIcons({});
        setRecipeMapCounts({});
        setRecipeQueryLoading(false);
        setRecipeQueryError(undefined);
      });
    }

    const cacheKey = getRecipeQueryKey(mapSelection, recipePage);
    const cached = getCachedRecipeQuery(recipeQueryCacheRef.current, cacheKey);
    if (cached) {
      return scheduleAfterPaint(() => {
        setFilteredRecipes((current) =>
          recipePage === 0 ? cached.recipes : appendUniqueRecipes(current, cached.recipes),
        );
        setRecipeTotal(cached.total);
        setRecipeHasMore(cached.hasMore);
        setAvailableRecipeMaps(cached.recipeMaps);
        setRecipeMapIcons(cached.recipeMapIcons ?? {});
        setRecipeMapCounts(cached.recipeMapCounts ?? {});
        setRecipeQueryLoading(false);
        setRecipeQueryError(undefined);
      });
    }

    const controller = new AbortController();
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        if (recipePage === 0) {
          setFilteredRecipes([]);
          setRecipeTotal(0);
          setRecipeHasMore(false);
        }
        setRecipeQueryLoading(true);
        setRecipeQueryError(undefined);
      }
    });

    const cancelAfterPaint = scheduleAfterPaint(() => {
      void queryRecipeDatasetRecipes(
        datasetManifestUrl ?? DEFAULT_DATASET_MANIFEST_URL,
        selectedDatasetVersion,
        {
          query,
          resource: activeResource
            ? {
                kind: activeResource.kind,
                id: activeResource.id,
              }
            : undefined,
          mode: browserMode,
          clauses: queryClauses.length > 0 ? queryClauses : undefined,
          takesOp,
          makesOp,
          allMaps: true,
          mapSelection,
          maxTier,
          offset: recipePage * RECIPE_QUERY_LIMIT,
          limit: RECIPE_QUERY_LIMIT,
        },
        { signal: controller.signal },
      )
        .then((result) => {
          if (cancelled) {
            return;
          }
          setCachedRecipeQuery(recipeQueryCacheRef.current, cacheKey, result);
          trimRecipeQueryCache(recipeQueryCacheRef.current);
          setFilteredRecipes((current) =>
            recipePage === 0 ? result.recipes : appendUniqueRecipes(current, result.recipes),
          );
          setRecipeTotal(result.total);
          setRecipeHasMore(result.hasMore);
          setAvailableRecipeMaps(result.recipeMaps);
          setRecipeMapIcons(result.recipeMapIcons ?? {});
          setRecipeMapCounts(result.recipeMapCounts ?? {});
          setRecipeQueryLoading(false);
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          setFilteredRecipes([]);
          setRecipeTotal(0);
          setRecipeHasMore(false);
          setAvailableRecipeMaps([]);
          setRecipeMapIcons({});
          setRecipeMapCounts({});
          setRecipeQueryError(error instanceof Error ? error.message : "Recipe query failed.");
          setRecipeQueryLoading(false);
        });
    });

    return () => {
      cancelled = true;
      controller.abort();
      cancelAfterPaint();
    };
  }, [
    activeRecipeQuery,
    activeResource,
    browserMode,
    datasetManifestUrl,
    getRecipeQueryKey,
    makesOp,
    mapSelection,
    maxTier,
    queryClauses,
    recipePage,
    selectedDatasetVersion,
    takesOp,
  ]);
  return (
    <>
      <aside
        data-help-anchor="browser"
        className="relative z-40 flex h-full min-h-[360px] compact:min-h-0 flex-col border-r border-neutral-800 bg-[#25272c] text-neutral-100"
      >
        {/*
          The column's own head row. It carried the game-version picker until
          that went up to the top bar; the row stays because it is what holds
          the tabs below level with the board's toolbar rather than riding up
          against the window chrome. The fold-away button sits on the outer
          edge, mirroring the resource panel's on the right.

          Gone on a phone: as a drawer this column has nothing to line up with,
          and a row holding one button is a row of screen the list wants. The
          close button moves in beside the tabs.
        */}
        <div className="flex h-8 shrink-0 items-center border-b border-neutral-800 px-2 compact:hidden">
          <button
            type="button"
            onClick={() => writeWorkspaceView({ leftPanelOpen: false })}
            title="Hide this column"
            aria-label="Hide the items, boards and setups column"
            className="flex h-7 w-6 shrink-0 items-center justify-center rounded-[4px] border border-neutral-700 text-neutral-400 hover:border-cyan-600 hover:text-cyan-400"
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10 3L5 8l5 5" />
            </svg>
          </button>
        </div>

        {/* The master switch: item search, the board shelf, or the
            setups network — whole column each. Flat tabs, not buttons. Three
            iconed labels need every trick to breathe: the column runs 344px,
            and the tabs wear 12px icons with 11px text, one size under the
            rest of the sidebar. */}
        <div className="flex shrink-0 border-b border-neutral-800">
          <button
            type="button"
            onClick={() => setSidebarMode("items")}
            className={[
              "flex h-7 flex-1 items-center justify-center gap-1 border-b-2 text-[11px] font-medium",
              sidebarMode === "items"
                ? "border-cyan-400 text-cyan-300"
                : "border-transparent text-neutral-400 hover:text-neutral-200",
            ].join(" ")}
          >
            <Search className="h-3 w-3" />
            Items
          </button>
          <button
            type="button"
            onClick={() => setSidebarMode("blueprints")}
            data-tour-anchor="pockets-tab"
            className={[
              "flex h-7 flex-1 items-center justify-center gap-1 border-b-2 text-[11px] font-medium",
              sidebarMode === "blueprints"
                ? "border-[#8d6fd1] text-[#c9b8ec]"
                : "border-transparent text-neutral-400 hover:text-neutral-200",
            ].join(" ")}
          >
            {/* The board star, the same mark a folded board wears in its
                name row and at a glance. A stack icon said "some other kind
                of thing"; every row on this shelf is a board. */}
            <span aria-hidden className="text-[12px] leading-none">
              ✦
            </span>
            Boards
          </button>
          <button
            type="button"
            onClick={() => setSidebarMode("setups")}
            className={[
              "flex h-7 flex-1 items-center justify-center gap-1 border-b-2 text-[11px] font-medium",
              sidebarMode === "setups"
                ? "border-emerald-400 text-emerald-300"
                : "border-transparent text-neutral-400 hover:text-neutral-200",
            ].join(" ")}
          >
            <Factory className="h-3 w-3" />
            Setups
          </button>
          {/* The drawer's own way out, on the tab row, since the head row that
              used to carry it is folded away on a phone. */}
          <button
            type="button"
            onClick={() => writeWorkspaceView({ leftPanelOpen: false })}
            aria-label="Close the items, boards and setups panel"
            className="hidden h-7 w-8 shrink-0 items-center justify-center border-b-2 border-transparent text-neutral-400 compact:flex"
          >
            <ChevronIcon direction="left" />
          </button>
        </div>
        {sidebarMode === "blueprints" ? (
          <BlueprintPanel />
        ) : sidebarMode === "setups" ? (
          <SetupsPanel />
        ) : (
          // The wheel pages the list from anywhere in the column, including over
          // the controls and the recent shelf: nothing here scrolls, so a wheel
          // that did nothing was just a panel that felt broken.
          <div className="flex min-h-0 flex-1 flex-col" onWheel={handleResourceWheel}>
        {/* The same card the board and setup shelves put their search and
            filters in. Bare, this tab's controls read as a different kind of
            thing from the other two, when they are the same thing. */}
        <ControlsCard>
          <div className="flex items-center gap-1.5">
            {/* 16px text on a phone, deliberately: below that, iOS zooms the
                whole page in the moment the field takes focus, and the way back
                out is a pinch. */}
            <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[4px] border border-neutral-700 bg-[#17191d] px-2 text-sm compact:text-base text-neutral-200 shadow-[inset_1px_1px_0_rgba(255,255,255,0.08)]">
              <Search className="h-4 w-4 text-neutral-500" />
              <input
                value={recipeSearch}
                onChange={(event) => {
                  const value = event.target.value;
                  setRecipeSearch(value);
                }}
                placeholder="Search item or fluid..."
                className="min-w-0 flex-1 bg-transparent outline-none"
              />
              {recipeSearch ? (
                <button
                  type="button"
                  onClick={() => setRecipeSearch("")}
                  title="Clear search"
                  aria-label="Clear search"
                  className="text-neutral-500 hover:text-neutral-200"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </label>
            {/* Folds everything below it away. Six filters and two dropdowns are
                worth their space when you are narrowing a search down and worth
                none of it when you are not, which on a phone is most of a screen
                of results. */}
            <button
              type="button"
              onClick={() => changeFiltersOpen(!filtersOpen)}
              aria-expanded={filtersOpen}
              title={filtersOpen ? "Hide the filters" : "Show the filters"}
              aria-label={filtersOpen ? "Hide the filters" : "Show the filters"}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-400 hover:text-neutral-200"
            >
              {filtersOpen ? (
                <ChevronsDownUp className="h-4 w-4" />
              ) : (
                <ChevronsUpDown className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* What the search had to do to find anything. Only ever shown when it
              had to do something: a spelling stood in, or the words were taken
              one at a time because no item has all of them. */}
          {displayedOutcome.phase !== "exact" ? (
            <p className="mt-1.5 truncate text-[11px] leading-tight text-amber-300/80">
              {displayedOutcome.phase === "corrected"
                ? `Showing results for ${displayedOutcome.corrections
                    .map((correction) => correction.to)
                    .join(", ")}`
                : "No item has all those words. Showing the closest."}
            </p>
          ) : null}

          {/* One question, six answers, one of them on at a time. There is no
              "fluids a bee makes" to ask for, so there is no second row to pair
              this with; the view toggle sits with the search box it belongs to. */}
          {/* Two rows of three rather than six across: the column has no room to
              print "Fluids" and "Plants" six abreast, and squeezing them was how
              the labels started clipping. Still one group with one answer on. */}
          <div className={filtersOpen ? "mt-1 grid grid-cols-3 gap-1" : "hidden"}>
            {RESOURCE_FILTER_CHOICES.map((choice) => (
              <button
                key={choice.mode}
                type="button"
                onClick={() => setResourceFilter(choice.mode)}
                title={choice.title}
                aria-pressed={resourceFilter === choice.mode}
                className={[
                  "h-6 min-w-0 truncate rounded-[4px] border text-[11px] font-medium",
                  resourceFilter === choice.mode
                    ? "border-cyan-500 bg-cyan-500/15 text-cyan-300"
                    : "border-neutral-700 bg-[#17191d] text-neutral-400 hover:text-neutral-200",
                ].join(" ")}
              >
                {choice.label}
              </button>
            ))}
          </div>

          <div className={filtersOpen ? "mt-1 grid grid-cols-2 gap-1" : "hidden"}>
            <select
              value={resourceMod}
              onChange={(event) => setResourceMod(event.target.value)}
              title="Filter by mod"
              aria-label="Filter by mod"
              className="h-6 min-w-0 rounded-[4px] border border-neutral-700 bg-[#17191d] px-1.5 text-[11px] text-neutral-100 outline-none"
            >
              <option value="">All mods</option>
              {displayedMods.map((mod) => (
                <option key={mod.id} value={mod.id}>
                  {mod.id} ({mod.count})
                </option>
              ))}
            </select>
            <select
              value={resourceSort}
              onChange={(event) => setResourceSort(event.target.value as ResourceSortMode)}
              title="Sort results"
              aria-label="Sort results"
              className="h-6 min-w-0 rounded-[4px] border border-neutral-700 bg-[#17191d] px-1.5 text-[11px] text-neutral-100 outline-none"
            >
              <option value="popular">Most popular</option>
              <option value="relevance">Best match</option>
              <option value="name">Name A–Z</option>
              <option value="mod">By mod</option>
              <option value="made">Most ways to make</option>
              <option value="uses">Most used</option>
            </select>
          </div>
        </ControlsCard>

        <div className="min-h-0 flex-1 overflow-hidden px-2 pb-1 pt-2">
          {!dataset && isDatasetLoading ? (
            <div className="rounded border border-dashed border-neutral-600 p-4 text-sm text-neutral-300">
              Loading recipe index...
            </div>
          ) : !dataset ? (
            <div className="rounded border border-dashed border-neutral-600 p-4 text-sm text-neutral-300">
              Recipe index is not loaded yet.
            </div>
          ) : (
            <VirtualResourceResultList
              resources={displayedResources}
              total={displayedTotal}
              currentPage={resourcePage}
              isLoading={resourceQueryLoading && !onBoard}
              error={resourceQueryError}
              emptyLabel={
                onBoard
                  ? "Nothing placed on the board yet."
                  : resourceFilter === "plants"
                    ? "No crop grows that."
                    : resourceFilter === "bees"
                      ? "No bee makes that."
                      : undefined
              }
              activeResource={activeResource}
              onPageChange={setResourcePage}
              onPageSizeChange={setResourcePageSize}
              onBrowse={browseResource}
            />
          )}
        </div>

        <RecentResourceStrip onBrowse={browseResource} />
          </div>
        )}
      </aside>

      {activeResource ? (
        <RecipeSearchOverlay
          clauses={stencilClauses}
          takesOp={takesOp}
          makesOp={makesOp}
          onClausesChange={changeStencilClauses}
          onTakesOpChange={changeTakesOp}
          onMakesOpChange={changeMakesOp}
          onSwapSides={swapStencilSides}
          recipeMapChips={recipeMapChips}
          allRecipeMapsSelected={allRecipeMapsSelected}
          onToggleRecipeMap={toggleRecipeMap}
          onToggleAllRecipeMaps={toggleAllRecipeMaps}
          onRecipeMapHover={prefetchRecipeMapToggle}
          recipes={filteredRecipes}
          totalAcrossMaps={recipeTotalAcrossMaps}
          hasMore={recipeHasMore}
          isLoading={recipeQueryLoading}
          queryError={recipeQueryError}
          query={recipeBookSearch}
          onQueryChange={(query) => {
            setRecipeBookSearch(query);
            setRecipePage(0);
          }}
          maxTier={maxTier}
          onMaxTierChange={setMaxTier}
          selectedRecipeId={selectedRecipeId}
          onSelectRecipe={selectRecipe}
          onAdd={handleAddRecipe}
          onPrefetch={prefetchRecipeAdd}
          onBrowseResource={(resource, mode) =>
            browseResource(
              {
                kind: resource.kind,
                id: resource.id,
                displayName: resource.displayName,
                iconPath: resource.iconPath,
                iconAtlas: resource.iconAtlas,
                dominantColor: resource.dominantColor ?? resource.iconAtlas?.dominantColor,
                anchorNodeId: activeResource.anchorNodeId,
              },
              mode,
            )
          }
          onLoadMore={() => {
            if (!recipeQueryLoading && recipeHasMore) {
              setRecipePage((page) => page + 1);
            }
          }}
          onClose={clearResourceBrowser}
          contextResource={activeResource}
          searchPickerResources={searchPickerResources}
        />
      ) : null}
    </>
  );
}

function useResourcePageSize(
  containerRef: RefObject<HTMLDivElement | null>,
  onPageSizeChange: (pageSize: number) => void,
) {
  const [pageSize, setPageSize] = useState(RESOURCE_DEFAULT_PAGE_SIZE);
  const [gridColumns, setGridColumns] = useState(2);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return;
    }

    const updatePageSize = () => {
      const availableHeight = Math.max(RESOURCE_TILE_HEIGHT, container.clientHeight);
      const listHeight = Math.max(RESOURCE_TILE_HEIGHT, availableHeight - RESOURCE_PAGER_HEIGHT);
      const width = Math.max(RESOURCE_TILE_MIN_WIDTH, container.clientWidth);
      const nextColumns = Math.max(
        1,
        Math.floor(
          (width + RESOURCE_TILE_GAP) / (RESOURCE_TILE_MIN_WIDTH + RESOURCE_TILE_GAP),
        ),
      );
      const rows = Math.max(
        1,
        Math.floor((listHeight + RESOURCE_TILE_GAP) / (RESOURCE_TILE_HEIGHT + RESOURCE_TILE_GAP)),
      );
      const nextPageSize = nextColumns * rows;

      setPageSize((current) => (current === nextPageSize ? current : nextPageSize));
      setGridColumns((current) => (current === nextColumns ? current : nextColumns));
      onPageSizeChange(nextPageSize);
    };

    updatePageSize();
    const observer = new ResizeObserver(updatePageSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, onPageSizeChange]);

  return { pageSize, gridColumns };
}

interface IndexedResource extends Pick<
  ResourceAmount,
  "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip"
> {
  recipeCount: number;
}

/** What the search had to do to answer, for the line under the box. */
interface SearchOutcome {
  phase: SearchPhase;
  corrections: SearchCorrection[];
}

const EXACT_SEARCH: SearchOutcome = { phase: "exact", corrections: [] };

function searchOutcomeOf(result: {
  searchPhase?: SearchPhase;
  corrections?: SearchCorrection[];
}): SearchOutcome {
  return result.searchPhase && result.searchPhase !== "exact"
    ? { phase: result.searchPhase, corrections: result.corrections ?? [] }
    : EXACT_SEARCH;
}

/**
 * Every item and fluid the board already touches.
 *
 * Read off the project rather than the dataset, because that is where the answer
 * is: a card's inputs and outputs (with whatever alternative was picked for a
 * slot) plus every drawer and tank. One entry per resource, however many cards
 * use it.
 */
function useBoardResources(enabled: boolean): IndexedResource[] {
  const nodes = useFactoryStore((state) => state.project.nodes);
  const recipes = useFactoryStore((state) => state.project.recipes);
  const storages = useFactoryStore((state) => state.project.storages);

  return useMemo(() => {
    if (!enabled) {
      return [];
    }

    const byKey = new Map<string, IndexedResource>();
    // Unlike the dataset list, an entry with no icon is kept: it is genuinely on
    // the board, and its name is what identifies it. Only the demo plan and
    // hand-imported plans hit this.
    const add = (resource: Omit<IndexedResource, "recipeCount">) => {
      if (!resource.id) {
        return;
      }
      const key = `${resource.kind}:${resource.id}`;
      if (!byKey.has(key)) {
        byKey.set(key, { ...resource, recipeCount: 0 });
      }
    };

    const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe] as const));
    for (const node of nodes) {
      const recipe = recipesById.get(node.recipeId);
      if (!recipe) {
        continue;
      }
      const effectiveRecipe = applyRecipeInputOverrides(recipe, node);
      for (const resource of [...effectiveRecipe.inputs, ...effectiveRecipe.outputs]) {
        add(resource);
      }
    }
    for (const storage of storages ?? []) {
      add({
        kind: storage.kind,
        id: storage.resourceId,
        displayName: storage.displayName,
        iconPath: storage.iconPath,
        iconAtlas: storage.iconAtlas,
        dominantColor: storage.dominantColor,
      });
    }

    return [...byKey.values()];
  }, [enabled, nodes, recipes, storages]);
}

/**
 * The same search, run over the board's own resources.
 *
 * It is the identical matcher the server uses, so typing "steal" finds the steel
 * on your board exactly as it finds the steel in the dataset - a filter that
 * behaved differently from the list it replaces would just read as broken.
 */
function useBoardResourceResults(
  enabled: boolean,
  request: {
    query: string;
    mod: string;
    sort: ResourceSortMode;
    offset: number;
    limit: number;
  },
) {
  const resources = useBoardResources(enabled);

  return useMemo(() => {
    if (!enabled) {
      return { resources: [], total: 0, mods: [], outcome: EXACT_SEARCH };
    }

    const fields = resources.map((resource) => ({
      nameText: (resource.displayName ?? resource.id).toLowerCase(),
      name: splitSearchTokens(resource.displayName ?? ""),
      id: splitSearchTokens(resource.id),
    }));
    const vocabulary = buildSearchVocabulary(
      resources.map((resource) => resource.displayName ?? ""),
    );
    const modCounts = new Map<string, number>();

    const resolved = resolveSearchPhases(
      parseSearchQuery(request.query),
      vocabulary,
      (query, options) => {
        modCounts.clear();
        const matches: Array<{ resource: IndexedResource; score: number }> = [];
        resources.forEach((resource, index) => {
          const score = matchSearchEntry(query, fields[index], options);
          if (score === undefined) {
            return;
          }
          const modId = getResourceModLabel(resource);
          modCounts.set(modId, (modCounts.get(modId) ?? 0) + 1);
          if (request.mod && modId !== request.mod) {
            return;
          }
          matches.push({ resource, score });
        });
        return matches;
      },
    );

    const nameOf = (match: { resource: IndexedResource }) =>
      (match.resource.displayName ?? match.resource.id).toLowerCase();
    const sorted = [...resolved.results].sort((left, right) => {
      if (request.sort === "name") {
        return nameOf(left).localeCompare(nameOf(right));
      }
      if (request.sort === "mod") {
        return (
          getResourceModLabel(left.resource).localeCompare(getResourceModLabel(right.resource)) ||
          nameOf(left).localeCompare(nameOf(right))
        );
      }
      // "Most recipes" has nothing to sort by here (a board resource carries no
      // recipe count), so it falls back to the same order as best match.
      return right.score - left.score || nameOf(left).localeCompare(nameOf(right));
    });

    return {
      resources: sorted
        .slice(request.offset, request.offset + request.limit)
        .map((match) => match.resource),
      total: sorted.length,
      mods: [...modCounts.entries()]
        .map(([id, count]) => ({ id, count }))
        .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id)),
      outcome:
        resolved.phase === "exact"
          ? EXACT_SEARCH
          : { phase: resolved.phase, corrections: resolved.query.corrections },
    };
  }, [
    enabled,
    request.limit,
    request.mod,
    request.offset,
    request.query,
    request.sort,
    resources,
  ]);
}

interface RecipeMapTab {
  id: string;
  label: string;
  icon?: Pick<
    ResourceAmount,
    "kind" | "id" | "amount" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
  >;
}

interface RecipeQueryCacheEntry {
  result: RecipeDatasetQueryResult;
  expiresAt: number;
}

interface ResourceQueryCacheEntry {
  result: RecipeDatasetResourceQueryResult;
  expiresAt: number;
}

/**
 * The last things looked up, three rows of them under the results.
 *
 * A build keeps coming back to the same dozen items, and this is the shelf they
 * sit on: click for recipes, right click for uses, exactly like a result row.
 * The list itself is the store's browse history, which every panel on the board
 * already writes to - so an item opened from a card's slot lands here too.
 */
// One small row everywhere (Jack, 2026-08-31): the shelf is a shortcut, and
// every pixel it holds is a pixel the results above it lose.
const RECENT_STRIP_ROWS = 1;
const RECENT_STRIP_ROWS_COMPACT = 1;
const RECENT_STRIP_CELL = 36;
/** More than one row of the widest column could ever show. */
const RECENT_STRIP_LIMIT = 24;

function RecentResourceStrip({
  onBrowse,
}: {
  onBrowse: (resource: IndexedResource, mode: "recipes" | "uses") => void;
}) {
  const history = useFactoryStore((state) => state.recipeResourceHistory);
  const clearResourceHistory = useFactoryStore((state) => state.clearResourceHistory);
  const activeResource = useFactoryStore((state) => state.recipeBrowserResource);
  const isCompact = useIsCompactViewport();
  const rows = isCompact ? RECENT_STRIP_ROWS_COMPACT : RECENT_STRIP_ROWS;
  const cell = RECENT_STRIP_CELL;
  const recent = history.slice(0, RECENT_STRIP_LIMIT);
  const rowBrowse = useResourceBrowseMenu(onBrowse);

  if (recent.length === 0) {
    return null;
  }

  return (
    // A card of its own, like the controls at the top of the column: bare, a shelf
    // of loose icons at the foot of a list of icons read as more of the list. The
    // bottom margin keeps it off the very edge of the window.
    <div className="mx-2 mb-1.5 shrink-0 rounded-[6px] border border-neutral-700 bg-[#2a2d33] p-1">
      <div className="mb-0.5 flex items-center justify-between px-0.5">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500">
          Recent
        </span>
        <button
          type="button"
          onClick={clearResourceHistory}
          title="Clear recent items"
          className="text-[9px] font-medium text-neutral-600 hover:text-neutral-200"
        >
          Clear
        </button>
      </div>
      {/* auto-fill picks the column count from the width, and the height stops
          it at one row: a shelf, not a second list. */}
      <div
        className="grid gap-1 overflow-hidden"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${cell}px, 1fr))`,
          maxHeight: rows * cell + (rows - 1) * RESOURCE_GRID_GAP,
        }}
        aria-label="Recently viewed"
        role="listbox"
      >
        {recent.map((resource) => {
          const active =
            activeResource?.kind === resource.kind && activeResource.id === resource.id;
          const indexed: IndexedResource = { ...resource, recipeCount: 0 };
          return (
            <MinecraftTooltip
              key={`${resource.kind}:${resource.id}`}
              label={[
                ...resourceTooltipLines(indexed),
                "Click for recipes, right click for uses",
              ]}
            >
              <button
                type="button"
                onClick={(event) => {
                  if (rowBrowse.claimedByMenu(event) || rowBrowse.openOnTap(event)) {
                    return;
                  }
                  onBrowse(indexed, "recipes");
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (rowBrowse.claimedByMenu(event)) {
                    return;
                  }
                  onBrowse(indexed, "uses");
                }}
                {...rowBrowse.pressProps(indexed)}
                aria-label={resourceLabel(resource)}
                className={[
                  "minecraft-pixel-art flex aspect-square items-center justify-center overflow-hidden rounded-[4px] border",
                  active
                    ? "border-cyan-400 bg-cyan-500/10"
                    : "border-transparent hover:border-neutral-500 hover:bg-white/5",
                ].join(" ")}
                role="option"
                aria-selected={active}
              >
                <ResourceIcon
                  resource={{ ...resource, amount: 1 }}
                  size="md"
                  bare
                  showAmount={false}
                  tooltip={false}
                  className={RESOURCE_GRID_ART}
                />
              </button>
            </MinecraftTooltip>
          );
        })}
      </div>
      {rowBrowse.menu}
    </div>
  );
}

function VirtualResourceResultList({
  resources,
  total,
  currentPage,
  isLoading,
  error,
  emptyLabel,
  activeResource,
  onPageChange,
  onPageSizeChange,
  onBrowse,
}: {
  resources: IndexedResource[];
  total: number;
  currentPage: number;
  isLoading: boolean;
  error?: string;
  /** What "nothing here" means under the current filter. */
  emptyLabel?: string;
  activeResource?: IndexedResource;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onBrowse: (resource: IndexedResource, mode: "recipes" | "uses") => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { pageSize, gridColumns } = useResourcePageSize(containerRef, onPageSizeChange);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const handlePreviousPage = useCallback(() => {
    onPageChange(Math.max(0, currentPage - 1));
  }, [currentPage, onPageChange]);
  const handleNextPage = useCallback(() => {
    onPageChange(Math.min(pageCount - 1, currentPage + 1));
  }, [currentPage, onPageChange, pageCount]);

  return (
    <div ref={containerRef} className="flex h-full min-w-0 min-h-0 flex-col overflow-hidden">
      {error ? (
        <div className="rounded border border-dashed border-red-700 p-4 text-sm text-red-200">
          {error}
        </div>
      ) : isLoading && resources.length === 0 ? (
        <ResourceResultSkeleton pageSize={pageSize} gridColumns={gridColumns} />
      ) : resources.length === 0 ? (
        <div className="rounded border border-dashed border-neutral-600 p-4 text-sm text-neutral-300">
          {emptyLabel ?? "No matching resource."}
        </div>
      ) : (
        <ResourceResultPage
          resources={resources}
          activeResource={activeResource}
          gridColumns={gridColumns}
          isRefreshing={isLoading}
          onBrowseResource={onBrowse}
        />
      )}
      <ResourcePager
        currentPage={currentPage}
        pageCount={pageCount}
        onPreviousPage={handlePreviousPage}
        onNextPage={handleNextPage}
      />
    </div>
  );
}

/** Pulsing placeholders shaped like the results, instead of a text box. */
function ResourceResultSkeleton({
  pageSize,
  gridColumns,
}: {
  pageSize: number;
  gridColumns: number;
}) {
  const count = Math.max(3, Math.min(pageSize, 60));
  return (
    <div
      className="grid min-h-0 flex-1 content-start gap-0.5 overflow-hidden"
      style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}
      aria-label="Loading resources"
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="flex shrink-0 flex-col items-center gap-1 pt-1"
          style={{ height: RESOURCE_TILE_HEIGHT }}
        >
          <div className="h-11 w-11 shrink-0 animate-pulse rounded-[4px] bg-neutral-800/70" />
          <div
            className="h-2.5 animate-pulse rounded bg-neutral-800/70"
            style={{ width: `${45 + ((index * 17) % 40)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function ResourcePager({
  currentPage,
  pageCount,
  onPreviousPage,
  onNextPage,
}: {
  currentPage: number;
  pageCount: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
}) {
  return (
    <div className="mt-1 flex h-6 w-full min-w-0 shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={onPreviousPage}
        disabled={currentPage === 0}
        className="flex h-6 w-7 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
        aria-label="Previous resource page"
        title="Previous page"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <div className="min-w-0 flex-1 truncate text-center text-[11px] text-neutral-400">
        Page {Math.min(currentPage + 1, pageCount)} of {pageCount}
      </div>
      <button
        type="button"
        onClick={onNextPage}
        disabled={currentPage >= pageCount - 1}
        className="flex h-6 w-7 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
        aria-label="Next resource page"
        title="Next page"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * A finger's way to choose between the two questions a resource answers.
 *
 * A mouse has a left button for "what makes it" and a right one for "what uses
 * it". A finger has one tap, and here it opens the pair as a menu rather than
 * guessing: unlike a port on the board, a row in this list has no third gesture to
 * protect — no wire to drag out of it — so there is nothing to lose by asking, and
 * "uses" was otherwise unreachable on a phone. Holding opens the same menu, which
 * is the gesture the board taught.
 *
 * One menu for the whole list rather than one per row: which resource is being
 * pressed is captured when the press starts, so this costs a ref and not a hook
 * per item in a list that can run to hundreds.
 */
function useResourceBrowseMenu(
  browse: (resource: IndexedResource, mode: "recipes" | "uses") => void,
) {
  const pressedRef = useRef<IndexedResource | undefined>(undefined);
  const [pressedName, setPressedName] = useState("");
  const menu = useBrowseMenu({
    name: pressedName,
    onPick: (mode) => {
      const resource = pressedRef.current;
      if (resource) {
        browse(resource, mode);
      }
    },
  });

  return {
    menu: menu.menu,
    /** Spread on the row, after its own click and context-menu handlers. */
    pressProps: (resource: IndexedResource) => ({
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        pressedRef.current = resource;
        if (event.pointerType !== "mouse") {
          setPressedName(resourceLabel(resource));
        }
        menu.pressHandlers.onPointerDown(event);
      },
      onPointerMove: menu.pressHandlers.onPointerMove,
      onPointerUp: menu.pressHandlers.onPointerUp,
      onPointerCancel: menu.pressHandlers.onPointerCancel,
    }),
    /**
     * Whether the row's own click should stand down: the menu is open, or has just
     * closed and this click is the trailing half of the tap that chose from it.
     */
    claimedByMenu: (event: { target: EventTarget | null }) =>
      isFromBrowseMenu(event) || menu.isPressing || menu.isSettling(),
    /**
     * A tap from a finger opens the menu. `isEchoOfTouch` as well as the row's own
     * pointerdown, because the click a tap synthesises claims to be a mouse.
     */
    openOnTap: (event: React.MouseEvent<HTMLElement>) => {
      if (!menu.wasTouch() && !isEchoOfTouch()) {
        return false;
      }
      return menu.openFromTap({ x: event.clientX, y: event.clientY });
    },
  };
}

function ResourceResultPage({
  resources,
  activeResource,
  gridColumns,
  isRefreshing,
  onBrowseResource,
}: {
  resources: IndexedResource[];
  activeResource?: IndexedResource;
  gridColumns: number;
  isRefreshing: boolean;
  onBrowseResource: (resource: IndexedResource, mode: "recipes" | "uses") => void;
}) {
  const [, startBrowseTransition] = useTransition();

  const browse = useCallback(
    (resource: IndexedResource, mode: "recipes" | "uses") => {
      startBrowseTransition(() => onBrowseResource(resource, mode));
    },
    [onBrowseResource, startBrowseTransition],
  );
  const rowBrowse = useResourceBrowseMenu(browse);

  return (
    <div
      className={[
        "grid min-h-0 flex-1 content-start gap-0.5 overflow-hidden",
        isRefreshing ? "opacity-60" : "",
      ].join(" ")}
      style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}
      aria-label="Resource results"
      role="listbox"
    >
      {resources.map((resource) => {
        const active = activeResource?.kind === resource.kind && activeResource.id === resource.id;

        return (
          // No hover tooltip: the tile already says what it is, and a tooltip
          // over every cell of a dense grid is a flicker, not a help.
          <button
              key={`${resource.kind}:${resource.id}`}
              type="button"
              onClick={(event) => {
                if (rowBrowse.claimedByMenu(event) || rowBrowse.openOnTap(event)) {
                  return;
                }
                browse(resource, "recipes");
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                if (rowBrowse.claimedByMenu(event)) {
                  return;
                }
                browse(resource, "uses");
              }}
              {...rowBrowse.pressProps(resource)}
              aria-label={resourceLabel(resource)}
              className={[
                "flex min-w-0 flex-col items-center overflow-hidden rounded-[4px] border px-0.5",
                // The power tile's own whisper of amber; selection still wins.
                !active && resource.id === POWER_EU_CLAUSE_ID ? "bg-amber-400/[0.07]" : "",
                active
                  ? "border-cyan-400 bg-cyan-500/10"
                  : "border-transparent hover:border-neutral-600 hover:bg-white/5",
              ].join(" ")}
              style={{ height: RESOURCE_TILE_HEIGHT }}
              role="option"
              aria-selected={active}
            >
              <span className="minecraft-pixel-art flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden drop-shadow-[0_2px_3px_rgba(0,0,0,0.5)]">
                {resource.id === POWER_EU_CLAUSE_ID ? (
                  <span className="flex h-full w-full items-center justify-center bg-amber-400/10">
                    <Zap className="h-5 w-5 fill-current text-amber-400" aria-hidden />
                  </span>
                ) : (
                  <ResourceIcon
                    resource={{ ...resource, amount: 1 }}
                    size="sm"
                    bare
                    showAmount={false}
                    tooltip={false}
                    // Items zoom-crop (the sprite ships transparent padding);
                    // fluids are measured to the same visual size as their
                    // item neighbours instead of the usual 78% inset.
                    iconPixelSize={
                      resource.kind === "fluid"
                        ? isSwatchFluid(resource)
                          ? 56
                          : spriteArtPixels(40)
                        : undefined
                    }
                    className={
                      resource.kind === "fluid" ? "!h-11 !w-11" : "!h-11 !w-11 scale-[1.5]"
                    }
                  />
                )}
              </span>
              <span className="line-clamp-2 w-full break-words text-center text-[9px] leading-[10px] text-neutral-400">
                {resource.id === POWER_EU_CLAUSE_ID ? "Power (EU/t)" : resourceLabel(resource)}
              </span>
          </button>
        );
      })}
      {rowBrowse.menu}
    </div>
  );
}

function getRecipeAddContextResource(
  activeResource: (IndexedResource & { anchorNodeId?: string }) | undefined,
  mode: "recipes" | "uses",
  contextRecipe: RecipeSummary | undefined,
):
  | (Pick<
      ResourceAmount,
      | "kind"
      | "id"
      | "displayName"
      | "iconPath"
      | "iconAtlas"
      | "dominantColor"
      | "tooltip"
      | "modId"
    > & {
      mode: "recipes" | "uses";
      inputIndex?: number;
      neiSlot?: ResourceAmount["neiSlot"];
    })
  | undefined {
  if (!activeResource) {
    return undefined;
  }

  if (mode === "uses") {
    const contextInputIndex = contextRecipe?.inputs.findIndex(
      (input) =>
        (input.kind === activeResource.kind && input.id === activeResource.id) ||
        resourceMatchesInput({ kind: activeResource.kind, id: activeResource.id }, input),
    );
    const contextInput =
      contextInputIndex !== undefined && contextInputIndex >= 0
        ? contextRecipe?.inputs[contextInputIndex]
        : undefined;
    const contextSlotInput =
      contextInput ??
      contextRecipe?.inputs.find(
        (input) =>
          input.neiSlot &&
          resourceMatchesInput({ kind: activeResource.kind, id: activeResource.id }, input),
      );
    if (contextSlotInput && !contextSlotInput.id.startsWith("oredict:")) {
      return {
        kind: contextSlotInput.kind,
        id: contextSlotInput.id,
        displayName: contextSlotInput.displayName ?? activeResource.displayName,
        iconPath: contextSlotInput.iconPath ?? activeResource.iconPath,
        iconAtlas: contextSlotInput.iconAtlas ?? activeResource.iconAtlas,
        dominantColor:
          contextSlotInput.dominantColor ??
          contextSlotInput.iconAtlas?.dominantColor ??
          activeResource.dominantColor ??
          activeResource.iconAtlas?.dominantColor,
        tooltip: contextSlotInput.tooltip,
        modId: contextSlotInput.modId,
        mode,
        inputIndex: contextInputIndex,
        neiSlot: contextSlotInput.neiSlot,
      };
    }
  }

  return {
    kind: activeResource.kind,
    id: activeResource.id,
    displayName: activeResource.displayName,
    iconPath: activeResource.iconPath,
    iconAtlas: activeResource.iconAtlas,
    dominantColor: activeResource.dominantColor ?? activeResource.iconAtlas?.dominantColor,
    mode,
  };
}

function recipeHasRenderableIcons(recipe: Recipe) {
  return [...recipe.inputs, ...recipe.outputs]
    .filter((resource) => resource.kind === "item")
    .every((resource) => Boolean(resource.iconPath || resource.iconAtlas));
}


function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function deferStateUpdate(callback: () => void) {
  let cancelled = false;
  queueMicrotask(() => {
    if (!cancelled) {
      callback();
    }
  });

  return () => {
    cancelled = true;
  };
}

function scheduleAfterPaint(callback: () => void) {
  if (typeof window === "undefined") {
    callback();
    return () => undefined;
  }

  let cancelled = false;
  let firstFrame = 0;
  let secondFrame = 0;

  firstFrame = window.requestAnimationFrame(() => {
    secondFrame = window.requestAnimationFrame(() => {
      if (!cancelled) {
        callback();
      }
    });
  });

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(firstFrame);
    window.cancelAnimationFrame(secondFrame);
  };
}


function getDatasetVersionCacheKey(version: {
  id: string;
  checksumSha256?: string;
  publishedAt: string;
}) {
  return [version.id, version.checksumSha256 ?? version.publishedAt].join("@");
}

function appendUniqueRecipes(current: RecipeSummary[], incoming: RecipeSummary[]) {
  const seen = new Set(current.map((recipe) => recipe.id));
  const next = [...current];
  for (const recipe of incoming) {
    if (seen.has(recipe.id)) {
      continue;
    }
    seen.add(recipe.id);
    next.push(recipe);
  }
  return next;
}

function getRecipeQueryCacheKey({
  versionId,
  query,
  resource,
  mode,
  clauses,
  takesOp,
  makesOp,
  mapSelection,
  maxTier,
  offset,
  limit,
}: {
  versionId: string;
  query: string;
  resource?: Pick<ResourceAmount, "kind" | "id">;
  mode: "recipes" | "uses";
  clauses: RecipeQueryClause[];
  takesOp: RecipeQuerySideOp;
  makesOp: RecipeQuerySideOp;
  mapSelection: RecipeMapSelection | undefined;
  maxTier: TierFilter;
  offset: number;
  limit: number;
}) {
  return [
    versionId,
    query.trim().toLowerCase(),
    resource ? `${resource.kind}:${resource.id}` : "",
    mode,
    clauses.map((clause) => `${clause.role}:${clause.kind}:${clause.id}`).join(","),
    takesOp,
    makesOp,
    mapSelection ? `${mapSelection.mode}:${[...mapSelection.maps].sort().join(",")}` : "all",
    maxTier,
    offset,
    limit,
  ].join("|");
}

/** Whether the chips' selection shows this map's recipes. Absent means all. */
function isMapSelectedIn(selection: RecipeMapSelection | undefined, recipeMap: string): boolean {
  if (!selection) {
    return true;
  }
  const listed = selection.maps.includes(recipeMap);
  return selection.mode === "exclude" ? !listed : listed;
}

/**
 * One chip's toggle. Exclusions and inclusions are edited in place so a map
 * unselected on an earlier search survives this one; the only normalisations
 * are back to "all" - an emptied exclusion list, or an include list that has
 * grown to cover every chip on screen.
 */
function toggledMapSelection(
  selection: RecipeMapSelection | undefined,
  recipeMap: string,
  visibleMaps: string[],
): RecipeMapSelection | undefined {
  if (!selection) {
    return { mode: "exclude", maps: [recipeMap] };
  }
  const listed = selection.maps.includes(recipeMap);
  const maps = listed
    ? selection.maps.filter((map) => map !== recipeMap)
    : [...selection.maps, recipeMap];
  if (selection.mode === "exclude") {
    return maps.length > 0 ? { mode: "exclude", maps } : undefined;
  }
  if (visibleMaps.every((map) => maps.includes(map))) {
    return undefined;
  }
  return { mode: "include", maps };
}

function readStoredMapSelection(): RecipeMapSelection | undefined {
  try {
    const stored = window.localStorage.getItem(MAP_SELECTION_STORAGE_KEY);
    if (!stored) {
      return undefined;
    }
    const parsed: unknown = JSON.parse(stored);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "mode" in parsed &&
      (parsed.mode === "exclude" || parsed.mode === "include") &&
      "maps" in parsed &&
      Array.isArray(parsed.maps)
    ) {
      const maps = parsed.maps.filter((map): map is string => typeof map === "string");
      // An empty exclusion list is just "all"; keep the state canonical.
      if (parsed.mode === "exclude" && maps.length === 0) {
        return undefined;
      }
      return { mode: parsed.mode, maps };
    }
  } catch {
    // A stale or foreign value reads as the default.
  }
  return undefined;
}

function getResourceQueryCacheKey({
  versionId,
  query,
  offset,
  limit,
  filter,
  mod,
  sort,
}: {
  versionId: string;
  query: string;
  offset: number;
  limit: number;
  filter: ResourceFilterMode;
  mod: string;
  sort: ResourceSortMode;
}) {
  return [versionId, query.trim().toLowerCase(), offset, limit, filter, mod, sort].join("|");
}


function getCachedRecipeQuery(cache: Map<string, RecipeQueryCacheEntry>, key: string) {
  const entry = cache.get(key);
  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }

  return entry.result;
}

function setCachedRecipeQuery(
  cache: Map<string, RecipeQueryCacheEntry>,
  key: string,
  result: RecipeDatasetQueryResult,
) {
  cache.set(key, {
    result,
    expiresAt: Date.now() + RECIPE_QUERY_CACHE_TTL_MS,
  });
}

function trimRecipeQueryCache(cache: Map<string, RecipeQueryCacheEntry>) {
  while (cache.size > 120) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) {
      return;
    }
    cache.delete(oldestKey);
  }
}

function getCachedResourceQuery(cache: Map<string, ResourceQueryCacheEntry>, key: string) {
  const entry = cache.get(key);
  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }

  return entry.result;
}

function setCachedResourceQuery(
  cache: Map<string, ResourceQueryCacheEntry>,
  key: string,
  result: RecipeDatasetResourceQueryResult,
) {
  cache.set(key, {
    result,
    expiresAt: Date.now() + RESOURCE_QUERY_CACHE_TTL_MS,
  });
}

function trimResourceQueryCache(cache: Map<string, ResourceQueryCacheEntry>) {
  while (cache.size > 160) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) {
      return;
    }
    cache.delete(oldestKey);
  }
}

function buildRecipeMapTabs(
  recipeMaps: string[],
  icons: Record<string, DatasetResourceIndexEntry>,
): RecipeMapTab[] {
  return recipeMaps.map((recipeMap) => {
    const resource = icons[recipeMap];
    return {
      id: recipeMap,
      label: recipeMap,
      icon: resource
        ? {
            kind: resource.kind,
            id: resource.id,
            amount: 1,
            displayName: resource.displayName,
            iconPath: resource.iconPath,
            iconAtlas: resource.iconAtlas,
            dominantColor: resource.dominantColor ?? resource.iconAtlas?.dominantColor,
          }
        : undefined,
    };
  });
}



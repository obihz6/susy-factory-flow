"use client";

import { SpawnKeys } from "@/components/SpawnKeys";
import {
  ChevronLeft,
  ChevronRight,
  Cpu,
  GitBranchPlus,
  Plus,
  Search,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { PointerEvent, RefObject } from "react";
import { DEFAULT_DATASET_MANIFEST_URL } from "@/lib/datasets";
import {
  getRecipeDatasetRecipe,
  queryRecipeDatasetResources,
  queryRecipeDatasetRecipes,
  type RecipeDatasetQueryResult,
  type RecipeDatasetResourceQueryResult,
  type RecipeMapSelection,
} from "@/lib/datasets/browser-loader";
import type {
  RecipeQueryClause,
  RecipeQuerySideOp,
} from "@/lib/datasets/recipe-query";
import type { DatasetResourceIndexEntry, RecipeSummary } from "@/lib/datasets/types";
import {
  formatRate,
  getRecipeMachineHandlers,
  resourceLabel,
  resourceMatchesInput,
} from "@/lib/model";
import { GT_VOLTAGE_TIERS } from "@/lib/model/tiers";
import { getRecipeProgrammedCircuit } from "@/lib/model/programmed-circuit";
import { usesNativeNeiChrome } from "@/lib/nei/layout";
import { NEI_PALETTE } from "@/lib/nei-renderer/theme/palette";
import { useIsCompactViewport } from "@/lib/compact-view";
import { isEchoOfTouch } from "@/lib/pointer-kind";
import { MACHINE_PIN_RESOURCE_ID, useFactoryStore } from "@/store/factory-store";
import { useDesignStore } from "@/store/design-store";
import { leaveWelcomeTab, readWelcomeTabState } from "@/lib/welcome/welcome-tab";
import type { RecipeInputPicks, TierFilter } from "@/store/factory-store";
import type { Recipe, ResourceAmount } from "@/lib/model/types";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import {
  OPEN_SIDEBAR_TAB_EVENT,
  takePendingSearchFocus,
  takePendingSidebarTab,
} from "@/lib/sidebar-tab";
import { writeWorkspaceView } from "@/lib/workspace-view";
import { isFromBrowseMenu, useBrowseMenu } from "./browse-menu";
import { MinecraftTooltip } from "./nei/MinecraftTooltip";
import { ResourceIcon } from "./nei/ResourceIcon";
import { NeiRecipeWindow } from "./nei/NeiRecipeWindow";
import { AlternativeCycleScope, useAlternativeCycleFacesRef } from "./nei/AlternativeCycleScope";
import { machineArtPixels } from "./flow/MachinePicker";
import { useMachineHandlerIcons } from "./flow/machine-icons";
import {
  deferStateUpdate,
  getDatasetVersionCacheKey,
  ResourceIndexPane,
  RESOURCE_SEARCH_DEBOUNCE_MS,
  useResourcePageSize,
  type IndexedResource,
} from "./ResourceIndexPane";
import { ChevronIcon } from "./PanelDrawer";
import {
  RecipeSearchOverlay,
  type RecipeMapChip,
  type StencilClause,
} from "./RecipeSearchOverlay";

// The preview helpers used to live here; they moved out with the overlay and
// keep their old import path for everyone already using it.
import {
  contextualizePreviewRecipe,
  summaryToPreviewRecipe,
  type PreviewContextResource,
} from "./recipe-preview";
export { contextualizePreviewRecipe, summaryToPreviewRecipe };
export type { PreviewContextResource };

const RECIPE_QUERY_LIMIT = 120;

/**
 * The recipe book's size rules.
 *
 * A recipe is drawn on a fixed NEI canvas, so a card cannot be squeezed: it is
 * either given the width it needs or it gets cut off, which is what used to
 * happen. Every number below is therefore derived from what one card needs.
 */
// The NEI canvas most recipes are drawn on. Wider ones exist, and like the row
// height, one decision is made for the whole grid rather than per card.
const NEI_CANVAS_WIDTH = 170;
// The add button sits in the panel's own top corner, so a card is no wider
// than the recipe it draws.
const CARD_ADD_GUTTER = 0;
const CARD_GAP = 12;
// The time and circuit strip along the foot of the panel.
const CARD_CHROME_HEIGHT = 38;
const NEI_CANVAS_HEIGHT_DEFAULT = 82;
const NEI_CANVAS_HEIGHT_NATIVE = 120;
const RECIPE_CARD_MAX_COLUMNS = 3;

const BOARD_SIDEBAR_LEFT = 306;
const BOARD_SIDEBAR_RIGHT = 330;
const CATEGORY_RAIL_WIDTH = 290;
// One column of cards next to the category rail.
const RECIPE_BOOK_MIN_WIDTH = 640;
const RECIPE_BOOK_MAX_WIDTH = 1400;
const RECIPE_BOOK_MAX_HEIGHT = 860;
// Two columns of cards next to the rail: the size worth stepping around the
// board's sidebars for.
const RECIPE_BOOK_COMFORTABLE_WIDTH = 1080;
// The rail keeps its column only while the recipes still get two of theirs.
// Held any lower it would win the argument for space and leave a single card
// stranded in a wide empty column.
const RECIPE_BOOK_RAIL_NEEDS =
  CATEGORY_RAIL_WIDTH + (NEI_CANVAS_WIDTH * 2 + CARD_ADD_GUTTER) * 2 + CARD_GAP + 24;
const RECIPE_BOOK_SHEET_BELOW = 700;
const ZERO_OFFSET = { x: 0, y: 0 };

interface MeasuredCard {
  /** Which list this was measured from, so a new list starts over. */
  key: string;
  /** One recipe's drawn width, unscaled. */
  unit: number;
  /** The tallest card drawn so far, in px at the scale it was drawn. */
  row: number;
}

/** Everything between the book's edge and the cards: rail, padding, borders. */
function recipeBookChrome(showRail: boolean) {
  return (showRail ? CATEGORY_RAIL_WIDTH : 0) + 24 + 4;
}

/**
 * The width the book actually needs, which is not the width it can have.
 *
 * Taking every spare pixel made the window wider without fitting another card
 * in it, and the difference went to margins either side of the cards. So the
 * columns are chosen from the room available, and then the book is pulled back
 * in to exactly hold them.
 */
function fitRecipeBookWidth(available: number, showRail: boolean, unitWidth: number) {
  const chrome = recipeBookChrome(showRail);
  const { columns, scale } = chooseRecipeGrid(available - chrome, unitWidth);
  const cards = columns * unitWidth * scale + CARD_GAP * (columns - 1);
  return Math.min(available, chrome + cards);
}

interface RecipeBookViewport {
  /** Filling the screen rather than floating over the board. */
  sheet: boolean;
  /** The category rail is a column of its own, not a dropdown. */
  showRail: boolean;
  dodgesSidebars: boolean;
  width: number;
  height: number;
  /** Measured, not assumed: these columns can be collapsed. */
  sidebars: { left: number; right: number };
}

/**
 * How many cards fit across, and how big to draw each one.
 *
 * Readability wins over density: the scale never drops below 2 while a single
 * column can still hold it, so a narrow book shows one large readable recipe
 * rather than two clipped ones.
 */
function chooseRecipeGrid(
  width: number,
  unitWidth: number = NEI_CANVAS_WIDTH,
): { columns: number; scale: number } {
  const cardAtScaleTwo = unitWidth * 2 + CARD_ADD_GUTTER;
  const columnWidth = (columns: number) => (width - CARD_GAP * (columns - 1)) / columns;

  let columns = 1;
  for (let candidate = RECIPE_CARD_MAX_COLUMNS; candidate >= 2; candidate -= 1) {
    if (columnWidth(candidate) >= cardAtScaleTwo) {
      columns = candidate;
      break;
    }
  }

  const column = columnWidth(columns);
  if (column < cardAtScaleTwo) {
    // A phone. One recipe, drawn to fill the width it has rather than sitting
    // small in the middle of it: a recipe is a grid of 18px slots, and at scale 1
    // on a 390px screen it was a postage stamp with two thirds of the drawer
    // empty beside it. Quantised to quarter steps, because the art is pixels and
    // a whole-pixel-ish scale keeps slot borders from smearing.
    const filling = Math.floor(((width - CARD_ADD_GUTTER) / unitWidth) * 4) / 4;
    return { columns: 1, scale: Math.max(1, Math.min(3, filling)) };
  }

  // A column with room to spare draws the recipe larger rather than leaving it
  // small in the middle of an empty card.
  return { columns, scale: Math.min(3, Math.floor(column / unitWidth)) };
}

function recipeRowHeight(scale: number, native: boolean) {
  const canvas = native ? NEI_CANVAS_HEIGHT_NATIVE : NEI_CANVAS_HEIGHT_DEFAULT;
  return canvas * scale + CARD_CHROME_HEIGHT;
}
const RESOURCE_DEFAULT_PAGE_SIZE = 6;
const RESOURCE_ROW_HEIGHT = 40;
const RESOURCE_ROW_GAP = 2;
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
const RESOURCE_PAGER_HEIGHT = 40;
/** One mouse notch is 100 on most platforms, so one notch is one page. */
const RESOURCE_WHEEL_PAGE_DELTA = 80;
const RESOURCE_VIEW_STORAGE_KEY = "susy-factory-flow.resource-view.v1";
/** Whether the filter block under the search box is folded away. */
const RESOURCE_FILTERS_STORAGE_KEY = "susy-factory-flow.resource-filters.v1";
/** The machine chips' multi-select: which maps' recipes the search shows. */
const MAP_SELECTION_STORAGE_KEY = "susy-factory-flow.machine-map-selection.v1";

type ResourceSortMode = "relevance" | "name" | "mod" | "recipes";
type ResourceViewMode = "list" | "grid";

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
  const colon = resource.id.indexOf(":");
  if (colon > 0) {
    return resource.id.slice(0, colon);
  }
  return resource.kind === "fluid" ? "fluids" : "other";
}
const RECIPE_QUERY_CACHE_TTL_MS = 90_000;
const RECIPE_SEARCH_DEBOUNCE_MS = 200;

interface RecipeBrowserProps {
  onLoadDatasetVersion: (versionId: string) => void;
}

export function RecipeBrowser({ onLoadDatasetVersion }: RecipeBrowserProps) {
  const datasetManifest = useFactoryStore((state) => state.datasetManifest);
  const datasetManifestUrl = useFactoryStore((state) => state.datasetManifestUrl);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const projectRecipes = useFactoryStore((state) => state.project.recipes);
  const recipeSearch = useFactoryStore((state) => state.recipeSearch);
  const maxTier = useFactoryStore((state) => state.maxTierFilter);
  const browserResource = useFactoryStore((state) => state.recipeBrowserResource);
  const browserMode = useFactoryStore((state) => state.recipeBrowserMode);
  const browserSeed = useFactoryStore((state) => state.recipeBrowserSeed);
  const refactorNodeId = useFactoryStore((state) => state.recipeBrowserRefactorNodeId);
  const seedNonce = useFactoryStore((state) => state.recipeBrowserSeedNonce);
  const machinePin = useFactoryStore((state) => state.recipeBrowserMachinePin);
  const addRecipeToNode = useFactoryStore((state) => state.addRecipeToNode);
  const selectedRecipeId = useFactoryStore((state) => state.selectedRecipeId);
  const setRecipeSearch = useFactoryStore((state) => state.setRecipeSearch);
  const setHighlightSearch = useFactoryStore((state) => state.setHighlightSearch);
  const setMaxTier = useFactoryStore((state) => state.setMaxTierFilter);
  const browseResource = useFactoryStore((state) => state.browseResource);
  const browseBack = useFactoryStore((state) => state.browseBack);
  const browseForward = useFactoryStore((state) => state.browseForward);
  const canBrowseBack = useFactoryStore((state) => state.recipeBrowserBack.length > 0);
  const canBrowseForward = useFactoryStore((state) => state.recipeBrowserForward.length > 0);
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
  // The machine chips' selection. Absent means everything is selected (the
  // default); "exclude" carries the unselected chips, "include" the selected
  // ones. Stored rather than derived so a map unselected on one search stays
  // unselected on the next, even across searches where it never appears.
  const [mapSelection, setMapSelection] = useState<RecipeMapSelection | undefined>(undefined);
  // PINNED to a machine: the search is scoped to that machine's maps and the
  // stored chip selection stands aside until the pin comes off.
  const effectiveMapSelection = useMemo<RecipeMapSelection | undefined>(
    () => (machinePin ? { mode: "include", maps: machinePin.recipeMaps } : mapSelection),
    [machinePin, mapSelection],
  );
  // The master switch: what the whole left panel is FOR right now — finding
  // items to build with, stamping saved blueprints, or browsing the network's
  // shared setups. One at a time, full column each; the old bottom-strip
  // library never had room to breathe.
  // A request that arrived before this column was mounted (a phone's drawer is
  // unmounted while closed) is waiting in module state, so the tab it asked for
  // is collected here as well as by the listener below.
  const [sidebarMode, setSidebarMode] = useState<"items">(
    () => takePendingSidebarTab() ?? "items",
  );
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // A request that wanted the search box focused, collected on mount the way
  // the tab is (the panel may have been closed when it was made).
  const [pendingSearchFocus, setPendingSearchFocus] = useState(() => takePendingSearchFocus());
  // The box lights up for a moment as well as taking the cursor: a caret
  // alone is easy to miss, and "Find a recipe" has to visibly do something.
  const [isSearchFlashing, setSearchFlashing] = useState(false);
  useEffect(() => {
    if (!pendingSearchFocus || sidebarMode !== "items") {
      return;
    }
    setPendingSearchFocus(false);
    setSearchFlashing(true);
    // A freshly mounted column paints its search box a few frames in, so
    // the focus keeps trying for up to a second rather than firing once
    // into an empty ref. The loop is deliberately NOT cancelled by the
    // cleanup: the setPendingSearchFocus above re-runs this effect at once,
    // and a cleanup that cancelled the frame killed the focus before it
    // could land. After an unmount the ref is empty and the loop just runs
    // out.
    let tries = 0;
    const tryFocus = () => {
      const input = searchInputRef.current;
      if (input) {
        input.focus();
        input.select();
        return;
      }
      if (tries++ < 60) {
        window.requestAnimationFrame(tryFocus);
      }
    };
    window.requestAnimationFrame(tryFocus);
    // Same story for the flash: left to run out on its own.
    window.setTimeout(() => setSearchFlashing(false), 1400);
  }, [pendingSearchFocus, sidebarMode]);
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
  const pendingRecipePrefetchesRef = useRef<Set<string>>(new Set());
  const debouncedRecipeSearch = useDebouncedValue(recipeSearch, RESOURCE_SEARCH_DEBOUNCE_MS);
  const debouncedRecipeBookSearch = useDebouncedValue(recipeBookSearch, RECIPE_SEARCH_DEBOUNCE_MS);



  // And the general form of the same thing: anything outside the column can
  // ask for a tab by name, and for the cursor in the search box.
  useEffect(() => {
    const openTab = () => {
      const tab = takePendingSidebarTab();
      if (tab) {
        setSidebarMode(tab);
      }
      if (takePendingSearchFocus()) {
        setPendingSearchFocus(true);
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
        selected: isMapSelectedIn(effectiveMapSelection, tab.id),
      })),
    [effectiveMapSelection, recipeMapCounts, recipeMapTabs],
  );

  // The All chip reads from what is on screen: lit when every listed chip is
  // selected, whatever out-of-view maps the stored selection also carries.
  const allRecipeMapsSelected = useMemo(
    () => recipeMaps.every((recipeMap) => isMapSelectedIn(effectiveMapSelection, recipeMap)),
    [effectiveMapSelection, recipeMaps],
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
        machinePin ? `pin:${machinePin.nodeId}:${seedNonce}` : "",
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
    // A pinned browse starts with no condition: the machine is the whole
    // question, and its stand-in resource is not a thing to search for.
    if (browserResource.id === MACHINE_PIN_RESOURCE_ID) {
      return [];
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

  // "Only this machine": the selection becomes that one map, and every
  // other chip goes dark until All or a chip brings it back.
  const selectOnlyRecipeMap = useCallback(
    (recipeMap: string) => {
      changeMapSelection({ mode: "include", maps: [recipeMap] });
    },
    [changeMapSelection],
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
      if (currentState.isReadOnly) return;
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
      const currentMachinePin = welcomeCovered ? undefined : currentState.recipeBrowserMachinePin;
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
        if (currentMachinePin) {
          // The pinned machine's card takes the pick as one more recipe.
          if (!addRecipeToNode(currentMachinePin.nodeId, recipe, { inputPicks })) {
            failRecipeAdd(
              pendingId,
              `No machine runs both ${recipeSummary.name} and what ${currentMachinePin.label} already has.`,
            );
            return;
          }
        } else if (currentRefactorNodeId) {
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
      addRecipeToNode,
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

    const cacheKey = getRecipeQueryKey(effectiveMapSelection, recipePage);
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
          // A pinned browse's stand-in resource is not a question for the
          // dataset; the pin scopes the maps and the stencil asks the rest.
          resource:
            activeResource && activeResource.id !== MACHINE_PIN_RESOURCE_ID
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
          mapSelection: effectiveMapSelection,
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
    effectiveMapSelection,
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
        {(
          // The wheel pages the list from anywhere in the column, including over
          // the controls and the recent shelf: nothing here scrolls, so a wheel
          // that did nothing was just a panel that felt broken.
          <div className="flex min-h-0 flex-1 flex-col">
        {/* The cards that are not recipes - generator, custom rate, crop
            farm - above the search, since this column is where things get
            added from. They came off the board's build tray (2026-09-06). */}
        <SpawnKeys
          leading={
            /* The way to fold this column away, at the start of the top row
               (it used to sit in the search box). On a phone it closes the
               drawer. */
            <button
              type="button"
              onClick={() => writeWorkspaceView({ leftPanelOpen: false })}
              aria-label="Hide the items column"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-100"
            >
              <ChevronIcon direction="left" />
            </button>
          }
        />
        <ResourceIndexPane
          search={recipeSearch}
          onSearchChange={setRecipeSearch}
          searchInputRef={searchInputRef}
          searchFlashing={isSearchFlashing}
          activeResource={activeResource}
          onBrowse={browseResource}
        />
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
          onSelectOnlyRecipeMap={selectOnlyRecipeMap}
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
          browseKey={browseKey}
          canGoBack={canBrowseBack}
          canGoForward={canBrowseForward}
          onBack={browseBack}
          onForward={browseForward}
          contextResource={activeResource}
          searchPickerResources={searchPickerResources}
          machinePin={machinePin}
        />
      ) : null}
    </>
  );
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
const RECENT_STRIP_ROWS = 3;
/** One row on a phone: the shelf was eating a third of a screen of results. */
const RECENT_STRIP_ROWS_COMPACT = 1;
/** And a smaller cell in that row, so the one row still holds a useful handful. */
const RECENT_STRIP_CELL_COMPACT = 44;
/** More than three rows of the widest column could ever show. */
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
  const cell = isCompact ? RECENT_STRIP_CELL_COMPACT : RESOURCE_GRID_CELL;
  const recent = history.slice(0, RECENT_STRIP_LIMIT);
  const rowBrowse = useResourceBrowseMenu(onBrowse);

  if (recent.length === 0) {
    return null;
  }

  return (
    // A card of its own, like the controls at the top of the column: bare, a shelf
    // of loose icons at the foot of a list of icons read as more of the list. The
    // bottom margin keeps it off the very edge of the window.
    <div className="mx-2 mb-3 compact:mb-2 shrink-0 rounded-[6px] border border-neutral-700 bg-[#2a2d33] p-2 compact:p-1.5">
      <div className="mb-1.5 compact:mb-1 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
          Recent
        </span>
        <button
          type="button"
          onClick={clearResourceHistory}
          title="Clear recent items"
          className="text-[10px] font-medium text-neutral-500 hover:text-neutral-200"
        >
          Clear
        </button>
      </div>
      {/* The same cells the grid view uses, so a recent item is as easy to hit and
          as easy to recognise as one in the list above it. auto-fill picks the
          column count from the width, and the height stops it at three rows.
          A phone gets one row of smaller cells: three rows of 56px was a third of
          the screen given to what you looked at last rather than what you are
          looking for, and the cells past the first row were only ever clipped. */}
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
  view,
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
  view: ResourceViewMode;
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
        <ResourceResultSkeleton view={view} pageSize={pageSize} gridColumns={gridColumns} />
      ) : resources.length === 0 ? (
        <div className="rounded border border-dashed border-neutral-600 p-4 text-sm text-neutral-300">
          {emptyLabel ?? "No matching resource."}
        </div>
      ) : (
        <ResourceResultPage
          resources={resources}
          activeResource={activeResource}
          view={view}
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
  view,
  pageSize,
  gridColumns,
}: {
  view: ResourceViewMode;
  pageSize: number;
  gridColumns: number;
}) {
  const count = Math.max(3, Math.min(pageSize, 60));
  if (view === "grid") {
    return (
      <div
        className="grid min-h-0 flex-1 content-start gap-1 overflow-hidden"
        style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}
        aria-label="Loading resources"
      >
        {Array.from({ length: count }, (_, index) => (
          <div
            key={index}
            className="aspect-square animate-pulse rounded-[4px] bg-neutral-800/70"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden" aria-label="Loading resources">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex h-10 shrink-0 items-center gap-2.5 px-1.5">
          <div className="h-8 w-8 animate-pulse rounded-[4px] bg-neutral-800/70" />
          <div
            className="h-3 animate-pulse rounded bg-neutral-800/70"
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
    <div className="mt-1.5 flex h-8 w-full min-w-0 shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={onPreviousPage}
        disabled={currentPage === 0}
        className="flex h-7 w-8 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
        aria-label="Previous resource page"
        title="Previous page"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <div className="min-w-0 flex-1 truncate text-center text-xs text-neutral-400">
        Page {Math.min(currentPage + 1, pageCount)} of {pageCount}
      </div>
      <button
        type="button"
        onClick={onNextPage}
        disabled={currentPage >= pageCount - 1}
        className="flex h-7 w-8 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
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
  view,
  gridColumns,
  isRefreshing,
  onBrowseResource,
}: {
  resources: IndexedResource[];
  activeResource?: IndexedResource;
  view: ResourceViewMode;
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

  if (view === "grid") {
    return (
      <div
        className={[
          "grid min-h-0 flex-1 content-start gap-1 overflow-hidden",
          isRefreshing ? "opacity-60" : "",
        ].join(" ")}
        style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}
        aria-label="Resource results"
        role="listbox"
      >
        {resources.map((resource) => {
          const active =
            activeResource?.kind === resource.kind && activeResource.id === resource.id;
          return (
            // A grid cell is art and nothing else, so the name and the line under
            // it in list view are only ever a hover away. The icon's own tooltip
            // is off: the nearest tooltip to the pointer wins, and this one knows
            // more than the icon does.
            <MinecraftTooltip
              key={`${resource.kind}:${resource.id}`}
              label={resourceTooltipLines(resource)}
            >
              <button
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
        {rowBrowse.menu}
      </div>
    );
  }

  return (
    <div
      className={[
        "flex min-h-0 flex-1 flex-col justify-start gap-0.5 overflow-hidden",
        isRefreshing ? "opacity-60" : "",
      ].join(" ")}
      aria-label="Resource results"
      role="listbox"
    >
      {resources.map((resource) => {
        const active = activeResource?.kind === resource.kind && activeResource.id === resource.id;

        return (
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
            title={resourceLabel(resource)}
            className={[
              "flex h-10 w-full shrink-0 items-center gap-2.5 overflow-hidden rounded-[4px] border px-1.5 text-left text-sm text-neutral-50",
              active
                ? "border-cyan-400 bg-cyan-500/10"
                : "border-transparent hover:bg-white/5",
            ].join(" ")}
            role="option"
            aria-selected={active}
          >
            <span className="minecraft-pixel-art flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden">
              <ResourceIcon
                resource={{ ...resource, amount: 1 }}
                size="sm"
                bare
                showAmount={false}
                tooltip={false}
                // Zoom the art without growing the cell (see crop picker);
                // the wrapper crops the overflow at the 32px cell.
                className="!h-8 !w-8 scale-[1.5]"
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate leading-tight [text-shadow:1px_1px_0_#000]">
                {resourceLabel(resource)}
              </span>
              <span className="block truncate text-[10px] leading-tight text-neutral-500">
                {getResourceModLabel(resource)}
                {resource.recipeCount > 0 ? ` · ${resource.recipeCount} recipes` : ""}
              </span>
            </span>
          </button>
        );
      })}
      {rowBrowse.menu}
    </div>
  );
}

function RecipeBookOverlay({
  activeRecipeMap,
  activeResource,
  filteredRecipes,
  hasMore,
  isLoading,
  query,
  queryError,
  queryTotal,
  recipeMapTabs,
  selectedRecipeId,
  maxTier,
  onMaxTierChange,
  onAdd,
  onAddConnected,
  onPrefetch,
  onBrowseResource,
  onRecipeMapChange,
  onRecipeMapHover,
  onQueryChange,
  onLoadMore,
  onSelectRecipe,
  onClose,
  mode,
}: {
  activeRecipeMap: string;
  activeResource: IndexedResource & { anchorNodeId?: string };
  mode: "recipes" | "uses";
  filteredRecipes: RecipeSummary[];
  hasMore: boolean;
  isLoading: boolean;
  query: string;
  queryError?: string;
  queryTotal: number;
  recipeMapTabs: RecipeMapTab[];
  selectedRecipeId?: string;
  maxTier: TierFilter;
  onMaxTierChange: (tier: TierFilter) => void;
  onAdd: (
    recipe: RecipeSummary,
    machineHandlerId?: string,
    inputPicks?: RecipeInputPicks,
  ) => void | Promise<void>;
  onAddConnected?: (recipeId: string) => void | Promise<void>;
  onPrefetch?: (recipeId: string) => void;
  onBrowseResource: (resource: ResourceAmount, mode: "recipes" | "uses") => void;
  onRecipeMapChange: (recipeMap: string) => void;
  onRecipeMapHover: (recipeMap: string) => void;
  onQueryChange: (query: string) => void;
  onLoadMore: () => void;
  onSelectRecipe: (recipeId: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const layout = useRecipeBookViewport();
  // Flipping between what makes this and what uses it is the same act as opening
  // the book on it, just with the other answer asked for — so it goes through the
  // same door rather than inventing a second one.
  const switchMode = (next: "recipes" | "uses") => {
    if (next !== mode) {
      onBrowseResource({ ...activeResource, amount: 1 }, next);
    }
  };
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [measured, setMeasured] = useState<MeasuredCard>({
    key: "",
    unit: NEI_CANVAS_WIDTH,
    row: 0,
  });
  // A book that fills the screen keeps its width; there is nowhere for a margin
  // to go and shrinking it would only leave a gap at the edge.
  const panelWidth = layout.sheet
    ? layout.width
    : fitRecipeBookWidth(layout.width, layout.showRail, measured.unit);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const displayedRecipes = filteredRecipes;

  // A book that fills the screen has nowhere to be dragged to, so it ignores
  // any offset rather than forgetting it: shrink the window and drag it, and
  // widening the window again puts it back where it was left.
  const appliedOffset = layout.sheet ? ZERO_OFFSET : dragOffset;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || layout.sheet) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: dragOffset.x,
      originY: dragOffset.y,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    setDragOffset(
      clampDragOffset(
        {
          x: drag.originX + event.clientX - drag.startX,
          y: drag.originY + event.clientY - drag.startY,
        },
        panelRef.current,
      ),
    );
  };

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  return (
    <div
      className={[
        "pointer-events-auto fixed inset-0 flex items-center justify-center",
        // While the book steps around the board's sidebars it sits under them,
        // so they stay usable. Once it stops stepping around them it has to
        // sit over them, or they clip the book instead.
        layout.dodgesSidebars ? "z-30" : "z-50",
        layout.sheet ? "" : "px-3 py-4",
      ].join(" ")}
      onPointerDown={onClose}
      style={
        layout.dodgesSidebars
          ? { paddingLeft: layout.sidebars.left, paddingRight: layout.sidebars.right }
          : undefined
      }
    >
      <section
        ref={panelRef}
        className="pointer-events-auto relative flex flex-col font-mono"
        aria-label="Recipe book"
        onPointerDown={(event) => event.stopPropagation()}
        style={{
          transform: `translate(${appliedOffset.x}px, ${appliedOffset.y}px)`,
          width: layout.sheet ? "100%" : `min(${panelWidth}px, 100%)`,
          height: layout.sheet ? "100%" : `min(${layout.height}px, 100%)`,
        }}
      >
        <div className="relative flex min-h-0 flex-1 overflow-hidden border-2 border-[var(--mc-96)] bg-[var(--mc-78)] text-[var(--mc-ink)] shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33)]">
          {layout.showRail ? (
            <CategoryRail
              activeResource={activeResource}
              mode={mode}
              tabs={recipeMapTabs}
              activeRecipeMap={activeRecipeMap}
              onRecipeMapChange={onRecipeMapChange}
              onRecipeMapHover={onRecipeMapHover}
              onModeChange={switchMode}
            />
          ) : null}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {layout.sheet ? (
            <SheetBookHeader
              activeResource={activeResource}
              mode={mode}
              tabs={recipeMapTabs}
              activeRecipeMap={activeRecipeMap}
              machineRecipe={filteredRecipes[0]}
              onRecipeMapChange={onRecipeMapChange}
              onModeChange={switchMode}
              onClose={onClose}
            />
          ) : (
            <>
              {layout.showRail ? null : (
                <CategoryPicker
                  activeResource={activeResource}
                  mode={mode}
                  tabs={recipeMapTabs}
                  activeRecipeMap={activeRecipeMap}
                  onRecipeMapChange={onRecipeMapChange}
                  onModeChange={switchMode}
                  showModeSwitch
                />
              )}
              <div className="px-2 pt-2">
                <div
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  className="flex h-11 cursor-move select-none items-center gap-3 border-2 border-[var(--mc-33)] bg-[var(--mc-61)] px-2 shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-29)]"
                >
                  {/* The title takes the slack so the machines and the close
                      button stay pinned to the right rather than floating in the
                      middle of a wide bar. */}
                  <span className="min-w-0 flex-1 leading-[1.1]">
                    <span className="block text-[8px] font-bold uppercase tracking-[0.14em] text-[#ececec] [text-shadow:1px_1px_0_#4a4a4a]">
                      Category · recipe map
                    </span>
                    <span className="minecraft-title block truncate text-[17px] leading-[20px] text-white [text-shadow:2px_2px_0_var(--mc-24)]">
                      {activeRecipeMap ||
                        filteredRecipes[0]?.machineType ||
                        resourceLabel(activeResource)}
                    </span>
                  </span>
                  <CategoryMachineStrip recipe={filteredRecipes[0]} />
                  {/*
                    The book used to be closed only by clicking the board around
                    it. Now that it can cover the whole screen there may be no
                    board left to click, so it says how to leave.
                  */}
                  <button
                    type="button"
                    title="Close recipe book (Esc)"
                    aria-label="Close recipe book"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={onClose}
                    className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center border-2 border-[var(--mc-33)] bg-[var(--mc-71)] text-[var(--mc-ink)] hover:bg-[var(--mc-85)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          )}

          <div className="flex gap-2 px-3 pt-2">
            <label className="flex h-9 min-w-0 flex-1 items-center gap-2 border-2 border-[var(--mc-33)] bg-[#17191d] px-2 text-sm text-neutral-100 shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607]">
              <Search className="h-4 w-4 text-neutral-500" />
              <input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Search ingredient..."
                className="min-w-0 flex-1 bg-transparent text-neutral-100 outline-none placeholder:text-neutral-500"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => onQueryChange("")}
                  className="text-neutral-400 hover:text-white"
                  aria-label="Clear recipe book search"
                  title="Clear recipe book search"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </label>
            <select
              value={maxTier}
              onChange={(event) => onMaxTierChange(event.target.value as TierFilter)}
              title="Highest tier"
              aria-label="Maximum machine tier"
              className="h-9 w-28 shrink-0 border-2 border-[var(--mc-33)] bg-[#17191d] px-1.5 text-sm text-neutral-100 outline-none shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607]"
            >
              <option value="all">All tiers</option>
              {GT_VOLTAGE_TIERS.map((entry) => (
                <option key={entry.tier} value={entry.tier}>
                  ≤ {entry.tier}
                </option>
              ))}
            </select>
          </div>

          <div
            // On a phone the padding is the difference between a recipe drawn
            // at readable size and one drawn at half of it, because a card
            // only steps in whole sizes.
            className={["min-h-0 flex-1 overflow-y-auto", layout.sheet ? "p-1" : "p-3"].join(" ")}
            id="recipe-book-scroll"
          >
            {queryError ? (
              <div className="border-2 border-[var(--mc-47)] bg-[var(--mc-71)] p-3 text-sm shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
                {queryError}
              </div>
            ) : isLoading && filteredRecipes.length === 0 ? (
              <div className="border-2 border-[var(--mc-47)] bg-[var(--mc-71)] p-3 text-sm shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
                Loading recipes...
              </div>
            ) : displayedRecipes.length === 0 ? (
              <div className="grid min-h-[260px] place-items-center border-2 border-[var(--mc-47)] bg-[var(--mc-71)] p-3 text-sm shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
                No matching recipes.
              </div>
            ) : (
              <VirtualRecipeResultList
                recipes={displayedRecipes}
                queryTotal={queryTotal}
                currentPage={0}
                pageSize={RECIPE_QUERY_LIMIT}
                selectedRecipeId={selectedRecipeId}
                onSelectRecipe={onSelectRecipe}
                onAdd={onAdd}
                onAddConnected={onAddConnected}
                onPrefetch={onPrefetch}
                onSlotBrowse={onBrowseResource}
                contextResource={activeResource}
                hasMore={hasMore}
                isLoadingMore={isLoading && displayedRecipes.length > 0}
                onLoadMore={onLoadMore}
                measured={measured}
                onMeasured={setMeasured}
              />
            )}
          </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * The category rail folded into one row, for a book too narrow to spare 290px
 * for a column. Same job as {@link CategoryRail}: say what is being looked at,
 * and switch recipe map.
 */
function CategoryPicker({
  activeResource,
  mode,
  tabs,
  activeRecipeMap,
  onRecipeMapChange,
  onModeChange,
  showModeSwitch,
}: {
  activeResource: IndexedResource;
  mode: "recipes" | "uses";
  tabs: RecipeMapTab[];
  activeRecipeMap: string;
  onRecipeMapChange: (recipeMap: string) => void;
  onModeChange: (mode: "recipes" | "uses") => void;
  showModeSwitch: boolean;
}) {
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2 border-b-2 border-[var(--mc-55)] bg-[var(--mc-71)] p-2">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center bg-[var(--mc-55)] shadow-[inset_2px_2px_0_var(--mc-25),inset_-2px_-2px_0_var(--mc-100)]">
        <ResourceIcon
          resource={{ ...activeResource, amount: 1 }}
          size="sm"
          bare
          showAmount={false}
          tooltip={false}
          className="!h-full !w-full"
          iconPixelSize={machineArtPixels(40)}
        />
      </span>
      <span className="min-w-0 flex-1 leading-[1.15]">
        {/* On a full-screen sheet the switch sits on the bar below instead, where
            the category title used to be: here it would be fighting the category
            dropdown for the same 340px. */}
        {showModeSwitch ? (
          <RecipeModeSwitch mode={mode} onModeChange={onModeChange} />
        ) : (
          <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--mc-ink-muted)]">
            {mode === "uses" ? "Uses of" : "Recipes for"}
          </span>
        )}
        <span className="mt-0.5 block truncate text-[14px] font-bold text-[var(--mc-ink)]">
          {resourceLabel(activeResource)}
        </span>
      </span>
      <label className="flex min-w-0 shrink items-center">
        <span className="sr-only">Category</span>
        <select
          value={activeRecipeMap}
          onChange={(event) => onRecipeMapChange(event.target.value)}
          className="h-9 w-[150px] max-w-full border-2 border-[var(--mc-33)] bg-[#17191d] px-1.5 text-sm text-neutral-100 outline-none shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607]"
        >
          {tabs.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/**
 * The book's head on a phone, in the order the questions are actually asked.
 *
 * It used to read bottom-up: an item, a caption saying which mode you were in, the
 * category to look in — and then, on the line BELOW that, the switch between the
 * two modes. But the mode decides which categories exist at all, so changing it
 * changed the dropdown above it, which is the wrong way round for a person to read.
 * And the way out sat on that lower bar, where it looked like it belonged to the
 * category rather than to the window.
 *
 * So: what you are looking at, which question you are asking, and how to leave, all
 * on the first line; the category and the machines that run it on the second. The
 * "Recipes for" caption is gone — the two buttons say it, and say it better for
 * being pressable.
 */
function SheetBookHeader({
  activeResource,
  mode,
  tabs,
  activeRecipeMap,
  machineRecipe,
  onRecipeMapChange,
  onModeChange,
  onClose,
}: {
  activeResource: IndexedResource;
  mode: "recipes" | "uses";
  tabs: RecipeMapTab[];
  activeRecipeMap: string;
  machineRecipe?: RecipeSummary;
  onRecipeMapChange: (recipeMap: string) => void;
  onModeChange: (mode: "recipes" | "uses") => void;
  onClose: () => void;
}) {
  return (
    <div className="shrink-0 border-b-2 border-[var(--mc-55)] bg-[var(--mc-71)] p-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-[var(--mc-55)] shadow-[inset_2px_2px_0_var(--mc-25),inset_-2px_-2px_0_var(--mc-100)]">
          <ResourceIcon
            resource={{ ...activeResource, amount: 1 }}
            size="sm"
            bare
            showAmount={false}
            tooltip={false}
            className="!h-full !w-full"
            iconPixelSize={machineArtPixels(36)}
          />
        </span>
        <span className="min-w-0 flex-1 truncate text-[15px] font-bold leading-tight text-[var(--mc-ink)]">
          {resourceLabel(activeResource)}
        </span>
        <RecipeModeSwitch mode={mode} onModeChange={onModeChange} dense />
        {/* On the title's line, where a window's close button lives, rather than
            down beside the category where it read as closing the category. */}
        <button
          type="button"
          title="Close recipe book (Esc)"
          aria-label="Close recipe book"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center border-2 border-[var(--mc-33)] bg-[var(--mc-61)] text-[var(--mc-ink)] shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 flex min-w-0 items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center">
          <span className="sr-only">Category</span>
          <select
            value={activeRecipeMap}
            onChange={(event) => onRecipeMapChange(event.target.value)}
            className="h-9 w-full min-w-0 border-2 border-[var(--mc-33)] bg-[#17191d] px-1.5 text-sm text-neutral-100 outline-none shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607]"
          >
            {tabs.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.label}
              </option>
            ))}
          </select>
        </label>
        <CategoryMachineStrip recipe={machineRecipe} compact />
      </div>
    </div>
  );
}

/**
 * Which question the book is answering, as two pills.
 *
 * It used to be a caption — "Recipes for" or "Uses of" — which stated the mode and
 * gave no way to change it: the only way to the other half was to go back to the
 * list and use the other mouse button, and on a phone there was no other button.
 * The label was already there, in the right place, saying the right thing; making
 * it the control costs no room at all.
 */
function RecipeModeSwitch({
  mode,
  onModeChange,
  dense = false,
}: {
  mode: "recipes" | "uses";
  onModeChange: (mode: "recipes" | "uses") => void;
  /** On a phone's bar it shares 340px with the machine strip and the way out. */
  dense?: boolean;
}) {
  const pill = (value: "recipes" | "uses", label: string, title: string) => (
    <button
      key={value}
      type="button"
      onClick={() => onModeChange(value)}
      title={title}
      aria-pressed={mode === value}
      className={[
        "h-5 shrink-0 whitespace-nowrap font-bold uppercase",
        dense ? "px-1 text-[9px]" : "px-1.5 text-[10px] tracking-[0.1em]",
        mode === value
          ? "bg-[var(--mc-85)] text-white shadow-[inset_1px_1px_0_var(--mc-100)]"
          : "text-[var(--mc-ink-muted)] hover:text-[var(--mc-ink)]",
      ].join(" ")}
    >
      {label}
    </button>
  );

  return (
    // `max-w-full`: in a flex row that has shrunk, a `w-fit` child otherwise
    // overflows its share rather than shrinking, and lands under its neighbour.
    <span className="flex w-fit max-w-full items-center overflow-hidden border-2 border-[var(--mc-33)] bg-[var(--mc-61)]">
      {pill("recipes", "Makes", "Recipes that make this")}
      {pill("uses", "Uses", "Recipes that use this")}
    </span>
  );
}

/** Vertical category (recipe map) rail: the master picker's first level. */
function CategoryRail({
  activeResource,
  mode,
  tabs,
  activeRecipeMap,
  onRecipeMapChange,
  onRecipeMapHover,
  onModeChange,
}: {
  activeResource: IndexedResource;
  mode: "recipes" | "uses";
  tabs: RecipeMapTab[];
  activeRecipeMap: string;
  onRecipeMapChange: (recipeMap: string) => void;
  onRecipeMapHover: (recipeMap: string) => void;
  onModeChange: (mode: "recipes" | "uses") => void;
}) {
  return (
    <div className="flex w-[290px] shrink-0 flex-col border-r-2 border-[var(--mc-47)] bg-[var(--mc-71)]">
      <div className="flex items-center gap-2.5 border-b-2 border-[var(--mc-55)] p-2.5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center bg-[var(--mc-55)] shadow-[inset_2px_2px_0_var(--mc-25),inset_-2px_-2px_0_var(--mc-100)]">
          <ResourceIcon
            resource={{ ...activeResource, amount: 1 }}
            size="sm"
            bare
            showAmount={false}
            tooltip={false}
            className="!h-full !w-full"
            iconPixelSize={machineArtPixels(48)}
          />
        </span>
        <span className="min-w-0 leading-[1.15]">
          <RecipeModeSwitch mode={mode} onModeChange={onModeChange} />
          <span className="mt-0.5 block truncate text-[16px] font-bold text-[var(--mc-ink)]">
            {resourceLabel(activeResource)}
          </span>
        </span>
      </div>
      <div className="px-2.5 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--mc-ink-muted)]">
        Categories
      </div>
      <div className="nowheel min-h-0 flex-1 overflow-y-auto p-2">
        {tabs.map((tab) => {
          const active = tab.id === activeRecipeMap;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onRecipeMapChange(tab.id)}
              onMouseEnter={() => onRecipeMapHover(tab.id)}
              className={[
                "mb-1 grid w-full grid-cols-[42px_minmax(0,1fr)] items-center gap-2.5 border-2 px-1.5 py-1.5 text-left",
                active
                  ? "border-[var(--mc-15)] bg-[var(--mc-85)] shadow-[inset_2px_2px_0_var(--mc-100),0_0_0_2px_#22d3ee_inset]"
                  : "border-[var(--mc-47)] bg-[var(--mc-78)] shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-47)] hover:bg-[var(--mc-85)]",
              ].join(" ")}
            >
              <span className="flex h-[42px] w-[42px] items-center justify-center bg-[var(--mc-55)] shadow-[inset_2px_2px_0_var(--mc-25),inset_-2px_-2px_0_var(--mc-100)]">
                {tab.icon ? (
                  <ResourceIcon
                    resource={{ ...tab.icon, amount: 1 }}
                    size="sm"
                    bare
                    showAmount={false}
                    tooltip={false}
                    className="!h-full !w-full"
                    iconPixelSize={machineArtPixels(42)}
                  />
                ) : null}
              </span>
              <span className="min-w-0 truncate text-[15px] font-bold leading-5 text-[var(--mc-ink)]">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Mini strip of the machines that can run the open category. */
function CategoryMachineStrip({
  recipe,
  compact = false,
}: {
  recipe?: RecipeSummary;
  /** A phone's bar shares its width with the mode switch: icons only, and fewer. */
  compact?: boolean;
}) {
  const machineIcons = useMachineHandlerIcons();
  const handlers = useMemo(
    () => (recipe ? getRecipeMachineHandlers(summaryToPreviewRecipe(recipe)) : []),
    [recipe],
  );
  if (handlers.length <= 1) {
    return null;
  }
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1">
      {compact ? null : (
        <span className="pr-1 text-[8px] font-bold uppercase tracking-[0.1em] text-[#ececec] [text-shadow:1px_1px_0_#4a4a4a]">
          {handlers.length} machines
        </span>
      )}
      {handlers.slice(0, compact ? 4 : 8).map((handler) => {
        const icon = machineIcons.get(handler.id);
        return (
          <span
            key={handler.id}
            title={handler.label}
            className="flex h-7 w-7 items-center justify-center bg-[var(--mc-55)] shadow-[inset_2px_2px_0_#373737,inset_-2px_-2px_0_#ffffff]"
          >
            {icon ? (
              <ResourceIcon
                resource={{ ...icon, amount: 1 }}
                size="sm"
                bare
                showAmount={false}
                tooltip={false}
                className="!h-full !w-full"
                iconPixelSize={machineArtPixels(28)}
              />
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

function VirtualRecipeResultList({
  recipes,
  queryTotal,
  currentPage,
  pageSize,
  selectedRecipeId,
  onSelectRecipe,
  onAdd,
  onAddConnected,
  onPrefetch,
  onSlotBrowse,
  contextResource,
  hasMore,
  isLoadingMore,
  onLoadMore,
  measured,
  onMeasured,
}: {
  recipes: RecipeSummary[];
  queryTotal: number;
  currentPage: number;
  pageSize: number;
  selectedRecipeId?: string;
  onSelectRecipe: (recipeId: string) => void;
  onAdd: (
    recipe: RecipeSummary,
    machineHandlerId?: string,
    inputPicks?: RecipeInputPicks,
  ) => void | Promise<void>;
  onAddConnected?: (recipeId: string) => void | Promise<void>;
  onPrefetch?: (recipeId: string) => void;
  onSlotBrowse: (resource: ResourceAmount, mode: "recipes" | "uses") => void;
  contextResource?: PreviewContextResource;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  /**
   * How wide one recipe draws, unscaled. Held by the book rather than here so
   * the book can shrink to fit whole cards instead of handing the difference
   * to the margins.
   */
  measured: MeasuredCard;
  onMeasured: (measured: MeasuredCard) => void;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 360, width: 640 });
  // `usesNativeNeiChrome` resolves a layout per call, and infinite scroll keeps
  // growing this array (120, 240, 360...), so it must not run on every scroll
  // frame.
  const native = useMemo(() => recipes.some(usesNativeNeiChrome), [recipes]);
  // How wide a recipe actually draws cannot be worked out ahead of time: the
  // panel grows to fit whatever slots the recipe has, and nothing in the
  // dataset records the result. Assuming the common width laid out columns
  // narrower than the cards in them, so cards overlapped their neighbours and
  // the corner of one disappeared under the next. So the cards are measured,
  // and the answer is thrown away whenever the list changes rather than
  // letting one wide category narrow every later one.
  const listKey = recipes.length > 0 ? `${recipes[0].id}:${recipes.length}` : "";
  const unitWidth = measured.key === listKey ? measured.unit : NEI_CANVAS_WIDTH;
  const { columns: columnCount, scale } = chooseRecipeGrid(viewport.width, unitWidth);
  // Every row is assumed to be exactly this tall, so the layout is made to
  // match rather than the other way round: recipes with a long list of outputs
  // draw much taller cards than the estimate, and a row that ran over its
  // share left the list reporting less height than it had. Scrolling down then
  // ran past the end, the browser pulled the scroll position back, and the
  // list could never reach its own bottom.
  const cardHeight = Math.max(
    recipeRowHeight(scale, native),
    measured.key === listKey ? measured.row : 0,
  );
  const rowHeight = cardHeight + CARD_GAP;
  const gridRef = useRef<HTMLDivElement>(null);
  // Read inside the observer, which must not be torn down and rebuilt every
  // time a measurement lands.
  const measuredRef = useRef(measured);
  useEffect(() => {
    measuredRef.current = measured;
  }, [measured]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) {
      return;
    }

    const observer = new ResizeObserver(() => {
      setViewport((current) =>
        current.width === grid.clientWidth ? current : { ...current, width: grid.clientWidth },
      );

      let unit = 0;
      let tallest = 0;
      for (const card of grid.children) {
        const box = card.getBoundingClientRect();
        const drawnAt = Number(card.getAttribute("data-card-scale")) || 1;
        // The unscaled width is what the next scale choice has to be made
        // from. The height is kept as drawn, since that is what a row holds.
        unit = Math.max(unit, box.width / drawnAt);
        tallest = Math.max(tallest, box.height);
      }
      if (unit <= 0) {
        return;
      }
      unit = Math.ceil(unit);
      const row = Math.ceil(tallest);
      const current = measuredRef.current;
      if (current.key !== listKey || unit > current.unit || row > current.row) {
        onMeasured({
          key: listKey,
          unit: current.key === listKey ? Math.max(current.unit, unit) : unit,
          row: current.key === listKey ? Math.max(current.row, row) : row,
        });
      }
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, [listKey, onMeasured, scale]);
  const overscan = 1;
  const rowCount = Math.ceil(recipes.length / columnCount);
  const startRow = Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - overscan);
  const visibleRowCount = Math.ceil(viewport.height / rowHeight) + overscan * 2;
  const visibleStartIndex = startRow * columnCount;
  const visibleRecipes = recipes.slice(
    visibleStartIndex,
    visibleStartIndex + visibleRowCount * columnCount,
  );
  const topPadding = startRow * rowHeight;
  const bottomPadding = Math.max(
    0,
    (rowCount - startRow - Math.ceil(visibleRecipes.length / columnCount)) * rowHeight,
  );

  useEffect(() => {
    const scrollParent = anchorRef.current?.parentElement;
    if (!scrollParent) {
      return;
    }

    const updateViewport = () => {
      setViewport({
        scrollTop: scrollParent.scrollTop,
        height: scrollParent.clientHeight,
        // The grid's own width, not the scroller's: the scroller's includes its
        // padding, and counting that as room for cards made the columns come
        // out a padding wider than the cards could ever fill.
        width: gridRef.current?.clientWidth ?? scrollParent.clientWidth,
      });
    };

    updateViewport();
    scrollParent.addEventListener("scroll", updateViewport, { passive: true });
    const resizeObserver = new ResizeObserver(updateViewport);
    resizeObserver.observe(scrollParent);

    return () => {
      scrollParent.removeEventListener("scroll", updateViewport);
      resizeObserver.disconnect();
    };
  }, [recipes.length]);

  useEffect(() => {
    const scrollParent = anchorRef.current?.parentElement;
    if (!scrollParent || !hasMore || isLoadingMore) {
      return;
    }

    const threshold = 360;
    const remaining =
      scrollParent.scrollHeight - scrollParent.scrollTop - scrollParent.clientHeight;
    if (remaining <= threshold) {
      onLoadMore();
    }
  }, [hasMore, isLoadingMore, onLoadMore, viewport.scrollTop, viewport.height, recipes.length]);

  return (
    <div
      ref={anchorRef}
      title={
        queryTotal > recipes.length
          ? `${queryTotal} recipes matched, showing ${currentPage * pageSize + 1}-${Math.min(
              queryTotal,
              currentPage * pageSize + recipes.length,
            )}`
          : undefined
      }
    >
      <div style={{ height: topPadding }} />
      <div
        ref={gridRef}
        className="grid items-start justify-items-center gap-3"
        style={{
          gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
          // Pinned, so a row can never take more room than the list set aside
          // for it. With the gap, each row occupies exactly one rowHeight.
          gridAutoRows: `${cardHeight}px`,
        }}
      >
        {visibleRecipes.map((recipe) => (
          <RecipeResultCard
            key={recipe.id}
            recipe={recipe}
            selected={selectedRecipeId === recipe.id}
            onSelectRecipe={onSelectRecipe}
            onAdd={onAdd}
            onAddConnected={onAddConnected}
            onPrefetch={onPrefetch}
            onSlotBrowse={onSlotBrowse}
            contextResource={contextResource}
            scale={scale}
          />
        ))}
      </div>
      {isLoadingMore ? (
        <div className="mt-3 border-2 border-[var(--mc-47)] bg-[var(--mc-71)] p-3 text-center text-sm shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
          Loading recipes...
        </div>
      ) : null}
      <div style={{ height: bottomPadding }} />
    </div>
  );
}

const RecipeResultCard = memo(function RecipeResultCard({
  recipe,
  selected,
  onSelectRecipe,
  onAdd,
  onAddConnected,
  onPrefetch,
  onSlotBrowse,
  contextResource,
  scale = 2,
}: {
  recipe: RecipeSummary;
  selected: boolean;
  onSelectRecipe: (recipeId: string) => void;
  onAdd: (
    recipe: RecipeSummary,
    machineHandlerId?: string,
    inputPicks?: RecipeInputPicks,
  ) => void | Promise<void>;
  onAddConnected?: (recipeId: string) => void | Promise<void>;
  onPrefetch?: (recipeId: string) => void;
  onSlotBrowse?: (resource: ResourceAmount, mode: "recipes" | "uses") => void;
  contextResource?: PreviewContextResource;
  /** How large to draw the recipe. Set by the grid from the width it has. */
  scale?: number;
}) {
  const previewRecipe = useMemo(
    () => contextualizePreviewRecipe(summaryToPreviewRecipe(recipe), contextResource),
    [contextResource, recipe],
  );
  // Written by the cycling slots on every face change and read only here, on
  // click, so a rotating card never re-renders on the clock.
  const facesRef = useAlternativeCycleFacesRef();
  const currentPicks = useCallback(
    () => Object.fromEntries(facesRef.current) as RecipeInputPicks,
    [facesRef],
  );
  const seconds = recipe.durationTicks / 20;
  // A pointer that settles on a card is probably about to press its plus, so
  // the full recipe starts travelling now. The short fuse keeps a pointer
  // sweeping across the grid from requesting every card it crosses.
  const prefetchTimerRef = useRef<number | undefined>(undefined);
  const cancelPrefetch = useCallback(() => {
    if (prefetchTimerRef.current !== undefined) {
      window.clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = undefined;
    }
  }, []);
  const armPrefetch = useCallback(() => {
    if (!onPrefetch) {
      return;
    }
    cancelPrefetch();
    prefetchTimerRef.current = window.setTimeout(() => {
      prefetchTimerRef.current = undefined;
      onPrefetch(recipe.id);
    }, 150);
  }, [cancelPrefetch, onPrefetch, recipe.id]);
  useEffect(() => cancelPrefetch, [cancelPrefetch]);

  return (
    <AlternativeCycleScope facesRef={facesRef}>
    <article
      // The scale this card was actually drawn at. The measurer reads it from
      // here rather than from React state, which can be a render ahead of the
      // DOM: pairing a new scale with a width drawn at the old one inflates
      // the measurement, and since it only ever grows, the error would stick.
      data-card-scale={scale}
      onClick={() => onSelectRecipe(recipe.id)}
      onDoubleClick={() => void onAdd(recipe, undefined, currentPicks())}
      onPointerEnter={armPrefetch}
      onPointerLeave={cancelPrefetch}
      className={[
        "relative cursor-pointer transition",
        selected ? "ring-1 ring-cyan-400" : "",
      ].join(" ")}
    >
      {/*
        Everything the card offers now sits on the recipe's own panel: the add
        button in its top corner and the time along its foot. The card is then
        exactly as wide as the panel, so a small recipe takes a small card
        instead of being padded out to a fixed width.
      */}
      <div
        className="relative w-fit overflow-hidden pb-[3px]"
        style={{ backgroundColor: NEI_PALETTE.panel }}
      >
        <NeiRecipeWindow
          recipe={previewRecipe}
          scale={scale}
          // A compact recipe takes its size from the slot, not from `scale`,
          // so the chosen scale has to be expressed as one. 20 keeps scale 2
          // drawing exactly the size these cards have always been.
          compactSlotPixelSize={20 * scale}
          compact
          hideStats
          contextResource={contextResource}
          onSlotClick={onSlotBrowse ? (slot, mode) => onSlotBrowse(slot.resource, mode) : undefined}
        />
        <div
          className="flex h-8 items-center gap-2 px-1.5 text-[11px] leading-none"
          style={{ color: NEI_PALETTE.borderDark }}
        >
          <span className="min-w-0 flex-1 truncate">
            Time: {formatRate(seconds, seconds >= 10 ? 0 : 1)} s
          </span>
          <CircuitSetting recipe={previewRecipe} />
        </div>
        <button
          type="button"
          title={onAddConnected ? "Add and connect recipe node" : "Add recipe node"}
          aria-label={onAddConnected ? "Add and connect recipe node" : "Add recipe node"}
          onClick={(event) => {
            event.stopPropagation();
            if (onAddConnected) {
              onAddConnected(recipe.id);
            } else {
              onAdd(recipe, undefined, currentPicks());
            }
          }}
          className="absolute right-[3px] top-[3px] z-10 inline-flex h-6 w-6 items-center justify-center border border-[#5a5a5a] bg-[#3b3b3b] text-neutral-100 hover:border-cyan-400 hover:text-cyan-200"
        >
          {onAddConnected ? <GitBranchPlus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        </button>
      </div>
    </article>
    </AlternativeCycleScope>
  );
});

/**
 * The number a machine's circuit slot has to be dialled to, or the empty slot
 * saying it does not care.
 *
 * Every GregTech machine has this slot, so the card always says where it
 * stands: a recipe that needs circuit 11 will not run on circuit 2, and a
 * recipe showing the empty slot runs whatever the circuit is set to. Leaving
 * it off entirely is what made the two cases impossible to tell apart.
 */
function CircuitSetting({ recipe }: { recipe: Recipe }) {
  const circuit = getRecipeProgrammedCircuit(recipe);
  if (!circuit) {
    return null;
  }

  const setting = circuit.setting;

  return (
    <span
      title={
        setting
          ? `Programmed circuit: set to ${setting}`
          : "No circuit setting: runs whatever the circuit is set to"
      }
      className="flex h-7 shrink-0 items-center gap-1"
    >
      {/*
        Always the drawn slot, never the circuit's own art. A recipe that dials
        a circuit already shows the item in its slots, so putting it here too
        would say the same thing twice in the space of one card.
      */}
      <Cpu className="h-5 w-5" style={{ color: NEI_PALETTE.borderDark }} />
      <span
        className="text-[13px] font-bold leading-none tabular-nums"
        style={{ color: NEI_PALETTE.borderDarker }}
      >
        {setting ?? "-"}
      </span>
    </span>
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

function clampDragOffset(offset: { x: number; y: number }, panel: HTMLElement | null) {
  if (!panel || typeof window === "undefined") {
    return offset;
  }

  const rect = panel.getBoundingClientRect();
  const margin = 12;
  const maxX = Math.max(0, (window.innerWidth - rect.width) / 2 - margin);
  const maxY = Math.max(0, (window.innerHeight - rect.height) / 2 - margin);
  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y)),
  };
}

function readRecipeBookViewport(): RecipeBookViewport {
  if (typeof window === "undefined") {
    return {
      sheet: false,
      showRail: true,
      dodgesSidebars: true,
      width: 960,
      height: 760,
      sidebars: { left: BOARD_SIDEBAR_LEFT, right: BOARD_SIDEBAR_RIGHT },
    };
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  if (viewportWidth < RECIPE_BOOK_SHEET_BELOW) {
    return {
      sheet: true,
      showRail: false,
      dodgesSidebars: false,
      width: viewportWidth,
      height: viewportHeight,
      sidebars: { left: 0, right: 0 },
    };
  }

  const besideSidebars = viewportWidth - BOARD_SIDEBAR_LEFT - BOARD_SIDEBAR_RIGHT - 24;
  const dodgesSidebars = besideSidebars >= RECIPE_BOOK_COMFORTABLE_WIDTH;
  const available = dodgesSidebars ? besideSidebars : viewportWidth - 24;
  return {
    sheet: false,
    showRail: available >= RECIPE_BOOK_RAIL_NEEDS,
    dodgesSidebars,
    width: Math.min(RECIPE_BOOK_MAX_WIDTH, Math.max(RECIPE_BOOK_MIN_WIDTH, available)),
    height: Math.min(RECIPE_BOOK_MAX_HEIGHT, Math.max(360, viewportHeight - 32)),
    sidebars: {
      left: dodgesSidebars ? BOARD_SIDEBAR_LEFT : 0,
      right: dodgesSidebars ? BOARD_SIDEBAR_RIGHT : 0,
    },
  };
}

function useRecipeBookViewport(): RecipeBookViewport {
  const [viewport, setViewport] = useState(readRecipeBookViewport);
  useEffect(() => {
    const update = () => setViewport(readRecipeBookViewport());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return viewport;
}

function recipeHasRenderableIcons(recipe: Recipe) {
  return [...recipe.inputs, ...recipe.outputs]
    .filter((resource) => resource.kind === "item")
    .every((resource) => Boolean(resource.iconPath || resource.iconAtlas));
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



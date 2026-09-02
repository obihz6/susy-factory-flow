"use client";

import { ArrowLeftRight, Plus, Search, Star, X, Zap } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  UIEvent,
} from "react";
import type { DatasetResourceIndexEntry, RecipeSummary } from "@/lib/datasets/types";
import type { RecipeQueryRole, RecipeQuerySideOp } from "@/lib/datasets/recipe-query";
import {
  AUTO_WORKBENCH_HANDLER_ID,
  GT_VOLTAGE_TIERS,
  formatRate,
  getRecipeMachineHandlers,
  isOreDictionaryResource,
  resourceMatchesInput,
} from "@/lib/model";
import type { MachineTier, ResourceAmount } from "@/lib/model/types";
import { energyPerUnitSuffix, type TimeRateUnit } from "@/lib/model/rate-unit";
import { formatCompact } from "@/lib/model/resources";
import { playBoardSound } from "@/lib/board-sounds";
import { ENERGY_READING_TEXT } from "./flow/flow-explainers";
import { GT_TIER_COLORS } from "./flow/tier-colors";
import type { RecipeInputPicks, TierFilter } from "@/store/factory-store";
import {
  applyAlternativeCycleFace,
  getAlternativeCycleFaces,
  type AlternativeCycleFace,
} from "@/lib/nei/alternative-cycle";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useIsCompactViewport } from "@/lib/compact-view";
import { machineArtPixels } from "./flow/MachinePicker";
import { useMachineHandlerIcons } from "./flow/machine-icons";
import { ResourceIcon } from "./nei/ResourceIcon";
import {
  contextualizePreviewRecipe,
  summaryToPreviewRecipe,
  type PreviewContextResource,
} from "./recipe-preview";
import {
  POWER_EU_CLAUSE_ID,
  queryAsksForPower,
  searchPowerSourcesForStencil,
  type PowerStencilHit,
} from "@/lib/power/power-search";
import { getPowerMachineIcon, resolvePowerResource } from "@/lib/power/planner-data";
import { formatAmount } from "@/lib/power/sources/helpers";
import { buildPowerSettingsReader, type PowerSourceDefinition } from "@/lib/power/types";
import { useFactoryStore } from "@/store/factory-store";

/**
 * One condition on the stencil: a resource and the side of the recipe it must
 * appear on, dressed to draw its own chip.
 */
export interface StencilClause
  extends Pick<
    ResourceAmount,
    "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
  > {
  role: RecipeQueryRole;
}

/**
 * How the result cards read their numbers: the recipe as written (amounts per
 * craft), or as rates over the recipe's own duration - one machine, full
 * speed, no overclock, exactly the nameplate figures a card gets on the board.
 */
// "eu" is the board's gold reading brought here: each OUTPUT chip reads the
// EU one machine spends per unit of it at the recipe's own tier (no
// overclock) - the number to compare two recipes for the same thing by.
// Input chips read the same energy per unit EATEN, in the board's muted
// gold, so the two sides never look like two costs to add up.
type RateView = "recipe" | TimeRateUnit | "ratio" | "eu";

const RATE_VIEW_UNITS: Record<TimeRateUnit, { multiplier: number; per: string }> = {
  tick: { multiplier: 1 / 20, per: "t" },
  second: { multiplier: 1, per: "s" },
  minute: { multiplier: 60, per: "min" },
  hour: { multiplier: 3600, per: "hr" },
};

const RATE_VIEW_CHOICES: Array<{ view: RateView; label: string; title: string }> = [
  { view: "recipe", label: "Recipe", title: "Amounts per craft, as the recipe is written" },
  { view: "tick", label: "/t", title: "Rates per tick, one machine at full speed" },
  { view: "second", label: "/s", title: "Rates per second, one machine at full speed" },
  { view: "minute", label: "/min", title: "Rates per minute, one machine at full speed" },
  { view: "hour", label: "/hr", title: "Rates per hour, one machine at full speed" },
  {
    view: "ratio",
    label: "Ratio",
    title: "Amounts reduced to lowest terms; time plays no part",
  },
  {
    view: "eu",
    label: "EU",
    title: "EU spent per unit of each output, one machine at the recipe's own tier",
  },
];

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b > 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

/** Survives close and reopen: the reading you chose is a preference, not a query. */
let storedRateView: RateView = "recipe";

/** The Generators chip's state: a browser preference, on unless turned off. */
const GENERATORS_CHIP_KEY = "gtnh-factory-flow.recipe-search-generators.v1";

function readGeneratorsChip(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    return window.localStorage.getItem(GENERATORS_CHIP_KEY) !== "off";
  } catch {
    return true;
  }
}

function writeGeneratorsChip(on: boolean) {
  try {
    window.localStorage.setItem(GENERATORS_CHIP_KEY, on ? "on" : "off");
  } catch {
    // Storage unavailable: the toggle holds for this session.
  }
}

/** Offered by a chip whose slot accepts several forms: the menu lists them. */
interface ChipMenuPicker {
  faces: AlternativeCycleFace[];
  currentId: string;
  onPick: (face: AlternativeCycleFace) => void;
}

/** A condition row in flight: where the hand holds it and where it would land. */
interface StencilDrag {
  index: number;
  width: number;
  pitch: number;
  grabDX: number;
  grabDY: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  overRole: RecipeQueryRole;
  overSlot: number;
}

export interface RecipeMapChip {
  id: string;
  label: string;
  count?: number;
  /** Whether this map's recipes are in the results; a chip click toggles it. */
  selected: boolean;
  icon?: Pick<
    ResourceAmount,
    "kind" | "id" | "amount" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
  >;
}

/**
 * The recipe search: one screen, no browse step.
 *
 * The screen is a letter T: the answers fill the top, and the STENCIL of the
 * recipe being looked for sits on its own card at the bottom middle - what it
 * takes on the left, what it makes on the right, exactly the way a machine
 * card reads. Each side combines its items with ANY (either of these) or ALL
 * (every one of them); a recipe must satisfy both sides.
 */
export function RecipeSearchOverlay({
  clauses,
  takesOp,
  makesOp,
  onClausesChange,
  onTakesOpChange,
  onMakesOpChange,
  onSwapSides,
  recipeMapChips,
  allRecipeMapsSelected,
  onToggleRecipeMap,
  onToggleAllRecipeMaps,
  onRecipeMapHover,
  recipes,
  totalAcrossMaps,
  hasMore,
  isLoading,
  queryError,
  query,
  onQueryChange,
  maxTier,
  onMaxTierChange,
  selectedRecipeId,
  onSelectRecipe,
  onAdd,
  onPrefetch,
  onBrowseResource,
  onLoadMore,
  onClose,
  contextResource,
  searchPickerResources,
}: {
  clauses: StencilClause[];
  takesOp: RecipeQuerySideOp;
  makesOp: RecipeQuerySideOp;
  onClausesChange: (clauses: StencilClause[]) => void;
  onTakesOpChange: (op: RecipeQuerySideOp) => void;
  onMakesOpChange: (op: RecipeQuerySideOp) => void;
  onSwapSides: () => void;
  recipeMapChips: RecipeMapChip[];
  allRecipeMapsSelected: boolean;
  onToggleRecipeMap: (recipeMap: string) => void;
  onToggleAllRecipeMaps: () => void;
  onRecipeMapHover: (recipeMap: string) => void;
  recipes: RecipeSummary[];
  totalAcrossMaps: number;
  hasMore: boolean;
  isLoading: boolean;
  queryError?: string;
  query: string;
  onQueryChange: (query: string) => void;
  maxTier: TierFilter;
  onMaxTierChange: (tier: TierFilter) => void;
  selectedRecipeId?: string;
  onSelectRecipe: (recipeId: string) => void;
  onAdd: (recipe: RecipeSummary, machineHandlerId?: string) => void | Promise<void>;
  onPrefetch?: (recipeId: string) => void;
  onBrowseResource: (resource: ResourceAmount, mode: "recipes" | "uses") => void;
  onLoadMore: () => void;
  onClose: () => void;
  contextResource?: PreviewContextResource;
  searchPickerResources: (
    query: string,
    signal: AbortSignal,
  ) => Promise<DatasetResourceIndexEntry[]>;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const layout = useRecipeSearchViewport();
  // A phone (or any window the app calls compact) gets the search FULL
  // SCREEN, first-class: its own header stack with the close in the top
  // right, one swipeable row of machine chips, and a shorter stencil.
  const compact = useIsCompactViewport();
  const sheet = compact || layout.sheet;
  const [pickerRole, setPickerRole] = useState<RecipeQueryRole | undefined>(undefined);
  const [rateView, setRateView] = useState<RateView>(() => storedRateView);
  const changeRateView = useCallback((view: RateView) => {
    storedRateView = view;
    setRateView(view);
  }, []);
  const [chipMenu, setChipMenu] = useState<
    | {
        x: number;
        y: number;
        resource: ResourceAmount;
        /** Set when the chip's slot accepts several forms: pick one here. */
        picker?: ChipMenuPicker;
      }
    | undefined
  >(undefined);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (chipMenu) {
        setChipMenu(undefined);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chipMenu, onClose]);

  // Any press outside the menu dismisses it; the menu's own buttons stop the
  // press from reaching this.
  useEffect(() => {
    if (!chipMenu) {
      return;
    }
    const dismiss = () => setChipMenu(undefined);
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [chipMenu]);

  const openChipMenu = useCallback(
    (event: ReactMouseEvent, resource: ResourceAmount, picker?: ChipMenuPicker) => {
      event.preventDefault();
      event.stopPropagation();
      setChipMenu({
        x: Math.min(event.clientX, window.innerWidth - 230),
        y: Math.min(event.clientY, window.innerHeight - (picker ? 330 : 190)),
        resource,
        picker,
      });
    },
    [],
  );

  const removeClause = (index: number) => {
    onClausesChange(clauses.filter((_, at) => at !== index));
  };

  const addResourceClause = useCallback(
    (resource: ResourceAmount, role: RecipeQueryRole) => {
      const already = clauses.some(
        (clause) => clause.role === role && clause.kind === resource.kind && clause.id === resource.id,
      );
      if (!already) {
        onClausesChange([
          ...clauses,
          {
            role,
            kind: resource.kind,
            id: resource.id,
            displayName: resource.displayName,
            iconPath: resource.iconPath,
            iconAtlas: resource.iconAtlas,
            dominantColor: resource.dominantColor ?? resource.iconAtlas?.dominantColor,
          },
        ]);
      }
    },
    [clauses, onClausesChange],
  );

  // A row dragged onto the other column changes sides; dragged within its own
  // it reorders. Dropping where the same item already sits does nothing.
  const moveClause = useCallback(
    (fromIndex: number, role: RecipeQueryRole, beforeIndex?: number) => {
      const dragged = clauses[fromIndex];
      if (!dragged) {
        return;
      }
      const duplicate = clauses.some(
        (clause, at) =>
          at !== fromIndex &&
          clause.role === role &&
          clause.kind === dragged.kind &&
          clause.id === dragged.id,
      );
      if (duplicate) {
        return;
      }
      const before = beforeIndex !== undefined ? clauses[beforeIndex] : undefined;
      const rest = clauses.filter((_, at) => at !== fromIndex);
      const moved = { ...dragged, role };
      const insertAt = before ? rest.indexOf(before) : -1;
      if (insertAt >= 0) {
        rest.splice(insertAt, 0, moved);
      } else {
        rest.push(moved);
      }
      onClausesChange(rest);
    },
    [clauses, onClausesChange],
  );

  // The condition rows drag by hand, not by the browser's link-ghost: the
  // lifted row rides the pointer as a floating copy while the rows beneath
  // slide apart to show exactly where it would land.
  const [stencilDrag, setStencilDrag] = useState<StencilDrag | undefined>(undefined);
  const stencilDragRef = useRef<StencilDrag | undefined>(undefined);
  useEffect(() => {
    stencilDragRef.current = stencilDrag;
  }, [stencilDrag]);
  const sideListsRef = useRef(new Map<RecipeQueryRole, HTMLDivElement>());
  const registerSideList = useCallback((role: RecipeQueryRole, element: HTMLDivElement | null) => {
    if (element) {
      sideListsRef.current.set(role, element);
    } else {
      sideListsRef.current.delete(role);
    }
  }, []);

  const beginRowDrag = useCallback(
    (index: number, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const clause = clauses[index];
      if (!clause) {
        return;
      }
      setStencilDrag({
        index,
        width: rect.width,
        pitch: rect.height + 6,
        grabDX: event.clientX - rect.left,
        grabDY: event.clientY - rect.top,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        active: false,
        overRole: clause.role,
        overSlot: 0,
      });
    },
    [clauses],
  );

  useEffect(() => {
    if (!stencilDrag) {
      return;
    }

    const layoutCount = (role: RecipeQueryRole) => {
      const draggedIndex = stencilDragRef.current?.index;
      return clauses.filter((clause, at) => clause.role === role && at !== draggedIndex).length;
    };

    const onMove = (event: globalThis.PointerEvent) => {
      setStencilDrag((drag) => {
        if (!drag) {
          return drag;
        }
        let overRole = drag.overRole;
        let overSlot = drag.overSlot;
        for (const [role, element] of sideListsRef.current) {
          const rect = element.getBoundingClientRect();
          if (
            event.clientX >= rect.left - 32 &&
            event.clientX <= rect.right + 32 &&
            event.clientY >= rect.top - 32 &&
            event.clientY <= rect.bottom + 32
          ) {
            overRole = role;
            const within = event.clientY - rect.top + element.scrollTop;
            overSlot = Math.max(
              0,
              Math.min(layoutCount(role), Math.round(within / drag.pitch)),
            );
          }
        }
        return {
          ...drag,
          x: event.clientX,
          y: event.clientY,
          active:
            drag.active ||
            Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4,
          overRole,
          overSlot,
        };
      });
    };

    const onUp = () => {
      const drag = stencilDragRef.current;
      setStencilDrag(undefined);
      if (!drag?.active) {
        return;
      }
      const layoutRows = clauses.filter(
        (clause, at) => clause.role === drag.overRole && at !== drag.index,
      );
      const before = layoutRows[drag.overSlot];
      moveClause(drag.index, drag.overRole, before ? clauses.indexOf(before) : undefined);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // The listeners live for the length of ONE drag, not one pointer frame:
    // keying on the boolean keeps every move from re-wiring the window.
  }, [clauses, moveClause, stencilDrag !== undefined]);

  const addClause = (entry: DatasetResourceIndexEntry, role: RecipeQueryRole) => {
    const already = clauses.some(
      (clause) => clause.role === role && clause.kind === entry.kind && clause.id === entry.id,
    );
    if (!already) {
      onClausesChange([
        ...clauses,
        {
          role,
          kind: entry.kind,
          id: entry.id,
          displayName: entry.displayName,
          iconPath: entry.iconPath,
          iconAtlas: entry.iconAtlas,
          dominantColor: entry.dominantColor ?? entry.iconAtlas?.dominantColor,
        },
      ]);
    }
    setPickerRole(undefined);
  };

  const takesClauses = clauses.filter((clause) => clause.role === "takes");
  const makesClauses = clauses.filter((clause) => clause.role === "makes");

  // Generators are not recipes, but they answer the same questions: a
  // takes/makes condition matches a source's flows under ANY setting, and
  // placing the hit dials those settings in. Purely client-side.
  const addPowerSourceNode = useFactoryStore((state) => state.addPowerSourceNode);
  const refactorNodeToPowerSource = useFactoryStore((state) => state.refactorNodeToPowerSource);
  const powerHits = useMemo(
    () => searchPowerSourcesForStencil(clauses, takesOp, makesOp, query),
    [clauses, takesOp, makesOp, query],
  );
  // "What takes power" is nearly everything in the pack, so nothing answers
  // it; the empty state explains instead of listing a misleading few.
  const asksWhatTakesPower = clauses.some(
    (clause) => clause.id === POWER_EU_CLAUSE_ID && clause.role === "takes",
  );
  const placePowerHit = useCallback(
    (hit: PowerStencilHit) => {
      // Refactor mode: the pick REPLACES the card the search came from,
      // exactly as a recipe pick does - not a second card beside it.
      const refactorNodeId = useFactoryStore.getState().recipeBrowserRefactorNodeId;
      if (refactorNodeId) {
        refactorNodeToPowerSource(refactorNodeId, hit.source.id, hit.settings);
      } else {
        addPowerSourceNode(hit.source.id, hit.settings);
      }
      onClose();
    },
    [addPowerSourceNode, refactorNodeToPowerSource, onClose],
  );
  // The Generators chip rides the machine row: same multi-select gesture,
  // its own browser-remembered state, and the All key sweeps it along.
  const [generatorsSelected, setGeneratorsSelected] = useState(readGeneratorsChip);
  const toggleGenerators = useCallback(() => {
    setGeneratorsSelected((on) => {
      writeGeneratorsChip(!on);
      return !on;
    });
  }, []);

  // Loading more when the bottom of the list scrolls near, so the grid reads
  // as one endless list rather than ending on a button.
  const handleResultsScroll = (event: UIEvent<HTMLDivElement>) => {
    const scroller = event.currentTarget;
    if (!hasMore || isLoading) {
      return;
    }
    if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 480) {
      onLoadMore();
    }
  };

  // The same controls wear different clothes on the two layouts, so they are
  // built once and placed twice.
  // The chips are a multi-select: each one toggles its machine's recipes in
  // or out of the results, and All is select-all / select-none. Unselecting
  // a chip while All is lit keeps everything else selected.
  const machineChipRow = (
    <>
      <MachineChip
        label="All"
        count={totalAcrossMaps}
        active={allRecipeMapsSelected && (powerHits.length === 0 || generatorsSelected)}
        title={
          allRecipeMapsSelected ? "Unselect every machine" : "Select every machine"
        }
        onClick={() => {
          if (powerHits.length > 0) {
            const next = !allRecipeMapsSelected;
            setGeneratorsSelected(next);
            writeGeneratorsChip(next);
          }
          onToggleAllRecipeMaps();
        }}
      />
      {powerHits.length > 0 ? (
        <MachineChip
          label="Generators"
          count={powerHits.length}
          active={generatorsSelected}
          title={generatorsSelected ? "Hide the generators" : "Show the generators"}
          onClick={toggleGenerators}
          iconNode={<Zap className="h-4 w-4 fill-current text-amber-400" aria-hidden />}
        />
      ) : null}
      {recipeMapChips.map((chip) => (
        <MachineChip
          key={chip.id}
          label={chip.label}
          count={chip.count}
          icon={chip.icon}
          active={chip.selected}
          title={chip.selected ? "Hide these recipes" : "Show these recipes"}
          onClick={() => onToggleRecipeMap(chip.id)}
          onHover={() => onRecipeMapHover(chip.id)}
        />
      ))}
    </>
  );
  const ratePillGroup = (
    <span
      className="flex shrink-0 items-center border-2 border-[var(--mc-29)] bg-[var(--mc-55)]"
      title="Read the recipes as written, or as rates for one machine at full speed"
    >
      {RATE_VIEW_CHOICES.map((choice) => (
        <OpPill
          key={choice.view}
          label={choice.label}
          title={choice.title}
          active={rateView === choice.view}
          gold={choice.view === "eu"}
          onClick={() => {
            if (choice.view === "eu" && rateView !== "eu") {
              playBoardSound("dialEnergy");
            }
            changeRateView(choice.view);
          }}
        />
      ))}
    </span>
  );
  const nameFilter = (
    <label
      className={[
        "flex min-w-0 items-center gap-2 border-2 border-[var(--mc-33)] bg-[#17191d] px-2 text-sm text-neutral-100 shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607]",
        compact ? "h-10 flex-1" : "h-9 w-[200px]",
      ].join(" ")}
    >
      <Search className="h-4 w-4 shrink-0 text-neutral-500" />
      <input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Filter by name..."
        className="min-w-0 flex-1 bg-transparent text-neutral-100 outline-none placeholder:text-neutral-500"
      />
      {query ? (
        <button
          type="button"
          onClick={() => onQueryChange("")}
          className="text-neutral-400 hover:text-white"
          aria-label="Clear the name filter"
          title="Clear the name filter"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </label>
  );
  const tierSelect = (
    <select
      value={maxTier}
      onChange={(event) => onMaxTierChange(event.target.value as TierFilter)}
      title="Highest tier"
      aria-label="Maximum machine tier"
      className={[
        "shrink-0 border-2 border-[var(--mc-33)] bg-[#17191d] px-1.5 text-sm text-neutral-100 outline-none shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607]",
        compact ? "h-10 w-24" : "h-9 w-28",
      ].join(" ")}
    >
      <option value="all">All tiers</option>
      {GT_VOLTAGE_TIERS.map((entry) => (
        <option key={entry.tier} value={entry.tier}>
          ≤ {entry.tier}
        </option>
      ))}
    </select>
  );
  const closeButton = (
    <button
      type="button"
      title="Close recipe search (Esc)"
      aria-label="Close recipe search"
      onClick={onClose}
      className={[
        "flex shrink-0 cursor-pointer items-center justify-center border-2 border-[var(--mc-33)] bg-[var(--mc-61)] text-[var(--mc-ink)] hover:bg-[var(--mc-85)]",
        compact ? "h-10 w-10" : "absolute right-2 top-2 z-30 h-8 w-8",
      ].join(" ")}
    >
      <X className={compact ? "h-5 w-5" : "h-4 w-4"} />
    </button>
  );

  // A PORTAL, not a child: on compact this component mounts inside a drawer,
  // and a drawer slides on `translate` - which quietly turns every fixed
  // descendant into a drawer-relative one. Full screen means the body.
  return createPortal(
    <div
      className={[
        // A near-black ground: the search is the only thing on screen, and
        // everything on it stands off the dark.
        "pointer-events-auto fixed inset-0 flex items-center justify-center bg-black/70",
        // The search covers the RIGHT column and spends that room on bigger
        // recipes; the LEFT column stays live beside it (see the style
        // below). On compact it outranks ALL the app chrome - full screen
        // means full screen.
        compact ? "z-[90]" : "z-50",
        sheet ? "" : "px-3 py-2",
      ].join(" ")}
      onPointerDown={onClose}
      // The dim starts where the item browser ends: the left column stays
      // bright and clickable beside the search, because the two are one tool.
      style={{ left: sheet ? 0 : layout.leftInset }}
    >
      {/* The section itself does NOT stop the close: only its two solid boxes
          do, so the bare corners beside the stencil card still read as the
          backdrop they look like. */}
      <section
        ref={panelRef}
        className="pointer-events-auto relative flex flex-col font-mono"
        aria-label="Recipe search"
        style={{
          width: sheet ? "100%" : `min(${layout.width}px, 100%)`,
          height: sheet ? "100%" : `min(${layout.height}px, 100%)`,
        }}
      >
        {/* The frame is 4px like a board window's, a dark grey one shade off
            the floor: an accent by contrast, not by colour. */}
        <div
          className="relative flex min-h-0 flex-1 flex-col overflow-hidden border-4 border-[#23262d] bg-[#101215] text-[var(--mc-ink)] shadow-[inset_2px_2px_0_rgba(255,255,255,0.05),inset_-2px_-2px_0_rgba(0,0,0,0.6)]"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {compact ? (
            /* ===== phone head: search row with the close top right, then one
                   swipeable row of machine chips, then the rate switch ===== */
            <div className="flex flex-col gap-2 p-2">
              <div className="flex items-center gap-2">
                {nameFilter}
                {tierSelect}
                {closeButton}
              </div>
              <div className="recipe-search-scroll flex items-center gap-1.5 overflow-x-auto pb-0.5">
                {machineChipRow}
              </div>
              <div className="flex">{ratePillGroup}</div>
            </div>
          ) : (
            <>
              {closeButton}
              {/* ===== the head: machine chips scroll on the left, the
                     controls stand still on the right. Cut mid-row on
                     purpose: a third row of chips peeking over the edge is
                     the scroll cue. ===== */}
              <div className="flex flex-wrap items-start gap-2 py-3 pl-3 pr-12">
                <div className="recipe-search-scroll flex max-h-[100px] min-w-[240px] flex-1 flex-wrap items-center gap-1.5 overflow-y-auto pr-1">
                  {machineChipRow}
                </div>
                {/* Two short rows instead of one long one: the filter and
                    tier up top, the rate switch beneath - so the machine
                    chips keep the width almost to the corner. */}
                <div className="ml-auto flex shrink-0 flex-col items-end gap-2">
                  <div className="flex items-center gap-2">
                    {nameFilter}
                    {tierSelect}
                  </div>
                  {ratePillGroup}
                </div>
              </div>
            </>
          )}

          {/* ===== the answers ===== */}
          <div
            className={[
              "recipe-search-scroll min-h-0 flex-1 overflow-y-auto",
              sheet ? "px-1.5" : "px-3",
            ].join(" ")}
            onScroll={handleResultsScroll}
          >
            {queryError ? (
              <div className="border-2 border-[var(--mc-47)] bg-[var(--mc-71)] p-3 text-sm shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
                {queryError}
              </div>
            ) : clauses.length === 0 && !query.trim() ? (
              <div className="grid min-h-[260px] place-items-center border-2 border-[var(--mc-47)] bg-[var(--mc-71)] p-3 text-sm shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
                Add an item to either side of the card below.
              </div>
            ) : (
              <>
                {powerHits.length > 0 && generatorsSelected ? (
                  // Generators are not recipes, so they answer inside their
                  // own ground: the power amber under recipe-shaped cards.
                  <div
                    className="mb-2 border-2 border-amber-300/25 p-2"
                    style={{ backgroundColor: "color-mix(in srgb, var(--mc-56) 88%, #d99a2b 12%)" }}
                  >
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300/90">
                      <Zap className="h-3.5 w-3.5 fill-current" aria-hidden />
                      Generators
                    </div>
                    <div
                      className="grid items-start gap-2"
                      style={{
                        gridTemplateColumns: sheet
                          ? "minmax(0, 1fr)"
                          : "repeat(auto-fill, minmax(480px, 1fr))",
                      }}
                    >
                      {powerHits.map((hit) => (
                        <PowerHitCard
                          key={`${hit.source.id}|${JSON.stringify(hit.settings ?? {})}`}
                          hit={hit}
                          rateView={rateView}
                          takesClauses={takesClauses}
                          makesClauses={makesClauses}
                          onPlace={() => placePowerHit(hit)}
                          onBrowseResource={onBrowseResource}
                          onChipMenu={openChipMenu}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
                {isLoading && recipes.length === 0 ? (
              <div
                className="grid items-start gap-2"
                style={{
                  gridTemplateColumns: sheet
                    ? "minmax(0, 1fr)"
                    : "repeat(auto-fill, minmax(480px, 1fr))",
                }}
                role="status"
                aria-label="Loading recipes"
              >
                {Array.from({ length: sheet ? 4 : 9 }, (_, index) => (
                  <SkeletonResultCard key={index} delay={index * 110} />
                ))}
              </div>
            ) : recipes.length === 0 && powerHits.length > 0 && generatorsSelected ? null : recipes.length === 0 ? (
              <div className="grid min-h-[260px] place-items-center border-2 border-[var(--mc-47)] bg-[var(--mc-71)] p-3 text-sm shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
                {/* An empty list with every chip dark is the selection's doing,
                    not the search's. Saying "no matching recipes" there sends
                    people to reword the query when the fix is one click up. */}
                {asksWhatTakesPower ? (
                  "Nearly every machine takes power, so that list would be the whole pack. Search for what makes power instead."
                ) : recipeMapChips.length > 0 &&
                  recipeMapChips.every((chip) => !chip.selected) ? (
                  <div className="flex flex-col items-center gap-3 text-center">
                    <span>No machines are selected at the top.</span>
                    <button
                      type="button"
                      onClick={onToggleAllRecipeMaps}
                      className="border-2 border-[var(--mc-47)] bg-[var(--mc-78)] px-3 py-1 text-[13px] font-bold shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-47)] hover:bg-[var(--mc-85)]"
                    >
                      Select all machines
                    </button>
                  </div>
                ) : (
                  "No matching recipes."
                )}
              </div>
            ) : (
              <>
                <div
                  className="grid items-start gap-2"
                  style={{
                    gridTemplateColumns: sheet
                      ? "minmax(0, 1fr)"
                      : "repeat(auto-fill, minmax(480px, 1fr))",
                  }}
                >
                  {recipes.map((recipe) => (
                    <CompactRecipeCard
                      key={recipe.id}
                      recipe={recipe}
                      takesClauses={takesClauses}
                      makesClauses={makesClauses}
                      contextResource={contextResource}
                      selected={selectedRecipeId === recipe.id}
                      onSelectRecipe={onSelectRecipe}
                      onAdd={onAdd}
                      onPrefetch={onPrefetch}
                      onBrowseResource={onBrowseResource}
                      onChipMenu={openChipMenu}
                      rateView={rateView}
                    />
                  ))}
                </div>
                {isLoading ? (
                  <div
                    className="mt-2 grid items-start gap-2"
                    style={{
                      gridTemplateColumns: sheet
                        ? "minmax(0, 1fr)"
                        : "repeat(auto-fill, minmax(480px, 1fr))",
                    }}
                    role="status"
                    aria-label="Loading more recipes"
                  >
                    {Array.from({ length: sheet ? 1 : 3 }, (_, index) => (
                      <SkeletonResultCard key={index} delay={index * 110} />
                    ))}
                  </div>
                ) : null}
              </>
            )}
              </>
            )}
          </div>

        </div>

        {/* ===== the stencil: its own detached card, the foot of the T ===== */}
        <div className="flex shrink-0 justify-center pt-3 compact:px-2 compact:pb-2 compact:pt-2">
          <div
            className="relative w-full max-w-[880px] border-4 border-[#23262d] bg-[var(--mc-71)] p-3 text-[var(--mc-ink)] shadow-[0_8px_0_rgba(0,0,0,0.5),inset_1px_1px_0_var(--mc-93)] compact:p-2"
            onPointerDown={(event) => event.stopPropagation()}
          >
              <div className="flex items-stretch gap-2 compact:gap-1">
                <StencilSide
                  label="Takes"
                  role="takes"
                  sideClauses={takesClauses}
                  clauses={clauses}
                  op={takesOp}
                  onOpChange={onTakesOpChange}
                  onRemove={removeClause}
                  drag={stencilDrag}
                  onRowPointerDown={beginRowDrag}
                  registerListRef={registerSideList}
                  onOpenPicker={() => setPickerRole(pickerRole === "takes" ? undefined : "takes")}
                />
                <button
                  type="button"
                  onClick={onSwapSides}
                  title="Swap sides: takes become makes and makes become takes"
                  aria-label="Swap the takes and makes sides"
                  className="group flex w-14 shrink-0 items-center justify-center self-center border-2 border-transparent text-[var(--mc-ink-muted)] hover:border-[var(--mc-33)] hover:bg-[var(--mc-71)] hover:text-[var(--mc-ink)] compact:w-9"
                  style={{ height: "72px" }}
                >
                  <svg
                    aria-hidden
                    viewBox="0 0 40 24"
                    className="h-7 w-11 group-hover:hidden"
                    fill="none"
                  >
                    <path d="M2 12h26" stroke="currentColor" strokeWidth="5" />
                    <path d="M24 2l14 10-14 10" fill="currentColor" />
                  </svg>
                  <ArrowLeftRight aria-hidden className="hidden h-7 w-7 group-hover:block" />
                </button>
                <StencilSide
                  label="Makes"
                  role="makes"
                  sideClauses={makesClauses}
                  clauses={clauses}
                  op={makesOp}
                  onOpChange={onMakesOpChange}
                  onRemove={removeClause}
                  drag={stencilDrag}
                  onRowPointerDown={beginRowDrag}
                  registerListRef={registerSideList}
                  onOpenPicker={() => setPickerRole(pickerRole === "makes" ? undefined : "makes")}
                />
              </div>
              {pickerRole ? (
                <ItemPickerPopover
                  role={pickerRole}
                  onPick={addClause}
                  onClose={() => setPickerRole(undefined)}
                  searchPickerResources={searchPickerResources}
                />
              ) : null}
            </div>
          </div>

          {/* ===== the lifted condition, riding the pointer ===== */}
          {stencilDrag?.active && clauses[stencilDrag.index] ? (
            <div
              className="pointer-events-none fixed z-[60] cursor-grabbing"
              style={{
                left: stencilDrag.x - stencilDrag.grabDX,
                top: stencilDrag.y - stencilDrag.grabDY,
                width: stencilDrag.width,
              }}
            >
              <span className="flex w-full items-center gap-2 border-2 border-[var(--mc-15)] bg-[var(--mc-61)] py-0.5 pl-0.5 pr-1 shadow-[6px_6px_0_rgba(0,0,0,0.5)]">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden bg-[var(--mc-55)] shadow-[inset_2px_2px_0_var(--mc-25),inset_-2px_-2px_0_var(--mc-100)]">
                  {clauses[stencilDrag.index].id === POWER_EU_CLAUSE_ID ? (
                    <Zap className="h-4 w-4 fill-current text-amber-300" aria-hidden />
                  ) : (
                    <ResourceIcon
                      resource={{ ...clauses[stencilDrag.index], amount: 1 }}
                      size="sm"
                      bare
                      showAmount={false}
                      tooltip={false}
                      className="!h-full !w-full"
                      iconPixelSize={machineArtPixels(32)}
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-[var(--mc-ink)]">
                  {clauses[stencilDrag.index].displayName ?? clauses[stencilDrag.index].id}
                </span>
              </span>
            </div>
          ) : null}

          {/* ===== the chip's right-click menu: every way to use an item ===== */}
          {chipMenu ? (
            <div
              className="fixed z-50 w-[220px] border-2 border-[var(--mc-15)] bg-[var(--mc-61)] p-1 font-mono shadow-[4px_4px_0_rgba(0,0,0,0.45)]"
              style={{ left: chipMenu.x, top: chipMenu.y }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="truncate px-2 py-1 text-[11px] font-bold text-[var(--mc-ink-muted)]">
                {chipMenu.resource.displayName ?? chipMenu.resource.id}
              </div>
              {(
                [
                  {
                    label: "Find what makes it",
                    act: () => onBrowseResource({ ...chipMenu.resource, amount: 1 }, "recipes"),
                  },
                  {
                    label: "Find what uses it",
                    act: () => onBrowseResource({ ...chipMenu.resource, amount: 1 }, "uses"),
                  },
                  {
                    label: "Add to takes",
                    act: () => addResourceClause(chipMenu.resource, "takes"),
                  },
                  {
                    label: "Add to makes",
                    act: () => addResourceClause(chipMenu.resource, "makes"),
                  },
                ] as const
              ).map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    item.act();
                    setChipMenu(undefined);
                  }}
                  className="block w-full px-2 py-1.5 text-left text-[13px] font-bold text-[var(--mc-ink)] hover:bg-[var(--mc-85)]"
                >
                  {item.label}
                </button>
              ))}
              {chipMenu.picker ? (
                <>
                  <div className="mx-2 my-1 border-t-2 border-[var(--mc-47)]" />
                  <div className="px-2 py-1 text-[11px] font-bold text-[var(--mc-ink-muted)]">
                    This slot also takes
                  </div>
                  <div className="recipe-search-scroll max-h-[180px] overflow-y-auto">
                    {chipMenu.picker.faces.map((face) => (
                      <button
                        key={`${face.kind}:${face.id}`}
                        type="button"
                        onClick={() => {
                          chipMenu.picker?.onPick(face);
                          setChipMenu(undefined);
                        }}
                        className={[
                          "flex w-full items-center gap-2 px-2 py-1 text-left text-[13px] font-bold text-[var(--mc-ink)] hover:bg-[var(--mc-85)]",
                          face.id === chipMenu.picker?.currentId ? "bg-[var(--mc-71)]" : "",
                        ].join(" ")}
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden bg-[var(--mc-55)] shadow-[inset_1px_1px_0_var(--mc-25),inset_-1px_-1px_0_var(--mc-100)]">
                          <ResourceIcon
                            resource={{ ...face, amount: 1 }}
                            size="sm"
                            bare
                            showAmount={false}
                            tooltip={false}
                            className="!h-full !w-full"
                            iconPixelSize={machineArtPixels(24)}
                          />
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {face.displayName ?? face.id}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
      </section>
    </div>,
    document.body,
  );
}

/**
 * One column of the stencil card: the side's name and its ANY/ALL/ONLY
 * switch on top, then a stack of condition rows, then the add slot. The
 * stack scrolls inside a FIXED height, so removing a condition never moves
 * the card and the next X stays under the pointer. Rows drag by hand: while
 * one is in flight this column hides it, and the rows below the landing spot
 * slide down to hold it open.
 */
function StencilSide({
  label,
  role,
  sideClauses,
  clauses,
  op,
  onOpChange,
  onRemove,
  drag,
  onRowPointerDown,
  registerListRef,
  onOpenPicker,
}: {
  label: string;
  role: RecipeQueryRole;
  sideClauses: StencilClause[];
  clauses: StencilClause[];
  op: RecipeQuerySideOp;
  onOpChange: (op: RecipeQuerySideOp) => void;
  onRemove: (index: number) => void;
  drag?: StencilDrag;
  onRowPointerDown: (index: number, event: ReactPointerEvent<HTMLElement>) => void;
  registerListRef: (role: RecipeQueryRole, element: HTMLDivElement | null) => void;
  onOpenPicker: () => void;
}) {
  const dragActive = drag?.active ?? false;
  const layoutClauses = dragActive
    ? sideClauses.filter((clause) => clauses.indexOf(clause) !== drag?.index)
    : sideClauses;
  const gapAt = dragActive && drag?.overRole === role ? drag.overSlot : undefined;
  const pitch = drag?.pitch ?? 46;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex h-6 items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--mc-ink)] compact:text-[10px] compact:tracking-normal">
          {label}
        </span>
        <span className="flex items-center border-2 border-[var(--mc-29)] bg-[var(--mc-55)]">
          <OpPill
            label="Any"
            title={`Recipes touching any one of these ${label.toLowerCase()}`}
            active={op === "any"}
            onClick={() => onOpChange("any")}
          />
          <OpPill
            label="All"
            title={`Recipes with every one of these ${label.toLowerCase()}; extras allowed`}
            active={op === "all"}
            onClick={() => onOpChange("all")}
          />
          <OpPill
            label="Only"
            title={`Recipes with exactly these ${label.toLowerCase()} and nothing else`}
            active={op === "only"}
            onClick={() => onOpChange("only")}
          />
        </span>
      </div>
      {/* A fixed-height stack so removing a row never moves the card. The
          scrollbar keeps a full-width lane with a bright thumb, so a stack
          deeper than the window says so instead of hiding rows. */}
      <div
        ref={(element) => registerListRef(role, element)}
        className="recipe-search-scroll flex h-[208px] flex-col gap-1.5 overflow-y-auto pr-1 compact:h-[124px]"
      >
        {layoutClauses.map((clause, slot) => {
          const index = clauses.indexOf(clause);
          const shifted = gapAt !== undefined && slot >= gapAt;
          return (
            <span
              key={`${clause.role}:${clause.kind}:${clause.id}`}
              onPointerDown={(event) => onRowPointerDown(index, event)}
              style={{ transform: shifted ? `translateY(${pitch}px)` : undefined }}
              className="flex w-full shrink-0 cursor-grab touch-none select-none items-center gap-2 border-2 border-[var(--mc-33)] bg-[var(--mc-61)] py-0.5 pl-0.5 pr-1 shadow-[inset_1px_1px_0_var(--mc-85)] transition-transform duration-150"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden bg-[var(--mc-55)] shadow-[inset_2px_2px_0_var(--mc-25),inset_-2px_-2px_0_var(--mc-100)]">
                {clause.id === POWER_EU_CLAUSE_ID ? (
                  <Zap className="h-4 w-4 fill-current text-amber-300" aria-hidden />
                ) : (
                  <ResourceIcon
                    resource={{ ...clause, amount: 1 }}
                    size="sm"
                    bare
                    showAmount={false}
                    tooltip={false}
                    className="!h-full !w-full"
                    iconPixelSize={machineArtPixels(32)}
                  />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-[14px] font-bold">
                {clause.displayName ?? clause.id}
              </span>
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onRemove(index)}
                aria-label={`Remove ${clause.displayName ?? clause.id} from the search`}
                title="Remove this condition"
                className="flex h-6 w-6 shrink-0 items-center justify-center text-[var(--mc-ink-muted)] hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          );
        })}
        <button
          type="button"
          onClick={onOpenPicker}
          aria-label={
            role === "takes" ? "Add an input to the search" : "Add an output to the search"
          }
          title={role === "takes" ? "Add an input" : "Add an output"}
          style={{ transform: gapAt !== undefined ? `translateY(${pitch}px)` : undefined }}
          className="flex h-10 w-full shrink-0 items-center justify-center gap-1.5 border-2 border-dashed border-[var(--mc-47)] px-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--mc-ink-muted)] transition-transform duration-150 hover:border-[var(--mc-33)] hover:text-[var(--mc-ink)]"
        >
          <Plus className="h-3.5 w-3.5" />
          {role === "takes" ? "Input" : "Output"}
        </button>
      </div>
    </div>
  );
}

function OpPill({
  label,
  title,
  active,
  gold = false,
  onClick,
}: {
  label: string;
  title: string;
  active: boolean;
  /** The EU view's pill wears the board's gold, pressed or not. */
  gold?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={[
        "h-5 shrink-0 whitespace-nowrap px-1.5 text-[10px] font-bold uppercase tracking-[0.1em] compact:px-1 compact:text-[9px] compact:tracking-normal",
        active
          ? gold
            ? "bg-amber-300 text-black shadow-[inset_1px_1px_0_#fde68a]"
            : "bg-[var(--mc-85)] text-white shadow-[inset_1px_1px_0_var(--mc-100)]"
          : gold
            ? "text-amber-400/80 hover:text-amber-300"
            : "text-[var(--mc-ink-muted)] hover:text-[var(--mc-ink)]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

/** The searchable item drop-down the stencil's add slots open. */
function ItemPickerPopover({
  role,
  onPick,
  onClose,
  searchPickerResources,
}: {
  role: RecipeQueryRole;
  onPick: (entry: DatasetResourceIndexEntry, role: RecipeQueryRole) => void;
  onClose: () => void;
  searchPickerResources: (
    query: string,
    signal: AbortSignal,
  ) => Promise<DatasetResourceIndexEntry[]>;
}) {
  const [pickerQuery, setPickerQuery] = useState("");
  const [results, setResults] = useState<DatasetResourceIndexEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const debouncedQuery = useDebouncedValue(pickerQuery, 125);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // A click elsewhere in the overlay closes the picker; the overlay's own
  // backdrop already closes everything above this.
  useEffect(() => {
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    searchPickerResources(debouncedQuery.trim(), controller.signal)
      .then((entries) => {
        setResults(entries);
        setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setResults([]);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [debouncedQuery, searchPickerResources]);

  // Power is not a dataset resource, but it IS something machines make: the
  // makes side offers it as a condition, and generators answer it.
  const displayResults: DatasetResourceIndexEntry[] =
    role === "makes" && queryAsksForPower(pickerQuery)
      ? [
          {
            kind: "fluid",
            id: POWER_EU_CLAUSE_ID,
            displayName: "Power (EU)",
            dominantColor: "#d99a2b",
          } as DatasetResourceIndexEntry,
          ...results,
        ]
      : results;

  return (
    <div
      ref={rootRef}
      className="absolute bottom-full left-1/2 z-20 mb-2 w-full max-w-[640px] -translate-x-1/2 border-2 border-[var(--mc-15)] bg-[var(--mc-61)] p-2 shadow-[6px_6px_0_rgba(0,0,0,0.45)] sm:w-[640px]"
    >
      <label className="flex h-9 items-center gap-2 border-2 border-[var(--mc-33)] bg-[#17191d] px-2 text-sm text-neutral-100 shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607]">
        <Search className="h-4 w-4 shrink-0 text-neutral-500" />
        <input
          ref={inputRef}
          value={pickerQuery}
          onChange={(event) => setPickerQuery(event.target.value)}
          placeholder={role === "takes" ? "Add an input..." : "Add an output..."}
          className="min-w-0 flex-1 bg-transparent text-neutral-100 outline-none placeholder:text-neutral-500"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onClose();
            }
            if (event.key === "Enter" && displayResults[0]) {
              onPick(displayResults[0], role);
            }
          }}
        />
      </label>
      <div className="recipe-search-scroll mt-2 grid max-h-[460px] grid-cols-1 gap-1 overflow-y-auto compact:max-h-[max(140px,calc(100vh-320px))] sm:grid-cols-2">
        {loading && displayResults.length === 0 ? (
          <div className="p-2 text-sm text-[var(--mc-ink-muted)]">Searching...</div>
        ) : displayResults.length === 0 ? (
          <div className="p-2 text-sm text-[var(--mc-ink-muted)]">No matching items.</div>
        ) : (
          displayResults.map((entry) => (
            <button
              key={`${entry.kind}:${entry.id}`}
              type="button"
              onClick={() => onPick(entry, role)}
              className="flex w-full items-center gap-2 border-2 border-[var(--mc-47)] bg-[var(--mc-71)] px-1.5 py-1 text-left shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)] hover:bg-[var(--mc-85)]"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden bg-[var(--mc-55)] shadow-[inset_2px_2px_0_var(--mc-25),inset_-2px_-2px_0_var(--mc-100)]">
                {entry.id === POWER_EU_CLAUSE_ID ? (
                  <Zap className="h-4 w-4 fill-current text-amber-300" aria-hidden />
                ) : (
                  <ResourceIcon
                    resource={{ ...entry, amount: 1 }}
                    size="sm"
                    bare
                    showAmount={false}
                    tooltip={false}
                    className="!h-full !w-full"
                    iconPixelSize={machineArtPixels(32)}
                  />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-[var(--mc-ink)]">
                {entry.displayName ?? entry.id}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function MachineChip({
  label,
  count,
  icon,
  iconNode,
  active,
  onClick,
  onHover,
  title,
}: {
  label: string;
  count?: number;
  icon?: RecipeMapChip["icon"];
  /** A hand-drawn tile face (the Generators chip's bolt) instead of an item. */
  iconNode?: ReactNode;
  active: boolean;
  onClick: () => void;
  onHover?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onHover}
      aria-pressed={active}
      title={title}
      className={[
        "flex shrink-0 items-center gap-1.5 border-2 py-0.5 pl-0.5 pr-2 text-[13px] font-bold",
        active
          ? "border-[var(--mc-15)] bg-[var(--mc-85)] shadow-[inset_2px_2px_0_var(--mc-100),0_0_0_2px_#22d3ee_inset]"
          : "border-[var(--mc-47)] bg-[var(--mc-78)] shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-47)] hover:bg-[var(--mc-85)]",
      ].join(" ")}
    >
      <span className="flex h-7 w-7 items-center justify-center overflow-hidden bg-[var(--mc-55)] shadow-[inset_2px_2px_0_var(--mc-25),inset_-2px_-2px_0_var(--mc-100)]">
        {iconNode ? (
          iconNode
        ) : icon ? (
          <ResourceIcon
            resource={{ ...icon, amount: 1 }}
            size="sm"
            bare
            showAmount={false}
            tooltip={false}
            className="!h-full !w-full"
            iconPixelSize={machineArtPixels(28)}
          />
        ) : (
          // An empty slot reads as a mistake, so a chip with no machine art
          // (the All chip) wears a star instead.
          <Star aria-hidden className="h-4 w-4 text-[var(--mc-ink-muted)]" />
        )}
      </span>
      <span className="max-w-[220px] truncate text-[var(--mc-ink)]">{label}</span>
      {count !== undefined ? (
        <span className="text-[12px] font-bold text-[var(--mc-ink-muted)] tabular-nums">
          {count.toLocaleString()}
        </span>
      ) : null}
    </button>
  );
}

/**
 * One recipe as a compact card-flavoured row: the machine and its numbers on
 * the first line, named item chips - inputs, arrow, outputs - on the second.
 * Chips that satisfy a stencil condition wear the cyan ring.
 */
const CompactRecipeCard = memo(function CompactRecipeCard({
  recipe,
  takesClauses,
  makesClauses,
  contextResource,
  selected,
  onSelectRecipe,
  onAdd,
  onPrefetch,
  onBrowseResource,
  onChipMenu,
  rateView,
}: {
  recipe: RecipeSummary;
  takesClauses: StencilClause[];
  makesClauses: StencilClause[];
  contextResource?: PreviewContextResource;
  selected: boolean;
  onSelectRecipe: (recipeId: string) => void;
  onAdd: (
    recipe: RecipeSummary,
    machineHandlerId?: string,
    inputPicks?: RecipeInputPicks,
  ) => void | Promise<void>;
  onPrefetch?: (recipeId: string) => void;
  onBrowseResource: (resource: ResourceAmount, mode: "recipes" | "uses") => void;
  onChipMenu: (event: ReactMouseEvent, resource: ResourceAmount, picker?: ChipMenuPicker) => void;
  rateView: RateView;
}) {
  const machineIcons = useMachineHandlerIcons();
  const preview = useMemo(
    () => contextualizePreviewRecipe(summaryToPreviewRecipe(recipe), contextResource),
    [contextResource, recipe],
  );
  const handlers = useMemo(() => getRecipeMachineHandlers(preview), [preview]);
  const primary = handlers[0];
  const machineLabel = primary?.label ?? recipe.machineType;
  const machineIcon = primary ? machineIcons.get(primary.id) : undefined;
  // A dataset recipe is written in its primary machine's numbers already; the
  // synthesized Auto Workbench is the one handler that brings its own (the
  // crafting maps are exported instant), so the card and its rate views read
  // the workbench's LV seed instead of claiming twenty crafts a second.
  const isAutoWorkbench = primary?.id === AUTO_WORKBENCH_HANDLER_ID;
  const durationTicks =
    isAutoWorkbench && primary.durationTicks !== undefined
      ? primary.durationTicks
      : recipe.durationTicks;
  const eut = isAutoWorkbench ? (primary.eut ?? recipe.eut) : recipe.eut;
  const minimumTier = isAutoWorkbench ? primary.minimumTier : recipe.minimumTier;
  const seconds = durationTicks / 20;
  const stats = [
    `${formatRate(seconds, seconds >= 10 ? 0 : 1)}s`,
    eut > 0 ? `${eut.toLocaleString()} EU/t` : "no power",
  ].join(" · ");
  const tierColor =
    eut > 0 ? GT_TIER_COLORS[minimumTier as Exclude<MachineTier, "DEMO">] : undefined;
  // Crafting-grid recipes arrive one slot at a time (nine separate Iron
  // Plates), and oredict slots arrive wearing their oredict name. The chips
  // read as a shopping list instead: same items merged with their amounts
  // summed, many-form slots wearing a face - the first by default, or the
  // one PICKED here. Picks ride onto the board with the add.
  const [inputPicks, setInputPicks] = useState<RecipeInputPicks>({});
  const inputChips = useMemo(() => {
    const merged = new Map<string, { raw: (typeof preview.inputs)[number]; indexes: number[] }>();
    preview.inputs.forEach((input, index) => {
      const key = [input.kind, input.id, input.consumed === false ? "nc" : "c"].join("|");
      const entry = merged.get(key);
      if (entry) {
        entry.raw = { ...entry.raw, amount: entry.raw.amount + input.amount };
        entry.indexes.push(index);
      } else {
        merged.set(key, { raw: { ...input }, indexes: [index] });
      }
    });
    return [...merged.values()].map(({ raw, indexes }) => {
      const faces = getAlternativeCycleFaces(raw);
      const face = inputPicks[indexes[0]] ?? faces[0];
      return {
        raw,
        indexes,
        faces,
        resource: face ? applyAlternativeCycleFace(raw, face) : raw,
      };
    });
  }, [inputPicks, preview]);
  const outputChips = useMemo(() => mergeChipResources(preview.outputs), [preview]);
  // The RATIO reading: every counted amount over their shared divisor, so
  // 2 dust into 2 ingots says 1 and 1. Catalysts stay out of the arithmetic,
  // and any non-whole amount (a substitute's scaled cost) leaves the recipe
  // unreduced rather than lying about it.
  const ratioDivisor = useMemo(() => {
    if (rateView !== "ratio") {
      return 1;
    }
    let divisor = 0;
    const amounts = [
      ...inputChips
        .filter((chip) => chip.raw.consumed !== false)
        .map((chip) => chip.resource.amount),
      ...outputChips.map((output) => output.amount),
    ];
    for (const amount of amounts) {
      if (!Number.isInteger(amount) || amount <= 0) {
        return 1;
      }
      divisor = greatestCommonDivisor(divisor, amount);
    }
    return divisor > 0 ? divisor : 1;
  }, [inputChips, outputChips, rateView]);
  // A merged chip stands for every slot it swallowed, so a pick lands on all
  // of their indexes at once.
  const pickFace = useCallback((indexes: number[], face: AlternativeCycleFace) => {
    setInputPicks((previous) => {
      const next = { ...previous };
      for (const index of indexes) {
        next[index] = face;
      }
      return next;
    });
  }, []);

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
    <article
      onClick={() => onSelectRecipe(recipe.id)}
      onDoubleClick={() => void onAdd(recipe, undefined, inputPicks)}
      onPointerEnter={armPrefetch}
      onPointerLeave={cancelPrefetch}
      className={[
        "cursor-pointer border-2 border-[var(--mc-47)] bg-[var(--mc-71)] p-2 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]",
        selected ? "ring-1 ring-cyan-400" : "",
      ].join(" ")}
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 196px" }}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden bg-[var(--mc-55)] shadow-[inset_2px_2px_0_var(--mc-25),inset_-2px_-2px_0_var(--mc-100)]">
          {machineIcon ? (
            <ResourceIcon
              resource={{ ...machineIcon, amount: 1 }}
              size="sm"
              bare
              showAmount={false}
              tooltip={false}
              className="!h-full !w-full"
              iconPixelSize={machineArtPixels(36)}
            />
          ) : null}
        </span>
        {/* The tier wears the board's own chip paint, full header height -
            the same standing as the add button, on the left. */}
        {tierColor ? (
          <span
            className="flex h-9 min-w-9 shrink-0 items-center justify-center border-2 px-1 text-[13px] font-bold shadow-[inset_2px_2px_0_rgba(255,255,255,0.55),inset_-2px_-2px_0_rgba(0,0,0,0.45)]"
            style={{
              backgroundColor: tierColor.background,
              borderColor: tierColor.border,
              color: tierColor.text,
              textShadow: `1px 1px 0 ${tierColor.shadow}`,
            }}
          >
            {minimumTier}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 leading-[1.15]">
          <span className="block truncate text-[15px] font-bold text-[var(--mc-ink)]">
            {machineLabel}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-[var(--mc-ink-muted)]">
            {stats}
          </span>
        </span>
        <button
          type="button"
          title="Add recipe node"
          aria-label="Add recipe node"
          onClick={(event) => {
            event.stopPropagation();
            void onAdd(recipe, undefined, inputPicks);
          }}
          className="flex h-8 w-8 shrink-0 items-center justify-center border-2 border-[var(--mc-33)] bg-[var(--mc-61)] text-neutral-100 shadow-[inset_1px_1px_0_var(--mc-85)] hover:border-cyan-400 hover:text-cyan-200"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {/* Two fixed halves with the arrow between, exactly the way the machine
          card itself reads: what it takes on the left, what it makes on the
          right, each item on its own line. */}
      <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-start gap-x-1">
        <span className="flex min-w-0 flex-col gap-1">
          {inputChips.map((chip, index) => {
            const picker: ChipMenuPicker | undefined =
              chip.faces.length > 1
                ? {
                    faces: chip.faces,
                    currentId: chip.resource.id,
                    onPick: (face) => pickFace(chip.indexes, face),
                  }
                : undefined;
            return (
              <ResourceChip
                key={`in-${index}`}
                resource={chip.resource}
                hit={takesClauses.some((clause) => clauseMatchesInput(clause, chip.raw))}
                amountText={
                  chip.raw.consumed === false
                    ? { text: "NC" }
                    : rateView === "eu"
                      ? formatChipEnergy(chip.resource, "input", eut, durationTicks)
                      : formatChipAmount(chip.resource, rateView, durationTicks, ratioDivisor)
                }
                hasAlternatives={chip.faces.length > 1}
                onCycle={
                  chip.faces.length > 1
                    ? (step) => {
                        const at = Math.max(
                          0,
                          chip.faces.findIndex((face) => face.id === chip.resource.id),
                        );
                        const next =
                          chip.faces[(at + step + chip.faces.length) % chip.faces.length];
                        pickFace(chip.indexes, next);
                      }
                    : undefined
                }
                onBrowseResource={onBrowseResource}
                onMenu={(event) => onChipMenu(event, { ...chip.resource, amount: 1 }, picker)}
              />
            );
          })}
        </span>
        <span className="flex items-start justify-center pt-2 text-[20px] font-black leading-6 text-[var(--mc-ink-muted)]">
          →
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          {outputChips.map((output, index) => (
            <ResourceChip
              key={`out-${index}`}
              resource={output}
              hit={makesClauses.some((clause) => clauseMatchesOutput(clause, output))}
              amountText={
                rateView === "eu"
                  ? formatChipEnergy(output, "output", eut, durationTicks)
                  : formatChipAmount(output, rateView, durationTicks, ratioDivisor)
              }
              chance={"chance" in output ? output.chance : undefined}
              onBrowseResource={onBrowseResource}
              onMenu={(event) => onChipMenu(event, { ...output, amount: 1 })}
            />
          ))}
        </span>
      </div>
    </article>
  );
});

/**
 * A ghost result card: the real card's anatomy with nothing in it yet,
 * breathing on a stagger while the answers travel. Its arrow fills over and
 * over like a furnace's progress bar - the one loading animation this app
 * could ever have.
 */
function powerDialNote(
  source: PowerSourceDefinition,
  settingId?: string,
  optionKey?: string,
): string | undefined {
  if (!settingId || !optionKey) {
    return undefined;
  }
  const setting = source.settings.find((entry) => entry.id === settingId);
  if (!setting || setting.type !== "select") {
    return undefined;
  }
  const option = setting.options.find((entry) => entry.key === optionKey);
  return option ? `${setting.label}: ${option.label}` : undefined;
}

/** Per-second power flows in the card's chosen reading; no craft, no ratio. */
function formatPowerChipAmount(kind: string, perSecond: number, rateView: RateView): ChipAmount {
  const unit =
    rateView === "recipe" || rateView === "ratio" || rateView === "eu"
      ? RATE_VIEW_UNITS.second
      : RATE_VIEW_UNITS[rateView];
  const per = unit.per;
  const value = perSecond * unit.multiplier;
  const text = trimTrailingZeros(formatRate(value, value >= 100 ? 0 : value >= 10 ? 1 : 2));
  return kind === "fluid" ? { text, unit: `L/${per}` } : { text, unit: `/${per}` };
}

/**
 * A generator answering the stencil, wearing the RECIPE CARD's own anatomy:
 * machine tile, tier chip, name, the plus - then takes on the left and makes
 * on the right as the same chips, with the EU it generates leading the
 * output column exactly as it leads the card's rail on the board. Not a
 * recipe underneath: the plus places the machine with the matched settings
 * dialed in, and the stats line names those dials.
 */
function PowerHitCard({
  hit,
  rateView,
  takesClauses,
  makesClauses,
  onPlace,
  onBrowseResource,
  onChipMenu,
}: {
  hit: PowerStencilHit;
  rateView: RateView;
  takesClauses: StencilClause[];
  makesClauses: StencilClause[];
  onPlace: () => void;
  onBrowseResource: (resource: ResourceAmount, mode: "recipes" | "uses") => void;
  onChipMenu: (event: ReactMouseEvent, resource: ResourceAmount) => void;
}) {
  const icon = getPowerMachineIcon(hit.source.id);
  const tierColor = hit.source.unlock
    ? (GT_TIER_COLORS as Record<string, (typeof GT_TIER_COLORS)["LV"] | undefined>)[
        hit.source.unlock
      ]
    : undefined;
  const model = useMemo(() => {
    try {
      return hit.source.compute(buildPowerSettingsReader(hit.source, hit.settings));
    } catch {
      return undefined;
    }
  }, [hit]);
  // Every dialed setting, not only the matched ones: a permuted card's fuel
  // is exactly what tells it apart from its siblings.
  const dials = Object.entries(hit.settings ?? {})
    .map(([settingId, optionKey]) => powerDialNote(hit.source, settingId, optionKey))
    .filter((note): note is string => note !== undefined);
  const stats = dials.length > 0 ? dials.join(" · ") : hit.source.blurb;
  const flowChip = (direction: "takes" | "makes", flow: { name: string; perSecond: number }) => {
    const resolved = resolvePowerResource(flow.name);
    const clauses = direction === "takes" ? takesClauses : makesClauses;
    const chipHit =
      resolved !== undefined &&
      clauses.some((clause) => clause.kind === resolved.kind && clause.id === resolved.id);
    if (!resolved) {
      // A flow with no dataset resource still shows, inert.
      return (
        <span
          key={`${direction}:${flow.name}`}
          className="flex w-full items-center gap-1.5 border border-[var(--mc-47)] bg-[var(--mc-61)] py-0.5 pl-0.5 pr-1.5"
        >
          <span className="h-9 w-9 shrink-0 bg-[var(--mc-55)] shadow-[inset_1px_1px_0_var(--mc-25),inset_-1px_-1px_0_var(--mc-100)]" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{flow.name}</span>
        </span>
      );
    }
    const resource: ResourceAmount = { ...resolved, amount: flow.perSecond } as ResourceAmount;
    return (
      <ResourceChip
        key={`${direction}:${flow.name}`}
        resource={resource}
        hit={chipHit}
        amountText={formatPowerChipAmount(resolved.kind, flow.perSecond, rateView)}
        onBrowseResource={onBrowseResource}
        onMenu={(event) => onChipMenu(event, { ...resource, amount: 1 })}
      />
    );
  };
  const wantsPower = makesClauses.some((clause) => clause.id === POWER_EU_CLAUSE_ID);
  return (
    <article
      onDoubleClick={onPlace}
      className="cursor-pointer border-2 border-[var(--mc-47)] bg-[var(--mc-71)] p-2 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]"
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 196px" }}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden bg-[var(--mc-55)] shadow-[inset_2px_2px_0_var(--mc-25),inset_-2px_-2px_0_var(--mc-100)]">
          {icon?.iconPath ? (
            <ResourceIcon
              resource={{
                kind: "item",
                id: icon.id,
                amount: 1,
                displayName: icon.displayName,
                iconPath: icon.iconPath,
                dominantColor: icon.dominantColor,
              }}
              size="sm"
              bare
              tooltip={false}
              showAmount={false}
              className="!h-full !w-full"
              iconPixelSize={machineArtPixels(36)}
            />
          ) : (
            <Zap className="h-4 w-4 fill-current text-amber-300" aria-hidden />
          )}
        </span>
        {tierColor ? (
          <span
            className="flex h-9 min-w-9 shrink-0 items-center justify-center border-2 px-1 text-[13px] font-bold shadow-[inset_2px_2px_0_rgba(255,255,255,0.55),inset_-2px_-2px_0_rgba(0,0,0,0.45)]"
            style={{
              backgroundColor: tierColor.background,
              borderColor: tierColor.border,
              color: tierColor.text,
              textShadow: `1px 1px 0 ${tierColor.shadow}`,
            }}
          >
            {hit.source.unlock}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 leading-[1.15]">
          <span className="block truncate text-[15px] font-bold text-[var(--mc-ink)]">
            {hit.source.name}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-[var(--mc-ink-muted)]">
            {stats}
          </span>
        </span>
        <button
          type="button"
          title="Add generator"
          aria-label={`Add ${hit.source.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onPlace();
          }}
          className="flex h-8 w-8 shrink-0 items-center justify-center border-2 border-[var(--mc-33)] bg-[var(--mc-61)] text-neutral-100 shadow-[inset_1px_1px_0_var(--mc-85)] hover:border-cyan-400 hover:text-cyan-200"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-start gap-x-1">
        <span className="flex min-w-0 flex-col gap-1">
          {model?.inputs
            .filter((flow) => flow.perSecond > 0)
            .map((flow) => flowChip("takes", flow))}
        </span>
        <span className="flex items-start justify-center pt-2 text-[20px] font-black leading-6 text-[var(--mc-ink-muted)]">
          →
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          {model && model.euPerTick > 0 ? (
            <span
              className={[
                "flex w-full items-center gap-1.5 border py-0.5 pl-0.5 pr-1.5",
                wantsPower
                  ? "border-cyan-400 bg-[var(--mc-61)] ring-1 ring-cyan-400"
                  : "border-[var(--mc-47)] bg-[var(--mc-61)]",
              ].join(" ")}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-[var(--mc-55)] shadow-[inset_1px_1px_0_var(--mc-25),inset_-1px_-1px_0_var(--mc-100)]">
                <Zap className="h-4 w-4 fill-current text-amber-400" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-bold">EU</span>
              <span className="shrink-0 whitespace-nowrap text-[12px] font-bold tabular-nums text-amber-300">
                ~{formatAmount(model.euPerTick)} EU/t
              </span>
            </span>
          ) : null}
          {model?.outputs
            .filter((flow) => flow.perSecond > 0)
            .map((flow) => flowChip("makes", flow))}
        </span>
      </div>
    </article>
  );
}

function SkeletonResultCard({ delay }: { delay: number }) {
  // NEGATIVE delay: a positive one leaves the card at full base opacity
  // until its turn, then snaps it into the cycle - which marched a visible
  // pop across the grid in reading order. Starting every card mid-cycle
  // gives the same ripple with nothing to snap.
  const delayStyle = { animationDelay: `-${delay}ms` };
  const ghostChip = (nameWidth: string, key: number) => (
    <span
      key={key}
      className="flex w-full items-center gap-1.5 border border-[var(--mc-47)] bg-[var(--mc-61)] py-0.5 pl-0.5 pr-1.5"
    >
      <span className="h-9 w-9 shrink-0 bg-[var(--mc-55)] shadow-[inset_1px_1px_0_var(--mc-25),inset_-1px_-1px_0_var(--mc-100)]" />
      <span className={`block h-4 ${nameWidth} bg-[var(--mc-71)]`} />
    </span>
  );

  return (
    <div
      className="recipe-search-skeleton border-2 border-[var(--mc-47)] bg-[var(--mc-71)] p-2 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]"
      style={delayStyle}
    >
      <div className="flex items-center gap-2">
        <span className="h-9 w-9 shrink-0 bg-[var(--mc-55)] shadow-[inset_2px_2px_0_var(--mc-25),inset_-2px_-2px_0_var(--mc-100)]" />
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="block h-3.5 w-36 bg-[var(--mc-61)]" />
          <span className="block h-2.5 w-24 bg-[var(--mc-61)]" />
        </span>
        <span className="h-8 w-8 shrink-0 border-2 border-[var(--mc-33)] bg-[var(--mc-61)]" />
      </div>
      <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-start gap-x-1">
        <span className="flex min-w-0 flex-col gap-1">
          {ghostChip("w-24", 0)}
          {ghostChip("w-16", 1)}
        </span>
        <span className="relative flex items-start justify-center pt-2 text-[var(--mc-47)]">
          <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden="true">
            <path d="M1 6h9" stroke="currentColor" strokeWidth="3" />
            <path d="M8 1l7 5-7 5" fill="currentColor" />
          </svg>
          <svg
            width="16"
            height="12"
            viewBox="0 0 16 12"
            fill="none"
            aria-hidden="true"
            className="recipe-search-arrow-fill absolute left-1/2 top-2 -translate-x-1/2 text-[#4cc3d9]"
            style={delayStyle}
          >
            <path d="M1 6h9" stroke="currentColor" strokeWidth="3" />
            <path d="M8 1l7 5-7 5" fill="currentColor" />
          </svg>
        </span>
        <span className="flex min-w-0 flex-col gap-1">{ghostChip("w-20", 0)}</span>
      </div>
    </div>
  );
}

/** A named item chip inside a result: icon, name, amount. Clicks browse it. */
function ResourceChip({
  resource,
  hit,
  amountText,
  chance,
  hasAlternatives = false,
  onCycle,
  onBrowseResource,
  onMenu,
}: {
  resource: ResourceAmount;
  hit: boolean;
  amountText: ChipAmount;
  chance?: number;
  /** The slot accepts several forms; the icon wears the classic blue plus. */
  hasAlternatives?: boolean;
  /** Wheel over the chip steps through the forms, and the choice sticks. */
  onCycle?: (step: 1 | -1) => void;
  onBrowseResource: (resource: ResourceAmount, mode: "recipes" | "uses") => void;
  onMenu: (event: ReactMouseEvent) => void;
}) {
  // The wheel listener is attached by hand, non-passive: React's synthetic
  // wheel cannot preventDefault, and without it every cycle also scrolls the
  // results behind the chip.
  const rootRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const element = rootRef.current;
    if (!element || !onCycle) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      if (!event.deltaY) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onCycle(event.deltaY > 0 ? 1 : -1);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [onCycle]);

  // A finger has no right button and iOS never fires contextmenu, so a held
  // press opens the same menu by hand - the port rows' own 450ms rule.
  const pressTimerRef = useRef<number | undefined>(undefined);
  const pressStartRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const longPressFiredRef = useRef(false);
  const clearPress = () => {
    pressStartRef.current = undefined;
    if (pressTimerRef.current !== undefined) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = undefined;
    }
  };
  useEffect(() => clearPress, []);

  return (
    <button
      ref={rootRef}
      type="button"
      onPointerDown={(event) => {
        if (event.pointerType !== "touch") {
          return;
        }
        const at = { clientX: event.clientX, clientY: event.clientY };
        clearPress();
        pressStartRef.current = { x: event.clientX, y: event.clientY };
        longPressFiredRef.current = false;
        pressTimerRef.current = window.setTimeout(() => {
          pressTimerRef.current = undefined;
          longPressFiredRef.current = true;
          onMenu({
            ...at,
            preventDefault: () => undefined,
            stopPropagation: () => undefined,
          } as ReactMouseEvent);
        }, 450);
      }}
      onPointerMove={(event) => {
        // A finger always jitters; only a real slide cancels the press.
        const start = pressStartRef.current;
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) {
          clearPress();
        }
      }}
      onPointerUp={clearPress}
      onPointerCancel={clearPress}
      title={
        hasAlternatives
          ? `${resource.displayName ?? resource.id}: scroll to switch what fills this slot, right click for more`
          : `${resource.displayName ?? resource.id}: click for what makes it, right click for more`
      }
      onClick={(event) => {
        event.stopPropagation();
        // The tap that ends a long press is not a second gesture.
        if (longPressFiredRef.current) {
          longPressFiredRef.current = false;
          return;
        }
        onBrowseResource({ ...resource, amount: 1 }, "recipes");
      }}
      onContextMenu={(event) => {
        onMenu(event);
      }}
      className={[
        "flex w-full items-center gap-2 border py-0.5 pl-0.5 pr-2 text-left",
        // A slot the stencil asked for says so quietly: the same chip on a
        // faintly blue ground with a faintly blue edge, not a highlighter.
        hit
          ? "border-[#3a525e] bg-[#283239]"
          : "border-[var(--mc-47)] bg-[var(--mc-61)] hover:border-[var(--mc-33)]",
      ].join(" ")}
    >
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden bg-[var(--mc-55)] shadow-[inset_1px_1px_0_var(--mc-25),inset_-1px_-1px_0_var(--mc-100)]">
        <ResourceIcon
          resource={{ ...resource, amount: 1, chance: undefined }}
          size="sm"
          bare
          showAmount={false}
          tooltip={false}
          className="!h-full !w-full"
          iconPixelSize={machineArtPixels(36)}
        />
        {/* No badge of our own: ResourceIcon already draws the blue plus for
            a slot that accepts several forms. */}
      </span>
      <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-[var(--mc-ink)]">
        {resource.displayName ?? resource.id}
      </span>
      <span
        className={[
          "shrink-0 text-[16px] font-bold tabular-nums",
          amountText.energy ? ENERGY_READING_TEXT : "text-[var(--mc-ink)]",
        ].join(" ")}
      >
        {amountText.text}
        {amountText.unit ? (
          <span
            className={[
              "ml-0.5 font-bold",
              // The energy unit is a tail, not part of the number: a size down
              // again, in the greyed gold that sits under the reading.
              amountText.energy ? "text-[10px] font-medium text-[#8c7d4c]" : "text-[11px] text-[var(--mc-ink-muted)]",
            ].join(" ")}
          >
            {amountText.unit}
          </span>
        ) : null}
      </span>
      {chance !== undefined && chance < 1 ? (
        <span className="text-[12px] text-[var(--mc-ink-muted)] tabular-nums">
          {Math.round(chance * 1000) / 10}%
        </span>
      ) : null}
    </button>
  );
}

/**
 * An oredict slot wears its first concrete face: the chip is a thing you can
 * click, not the dictionary's internal name.
 */
function chipFaceResource<T extends ResourceAmount>(resource: T): T {
  const face = isOreDictionaryResource(resource) ? resource.alternatives?.[0] : undefined;
  if (!face) {
    return resource;
  }
  return {
    ...resource,
    kind: face.kind,
    id: face.id,
    displayName: face.displayName ?? resource.displayName,
    iconPath: face.iconPath ?? resource.iconPath,
    iconAtlas: face.iconAtlas ?? resource.iconAtlas,
    dominantColor: face.dominantColor ?? face.iconAtlas?.dominantColor ?? resource.dominantColor,
  };
}

/**
 * Crafting-grid recipes list one entry per slot; the same item nine times is
 * one line saying ×9. Non-consumed entries and chanced outputs keep their own
 * lines, because merging those would change what the numbers mean.
 */
function mergeChipResources<T extends ResourceAmount & { consumed?: boolean; chance?: number }>(
  resources: T[],
): T[] {
  const merged = new Map<string, T>();
  for (const raw of resources) {
    const resource = chipFaceResource(raw);
    const key = [
      resource.kind,
      resource.id,
      resource.consumed === false ? "nc" : "c",
      resource.chance ?? 1,
    ].join("|");
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, { ...existing, amount: existing.amount + resource.amount });
    } else {
      merged.set(key, resource);
    }
  }
  return [...merged.values()];
}

function clauseMatchesInput(clause: StencilClause, input: ResourceAmount): boolean {
  if (clause.kind !== input.kind) {
    return false;
  }
  return (
    clause.id === input.id || resourceMatchesInput({ kind: clause.kind, id: clause.id }, input)
  );
}

function clauseMatchesOutput(clause: StencilClause, output: ResourceAmount): boolean {
  if (clause.kind !== output.kind) {
    return false;
  }
  return (
    clause.id === output.id ||
    (output.alternatives?.some(
      (alternative) => alternative.kind === clause.kind && alternative.id === clause.id,
    ) ??
      false)
  );
}

/** A chip's number and, apart from it, the quieter unit it is counted in. */
interface ChipAmount {
  text: string;
  unit?: string;
  /** An EU-per-unit reading, drawn in the board's gold on either side. */
  energy?: "input" | "output";
}

/**
 * The EU view's chip: one craft's energy (EU/t x ticks) over the amount
 * this slot makes (or eats) per craft. Chance is not applied - the recipe
 * as written, like every other view here. A recipe with no power or no
 * time reads 0, which is honest: a hand craft costs nothing.
 */
function formatChipEnergy(
  resource: ResourceAmount,
  side: "input" | "output",
  eut: number,
  durationTicks: number,
): ChipAmount {
  const perUnit =
    resource.amount > 0 ? (Math.max(0, eut) * Math.max(0, durationTicks)) / resource.amount : 0;
  return { text: formatCompact(perUnit), unit: energyPerUnitSuffix(resource.kind).trim(), energy: side };
}

/** "7.0" is 7 and "7.50" is 7.5: a trailing zero says nothing. */
function trimTrailingZeros(text: string): string {
  return text.includes(".") ? text.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : text;
}

function formatChipAmount(
  resource: ResourceAmount,
  rateView: RateView,
  durationTicks: number,
  ratioDivisor = 1,
): ChipAmount {
  // Ratio: lowest terms, no time, no unit prefix - a 1:1 recipe says 1 and 1,
  // not x1 and x1. Fluids keep their L so a litre never reads as an item.
  if (rateView === "ratio") {
    const reduced = resource.amount / ratioDivisor;
    return resource.kind === "fluid"
      ? { text: reduced.toLocaleString(), unit: "L" }
      : { text: reduced.toLocaleString() };
  }

  // The EU view reads INPUTS as written (see the RateView note).
  if (rateView === "recipe" || rateView === "eu" || durationTicks <= 0) {
    if (resource.kind === "fluid") {
      return { text: resource.amount.toLocaleString(), unit: "L" };
    }
    return { text: `×${resource.amount.toLocaleString()}` };
  }

  const unit = RATE_VIEW_UNITS[rateView];
  const value = ((resource.amount * 20) / durationTicks) * unit.multiplier;
  const text = trimTrailingZeros(formatRate(value, value >= 100 ? 0 : value >= 10 ? 1 : 2));
  return resource.kind === "fluid"
    ? { text, unit: `L/${unit.per}` }
    : { text, unit: `/${unit.per}` };
}


/**
 * How much room the search has: everything to the RIGHT of the item browser.
 *
 * The left column stays live beside the search - its list, search box and
 * recents are how queries get seeded, so covering it would cut the tool in
 * half. The right column is only readouts while the search is open, so the
 * search covers it and spends the room on bigger recipes.
 */
const BOARD_SIDEBAR_LEFT = 306;
const RECIPE_SEARCH_MIN_WIDTH = 640;
const RECIPE_SEARCH_MAX_WIDTH = 2200;
const RECIPE_SEARCH_MAX_HEIGHT = 1200;
const RECIPE_SEARCH_SHEET_BELOW = 700;
const ZERO_OFFSET = { x: 0, y: 0 };

interface RecipeSearchViewport {
  /** Filling the screen rather than floating over the board. */
  sheet: boolean;
  /** Where the search begins: the item browser keeps everything left of it. */
  leftInset: number;
  width: number;
  height: number;
}

function measureLeftSidebar(): number {
  if (typeof document === "undefined") {
    return BOARD_SIDEBAR_LEFT;
  }
  const element = document.querySelector('aside[data-help-anchor="browser"]');
  return element ? Math.round(element.getBoundingClientRect().width) : BOARD_SIDEBAR_LEFT;
}

function readRecipeSearchViewport(): RecipeSearchViewport {
  if (typeof window === "undefined") {
    return { sheet: false, leftInset: BOARD_SIDEBAR_LEFT, width: 960, height: 760 };
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Too narrow to be a window at all: fill the screen instead of leaving a
  // panel that is mostly margin. The item browser is a drawer here anyway.
  if (viewportWidth < RECIPE_SEARCH_SHEET_BELOW) {
    return { sheet: true, leftInset: 0, width: viewportWidth, height: viewportHeight };
  }

  const leftInset = measureLeftSidebar();
  return {
    sheet: false,
    leftInset,
    width: Math.min(
      RECIPE_SEARCH_MAX_WIDTH,
      Math.max(RECIPE_SEARCH_MIN_WIDTH, viewportWidth - leftInset - 24),
    ),
    height: Math.min(RECIPE_SEARCH_MAX_HEIGHT, Math.max(360, viewportHeight - 20)),
  };
}

function useRecipeSearchViewport(): RecipeSearchViewport {
  const [viewport, setViewport] = useState(readRecipeSearchViewport);

  useEffect(() => {
    const update = () => setViewport(readRecipeSearchViewport());

    window.addEventListener("resize", update);
    // Collapsing the item browser is not a window resize, and the search
    // should take the room it gives back.
    const observer = new ResizeObserver(update);
    const element = document.querySelector('aside[data-help-anchor="browser"]');
    if (element) {
      observer.observe(element);
    }

    return () => {
      window.removeEventListener("resize", update);
      observer.disconnect();
    };
  }, []);

  return viewport;
}

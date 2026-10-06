"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { getUiScale } from "@/lib/ui-scale";
import "./inspector/panel.css";
import { DrawerTargetRow } from "./inspector/DrawerTargetRow";
import { MachineShoppingList } from "./MachineShoppingList";
import { makeResourceKey, resourceLabel } from "@/lib/model/resources";
import { getCategoryPresentation } from "@/lib/model/category-presentation";
import { formatSignedRate } from "./inspector/flow-rate";
import { getMemoizedSupplyShortfalls, type InputSupplyShortfall } from "@/lib/solver/supply-shortfall";
import { getStorageRoles } from "@/lib/model/storage-role";
import { sectionNodeId } from "@/lib/model/shared-machine";
import {
  energyPerUnit,
  isEnergyRateUnit,
  rateMultiplierForKind,
  rateSuffixForKind,
} from "@/lib/model/rate-unit";
import { ENERGY_READING_TEXT, formatEnergyPerUnitParts } from "./flow/flow-explainers";
import type {
  FactoryProject,
  FactoryStorage,
  ResourceAmount,
  ResourceBalance,
  ResourceKey,
} from "@/lib/model/types";
import { calculateSelectionFlow, selectInternalBalances } from "@/lib/solver";
import { selectTrendSeries, useResourceTrends } from "@/lib/resource-trends";
import { useFactoryStore, useRateDisplayUnits } from "@/store/factory-store";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import {
  toggleResourceFavourite,
  toggleResourceHidden,
  useWorkspaceView,
  writeWorkspaceView,
} from "@/lib/workspace-view";
import {
  applyNetFlow,
  applyResourceMarks,
  buildFlowRows,
  filterFlowBalances,
  findResourceCardIds,
  findRowIndexAtOffset,
  getFlowRowValue,
  measureFlowRows,
  type BoundaryDrawers,
  type FlowRow,
  type FlowSection,
  type FlowSectionId,
  type FlowSectionTone,
  type ResourceMarks,
} from "./inspector/flow-sections";
import { TrendSparkline } from "./inspector/TrendSparkline";
import { MotionNumberText, runMotionTween, useBoardMotion } from "./flow/board-motion";
import { ResourceIcon } from "./nei/ResourceIcon";

const FLOW_FILTER_DEBOUNCE_MS = 120;
const SELECTION_DEBOUNCE_MS = 100;

// One ledger row: icon, resource, Raw and Net. Keep the virtual list
// height in sync with inspector/panel.css.
const ROW_HEIGHTS = { header: 22, item: 24, empty: 22, chart: 60, drawer: 28 };
const ICON_COLUMN = "20px";
const ROW_OVERSCAN = 6;
/** Stable identity so the row memo holds when charts are switched off. */
const EMPTY_KEYS: ReadonlySet<string> = new Set();

/**
 * Rates here obey the board's /s /min /hr switch like every other surface.
 * Formatters read the unit singleton; rows subscribe to the display dials
 * and repaint without solving again.
 */
function rateUnitFor(kind: ResourceBalance["kind"]): string {
  return rateSuffixForKind(kind).trim();
}

/** How long a row takes to grow into the list or fold out of it. */
const PRESENCE_MS = 240;
/**
 * Past this many rows changing at once (tab switch, filter keystroke, RAW/NET
 * flip) the list snaps instead of animating.
 */
const PRESENCE_BULK_CAP = 16;

interface RowPresence {
  /** Target rows plus any rows still folding out, held in place. */
  rows: FlowRow[];
  /** Bumped every animation frame; put it in measure-memo deps. */
  version: number;
  /** Height/opacity scale for one row: 1 settled, 0..1 mid-fold. */
  factorFor: (row: FlowRow) => number;
}

/**
 * List membership, animated: joining rows grow from zero height and leaving
 * rows fold away, on the value-motion clock. Windowing stays exact because
 * measureFlowRows reads the animated heights through `factorFor`.
 *
 * Rows are reconciled by KEY in the render phase (idempotent), so the first
 * frame after a change already shows arrivals at height zero. The tweens
 * start from an effect, so a render React discards starts nothing.
 */
function useRowPresence(targetRows: FlowRow[], enabled: boolean): RowPresence {
  const [, force] = useReducer((count: number) => count + 1, 0);
  const stateRef = useRef<
    | {
        target: FlowRow[];
        display: FlowRow[];
        factors: Map<string, number>;
        /** Where each animating key is heading: 1 arriving, 0 leaving. */
        directions: Map<string, 0 | 1>;
        cancels: Map<string, () => void>;
        pendingEnters: string[];
        pendingLeaves: string[];
        pendingSnap: boolean;
        seq: number;
        version: number;
      }
    | undefined
  >(undefined);
  if (stateRef.current === undefined) {
    stateRef.current = {
      target: targetRows,
      display: targetRows,
      factors: new Map(),
      directions: new Map(),
      cancels: new Map(),
      pendingEnters: [],
      pendingLeaves: [],
      pendingSnap: false,
      seq: 0,
      version: 0,
    };
  }
  const state = stateRef.current;

  if (state.target !== targetRows) {
    const targetKeys = new Set(targetRows.map((row) => row.key));
    const displayedKeys = new Set(state.display.map((row) => row.key));
    const arrivals: string[] = [];
    for (const row of targetRows) {
      // New to the list, or caught on the way out and coming back.
      if (!displayedKeys.has(row.key) || state.directions.get(row.key) === 0) {
        arrivals.push(row.key);
      }
    }
    const leavers = state.display.filter(
      (row) => !targetKeys.has(row.key) && state.directions.get(row.key) !== 0,
    );
    const churn = arrivals.length + leavers.length;

    if (!enabled || churn > PRESENCE_BULK_CAP) {
      state.display = targetRows;
      state.pendingEnters = [];
      state.pendingLeaves = [];
      if (churn > 0 || state.factors.size > 0) {
        state.pendingSnap = true;
        state.seq += 1;
      }
      state.version += 1;
    } else if (churn === 0 && state.factors.size === 0) {
      // Same membership, fresh data: pass the new rows straight through.
      state.display = targetRows;
    } else {
      // Merge: survivors take their fresh target row (in target order),
      // leavers hold their old row and their old place while they fold.
      const display: FlowRow[] = [];
      let cursor = 0;
      for (const row of state.display) {
        if (targetKeys.has(row.key)) {
          while (cursor < targetRows.length) {
            const next = targetRows[cursor];
            cursor += 1;
            display.push(next);
            if (next.key === row.key) {
              break;
            }
          }
        } else {
          display.push(row);
        }
      }
      while (cursor < targetRows.length) {
        display.push(targetRows[cursor]);
        cursor += 1;
      }
      state.display = display;
      for (const key of arrivals) {
        if (!state.factors.has(key)) {
          state.factors.set(key, 0);
        }
        state.pendingEnters.push(key);
      }
      for (const row of leavers) {
        state.pendingLeaves.push(row.key);
      }
      if (churn > 0) {
        state.seq += 1;
      }
      state.version += 1;
    }
    state.target = targetRows;
  }

  const seq = state.seq;
  useEffect(() => {
    const shared = stateRef.current;
    if (!shared) {
      return;
    }
    if (shared.pendingSnap) {
      for (const cancel of shared.cancels.values()) {
        cancel();
      }
      shared.cancels.clear();
      shared.factors.clear();
      shared.directions.clear();
      shared.pendingSnap = false;
      shared.version += 1;
      force();
    }
    const animateKey = (key: string, to: 0 | 1) => {
      shared.cancels.get(key)?.();
      const from = shared.factors.get(key) ?? (to === 1 ? 0 : 1);
      shared.directions.set(key, to);
      const cancel = runMotionTween({
        durationMs: PRESENCE_MS,
        onFrame: (eased) => {
          shared.factors.set(key, from + (to - from) * eased);
          shared.version += 1;
          force();
        },
        onDone: () => {
          shared.cancels.delete(key);
          shared.directions.delete(key);
          shared.factors.delete(key);
          if (to === 0) {
            shared.display = shared.display.filter((row) => row.key !== key);
          }
          shared.version += 1;
          force();
        },
      });
      shared.cancels.set(key, cancel);
    };
    const enters = shared.pendingEnters;
    shared.pendingEnters = [];
    const leaves = shared.pendingLeaves;
    shared.pendingLeaves = [];
    for (const key of enters) {
      animateKey(key, 1);
    }
    for (const key of leaves) {
      animateKey(key, 0);
    }
    // The ref box is stable; a new seq is a new batch of arrivals/leavers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);
  useEffect(
    () => () => {
      for (const cancel of stateRef.current?.cancels.values() ?? []) {
        cancel();
      }
    },
    [],
  );

  return {
    rows: state.display,
    version: state.version,
    factorFor: (row) => state.factors.get(row.key) ?? 1,
  };
}

export function InspectorPanel() {
  return (
    <aside
      data-help-anchor="inspector"
      className="inspector-panel flex h-full min-h-[360px] compact:min-h-0 flex-col bg-[#25272c]"
    >
      <FlowIOPanel />
      {/* The build list rides the panel's floor: what to build, at which
          tier, what one of each draws - and, when generators stand on the
          board, what they make and the plan's net power. */}
      <MachineShoppingList />
    </aside>
  );
}

function SelectedNodeShortfalls({
  name,
  inputs,
}: {
  name: string;
  inputs: InputSupplyShortfall[];
}) {
  return (
    <section
      aria-label="Selected node shortfalls"
      className="shrink-0 border-b border-amber-700/40 bg-amber-950/20 px-2 py-1.5 text-[11px] text-slate-200"
    >
      <div className="mb-1 truncate font-bold text-amber-300">{name} input shortfalls</div>
      {inputs.length === 0 ? (
        <p className="text-slate-400">No input shortfalls.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {inputs.map((input) => (
            <li key={input.resourceKey} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 tabular-nums">
              <span className="truncate" title={input.displayName}>{input.displayName}</span>
              <span className="whitespace-nowrap text-amber-300">
                −{formatSignedRate(input.deficitPerSecond, input.kind, 0)}{rateUnitFor(input.kind)}
              </span>
              <span className="col-span-2 truncate text-[10px] text-slate-400">
                {formatSignedRate(input.suppliedPerSecond, input.kind, 0)}{rateUnitFor(input.kind)} supplied / {formatSignedRate(input.requiredPerSecond, input.kind, 0)}{rateUnitFor(input.kind)} required
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FlowIOPanel() {
  const readOnly = useFactoryStore(state => state.isReadOnly);
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  // Every row prints a rate: follow the rate and power dials.
  useRateDisplayUnits();
  const hoveredFlowResourceKey = useFactoryStore((state) => state.hoveredFlowResourceKey);
  const setHoveredFlowResourceKey = useFactoryStore((state) => state.setHoveredFlowResourceKey);
  const selectedBoardIds = useFactoryStore((state) => state.selectedBoardIds);
  const focusBoardNode = useFactoryStore((state) => state.focusBoardNode);

  const [filter, setFilter] = useState("");
  const [rateColumn, setRateColumn] = useState<"raw" | "net">("raw");
  // Internal starts folded: it is the long tail, and the group that means
  // "nothing to see". One click opens it, and the state is per visit like the
  // other folds.
  const [collapsed, setCollapsed] = useState<Record<FlowSectionId, boolean>>({
    need: false,
    output: false,
    internal: true,
  });

  const resourcesByKey = useMemo(() => buildProjectResourceLookup(project), [project]);
  // Hundreds of rows carrying resource icons, so the list follows the settled
  // filter. The input stays on the raw value and remains instant.
  const debouncedFilter = useDebouncedValue(filter, FLOW_FILTER_DEBOUNCE_MS);

  // Selecting cards narrows the panel to those cards, solved as their own
  // small plan; selecting nothing (or only drawers) shows the whole board.
  // Debounced because this is a real solve and a selection-box drag changes
  // membership many times. Keyed on the joined ids so reselecting is free.
  const selectionKey = selectedBoardIds.join("\0");
  const debouncedSelectionKey = useDebouncedValue(selectionKey, SELECTION_DEBOUNCE_MS);
  const selection = useMemo(
    () =>
      calculateSelectionFlow(
        project,
        debouncedSelectionKey === "" ? [] : debouncedSelectionKey.split("\0"),
      ),
    [project, debouncedSelectionKey],
  );

  const planInternal = useMemo(
    () => selectInternalBalances(Object.values(result.resources)),
    [result.resources],
  );
  const selectedNodeShortfalls = useMemo(() => {
    if (selectedBoardIds.length !== 1) return undefined;
    const selectedNodeId = selectedBoardIds[0];
    const node = project.nodes.find((entry) => entry.id === selectedNodeId);
    if (!node) return undefined;
    const reports = getMemoizedSupplyShortfalls(project, result).byNode;
    const sectionIds = [
      node.id,
      ...(node.extraRecipes ?? []).map((_section, index) => sectionNodeId(node.id, index + 1)),
    ];
    const totals = new Map<string, InputSupplyShortfall>();
    for (const sectionId of sectionIds) {
      for (const input of reports[sectionId] ?? []) {
        const current = totals.get(input.resourceKey);
        totals.set(input.resourceKey, current ? {
          ...current,
          requiredPerSecond: current.requiredPerSecond + input.requiredPerSecond,
          suppliedPerSecond: current.suppliedPerSecond + input.suppliedPerSecond,
          deficitPerSecond: current.deficitPerSecond + input.deficitPerSecond,
        } : { ...input, nodeId: selectedNodeId });
      }
    }
    return {
      name: project.recipes.find((recipe) => recipe.id === node.recipeId)?.name ?? "Selected node",
      inputs: [...totals.values()],
    };
  }, [project, result, selectedBoardIds]);
  const scope = selection ?? result;
  const balanced = selection ? selection.internal : planInternal;

  const workspace = useWorkspaceView();
  const marks = useMemo<ResourceMarks>(
    () => ({
      hidden: new Set(readOnly ? [] : workspace.hiddenResourceKeys),
      favourites: new Set(readOnly ? [] : workspace.favouriteResourceKeys),
      showHidden: !readOnly && workspace.showHiddenResources,
      favouritesOnly: !readOnly && workspace.favouritesOnly,
    }),
    [
      readOnly,
      workspace.favouriteResourceKeys,
      workspace.favouritesOnly,
      workspace.hiddenResourceKeys,
      workspace.showHiddenResources,
    ],
  );

  // Declared boundary: resources with a source, product or byproduct drawer.
  // Those rows stay listed at 0/s instead of vanishing; internal rows come
  // and go with the wiring.
  const boundaryStorageKeys = useMemo(() => {
    const roles = getStorageRoles(project);
    const sources = new Set<ResourceKey>();
    const drains = new Set<ResourceKey>();
    for (const storage of project.storages ?? []) {
      const key = makeResourceKey(storage.kind, storage.resourceId);
      const role = roles.get(storage.id);
      if (role === "source") {
        sources.add(key);
      } else if (role === "product" || role === "byproduct") {
        drains.add(key);
      }
    }
    return { sources, drains };
  }, [project]);

  const sections = useMemo<FlowSection[]>(() => {
    const build = (
      id: FlowSectionId,
      label: string,
      empty: string,
      tone: FlowSectionTone,
      sign: -1 | 0 | 1,
      items: ResourceBalance[],
    ): FlowSection => {
      const marked = applyResourceMarks(items, marks);
      return {
        id,
        label,
        empty,
        tone,
        sign,
        items: filterFlowBalances(marked, debouncedFilter),
        totalCount: marked.length,
      };
    };

    // Raw lists preserve both boundary sides; Net files each resource by sign.
    let boundary = { needs: scope.externalInputs, outputs: scope.unconsumedOutputs };
    // The declared boundary (see boundaryStorageKeys): rows the drawers vouch
    // for join at 0/s when the books dropped them. Board scope only — the
    // selection view is a transient analysis, not the plan's ledger.
    if (!selection) {
      const augment = (list: ResourceBalance[], keys: ReadonlySet<ResourceKey>) => {
        const present = new Set(list.map((balance) => balance.key));
        const extras: ResourceBalance[] = [];
        for (const key of keys) {
          const balance = scope.resources[key];
          if (!present.has(key) && balance) {
            extras.push(balance);
          }
        }
        if (extras.length === 0) {
          return list;
        }
        extras.sort((a, b) =>
          (a.displayName ?? a.resourceId).localeCompare(b.displayName ?? b.resourceId),
        );
        return [...list, ...extras];
      };
      boundary = {
        needs: augment(boundary.needs, boundaryStorageKeys.sources),
        outputs: augment(boundary.outputs, boundaryStorageKeys.drains),
      };
    }
    if (rateColumn === "net") boundary = applyNetFlow(boundary.needs, boundary.outputs);
    return [
      // One line each: the row is a single fixed-height line, so wrapping
      // would clip.
      build("need", "Inputs", "Nothing missing.", "need", -1, boundary.needs),
      build("output", "Outputs", "Nothing coming out yet.", "output", 1, boundary.outputs),
      build("internal", "Internal", "Nothing internal.", "internal", 0, balanced),
    ];
  }, [
    balanced,
    boundaryStorageKeys,
    debouncedFilter,
    marks,
    rateColumn,
    scope.externalInputs,
    scope.resources,
    scope.unconsumedOutputs,
    selection,
  ]);

  const toggleSection = useCallback((id: FlowSectionId) => {
    setCollapsed((current) => ({ ...current, [id]: !current[id] }));
  }, []);

  /**
   * Double-click flies the board to a card that uses this resource; repeating
   * steps to the next one. The per-resource counter lives in a ref so
   * advancing it does not re-render the list.
   */
  const focusStepRef = useRef(new Map<string, number>());
  const focusBoardOnResource = useCallback(
    (resourceKey: string) => {
      const cardIds = findResourceCardIds(project, resourceKey);
      if (cardIds.length === 0) {
        return;
      }
      const step = focusStepRef.current.get(resourceKey) ?? 0;
      focusStepRef.current.set(resourceKey, step + 1);
      focusBoardNode(cardIds[step % cardIds.length]);
    },
    [focusBoardNode, project],
  );

  const activeResourceKey = hoveredFlowResourceKey;
  const matchCount = sections.reduce((total, section) => total + section.items.length, 0);
  const isFiltered = debouncedFilter.trim().length > 0;
  // Counted against the plan's own books, so resources hidden on some other
  // design never inflate the badge here.
  const hiddenCount = useMemo(
    () =>
      Object.keys(scope.resources).filter((key) => marks.hidden.has(key)).length,
    [marks.hidden, scope.resources],
  );

  // Rates are set here in Solve: sources behind Inputs rows, products
  // behind Outputs rows. Build and viewers only mark the products.
  const canEditRates = useFactoryStore((state) => !state.isReadOnly && (state.project.solveMode === true || state.project.poolMode === true));
  const drawers = useMemo<BoundaryDrawers>(() => {
    const roles = getStorageRoles(project);
    const selected = selection ? new Set(debouncedSelectionKey.split("\0")) : undefined;
    const need = new Map<string, FactoryStorage[]>();
    const output = new Map<string, FactoryStorage[]>();
    for (const storage of project.storages ?? []) {
      const role = roles.get(storage.id);
      const list = role === "source" ? need : role === "product" ? output : undefined;
      if (!list || (selected && !selected.has(storage.id))) continue;
      const key = makeResourceKey(storage.kind, storage.resourceId);
      list.set(key, [...(list.get(key) ?? []), storage]);
    }
    return { need, output };
  }, [project, selection, debouncedSelectionKey]);

  const shortfallPanelHeight = selectedNodeShortfalls
    ? 28 + selectedNodeShortfalls.inputs.length * 26
    : 0;
  const contentHeight = 78 + (selection ? 28 : 0) + shortfallPanelHeight + measureFlowRows(
    buildFlowRows(sections, collapsed, workspace.trendsOpen && !selection ? marks.favourites : EMPTY_KEYS, canEditRates ? drawers : undefined),
    ROW_HEIGHTS,
  ).totalHeight;

  return (
    <section
      style={{ flex: "0 1 auto", height: contentHeight, maxHeight: "var(--inspector-resource-max, 100%)", minHeight: "min(190px, 45%)" }}
      className={[
        // The ring wraps the WHOLE panel so the selection mode reads from
        // anywhere in the list. Only the controls sit on a card; the list sits
        // on the column itself.
        "relative isolate flex min-h-0 flex-1 flex-col",
        selection ? "inspector-selection-scope" : "",
      ].join(" ")}
    >
      {selection ? (
        <ScopeStrip
          machineCount={selection.machineCount}
          storageCount={selection.storageCount}
        />
      ) : null}
      {selectedNodeShortfalls ? (
        <SelectedNodeShortfalls name={selectedNodeShortfalls.name} inputs={selectedNodeShortfalls.inputs} />
      ) : null}

      <div className="inspector-section-heading">
        <h2>Resources</h2>
        <div hidden={readOnly} className={readOnly ? "ml-auto hidden" : "inspector-header-actions ml-auto flex items-center gap-1"}>
          <ToolbarToggle
            on={workspace.showHiddenResources}
            onClick={() =>
              writeWorkspaceView({ showHiddenResources: !workspace.showHiddenResources })
            }
            title={`Hidden resources (${hiddenCount})`}
            label={
              workspace.showHiddenResources
                ? "Stop showing hidden resources"
                : "Show hidden resources"
            }
            tone="cyan"
          >
            {workspace.showHiddenResources ? <EyeIcon /> : <EyeOffIcon />}
          </ToolbarToggle>

          {/* Charts record the whole plan's history, so they hide while a selection scopes the panel. */}
          {selection ? null : (
            <ToolbarToggle
              on={workspace.trendsOpen}
              onClick={() => writeWorkspaceView({ trendsOpen: !workspace.trendsOpen })}
              title="Charts"
              label={workspace.trendsOpen ? "Hide all charts" : "Show all charts"}
              tone="amber"
            >
              <ChartIcon />
            </ToolbarToggle>
          )}

          <ToolbarToggle
            on={workspace.favouritesOnly}
            onClick={() => writeWorkspaceView({ favouritesOnly: !workspace.favouritesOnly })}
            title="Starred only"
            label={
              workspace.favouritesOnly ? "List every resource again" : "List only starred resources"
            }
            tone="amber"
          >
            <span className="text-[13px] leading-none">★</span>
          </ToolbarToggle>

        </div>

          <button
            type="button"
            onClick={() => writeWorkspaceView({ rightPanelOpen: false })}
            title="Hide"
            aria-label="Hide the resources column"
            className={[
              "ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded border border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-100",

            ].join(" ")}
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
              <path d="M6 3l5 5-5 5" />
            </svg>
          </button>
      </div>
      <div className="inspector-controls mx-2 shrink-0 border-b border-neutral-700 pb-1">
        <div className="relative">
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter resources…"
            aria-label="Filter flow resources"
            className="h-7 w-full rounded-[4px] border border-neutral-700 bg-[#17191d] pl-2 pr-14 text-base shadow-[inset_1px_1px_0_rgba(255,255,255,0.08)] text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-cyan-600 focus:ring-1 focus:ring-cyan-300"
          />
          {filter ? (
            <button
              type="button"
              onClick={() => setFilter("")}
              aria-label="Clear filter"
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 hover:bg-[#1b1d21] hover:text-neutral-100"
            >
              {matchCount} ✕
            </button>
          ) : null}
        </div>
      </div>

      <FlowVirtualList
        rateColumn={rateColumn}
        onRateColumnChange={setRateColumn}
        drawers={drawers}
        editRates={canEditRates}
        sections={sections}
        collapsed={collapsed}
        isFiltered={isFiltered}
        resourcesByKey={resourcesByKey}
        activeResourceKey={activeResourceKey}
        hidden={marks.hidden}
        favourites={marks.favourites}
        // Charts are a whole-plan record, so a scoped panel has none to show.
        showCharts={!readOnly && workspace.trendsOpen && !selection}
        manageMode={!readOnly && workspace.showHiddenResources}
        // Read at render: flipping the unit re-solves, which re-renders here.
        energyEuT={isEnergyRateUnit() ? scope.totalEuT : undefined}
        onToggleSection={toggleSection}
        onHover={setHoveredFlowResourceKey}
        onFocusBoard={focusBoardOnResource}
      />
    </section>
  );
}

/** One square button in the panel's toolbar row. */
function ToolbarToggle({
  on,
  onClick,
  title,
  label,
  tone,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  label: string;
  tone: "cyan" | "amber";
  children: React.ReactNode;
}) {
  const onStyle =
    tone === "cyan"
      ? "border-cyan-500 bg-cyan-500/20 text-cyan-200"
      : "border-amber-500 bg-amber-500/20 text-amber-200";

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={label}
      aria-pressed={on}
      className={[
        "flex h-6 w-7 shrink-0 items-center justify-center rounded border",
        on ? onStyle : "border-neutral-700 text-neutral-400 hover:border-neutral-700 hover:text-neutral-100",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1.5 11.5 5 7l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z" />
      <circle cx="8" cy="8" r="1.9" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z" />
      <circle cx="8" cy="8" r="1.9" />
      <path d="M2 14 14 2" />
    </svg>
  );
}

/**
 * Names the mode the purple ring announces, so the numbers never change
 * unexplained. No exit control on purpose: the selection belongs to the
 * board, and clicking the canvas drops it.
 */
function ScopeStrip({
  machineCount,
  storageCount,
}: {
  machineCount: number;
  storageCount: number;
}) {
  const parts = [`${machineCount} ${machineCount === 1 ? "machine" : "machines"}`];
  if (storageCount > 0) {
    parts.push(`${storageCount} ${storageCount === 1 ? "drawer" : "drawers"}`);
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-[var(--selection-line)] bg-[var(--selection-wash)] px-2 py-1">
      <span className="text-xs font-bold uppercase tracking-wider text-[var(--selection-ink)]">
        Selection
      </span>
      <span className="ml-auto truncate text-xs text-[var(--selection-ink-dim)]">
        {parts.join(", ")}
      </span>
    </div>
  );
}

/**
 * Windowed list over all three sections at once, so hundreds of resources
 * cost the same as ten. Rows stay in normal flow between two spacers, which
 * lets the section headers use real CSS stickiness.
 */
function FlowVirtualList({
  rateColumn,
  onRateColumnChange,
  drawers,
  editRates,
  sections,
  collapsed,
  isFiltered,
  resourcesByKey,
  activeResourceKey,
  hidden,
  favourites,
  showCharts,
  manageMode,
  energyEuT,
  onToggleSection,
  onHover,
  onFocusBoard,
}: {
  rateColumn: "raw" | "net";
  onRateColumnChange: (value: "raw" | "net") => void;
  drawers: BoundaryDrawers;
  /** Solve, not a viewer: the drawers' rules and rates can be set here. */
  editRates: boolean;
  sections: FlowSection[];
  collapsed: Record<FlowSectionId, boolean>;
  isFiltered: boolean;
  resourcesByKey: Map<string, FlowResourceDisplay>;
  activeResourceKey?: string;
  hidden: ReadonlySet<string>;
  favourites: ReadonlySet<string>;
  showCharts: boolean;
  manageMode: boolean;
  /** The scope's power draw while the EU unit is on; undefined otherwise. */
  energyEuT?: number;
  onToggleSection: (id: FlowSectionId) => void;
  onHover: (resourceKey?: string) => void;
  onFocusBoard: (resourceKey: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(320);

  // No chart rows at all when charts are off, so the list closes up rather
  // than leaving gaps where they were.
  const targetRows = useMemo(
    () => buildFlowRows(sections, collapsed, showCharts ? favourites : EMPTY_KEYS, editRates ? drawers : undefined),
    [collapsed, favourites, sections, showCharts, drawers, editRates],
  );
  // Membership rides the value-motion clock: rows grow in and fold out, and
  // `rows` below may briefly hold departed rows mid-fold.
  const { valueMotion } = useBoardMotion();
  const presence = useRowPresence(targetRows, valueMotion);
  const rows = presence.rows;
  const history = useResourceTrends();
  // The pointed-at row, redrawn wide enough for its full name. Kept here
  // rather than in the row so only one can ever be open, and so it can be
  // rendered outside the scroll box that would otherwise clip it.
  const [expanded, setExpandedState] = useState<{
    key: string;
    top: number;
    right: number;
    startWidth: number;
  }>();
  const setExpanded = useCallback(
    (key: string, top: number, right: number, startWidth: number) => {
      setExpandedState({ key, top, right, startWidth });
    },
    [],
  );
  /**
   * Starring or hiding from the wide copy closes it. Both change the row (a
   * star adds a chart, a hide can drop it), and a lingering copy re-renders so
   * a different button lands under the unmoved pointer.
   */
  const dismissExpanded = useCallback(() => setExpandedState(undefined), []);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const expandedRow = useMemo(() => {
    if (!expanded) {
      return undefined;
    }
    for (const section of sections) {
      const balance = section.items.find((entry) => entry.key === expanded.key);
      if (balance) {
        return {
          balance,
          section,
          top: expanded.top,
          right: expanded.right,
          startWidth: expanded.startWidth,
        };
      }
    }
    // The row scrolled out from under the pointer, or a solve dropped it.
    return undefined;
  }, [expanded, sections]);
  // presence.version is what re-measures per animation frame, so the
  // spacers and the scroll length track the folding rows exactly.
  const presenceVersion = presence.version;
  const { offsets, totalHeight } = useMemo(
    () => measureFlowRows(rows, ROW_HEIGHTS, presence.factorFor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, presenceVersion],
  );

  /**
   * Keeps the wide copy glued to the row it covers. The copy is
   * `position: fixed`, so list scroll, page scroll (the shell has a minimum
   * height) and resizes would strand it. This re-measures the real row and
   * writes the position straight to the element: one measurement per scroll,
   * no re-render.
   */
  const expandedKey = expandedRow?.balance.key;
  /**
   * The real row behind the copy. Walked rather than queried by attribute
   * value: resource keys contain colons and `@`, and few rows are rendered.
   */
  const findExpandedRow = useCallback(() => {
    const rendered = scrollRef.current?.querySelectorAll<HTMLElement>("[data-resource-row]");
    return rendered
      ? Array.from(rendered).find((element) => element.dataset.resourceRow === expandedKey)
      : undefined;
  }, [expandedKey]);

  const positionExpanded = useCallback(() => {
    const overlay = overlayRef.current;
    const row = findExpandedRow();
    if (!overlay || !expandedKey || !row) {
      return;
    }

    const box = row.getBoundingClientRect();
    const list = scrollRef.current?.getBoundingClientRect();
    // A row scrolled half out of the list is clipped to a sliver, while its copy
    // is not: drawn on the row's real position it hung out of the bottom of the
    // panel and over the board, which looks like the wrong row entirely. No copy
    // until the row it belongs to is all there.
    if (list && (box.top < list.top - 1 || box.bottom > list.bottom + 1)) {
      overlay.style.visibility = "hidden";
      return;
    }
    overlay.style.visibility = "";
    // The copy is a body portal wearing .ui-zoom: its top/right are shell
    // pixels, the row's rect and the document width real pixels.
    const scale = getUiScale();
    overlay.style.top = `${box.top / scale}px`;
    // clientWidth, not innerWidth: innerWidth includes a classic scrollbar,
    // but a fixed element's `right` is measured from the initial containing
    // block, which does not. Flush with the row on purpose; the scrollbar is
    // handled by the copy being a pointer GHOST (see the wrapper).
    overlay.style.right = `${(document.documentElement.clientWidth - box.right) / scale}px`;
  }, [expandedKey, findExpandedRow]);

  /**
   * The copy's width: enough for the whole name, the rate and the mark
   * buttons' gap, never narrower than the row it covers nor wider than the
   * window has left. `max-content` asks the row itself, so a name that
   * already fits comes back no wider than its row.
   */
  const sizeExpanded = useCallback(() => {
    const overlay = overlayRef.current;
    const row = findExpandedRow();
    if (!overlay || !row) {
      return;
    }

    const box = row.getBoundingClientRect();
    // Measured with the arrival animations frozen: the buttons' gap animates up
    // from zero width, so a mid-flight measurement comes back short. Unfreezing
    // restarts them, which is right because the copy has not been painted yet.
    overlay.classList.add("resource-row-measuring");
    overlay.style.width = "max-content";
    // Fractional measurement plus slack, never offsetWidth: rounding a
    // fractional max-content down re-truncates the name. Rects are real px and
    // the copy's width is a shell-px style (a body portal wearing .ui-zoom),
    // so everything is converted.
    const scale = getUiScale();
    const natural = Math.ceil(overlay.getBoundingClientRect().width / scale) + 2;
    const rowWidth = box.width / scale;
    overlay.style.width = `${Math.round(
      Math.min(Math.max(natural, rowWidth), Math.max(box.right / scale - 12, rowWidth)),
    )}px`;
    overlay.classList.remove("resource-row-measuring");
  }, [findExpandedRow]);

  useLayoutEffect(() => {
    if (!expandedKey) {
      return undefined;
    }

    sizeExpanded();
    positionExpanded();
    // Capture phase: a scroll event does not bubble, and the one that matters
    // most is the list's own.
    window.addEventListener("scroll", positionExpanded, true);
    window.addEventListener("resize", positionExpanded);
    return () => {
      window.removeEventListener("scroll", positionExpanded, true);
      window.removeEventListener("resize", positionExpanded);
    };
  }, [expandedKey, positionExpanded, sizeExpanded]);

  /**
   * Dismissal is watched from the document because the copy is
   * pointer-transparent. It stays while the pointer is on a list row (rows
   * keep or replace it) or on the copy's own box; anywhere else it folds.
   * No carve-out near the scrollbar: the ghost already lets the bar be grabbed,
   * and folding there dropped the copy on the way to the star and eye.
   */
  useEffect(() => {
    if (!expandedKey) {
      return undefined;
    }
    const onMove = (event: globalThis.MouseEvent) => {
      const overlay = overlayRef.current;
      const target = event.target;
      if (target instanceof Element && overlay?.contains(target)) {
        return;
      }
      if (
        target instanceof Element &&
        target.closest("[data-resource-row], [data-resource-chart]")
      ) {
        return;
      }
      const copy = overlay?.getBoundingClientRect();
      if (
        copy &&
        event.clientX >= copy.left &&
        event.clientX <= copy.right &&
        event.clientY >= copy.top &&
        event.clientY <= copy.bottom
      ) {
        return;
      }
      setExpandedState(undefined);
    };
    document.addEventListener("mousemove", onMove, { capture: true, passive: true });
    return () => document.removeEventListener("mousemove", onMove, { capture: true });
  }, [expandedKey]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    setViewportHeight(element.clientHeight);
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  const startIndex = Math.max(0, findRowIndexAtOffset(offsets, scrollTop) - ROW_OVERSCAN);
  const endIndex = Math.min(
    rows.length,
    findRowIndexAtOffset(offsets, scrollTop + viewportHeight) + 1 + ROW_OVERSCAN,
  );
  const visibleRows = rows.slice(startIndex, endIndex);

  // The header of the section being scrolled through may sit above the window.
  // Re-adding it keeps a header pinned at all times; its height comes back out
  // of the top spacer so the total scroll length is unchanged.
  let stickyHeader: FlowRow | undefined;
  for (let index = startIndex; index >= 0; index -= 1) {
    if (rows[index]?.type === "header") {
      stickyHeader = index < startIndex ? rows[index] : undefined;
      break;
    }
  }

  const topSpacer = Math.max(0, offsets[startIndex] - (stickyHeader ? ROW_HEIGHTS.header : 0));
  const bottomSpacer = Math.max(0, totalHeight - offsets[endIndex]);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
    >
      {stickyHeader?.type === "header" ? (
        <FlowSectionHeader
          rateColumn={rateColumn}
          onRateColumnChange={onRateColumnChange}
          section={stickyHeader.section}
          collapsed={stickyHeader.collapsed}
          isFiltered={isFiltered}
          onToggle={onToggleSection}
        />
      ) : null}

      <div style={{ height: topSpacer }} />

      {visibleRows.map((row) => {
        // Headers are never wrapped: they are permanent (only their sections'
        // CONTENTS churn), and the shell would cage their sticky pinning.
        if (row.type === "header") {
          return (
            <FlowSectionHeader
          rateColumn={rateColumn}
          onRateColumnChange={onRateColumnChange}
              key={row.key}
              section={row.section}
              collapsed={row.collapsed}
              isFiltered={isFiltered}
              onToggle={onToggleSection}
            />
          );
        }

        // Every other row lives in a presence shell: full height at rest, a
        // clipping box mid-fold. Always mounted so an animation starting is
        // a style change, never a remount.
        const factor = presence.factorFor(row);
        const shell = (content: ReactNode) => (
          <div
            key={row.key}
            style={
              factor < 1
                ? {
                    height: Math.round(ROW_HEIGHTS[row.type] * factor),
                    opacity: factor,
                    overflow: "hidden",
                  }
                : undefined
            }
          >
            {content}
          </div>
        );

        if (row.type === "empty") {
          return shell(
            <p
              style={{ height: ROW_HEIGHTS.empty }}
              className={[
                "flex items-center px-3 text-xs text-neutral-400",
                TONE_STYLES[row.section.tone].tint,
              ].join(" ")}
            >
              {/* The row is one fixed-height line, so wrapping would clip. */}
              <span className="truncate">
                {isFiltered ? "No matches." : row.section.empty}
              </span>
            </p>,
          );
        }

        if (row.type === "drawer") {
          return shell(<DrawerTargetRow storage={row.storage} input={row.section.id === "need"} isLast={row.last} />);
        }

        if (row.type === "chart") {
          return shell(
            <FlowChartRow
              balance={row.balance}
              series={selectTrendSeries(history, row.balance.key)}
              // A starred row carries its chart directly beneath it, so the
              // chart takes the section's tint too or the band breaks under
              // every favourite.
              tint={TONE_STYLES[row.section.tone].tint}
              onHover={onHover}
              onExpand={setExpanded}
              onFocusBoard={onFocusBoard}
            />,
          );
        }

        return shell(
          <FlowResourceRow
            rateColumn={rateColumn}
            productMarker={!editRates && row.section.id === "output" && drawers.output.has(row.balance.key)}
            balance={row.balance}
            sectionId={row.section.id}
            tone={row.section.tone}
            sign={row.section.sign}
            resource={resourcesByKey.get(row.balance.key)}
            isActive={activeResourceKey === row.balance.key}
            isHidden={hidden.has(row.balance.key)}
            isFavourite={favourites.has(row.balance.key)}
            manageMode={manageMode}
            energyEuT={row.section.id !== "internal" ? energyEuT : undefined}
            onHover={onHover}
            onExpand={setExpanded}
            onFocusBoard={onFocusBoard}
          />,
        );
      })}

      <div style={{ height: bottomSpacer }} />

      {/*
        The pointed-at row, redrawn wide, portaled to <body>: a transform,
        filter, backdrop-filter, `contain` or `will-change` on any ancestor
        would become the containing block for `position: fixed`, so the copy
        would be mispositioned and clipped at the panel edge.
      */}
      {expandedRow && typeof document !== "undefined"
        ? createPortal(
        <div
          // The row's own width, measured on pointer arrival, is where the
          // grow animation starts.
          key={expandedRow.balance.key}
          ref={overlayRef}
          style={
            {
              // The row's position on pointer arrival, for the first frame;
              // the layout effect above owns these afterwards. Reported in real
              // px by the row; this portal positions in shell px (see
              // positionExpanded).
              top: expandedRow.top / getUiScale(),
              right: expandedRow.right / getUiScale(),
              "--row-start-width": `${expandedRow.startWidth / getUiScale()}px`,
            } as React.CSSProperties
          }
          // One ring around the row and its chart. A pointer GHOST: every
          // event falls through to the real list, so the wheel scrolls it, the
          // scrollbar stays grabbable and double-click still flies the board.
          // Only the mark buttons opt back in (pointer-events-auto). Hover and
          // dismissal belong to the underlying rows and the document watcher.
          className="resource-row-expand ui-zoom pointer-events-none fixed z-[60] overflow-hidden rounded bg-[#2a2d33] shadow-xl ring-1 ring-cyan-500/60"
        >
          <FlowResourceRow
            rateColumn={rateColumn}
            productMarker={!editRates && expandedRow.section.id === "output" && drawers.output.has(expandedRow.balance.key)}
            balance={expandedRow.balance}
            sectionId={expandedRow.section.id}
            tone={expandedRow.section.tone}
            sign={expandedRow.section.sign}
            resource={resourcesByKey.get(expandedRow.balance.key)}
            isActive
            isHidden={hidden.has(expandedRow.balance.key)}
            isFavourite={favourites.has(expandedRow.balance.key)}
            manageMode={manageMode}
            energyEuT={expandedRow.section.id !== "internal" ? energyEuT : undefined}
            expanded
            onHover={onHover}
            onExpand={setExpanded}
            onMarkChanged={dismissExpanded}
            onFocusBoard={onFocusBoard}
          />
          {/* The chart comes along, so the pair widens together rather than
              leaving the graph at column width under a row that grew. */}
          {showCharts && favourites.has(expandedRow.balance.key) ? (
            <FlowChartRow
              balance={expandedRow.balance}
              series={selectTrendSeries(history, expandedRow.balance.key)}
              expanded
              onHover={onHover}
              onExpand={setExpanded}
              onFocusBoard={onFocusBoard}
            />
          ) : null}
        </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/**
 * The chart under a starred resource, two rows tall. It shares the row
 * above's hover, so the pair lights the same machines as one block.
 */
const FlowChartRow = memo(function FlowChartRow({
  balance,
  series,
  tint = "",
  expanded = false,
  onHover,
  onExpand,
  onFocusBoard,
}: {
  balance: ResourceBalance;
  series: number[];
  /** The section colour its row carries, so the pair reads as one block. */
  tint?: string;
  expanded?: boolean;
  onHover: (resourceKey?: string) => void;
  onExpand: (resourceKey: string, top: number, right: number, startWidth: number) => void;
  onFocusBoard: (resourceKey: string) => void;
}) {
  useRateDisplayUnits();
  return (
    <div
      data-resource-chart={balance.key}
      style={{ height: ROW_HEIGHTS.chart }}
      className={["px-1 pb-1", tint].join(" ")}
      onMouseEnter={(event) => {
        onHover(balance.key);
        // Widens with its row: the chart is the half of the pair that most
        // needs the extra width, since more pixels across is literally more
        // edits you can pick out. The top of the PAIR is what the overlay
        // anchors to, so this reports its row's top, not its own.
        const box = event.currentTarget.getBoundingClientRect();
        onExpand(
          balance.key,
          box.top - ROW_HEIGHTS.item,
          document.documentElement.clientWidth - box.right,
          box.width,
        );
      }}
      onMouseLeave={expanded ? undefined : () => onHover(undefined)}
      // Same gesture as the row above it, so the pair behaves as one thing.
      onDoubleClick={() => onFocusBoard(balance.key)}
    >
      {/* One look, hovered or not: a hover tint would read as the data
          changing. Inside the wide copy it drops its own frame, because the
          wrapper already rings the pair. */}
      <div
        className={[
          "h-full rounded px-1",
          expanded ? "" : "border border-neutral-800 bg-[#1b1d21]/40",
        ].join(" ")}
      >
        <TrendSparkline
          series={series}
          height={ROW_HEIGHTS.chart - 10}
          unit={rateUnitFor(balance.kind)}
          multiplier={rateMultiplierForKind(balance.kind)}
        />
      </div>
    </div>
  );
});

function FlowSectionHeader({
  rateColumn,
  onRateColumnChange,
  section,
  collapsed,
  isFiltered,
  onToggle,
}: {
  rateColumn: "raw" | "net";
  onRateColumnChange: (value: "raw" | "net") => void;
  section: FlowSection;
  collapsed: boolean;
  isFiltered: boolean;
  onToggle: (id: FlowSectionId) => void;
}) {
  const tone = TONE_STYLES[section.tone];
  const showRatio = isFiltered && section.items.length !== section.totalCount;

  return (
    <div
      style={{ height: ROW_HEIGHTS.header }}
      className={[
        "inspector-flow-section sticky top-0 z-10 flex w-full items-center gap-2 px-2 text-left backdrop-blur-sm",
        tone.header,
      ].join(" ")}
    >
      <button type="button" onClick={() => onToggle(section.id)} aria-expanded={!collapsed} className="flex min-w-0 flex-1 items-center gap-1 text-left">
      <span className={["text-[11px] leading-none", collapsed ? "" : "rotate-90"].join(" ")}>▶</span>
      <span className="text-sm font-bold uppercase tracking-wider">{section.label}</span>
      <span className={["rounded px-1.5 py-0.5 text-xs font-bold tabular-nums", tone.badge].join(" ")}>
        {showRatio ? `${section.items.length} / ${section.totalCount}` : section.totalCount}
      </span>
      </button>
      {section.id === "need" && <span className="inspector-rate-selector ml-auto flex shrink-0 justify-end gap-0.5" role="group" aria-label="Resource rate display">
        {(["raw", "net"] as const).map(value => <button key={value} type="button" aria-pressed={rateColumn === value}
          onClick={() => onRateColumnChange(value)} className="px-2 py-0.5" aria-label={value === "raw" ? "Show raw rates" : "Show net rates"}>
          {value === "raw" ? "Raw" : "Net"}
        </button>)}
      </span>}
    </div>
  );
}

const FlowResourceRow = memo(function FlowResourceRow({
  rateColumn,
  productMarker,
  balance,
  sectionId,
  tone,
  sign,
  resource,
  isActive,
  isHidden,
  isFavourite,
  manageMode,
  energyEuT,
  expanded = false,
  onHover,
  onExpand,
  onMarkChanged,
  onFocusBoard,
}: {
  rateColumn: "raw" | "net";
  productMarker?: boolean;
  balance: ResourceBalance;
  sectionId: FlowSectionId;
  tone: FlowSectionTone;
  sign: -1 | 0 | 1;
  resource?: FlowResourceDisplay;
  isActive: boolean;
  isHidden: boolean;
  isFavourite: boolean;
  manageMode: boolean;
  /**
   * The scope's whole power draw while the EU unit is on, Inputs and Outputs rows:
   * the row then reads the EU the entire chain spent per unit of this resource
   * (made, or brought in) instead of its rate. Undefined otherwise and for Internal.
   */
  energyEuT?: number;
  /** The wide copy floating over the board: no truncation, opaque, raised. */
  expanded?: boolean;
  onHover: (resourceKey?: string) => void;
  onExpand: (resourceKey: string, top: number, right: number, startWidth: number) => void;
  /** Raised after a star or hide, so the wide copy can stand down. */
  onMarkChanged?: () => void;
  onFocusBoard: (resourceKey: string) => void;
}) {
  // Memoized rows keep the same balance when only a display dial changes.
  useRateDisplayUnits();
  const readOnly = useFactoryStore(state => state.isReadOnly);
  const toneStyle = TONE_STYLES[tone];
  const value = getFlowRowValue(sectionId, balance);
  // The energy reading: what the whole scope spends per unit of this product.
  // EU itself never reads as EU per EU.
  const euEach =
    energyEuT !== undefined && balance.kind !== "power"
      ? energyPerUnit(energyEuT, Math.abs(value))
      : undefined;
  const netValue = balance.surplusPerSecond - balance.deficitPerSecond;
  const netEnergy = energyEuT !== undefined && balance.kind !== "power"
    ? energyPerUnit(energyEuT, Math.abs(netValue)) : undefined;
  const unit = rateUnitFor(balance.kind);
  const category = useFactoryStore((state) =>
    getCategoryPresentation(state.project.recipes, balance.kind, balance.resourceId),
  );
  const name = resourceLabel(category ?? { id: balance.resourceId, displayName: balance.displayName });

  return (
    // The row is a group, not one button: the star and the eye are their own
    // controls, and a button cannot legally live inside another button.
    <div
      // Only the real rows are findable by key: the wide copy is what gets
      // positioned FROM one, so it must not be able to answer that query itself.
      data-resource-row={expanded ? undefined : balance.key}
      data-viewer-resource={readOnly || undefined}
      data-resource-hidden={isHidden ? "true" : undefined}
      style={{ height: ROW_HEIGHTS.item }}
      className={[
        "group relative px-1",
        // The section's colour, on the WRAPPER rather than the button inside
        // it. The button paints the cyan hover and the active highlight, so a
        // tint there would be competing with them for the same property;
        // underneath, it simply shows through until something covers it.
        toneStyle.tint,
        // Heavy enough to read as "struck off the list" at a glance, while
        // still legible enough to find the row you came here to unhide.
        isHidden ? "opacity-30 grayscale" : "",
      ].join(" ")}
      onMouseEnter={(event) => {
        onHover(balance.key);
        // The pointed-at row is redrawn wider over the board so a long name
        // reads in full. It must be a separate fixed layer: this row lives in
        // an `overflow-y: auto` box that clips anything past its edge. The copy
        // is pointer-transparent, so this enter keeps firing through it.
        const box = event.currentTarget.getBoundingClientRect();
        onExpand(
          balance.key,
          box.top,
          document.documentElement.clientWidth - box.right,
          box.width,
        );
      }}
      onMouseLeave={expanded ? undefined : () => onHover(undefined)}
    >
      <button
        type="button"
        onFocus={() => onHover(balance.key)}
        onBlur={() => onHover(undefined)}
        // Hover only, no click-to-lock: pointing at a row lights its machines
        // and leaving puts them out.
        onDoubleClick={() => onFocusBoard(balance.key)}
        // No `title`: a tooltip would trail the cursor down this dense list,
        // and the row already widens on hover to show the full name.
        style={{ gridTemplateColumns: `${ICON_COLUMN} minmax(0,1fr) 89px auto` }}
        className={[
          // A ring, not a border: a border takes a pixel off the content box
          // and reopens a band between rows. Spacing is per cell, not a grid
          // `gap`, which would also apply between the rate and the collapsed
          // columns after it.
          "inspector-resource-button grid h-full w-full items-center rounded pr-1 text-left",
          // The wide copy carries no highlight of its own: its wrapper rings
          // the row and the chart together as one block.
          expanded
            ? ""
            : isActive
              ? "bg-cyan-500/10 ring-1 ring-cyan-500/60"
              : "hover:bg-cyan-500/10 hover:ring-1 hover:ring-cyan-500/60",
        ].join(" ")}
      >
        {/* The icon spans the name and rate lines without growing with the row. */}
        <span
          style={{ height: 20, width: 20 }}
          className="relative flex shrink-0 items-center justify-center"
        >
          <ResourceIcon
            resource={{
              kind: balance.kind,
              id: balance.resourceId,
              amount: 1,
              displayName: name,
              alternatives: category?.alternatives,
              iconPath: resource?.iconPath,
              iconAtlas: resource?.iconAtlas,
              // Needed for the fluid fallback, which has no art to fall back on.
              dominantColor: resource?.dominantColor,
            }}
            size="sm"
            showAmount={false}
            bare
            tooltip={false}
            className="!h-full !w-full"
          />
          {productMarker ? <span className="inspector-product-marker" role="img" aria-label="Product">◆</span> : null}
        </span>

        {/* Truncates in the wide copy too. The extra width fits most names in
            full, which is the point, but a name longer than even that has to
            end in an ellipsis rather than run under the rate. */}
        <span className="inspector-resource-name ml-2 flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-base font-medium text-neutral-100">{name}</span>
        </span>

        {rateColumn === "raw" && <span
          className={[
            "inspector-resource-rate ml-2 flex shrink-0 items-baseline",
            euEach !== undefined ? ENERGY_READING_TEXT : toneStyle.value,
          ].join(" ")}
        >
          <span className="text-base font-bold tabular-nums">
            {euEach !== undefined ? (
              // The chain's cost per unit, in energy gold with a small grey
              // unit. Not eased: it is a quotient of two moving figures, and
              // tweening it would show the cost drifting on its own.
              <>
                {formatEnergyPerUnitParts(euEach, balance.kind).value}
                <span className="inspector-unit">
                  {formatEnergyPerUnitParts(euEach, balance.kind).unit}
                </span>
              </>
            ) : (
              <>
                {/* Eases to a new solve on the board's value-motion clock; the
                    sign and tone flip immediately, only the digits travel. */}
                <MotionNumberText
                  values={[Math.abs(value)]}
                  render={(shown) => formatSignedRate(shown[0] ?? Math.abs(value), balance.kind, sign)}
                />
                <span className="inspector-unit">{unit}</span>
              </>
            )}
          </span>

          {/*
            The star sits past the rate at the far right, so it holds still when
            the row widens on hover. It fades out as the mark buttons slide in,
            since the favourite button is also a filled star.
          */}
          {isFavourite ? (
            <span
              aria-hidden
              className={[
                "ml-1 shrink-0 text-[11px] leading-none text-amber-300",
                manageMode || expanded
                  ? "opacity-0"
                  : "group-focus-within:opacity-0 group-hover:opacity-0",
              ].join(" ")}
            >
              ★
            </span>
          ) : null}
        </span>}


        {rateColumn === "net" && <span className={`inspector-resource-net ${euEach !== undefined ? ENERGY_READING_TEXT : toneStyle.value}`}>
          {euEach !== undefined ? (netEnergy === undefined ? "—" : <>
            {formatEnergyPerUnitParts(netEnergy, balance.kind).value}
            <span className="inspector-unit">{formatEnergyPerUnitParts(netEnergy, balance.kind).unit}</span>
          </>) : <>
          <MotionNumberText
            values={[netValue]}
            render={([net = 0]) => formatSignedRate(net, balance.kind, net)}
          />
          <span className="inspector-unit">{unit}</span>
          </>}
        </span>}
        {/*
          The room the mark buttons slide into: a real grid column, not an
          overlay, so the hide button never covers the rate. Zero-wide until
          the row is pointed at. Class names are written in full because
          Tailwind only generates literal class names it finds in source.
        */}
        <span
          className={[
            // The class is the hook for the wide copy's own arrival animation
            // (globals.css): a copy mounts already open, so it has no previous
            // width to transition from.
            "resource-row-marks-gap overflow-hidden transition-[width] duration-100",
            isFavourite
              ? manageMode || expanded
                ? "w-6"
                : "w-0 group-focus-within:w-6 group-hover:w-6"
              : manageMode || expanded
                ? "w-11"
                : "w-0 group-focus-within:w-11 group-hover:w-11",
          ].join(" ")}
        />
      </button>

      {/*
        The buttons: absolute so they never affect row height, with
        `pointer-events-none` on the bar so only the squares are clickable.
        Manage mode shows them on every row at once.
      */}
      <div
        hidden={readOnly}
        className={[
          "resource-row-marks pointer-events-none absolute inset-y-0 right-1 flex items-center gap-0.5",
          manageMode || expanded
            ? ""
            : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
        ].join(" ")}
      >
        <RowMarkButton
          onClick={() => {
            toggleResourceFavourite(balance.key);
            onMarkChanged?.();
          }}
          title={isFavourite ? "Unwatch" : "Watch"}
          on={isFavourite}
          onClass="text-amber-300"
        >
          {isFavourite ? "★" : "☆"}
        </RowMarkButton>
        {/* A starred resource has no hide button. Starring a hidden one
            unhides it, so this can never strand a row. */}
        {isFavourite ? null : (
          <RowMarkButton
            onClick={() => {
              toggleResourceHidden(balance.key);
              onMarkChanged?.();
            }}
            title={isHidden ? "Unhide" : "Hide"}
            on={isHidden}
            onClass="text-cyan-300"
          >
            <span className="flex h-3.5 w-3.5 items-center justify-center">
              {isHidden ? <EyeIcon /> : <EyeOffIcon />}
            </span>
          </RowMarkButton>
        )}
      </div>
    </div>
  );
});

function RowMarkButton({
  onClick,
  title,
  on,
  onClass,
  children,
}: {
  onClick: () => void;
  title: string;
  on: boolean;
  onClass: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={on}
      // The bar around these is pointer-events-none so it can never swallow a
      // click meant for the rate behind it; the buttons opt back in.
      className={[
        "pointer-events-auto flex h-5 w-5 shrink-0 items-center justify-center rounded text-[13px] leading-none hover:bg-[#1b1d21]",
        on ? onClass : "text-neutral-400 hover:text-neutral-100",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/**
 * `tint` is the section's colour at 5%, carried by every row under the header
 * so a group reads as one band. Faint so it loses to the cyan hover.
 */
const TONE_STYLES: Record<
  FlowSectionTone,
  { header: string; badge: string; value: string; tint: string }
> = {
  need: {
    header:
      "border-[var(--flow-input)]/40 bg-red-950/85 text-[var(--flow-input)] hover:bg-red-900/60",
    badge: "bg-[var(--flow-input)]/30 text-[var(--flow-input)]",
    value: "text-[var(--flow-input)]",
    tint: "bg-[var(--flow-input)]/5",
  },
  /* One Outputs section, one colour: red in, green out. */
  output: {
    header: "border-[var(--flow-output)]/40 bg-emerald-950/85 text-[var(--flow-output)] hover:bg-emerald-900/60",
    badge: "bg-[var(--flow-output)]/30 text-[var(--flow-output)]",
    value: "text-[var(--flow-output)]",
    tint: "bg-[var(--flow-output)]/5",
  },
  internal: {
    header:
      "border-neutral-800 bg-[#1b1d21]/90 text-neutral-300 hover:bg-[#25272c]",
    badge: "bg-fg-muted/20 text-neutral-300",
    value: "text-neutral-300",
    // No tint. Internal is the long tail and the one group that means "nothing
    // to see"; painting it too would make the panel a stack of colours with no
    // quiet ground to read the others against.
    tint: "",
  },
};

type FlowResourceDisplay = Pick<
  ResourceAmount,
  "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
>;

function buildProjectResourceLookup(project: FactoryProject): Map<string, FlowResourceDisplay> {
  const resources = new Map<string, FlowResourceDisplay>();
  const addResource = (resource: FlowResourceDisplay) => {
    const key = `${resource.kind}:${resource.id}`;
    const existing = resources.get(key);
    if (!existing || (!existing.iconPath && resource.iconPath)) {
      resources.set(key, resource);
    }
  };

  for (const recipe of project.recipes) {
    for (const resource of [...recipe.inputs, ...recipe.outputs]) {
      addResource(resource);
    }
  }

  for (const storage of project.storages ?? []) {
    addResource({
      kind: storage.kind,
      id: storage.resourceId,
      displayName: storage.displayName,
      iconPath: storage.iconPath,
      iconAtlas: storage.iconAtlas,
      dominantColor: storage.dominantColor,
    });
  }

  return resources;
}

"use client";

import {
  Check,
  ChevronDown,
  ClipboardList,
  Download,
  ImageDown,
  LoaderCircle,
  Redo2,
  Share2,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  cloneImportedProject,
  parseFactoryProjectJson,
  serializeFactoryProject,
} from "@/lib/import-export";
import { DEFAULT_DATASET_MANIFEST_URL } from "@/lib/datasets";
import { randomUUID } from "@/lib/random-id";
import {
  getRecipeDatasetRecipe,
  getRecipeDatasetRecipeIds,
  queryRecipeDatasetRecipes,
  resolveRecipeDatasetRecipes,
} from "@/lib/datasets/browser-loader";
import type { DatasetVersion } from "@/lib/datasets";
import type {
  FactoryEdge,
  FactoryProject,
  Recipe,
  RecipeOutput,
  ResourceKind,
} from "@/lib/model/types";
import { formatBoardDump } from "./flow/board-dump";
import { makeResourceHandleId, parseResourceHandleId } from "./flow/resource-handles";
import { isEditableKeyboardTarget } from "./flow/keyboard";
import {
  extractProjectJsonFromPng,
  extractProjectJsonFromSvg,
} from "@/lib/import-export/plan-image";
import { useWelcomeTab } from "@/lib/tour/welcome-tab";
import { useFactoryStore } from "@/store/factory-store";

interface BoardActionsProps {
  /**
   * `bar` is the top bar's row of icons. `list` is the compact menu: the same
   * actions as labelled rows, with the export dropdown flattened into its three
   * formats — a menu inside a menu is a trap on a touchscreen — and undo/redo
   * left out, because on a phone they are two always-visible buttons on the
   * board itself.
   */
  variant?: "bar" | "list";
  /** Lets the compact menu close itself once one of its rows has fired. */
  onAction?: () => void;
  /**
   * Opens the share dialog. The dialog itself is owned by the header, not
   * rendered here: on compact this component lives inside the menu sheet,
   * which closes (and unmounts) the moment a row fires.
   */
  onShare?: () => void;
  /** Opens the export-image dialog; owned by the header for the same reason. */
  onExportImage?: () => void;
}

/**
 * Board actions - undo/redo, clean, import/export, theme.
 *
 * Lives on the right of the design tab strip: everything here acts on the plan
 * that strip is switching between, so the two belong on the same bar.
 */
export function BoardActions({
  variant = "bar",
  onAction,
  onShare,
  onExportImage,
}: BoardActionsProps = {}) {
  const projectInputRef = useRef<HTMLInputElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [isExportMenuOpen, setExportMenuOpen] = useState(false);
  const [pendingExport, setPendingExport] = useState<
    { format: "json"; requestId: string } | undefined
  >();
  const project = useFactoryStore((state) => state.project);
  const manifest = useFactoryStore((state) => state.datasetManifest);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const isProjectImporting = useFactoryStore((state) => state.isProjectImporting);
  const canUndo = useFactoryStore((state) => state.undoHistory.length > 0);
  const canRedo = useFactoryStore((state) => state.redoHistory.length > 0);
  const setProject = useFactoryStore((state) => state.setProject);
  const frameBoardNodes = useFactoryStore((state) => state.frameBoardNodes);
  const setProjectImporting = useFactoryStore((state) => state.setProjectImporting);
  const cleanBoard = useFactoryStore((state) => state.cleanBoard);
  const undo = useFactoryStore((state) => state.undo);
  const redo = useFactoryStore((state) => state.redo);
  const lastResult = useFactoryStore((state) => state.lastResult);
  const selectedBoardIds = useFactoryStore((state) => state.selectedBoardIds);
  const [diagnosticsState, setDiagnosticsState] = useState<"idle" | "copied" | "failed">("idle");
  // Welcome COVERS the board, so the design underneath still has content and
  // Share would happily post it. But sharing a board you cannot see is a
  // trap, so the button waits until you are looking at the thing it posts.
  const isWelcomeCoveringBoard = useWelcomeTab().active;
  const canShare = !isWelcomeCoveringBoard && project.nodes.length > 0;
  const shareTitle = isWelcomeCoveringBoard
    ? "Share: open a design tab first"
    : project.nodes.length === 0
      ? "Share: build something first"
      : "Share";

  const selectedCardCount = selectedBoardIds.length;
  const diagnosticsLabel =
    diagnosticsState === "copied"
      ? "Copied to clipboard"
      : diagnosticsState === "failed"
        ? "Could not reach the clipboard"
        : selectedCardCount > 0
          ? `Copy diagnostics (${selectedCardCount} selected)`
          : "Copy diagnostics (whole plan)";

  /**
   * The pasteable version of what the board is showing: every selected card's
   * machine, tier, config, overclock, rates and verdict, in JSON. Select
   * nothing and it dumps the plan.
   *
   * The menu deliberately stays open - the row itself is the receipt, and
   * closing it would take the only confirmation away with it.
   */
  const copyDiagnostics = async () => {
    const text = formatBoardDump({
      project,
      result: lastResult,
      selectedIds: selectedBoardIds,
    });
    setDiagnosticsState((await copyToClipboard(text)) ? "copied" : "failed");
    window.setTimeout(() => setDiagnosticsState("idle"), 2000);
  };

  const exportJson = async () => {
    const requestId = randomUUID();
    setExportMenuOpen(false);
    setPendingExport({ format: "json", requestId });
    await nextAnimationFrame();

    const json = serializeFactoryProject(project);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "factory"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    window.setTimeout(() => {
      setPendingExport((current) => (current?.requestId === requestId ? undefined : current));
    }, 450);
  };

  const importProjectJson = async (file: File) => {
    setProjectImporting(true);

    try {
      const text = await readProjectFile(file);
      const selectedDatasetVersion = manifest?.versions.find(
        (version) => version.id === selectedDatasetVersionId,
      );
      const importedProject = refreshImportedProjectEdges(
        cloneImportedProject(parseFactoryProjectJson(text)),
      );

      // An imported plan was built on someone else's board, so its cards can
      // sit anywhere at all: the camera goes to them rather than leaving the
      // viewer on blank canvas.
      if (!selectedDatasetVersion) {
        setProject(importedProject);
        frameBoardNodes();
        console.warn(
          "Plan imported without an active GTNH dataset; embedded recipe data was kept.",
        );
        return;
      }

      const hydration = await hydrateImportedProjectRecipes(
        importedProject,
        selectedDatasetVersion,
      );
      setProject(refreshImportedProjectEdges(hydration.project));
      frameBoardNodes();

      if (hydration.missingRecipes.length) {
        console.warn(
          "Imported plan contains recipe IDs that are not present in the selected dataset.",
          hydration.missingRecipes,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Plan import failed.";
      console.error(message);
    } finally {
      setProjectImporting(false);
      if (projectInputRef.current) {
        projectInputRef.current.value = "";
      }
    }
  };

  useEffect(() => {
    const closeMenus = (event: PointerEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    };

    // Capture phase: the board's pan handler stops a press on the canvas before
    // it reaches a bubble-phase listener, which left this menu open over it.
    window.addEventListener("pointerdown", closeMenus, true);
    return () => window.removeEventListener("pointerdown", closeMenus, true);
  }, []);

  useEffect(() => {
    const handleProjectHistoryShortcut = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey) {
        return;
      }

      // Typing owns its own history: Ctrl+Z in a rename field or note must
      // undo the typing, not the board.
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      if (key === "y" && !event.shiftKey) {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleProjectHistoryShortcut);
    return () => window.removeEventListener("keydown", handleProjectHistoryShortcut);
  }, [redo, undo]);

  const requestCleanBoard = () => {
    if (project.nodes.length === 0 && project.edges.length === 0) {
      return;
    }

    if (!window.confirm("Clean the board and remove all nodes and links?")) {
      return;
    }

    cleanBoard();
  };

  const planFileInput = (
    <input
      ref={projectInputRef}
      type="file"
      accept="application/json,image/svg+xml,image/png,.json,.svg,.png"
      className="hidden"
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) {
          void importProjectJson(file);
        }
      }}
    />
  );

  if (variant === "list") {
    return (
      <div data-help-anchor="plan-actions" className="flex flex-col">
        {onShare ? (
          <MenuAction
            icon={Share2}
            label="Share this setup"
            disabled={!canShare}
            onClick={() => {
              onShare();
              onAction?.();
            }}
          />
        ) : null}
        <MenuAction
          icon={Trash2}
          label="Clean the board"
          onClick={() => {
            requestCleanBoard();
            onAction?.();
          }}
        />
        <MenuAction
          icon={Upload}
          label="Import a plan"
          disabled={isProjectImporting}
          onClick={() => {
            projectInputRef.current?.click();
            onAction?.();
          }}
        />
        <MenuAction
          icon={diagnosticsState === "copied" ? Check : ClipboardList}
          label={diagnosticsLabel}
          onClick={() => {
            void copyDiagnostics();
          }}
        />
        <MenuAction
          icon={Download}
          label="Export as JSON"
          disabled={Boolean(pendingExport)}
          onClick={() => {
            void exportJson();
            onAction?.();
          }}
        />
        {onExportImage ? (
          <MenuAction
            icon={ImageDown}
            label="Export an image"
            onClick={() => {
              onExportImage();
              onAction?.();
            }}
          />
        ) : null}
        {planFileInput}
      </div>
    );
  }

  return (
    <div data-help-anchor="plan-actions" className="flex shrink-0 items-center gap-1">
      <div className="flex items-center gap-1">
        {/* No undo, redo or clean-board up here. Undo and redo already sit on
            the board's own build toolbar, an inch from the thing being undone,
            and having them in two places at once only made the header look
            like the authoritative pair. Clean board is a whole-plan action that
            was one slip away from the import button; it lives in the menu. */}
        {/* Share wears its word, alone on the bar in doing so: it was buried
            in the Setups tab and people could not find it. Same dialog as the
            shelf's own button. */}
        {onShare ? (
          <button
            type="button"
            onClick={onShare}
            disabled={!canShare}
            title={shareTitle}
            className="inline-flex h-7 items-center gap-1 rounded border border-line-strong bg-surface px-1.5 text-xs font-medium text-fg-subtle hover:border-emerald-600 hover:text-emerald-500 disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-muted"
          >
            <Share2 className="h-3.5 w-3.5" />
            Share
          </button>
        ) : null}
        <ToolbarButton
          icon={Upload}
          label="Import plan"
          disabled={isProjectImporting}
          onClick={() => projectInputRef.current?.click()}
        />
        <div ref={exportMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setExportMenuOpen((isOpen) => !isOpen)}
            title="Export plan"
            aria-label="Export plan"
            aria-expanded={isExportMenuOpen}
            aria-busy={pendingExport ? true : undefined}
            disabled={Boolean(pendingExport)}
            className="inline-flex h-7 items-center justify-center gap-0.5 rounded border border-line-strong bg-surface px-1.5 text-fg-subtle hover:bg-surface-raised disabled:cursor-wait disabled:bg-surface-sunken disabled:text-fg-muted"
          >
            {pendingExport ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            <ChevronDown className="h-3 w-3" />
          </button>
          {isExportMenuOpen ? (
            <div className="absolute right-0 top-8 z-50 min-w-44 rounded border border-line-strong bg-surface py-1 text-sm shadow-lg">
              <ExportMenuItem
                icon={diagnosticsState === "copied" ? Check : ClipboardList}
                label={diagnosticsLabel}
                onClick={() => {
                  void copyDiagnostics();
                }}
              />
              <div className="my-1 border-t border-line-strong" />
              <ExportMenuItem
                icon={Download}
                label="Export plan JSON"
                onClick={() => {
                  void exportJson();
                }}
              />
              {onExportImage ? (
                <ExportMenuItem
                  icon={ImageDown}
                  label="Export an image..."
                  onClick={() => {
                    setExportMenuOpen(false);
                    onExportImage();
                  }}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {planFileInput}
    </div>
  );
}

/**
 * One row of the compact menu: a 40px tap target with the icon the top bar
 * would have shown on its own, and the words that icon was relying on a
 * tooltip for.
 */
function MenuAction({
  icon: Icon,
  label,
  disabled = false,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-10 w-full items-center gap-2.5 rounded px-2 text-left text-sm text-fg-subtle hover:bg-surface-sunken disabled:cursor-not-allowed disabled:text-fg-muted"
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * Write text to the system clipboard, with the old selection-based path behind
 * it: the async API needs a secure context, and a plan opened from a file or
 * over plain http has none. Reports whether it landed rather than throwing,
 * because the caller's whole job is to say so on the button.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const scratch = document.createElement("textarea");
      scratch.value = text;
      scratch.setAttribute("readonly", "");
      scratch.style.position = "fixed";
      scratch.style.opacity = "0";
      document.body.append(scratch);
      scratch.select();
      const copied = document.execCommand("copy");
      scratch.remove();
      return copied;
    } catch {
      return false;
    }
  }
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

async function readProjectFile(file: File): Promise<string> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "svg" || file.type === "image/svg+xml") {
    const projectJson = extractProjectJsonFromSvg(await file.text());
    if (!projectJson) {
      throw new Error("This SVG does not contain a GTNH Planner plan.");
    }
    return projectJson;
  }

  if (extension === "png" || file.type === "image/png") {
    const projectJson = await extractProjectJsonFromPng(file);
    if (!projectJson) {
      throw new Error("This PNG does not contain a GTNH Planner plan.");
    }
    return projectJson;
  }

  return file.text();
}

async function hydrateImportedProjectRecipes(
  project: FactoryProject,
  version: DatasetVersion,
): Promise<{
  project: FactoryProject;
  missingRecipes: Array<Pick<FactoryProject["recipes"][number], "id" | "name">>;
  migratedRecipes: Array<{
    fromId: string;
    toId: string;
    name: string;
  }>;
}> {
  const availableRecipeIds = new Set(
    await getRecipeDatasetRecipeIds(DEFAULT_DATASET_MANIFEST_URL, version),
  );
  const importRecipesToResolve = project.recipes.filter(
    (recipe) => !availableRecipeIds.has(recipe.id),
  );
  const resolvedRecipeIds = new Map(
    importRecipesToResolve.length
      ? (
          await resolveRecipeDatasetRecipes(
            DEFAULT_DATASET_MANIFEST_URL,
            version,
            importRecipesToResolve.map((recipe) => ({
              id: recipe.id,
              name: recipe.name,
              machineType: recipe.machineType,
              recipeMap: recipe.source?.recipeMap,
              rawRecipeId: recipe.source?.rawRecipeId,
              outputs: recipe.outputs.map((output) => ({
                kind: output.kind,
                id: output.id,
              })),
            })),
          )
        ).matches.map((match) => [match.importedId, match.recipeId] as const)
      : [],
  );
  const missingRecipes: Array<Pick<FactoryProject["recipes"][number], "id" | "name">> = [];
  const migratedRecipes: Array<{ fromId: string; toId: string; name: string }> = [];
  const recipeIdMigration = new Map<string, string>();

  const hydratedRecipes = await Promise.all(
    project.recipes.map(async (recipe) => {
      if (!availableRecipeIds.has(recipe.id)) {
        const rawRecipeIdMatch = resolvedRecipeIds.get(recipe.id);
        const migratedRecipe = rawRecipeIdMatch
          ? await getRecipeDatasetRecipe(DEFAULT_DATASET_MANIFEST_URL, version, rawRecipeIdMatch)
          : await resolveImportedRecipe(version, recipe);
        if (migratedRecipe) {
          migratedRecipes.push({
            fromId: recipe.id,
            toId: migratedRecipe.id,
            name: recipe.name,
          });
          recipeIdMigration.set(recipe.id, migratedRecipe.id);
          return migratedRecipe;
        }

        missingRecipes.push({ id: recipe.id, name: recipe.name });
        return recipe;
      }

      return getRecipeDatasetRecipe(DEFAULT_DATASET_MANIFEST_URL, version, recipe.id);
    }),
  );
  const hydratedProject = {
    ...project,
    recipes: hydratedRecipes,
  };

  return {
    project: remapMigratedRecipeReferences(hydratedProject, recipeIdMigration),
    missingRecipes,
    migratedRecipes,
  };
}

function remapMigratedRecipeReferences(
  project: FactoryProject,
  recipeIdMigration: Map<string, string>,
): FactoryProject {
  if (recipeIdMigration.size === 0) {
    return project;
  }

  const nodes = project.nodes.map((node) => ({
    ...node,
    recipeId: recipeIdMigration.get(node.recipeId) ?? node.recipeId,
  }));
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const originalNodesById = new Map(project.nodes.map((node) => [node.id, node] as const));

  return {
    ...project,
    nodes,
    edges: project.edges.map((edge) =>
      remapMigratedRecipeEdgeHandles(
        project,
        nodesById,
        originalNodesById,
        recipeIdMigration,
        edge,
      ),
    ),
  };
}

function refreshImportedProjectEdges(project: FactoryProject): FactoryProject {
  if (project.edges.length === 0) {
    return project;
  }

  const nodesById = new Map(project.nodes.map((node) => [node.id, node] as const));
  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe] as const));
  const storagesById = new Map(
    (project.storages ?? []).map((storage) => [storage.id, storage] as const),
  );
  const edges = project.edges.map((edge) =>
    refreshImportedProjectEdgeHandles(edge, nodesById, recipesById, storagesById),
  );

  return { ...project, edges };
}

function refreshImportedProjectEdgeHandles(
  edge: FactoryEdge,
  nodesById: Map<string, FactoryProject["nodes"][number]>,
  recipesById: Map<string, Recipe>,
  storagesById: Map<string, NonNullable<FactoryProject["storages"]>[number]>,
): FactoryEdge {
  const sourceNode = nodesById.get(edge.source);
  const targetNode = nodesById.get(edge.target);
  const sourceRecipe = sourceNode ? recipesById.get(sourceNode.recipeId) : undefined;
  const targetRecipe = targetNode ? recipesById.get(targetNode.recipeId) : undefined;
  const sourceStorage = storagesById.get(edge.source);
  const targetStorage = storagesById.get(edge.target);

  return {
    ...edge,
    sourceHandle: sourceRecipe
      ? remapRecipeHandle(
          sourceRecipe,
          edge.sourceHandle,
          "output",
          edge.resourceKind,
          edge.resourceId,
        )
      : sourceStorage
        ? makeResourceHandleId("output", {
            kind: sourceStorage.kind,
            id: sourceStorage.resourceId,
          })
        : edge.sourceHandle,
    targetHandle: targetRecipe
      ? remapRecipeHandle(
          targetRecipe,
          edge.targetHandle,
          "input",
          edge.resourceKind,
          edge.resourceId,
        )
      : targetStorage
        ? makeResourceHandleId("input", {
            kind: targetStorage.kind,
            id: targetStorage.resourceId,
          })
        : edge.targetHandle,
  };
}

function remapMigratedRecipeEdgeHandles(
  project: FactoryProject,
  nodesById: Map<string, FactoryProject["nodes"][number]>,
  originalNodesById: Map<string, FactoryProject["nodes"][number]>,
  recipeIdMigration: Map<string, string>,
  edge: FactoryEdge,
): FactoryEdge {
  const sourceNode = nodesById.get(edge.source);
  const targetNode = nodesById.get(edge.target);
  const originalSourceNode = originalNodesById.get(edge.source);
  const originalTargetNode = originalNodesById.get(edge.target);
  const sourceRecipeMigrated = Boolean(
    originalSourceNode && recipeIdMigration.has(originalSourceNode.recipeId),
  );
  const targetRecipeMigrated = Boolean(
    originalTargetNode && recipeIdMigration.has(originalTargetNode.recipeId),
  );

  if (!sourceRecipeMigrated && !targetRecipeMigrated) {
    return edge;
  }

  const sourceRecipe = project.recipes.find((recipe) => recipe.id === sourceNode?.recipeId);
  const targetRecipe = project.recipes.find((recipe) => recipe.id === targetNode?.recipeId);

  return {
    ...edge,
    sourceHandle:
      sourceRecipeMigrated && sourceRecipe
        ? remapRecipeHandle(
            sourceRecipe,
            edge.sourceHandle,
            "output",
            edge.resourceKind,
            edge.resourceId,
          )
        : edge.sourceHandle,
    targetHandle:
      targetRecipeMigrated && targetRecipe
        ? remapRecipeHandle(
            targetRecipe,
            edge.targetHandle,
            "input",
            edge.resourceKind,
            edge.resourceId,
          )
        : edge.targetHandle,
  };
}

function remapRecipeHandle(
  recipe: Recipe,
  handleId: string | undefined,
  expectedSide: "input" | "output",
  resourceKind: ResourceKind,
  resourceId: string,
): string | undefined {
  const handle = parseResourceHandleId(handleId);
  const resources = expectedSide === "input" ? recipe.inputs : recipe.outputs;
  const handleResourceKind = handle?.kind ?? resourceKind;
  const handleResourceId = handle?.resourceId ?? resourceId;
  const slotIndex = parseResourceHandleSlotIndex(handleId);

  if (
    handle?.side === expectedSide &&
    resources.some(
      (resource, index) =>
        resource.kind === handleResourceKind &&
        resource.id === handleResourceId &&
        makeResourceHandleId(expectedSide, resource, index) === handleId,
    )
  ) {
    return handleId;
  }

  if (slotIndex !== undefined) {
    const indexedResource = resources[slotIndex];
    if (indexedResource?.kind === handleResourceKind && indexedResource.id === handleResourceId) {
      return makeResourceHandleId(expectedSide, indexedResource, slotIndex);
    }
  }

  const nextIndex = resources.findIndex(
    (resource) => resource.kind === resourceKind && resource.id === resourceId,
  );
  if (nextIndex !== -1) {
    return makeResourceHandleId(expectedSide, resources[nextIndex], nextIndex);
  }

  const matchingHandleIndex = resources.findIndex(
    (resource) => resource.kind === handleResourceKind && resource.id === handleResourceId,
  );
  return matchingHandleIndex === -1
    ? handleId
    : makeResourceHandleId(expectedSide, resources[matchingHandleIndex], matchingHandleIndex);
}

function parseResourceHandleSlotIndex(handleId: string | undefined): number | undefined {
  const rawIndex = handleId?.split(":")[3];
  if (rawIndex === undefined) {
    return undefined;
  }

  const index = Number(rawIndex);
  return Number.isInteger(index) && index >= 0 ? index : undefined;
}

async function resolveImportedRecipe(
  version: DatasetVersion,
  importedRecipe: Recipe,
): Promise<Recipe | undefined> {
  const candidates = await queryRecipeDatasetRecipes(DEFAULT_DATASET_MANIFEST_URL, version, {
    query: importedRecipe.name,
    mode: "recipes",
    maxTier: "all",
    offset: 0,
    limit: 40,
  });
  const sourceRecipeMap = importedRecipe.source?.recipeMap;
  const match = candidates.recipes.find(
    (candidate) =>
      candidate.id !== importedRecipe.id &&
      candidate.name === importedRecipe.name &&
      candidate.machineType === importedRecipe.machineType &&
      (!sourceRecipeMap ||
        candidate.recipeMap === sourceRecipeMap ||
        candidate.source?.recipeMap === sourceRecipeMap) &&
      outputsAreCompatible(importedRecipe.outputs, candidate.outputs),
  );

  return match
    ? getRecipeDatasetRecipe(DEFAULT_DATASET_MANIFEST_URL, version, match.id)
    : undefined;
}

function outputsAreCompatible(
  importedOutputs: RecipeOutput[],
  candidateOutputs: RecipeOutput[],
): boolean {
  if (importedOutputs.length === 0) {
    return true;
  }

  const candidateResources = new Set(
    candidateOutputs.map((output) => `${output.kind}:${output.id}`),
  );
  return importedOutputs.every((output) => candidateResources.has(`${output.kind}:${output.id}`));
}

function ExportMenuItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-fg-subtle hover:bg-surface-sunken"
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  disabled = false,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded border border-line-strong bg-surface text-fg-subtle hover:bg-surface-raised disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-muted"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

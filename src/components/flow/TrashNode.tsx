"use client";

import { Handle, Position, useStoreApi, type Node, type NodeProps } from "@xyflow/react";
import { memo, type CSSProperties } from "react";
import { Copy } from "lucide-react";
import type { FactoryNode } from "@/lib/model/types";
import { TRASH_ANY_RESOURCE_ID } from "@/lib/model/trash";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import { useFactoryStore } from "@/store/factory-store";
import { makeResourceHandleId } from "./resource-handles";
import { GT_NODE_COLORS } from "./node-colors";
import { getPaintBrushCursor } from "./paint-cursor";
import { NodeGlanceIcon } from "./NodeGlance";

export interface TrashNodeData extends Record<string, unknown> {
  projectNode: FactoryNode;
}

export type TrashFlowNode = Node<TrashNodeData, "trashNode">;

// Inline (not utility classes) so React Flow's own handle stylesheet can
// never reposition or resize it: the whole dark well is the wire-in zone,
// exactly — the frame and header around it drag the node (same doctrine as
// tanks and drawers).
const WELL_HANDLE_FULL: CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
  width: "100%",
  height: "100%",
  minWidth: 0,
  minHeight: 0,
  margin: 0,
  transform: "none",
  borderRadius: 0,
  border: "none",
  background: "transparent",
  opacity: 0,
  zIndex: 30,
};

// The can itself: hand-placed pixels in the tank's steel palette, rendered as
// merged-run <rect>s on a crisp grid so it reads like the drawer/tank art.
const CAN_PALETTE: Record<string, string> = {
  o: "#262b34",
  H: "#e8edf7",
  L: "#b9c2d4",
  M: "#8a93a6",
  D: "#565f72",
  S: "#14181f",
};

const CAN_ROWS = [
  "......oooo......",
  ".....oHLLDo.....",
  "..oooooooooooo..",
  ".oHLLLLLLLLLLDo.",
  ".oooooooooooooo.",
  "..oSSSSSSSSSSo..",
  "..oHLMLMLMLMDo..",
  "..oHLMLMLMLMDo..",
  "..oHLMLMLMLMDo..",
  "..oHLMLMLMLMDo..",
  "..oHLMLMLMLMDo..",
  "..oHLMLMLMLMDo..",
  "..oHLMLMLMLMDo..",
  "..oHLMLMLMLMDo..",
  "..oDLMLMLMLMDo..",
  "..oDDDDDDDDDDo..",
  "...oooooooooo...",
];

const CAN_RECTS: Array<{ x: number; y: number; width: number; fill: string }> = [];
for (let y = 0; y < CAN_ROWS.length; y += 1) {
  const row = CAN_ROWS[y]!;
  let x = 0;
  while (x < row.length) {
    const char = row[x]!;
    const fill = CAN_PALETTE[char];
    if (!fill) {
      x += 1;
      continue;
    }
    let runEnd = x + 1;
    while (runEnd < row.length && row[runEnd] === char) {
      runEnd += 1;
    }
    CAN_RECTS.push({ x, y, width: runEnd - x, fill });
    x = runEnd;
  }
}

function TrashCanPixelArt({ width = 64, height = 68 }: { width?: number; height?: number }) {
  return (
    <svg
      viewBox="0 0 16 17"
      width={width}
      height={height}
      shapeRendering="crispEdges"
      aria-hidden
      className="pointer-events-none"
    >
      {CAN_RECTS.map((rect, index) => (
        <rect
          key={index}
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={1}
          fill={rect.fill}
        />
      ))}
    </svg>
  );
}

function TrashNodeComponent({ data, selected }: NodeProps<TrashFlowNode>) {
  const { projectNode } = data;
  const reactFlowStore = useStoreApi();
  // The invisible wire handle blankets the well, and React Flow does not
  // select a node for clicks that land on a handle — so a plain click (no
  // drag) selects explicitly, keeping Delete-to-remove reachable.
  const selectOnHandleClick = () => {
    reactFlowStore.getState().addSelectedNodes([projectNode.id]);
  };
  const deleteNode = useFactoryStore((state) => state.deleteNode);
  const duplicateNode = useFactoryStore((state) => state.duplicateNode);
  const nodeColorPaintMode = useFactoryStore((state) => state.nodeColorPaintMode);
  const nodeColor = projectNode.colorTag ? GT_NODE_COLORS[projectNode.colorTag] : undefined;
  const paintCursor =
    nodeColorPaintMode !== undefined
      ? getPaintBrushCursor(
          nodeColorPaintMode ? GT_NODE_COLORS[nodeColorPaintMode].swatch : undefined,
        )
      : undefined;
  const inputHandleId = makeResourceHandleId("input", {
    kind: "item",
    id: TRASH_ANY_RESOURCE_ID,
  });

  // Same colour system as drawers and tanks: paint wins, otherwise the can's
  // own steel — mixed into a dark card so the art carries the identity.
  const tint = nodeColor?.swatch ?? "#8a93a6";

  return (
    <div
      data-trash-node-id={projectNode.id}
      className={[
        "group relative text-[#e8e9ee]",
        selected ? "ring-2 ring-purple-500" : "",
      ].join(" ")}
      style={paintCursor ? { cursor: paintCursor } : undefined}
    >
      {/* Wires dock anywhere on the card's PERIMETER — the anchor spans the
          whole card, and the router already picks the best side. */}
      <span
        data-resource-edge-anchor="true"
        data-resource-node-id={projectNode.id}
        data-resource-handle-id={inputHandleId}
        className="pointer-events-none absolute inset-0"
      />
      <div
        // Glance root is the CARD, so the can keeps its frame and colour and
        // only loses the buttons and the title.
        data-node-glance-root=""
        // Four cells square, fixed — the can docks wires on its perimeter.
        className="trash-node-card relative h-[80px] w-[80px] border-2 p-1"
        style={{
          borderColor: `color-mix(in srgb, ${tint} 55%, #262b34)`,
          background: `color-mix(in srgb, ${tint} 24%, #101318)`,
          boxShadow: "inset 2px 2px 0 rgba(255,255,255,0.08), inset -2px -2px 0 rgba(0,0,0,0.45)",
        }}
      >
        <NodeGlanceIcon tileTint={tint}>
          {/* Same reasoning as the drawer: bigger than the card, so the can
              reads at a glance. The art is a viewBox SVG, so it scales
              cleanly at any size. */}
          <div className="[&>svg]:!h-[104px] [&>svg]:!w-[98px]">
            <TrashCanPixelArt />
          </div>
        </NodeGlanceIcon>
        <div
          className="relative z-40 -m-1 mb-0 flex h-6 items-center gap-1 border-b-2 px-1 shadow-[inset_1px_1px_0_rgba(255,255,255,0.08)]"
          style={{
            borderColor: `color-mix(in srgb, ${tint} 55%, #262b34)`,
            background: `color-mix(in srgb, ${tint} 32%, #0a0c10)`,
          }}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              deleteNode(projectNode.id);
            }}
            className="board-edit-chrome nodrag flex h-4 w-4 shrink-0 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)] hover:bg-red-700"
            title="Delete trash can"
            aria-label="Delete trash can"
          >
            -
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              duplicateNode(projectNode.id);
            }}
            className="board-edit-chrome nodrag flex h-4 w-4 shrink-0 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)] hover:bg-[var(--mc-61)]"
            title="Clone trash can"
            aria-label="Clone trash can"
          >
            <Copy aria-hidden className="h-2.5 w-2.5" />
          </button>
          <div className="minecraft-title min-w-0 flex-1 truncate text-left text-[11px] leading-4">
            Trash
          </div>
        </div>
        <MinecraftTooltip content={'Voids any input. Never shows up as an "Output".'}>
          {/* The dark well is the wire zone: drop or drag a wire anywhere on
              it. The frame and header around it move the node. */}
          {/* Square, and sized to fill what the header leaves of the card's
              interior at the four-cell tile size. */}
          <div className="relative mx-auto mb-0.5 mt-1 h-[44px] w-[44px]">
            <Handle
              id={inputHandleId}
              type="target"
              position={Position.Left}
              data-resource-handle="true"
              data-resource-node-id={projectNode.id}
              data-resource-handle-id={inputHandleId}
              onClick={selectOnHandleClick}
              className="nodrag"
              style={WELL_HANDLE_FULL}
            />
            {/* No boxed well: the dark card is the surface, and the can art
                fills nearly all of it — same doctrine as drawers and tanks. */}
            <div className="grid h-full w-full place-items-center">
              <TrashCanPixelArt width={41} height={44} />
            </div>
          </div>
        </MinecraftTooltip>
      </div>
    </div>
  );
}

// Position props change every drag frame; the component only reads `data` and
// `selected`, so comparing exactly those keeps the card from re-rendering
// while its wrapper is translated (see RecipeNode for the long version).
export const TrashNode = memo(
  TrashNodeComponent,
  (previous, next) => previous.data === next.data && previous.selected === next.selected,
);

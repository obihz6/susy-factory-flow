"use client";

import { useStore, useStoreApi } from "@xyflow/react";
import { memo, useEffect, useId, useRef } from "react";
import { BOARD_GRID } from "@/lib/board-grid";
import type { CanvasGrainLayer } from "./canvas-themes";

/**
 * The two paper rulings the stock React Flow Background cannot draw: ruled
 * lines (horizontal only, like a notepad) and a graph grid (a fine grid with
 * a heavier line every five cells) — plus the paper grain below.
 *
 * HOW THESE MOVE. The stock Background writes the viewport offset into the
 * SVG pattern's x/y every frame, which invalidates and repaints the entire
 * viewport-sized layer on every pan frame — with the grain's tiled bitmap
 * noise that repaint was what capped panning at half the display's rate.
 * Instead the pattern here is STATIC and the whole SVG is one tile larger
 * than the viewport on every side; a pan writes `translate3d(tx mod tile,
 * ty mod tile)` onto it imperatively (no React, no invalidation), which the
 * compositor moves for free. Only a ZOOM — which really does change the
 * pattern's geometry — re-renders and repaints, exactly as it must.
 */

/** Subscribes outside React: writes the wrapped-modulo translate per pan. */
function usePanTranslate(
  ref: React.RefObject<SVGSVGElement | null>,
  tileX: number,
  tileY: number,
) {
  const store = useStoreApi();
  useEffect(() => {
    const element = ref.current;
    if (!element || tileX <= 0 || tileY <= 0) {
      return;
    }
    const apply = (transform: [number, number, number]) => {
      const modX = ((transform[0] % tileX) + tileX) % tileX;
      const modY = ((transform[1] % tileY) + tileY) % tileY;
      element.style.transform = `translate3d(${modX}px, ${modY}px, 0)`;
    };
    apply(store.getState().transform);
    return store.subscribe((state, previous) => {
      if (state.transform !== previous.transform) {
        apply(state.transform);
      }
    });
  }, [ref, store, tileX, tileY]);
}

/** The oversized, one-tile-bled geometry every layer shares. */
function bledSvgStyle(tile: number): React.CSSProperties {
  return {
    position: "absolute",
    left: -tile,
    top: -tile,
    width: `calc(100% + ${2 * tile}px)`,
    height: `calc(100% + ${2 * tile}px)`,
    pointerEvents: "none",
    willChange: "transform",
  };
}

export const RuledBackground = memo(function RuledBackground({
  mode,
  color,
}: {
  mode: "ruled" | "graph";
  color: string;
}) {
  // Zoom is the only transform component the GEOMETRY depends on; panning is
  // handled off-React by usePanTranslate above.
  const zoom = useStore((state) => state.transform[2]);
  const patternId = useId();
  const svgRef = useRef<SVGSVGElement | null>(null);

  // A notepad rules every 2 cells; graph paper repeats its heavy line every
  // 5, with a fine line on each cell inside.
  const gap = (mode === "ruled" ? 2 : 5) * BOARD_GRID * zoom;
  const cell = BOARD_GRID * zoom;
  usePanTranslate(svgRef, gap, gap);

  return (
    // NOT the stock react-flow__background class: that class carries the
    // library's own dark background-color, the very layer the themed board
    // has to show through. board-ruling is the glance fade's handle: zoomed
    // out the ruling sinks away with the rest of the near view (globals.css,
    // the LOD rules). The overflow-hidden wrapper clips the one-tile bleed.
    <div
      className="board-ruling"
      style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}
      aria-hidden
    >
      <svg ref={svgRef} style={bledSvgStyle(gap)}>
        <pattern id={patternId} x={0} y={0} width={gap} height={gap} patternUnits="userSpaceOnUse">
          {mode === "graph" ? (
            <>
              {[1, 2, 3, 4].map((step) => (
                <g key={step}>
                  <line
                    x1={step * cell}
                    y1={0}
                    x2={step * cell}
                    y2={gap}
                    stroke={color}
                    strokeOpacity={0.4}
                    strokeWidth={1}
                  />
                  <line
                    x1={0}
                    y1={step * cell}
                    x2={gap}
                    y2={step * cell}
                    stroke={color}
                    strokeOpacity={0.4}
                    strokeWidth={1}
                  />
                </g>
              ))}
              <line x1={0.5} y1={0} x2={0.5} y2={gap} stroke={color} strokeWidth={1.5} />
              <line x1={0} y1={0.5} x2={gap} y2={0.5} stroke={color} strokeWidth={1.5} />
            </>
          ) : (
            <line x1={0} y1={0.5} x2={gap} y2={0.5} stroke={color} strokeWidth={1} />
          )}
        </pattern>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
});

/**
 * The stock dot / line / cross patterns, re-drawn with the compositor trick
 * above. React Flow's own `<Background>` writes the viewport offset into the
 * pattern's x/y every pan frame, which repainted the whole viewport per
 * frame — the exact cost the module note describes, and on the DEFAULT board
 * (dots) it was the biggest repaint a pan paid. Geometry, offsets and sizes
 * are transcribed from the library component so the ink is pixel-identical:
 * tile = gap × zoom, the dot radius is (size × zoom) / 2, the cross arm is
 * size × zoom, and the stock's `offset × zoom || 1 + dimension / 2` quirk is
 * kept so nothing shifts by half a cell. Wears `board-ruling` so the glance
 * fade rules in globals.css keep applying.
 */
export const TiledBackground = memo(function TiledBackground({
  variant,
  gap,
  size,
  color,
}: {
  variant: "dots" | "lines" | "cross";
  gap: number;
  size: number;
  color: string;
}) {
  const zoom = useStore((state) => state.transform[2]);
  const patternId = useId();
  const svgRef = useRef<SVGSVGElement | null>(null);

  const tile = gap * zoom || 1;
  const scaledSize = size * zoom;
  usePanTranslate(svgRef, tile, tile);

  // The stock component's own expression, precedence and all: offset is 0
  // here, and `0 || 1 + dimension / 2` is the half-cell shift its patterns
  // actually render with.
  const dimension = variant === "cross" ? scaledSize : tile;
  const patternOffset = 1 + dimension / 2;

  return (
    <div
      className="board-ruling"
      style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}
      aria-hidden
    >
      <svg ref={svgRef} style={bledSvgStyle(tile)}>
        <pattern
          id={patternId}
          x={0}
          y={0}
          width={tile}
          height={tile}
          patternUnits="userSpaceOnUse"
          patternTransform={`translate(-${patternOffset},-${patternOffset})`}
        >
          {variant === "dots" ? (
            <circle cx={scaledSize / 2} cy={scaledSize / 2} r={scaledSize / 2} fill={color} />
          ) : (
            <path
              stroke={color}
              fill="none"
              strokeWidth={1}
              d={`M${dimension / 2} 0 V${variant === "cross" ? dimension : tile} M0 ${
                variant === "cross" ? dimension / 2 : tile / 2
              } H${dimension}`}
            />
          )}
        </pattern>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
});

/**
 * The paper's tooth: each grain layer is a tileable noise image drawn as an
 * SVG pattern. Pan slides it through the compositor (see the module note);
 * zoom re-renders so the tile grows like paper under a loupe. Zoomed far out
 * the tile shrinks toward per-pixel fizz, so the whole layer fades below 0.5
 * zoom and is gone by 0.2 — tooth is a close-up reading.
 */
export const GrainBackground = memo(function GrainBackground({
  layers,
}: {
  layers: CanvasGrainLayer[];
}) {
  const zoom = useStore((state) => state.transform[2]);
  const baseId = useId();
  const fade = Math.max(0, Math.min(1, (zoom - 0.2) / 0.3));
  if (fade <= 0) {
    return null;
  }

  return (
    // Mounted BEFORE the ruling component so the lines stay inked over the
    // paper, not under it. One svg per layer: each tile size needs its own
    // modulo translate.
    <div
      style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}
      aria-hidden
    >
      {layers.map((layer, index) => (
        <GrainLayerSvg
          key={index}
          layer={layer}
          tile={layer.size * zoom}
          patternId={`${baseId}-${index}`}
          opacity={fade * (layer.opacity ?? 1)}
        />
      ))}
    </div>
  );
});

function GrainLayerSvg({
  layer,
  tile,
  patternId,
  opacity,
}: {
  layer: CanvasGrainLayer;
  tile: number;
  patternId: string;
  opacity: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  usePanTranslate(svgRef, tile, tile);
  return (
    <svg ref={svgRef} style={bledSvgStyle(tile)}>
      <defs>
        <pattern id={patternId} x={0} y={0} width={tile} height={tile} patternUnits="userSpaceOnUse">
          <image href={layer.uri} width={tile} height={tile} preserveAspectRatio="none" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} opacity={opacity} />
    </svg>
  );
}

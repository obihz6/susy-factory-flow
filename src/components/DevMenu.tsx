"use client";

import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  BOARD_TIMELAPSE_SPEEDS,
  getBoardTimelapseCameraMode,
  getBoardTimelapseCameraPace,
  getBoardTimelapseCineZoom,
  getBoardTimelapseHoldEnding,
  getBoardTimelapsePopMs,
  getBoardTimelapseSpeed,
  getBoardTimelapseVolume,
  getBoardTimelapseWireDrawMs,
  getBoardTimelapseZoomRange,
  setBoardTimelapseCameraMode,
  setBoardTimelapseCameraPace,
  setBoardTimelapseCineZoom,
  setBoardTimelapseHoldEnding,
  setBoardTimelapsePopMs,
  setBoardTimelapseSpeed,
  setBoardTimelapseVolume,
  setBoardTimelapseWireDrawMs,
  setBoardTimelapseZoomRange,
  startBoardTimelapse,
  TIMELAPSE_CAMERA_PACE_MAX,
  TIMELAPSE_CAMERA_PACE_MIN,
  TIMELAPSE_CINE_ZOOM_MAX,
  TIMELAPSE_CINE_ZOOM_MIN,
  TIMELAPSE_POP_MAX_MS,
  TIMELAPSE_POP_MIN_MS,
  TIMELAPSE_WIRE_DRAW_MAX_MS,
  TIMELAPSE_WIRE_DRAW_MIN_MS,
  TIMELAPSE_ZOOM_CEILING,
  TIMELAPSE_ZOOM_FLOOR,
} from "./flow/board-timelapse";
import {
  BOARD_TILT_MAX_ANGLE,
  getBoardTiltSnapshot,
  writeBoardTilt,
  type BoardTilt,
} from "./flow/board-tilt";
import { isNodeDetailGlanceForced, setNodeDetailGlanceForced } from "./flow/node-detail";
import { isPerfHudEnabled, setPerfHudEnabled } from "./flow/PerfHud";
import { useFactoryStore } from "@/store/factory-store";

/**
 * The dev menu, behind a shift-click on the version chip.
 *
 * The chip's shift-click used to jump straight to the update-popup preview;
 * that preview now lives in here as one row among the dev tools, so new ones
 * get a home instead of each claiming its own secret click. Deliberately
 * undocumented in the UI - it is a workbench, not a feature.
 *
 * A floating PALETTE, not a modal: no backdrop, no dim, no blur, dragged
 * around by its header. The tools in here act on the board live - the tilt
 * sliders especially - so the board has to stay visible and the panel has
 * to get out of the way of whatever it is adjusting.
 */
export function DevMenu({
  onClose,
  onPreviewUpdatePopup,
}: {
  onClose: () => void;
  /** Opens the update-popup preview (WhatsNewPreview), replacing this menu. */
  onPreviewUpdatePopup: () => void;
}) {
  const [perfHud, setPerfHud] = useState<boolean>(() => isPerfHudEnabled());
  // Two cards is the least board that reads as a sequence at all.
  const canPlayTimelapse = useFactoryStore(
    (state) => state.project.nodes.length + (state.project.storages?.length ?? 0) >= 2,
  );
  // The timelapse is CONFIGURED here, before it starts; during the run the
  // chip on the board only stops it. Both settings persist on this device.
  const [timelapseSpeed, setTimelapseSpeed] = useState<number>(() => getBoardTimelapseSpeed());
  const [cameraMode, setCameraMode] = useState(() => getBoardTimelapseCameraMode());
  const [cineZoom, setCineZoom] = useState(() => getBoardTimelapseCineZoom());
  // Every dial shows its number: a setting you can read is a setting you
  // can refer to, write down, and set back.
  const [volume, setVolume] = useState(() => getBoardTimelapseVolume());
  const [cameraPace, setCameraPace] = useState(() => getBoardTimelapseCameraPace());
  const [wireDrawMs, setWireDrawMs] = useState(() => getBoardTimelapseWireDrawMs());
  const [popMs, setPopMs] = useState(() => getBoardTimelapsePopMs());
  // The demo-card tilt: edits apply to the board live (a running timelapse
  // included - this menu opens over it without cancelling).
  const [tilt, setTilt] = useState<BoardTilt>(() => getBoardTiltSnapshot());
  const patchTilt = (patch: Partial<BoardTilt>) => {
    writeBoardTilt(patch);
    setTilt(getBoardTiltSnapshot());
  };
  const [zoomRange, setZoomRange] = useState(() => getBoardTimelapseZoomRange());
  const patchZoomRange = (patch: { min?: number; max?: number }) => {
    setBoardTimelapseZoomRange(patch);
    setZoomRange(getBoardTimelapseZoomRange());
  };
  const [forceGlance, setForceGlance] = useState(() => isNodeDetailGlanceForced());
  const [holdEnding, setHoldEnding] = useState(() => getBoardTimelapseHoldEnding());

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Dragged by the header, plain pointer capture. Clamped so the header can
  // never leave reach - a palette dragged offscreen is a palette lost.
  const [position, setPosition] = useState({ x: 16, y: 56 });
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number }>(undefined);

  return (
    <div
      role="dialog"
      aria-label="Dev menu"
      className="fixed z-[120] flex max-h-[85vh] w-96 max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-lg border border-line-strong bg-surface shadow-2xl"
      style={{ left: position.x, top: position.y }}
    >
      <div
        className="relative shrink-0 cursor-move touch-none select-none border-b border-line bg-gradient-to-br from-surface-raised to-surface px-5 py-4 compact:px-4"
        onPointerDown={(event) => {
          if ((event.target as Element).closest("button")) {
            return;
          }
          dragRef.current = {
            pointerId: event.pointerId,
            offsetX: event.clientX - position.x,
            offsetY: event.clientY - position.y,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) {
            return;
          }
          setPosition({
            x: Math.min(
              window.innerWidth - 72,
              Math.max(72 - 384, event.clientX - drag.offsetX),
            ),
            y: Math.min(window.innerHeight - 48, Math.max(0, event.clientY - drag.offsetY)),
          });
        }}
        onPointerUp={() => {
          dragRef.current = undefined;
        }}
        onPointerCancel={() => {
          dragRef.current = undefined;
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded p-1.5 text-fg-subtle hover:bg-surface-raised hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
        <h2 className="text-xl font-black leading-none tracking-tight">Dev menu</h2>
        <p className="mt-1.5 text-sm text-fg-muted">
          Tools for working on the planner. Saved on this device. Drag me aside.
        </p>
      </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 compact:p-3">
          <button
            type="button"
            onClick={() => {
              const next = !perfHud;
              setPerfHudEnabled(next);
              setPerfHud(next);
            }}
            aria-pressed={perfHud}
            className={[
              "flex w-full items-center gap-3 rounded border px-3 py-2.5 text-left",
              perfHud
                ? "border-cyan-600 bg-cyan-500/10"
                : "border-line hover:border-line-strong hover:bg-surface-raised",
            ].join(" ")}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-base leading-tight text-fg">Performance readout</span>
              <span className="mt-0.5 block text-xs text-fg-muted">
                Frame times, stutter counts and what is mounted, in the bottom left corner of the
                board.
              </span>
            </span>
            <Check
              aria-hidden
              className={["h-4 w-4 shrink-0", perfHud ? "text-cyan-400" : "invisible"].join(" ")}
            />
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onPreviewUpdatePopup();
            }}
            className="mt-2 flex w-full items-center gap-3 rounded border border-line px-3 py-2.5 text-left hover:border-line-strong hover:bg-surface-raised"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-base leading-tight text-fg">
                Preview the update popup
              </span>
              <span className="mt-0.5 block text-xs text-fg-muted">
                Shows the what&apos;s-new popup exactly as a returning player sees it.
              </span>
            </span>
          </button>

          <div className="mt-2 rounded border border-line px-3 py-2.5">
            <span className="block text-base leading-tight text-fg">Build timelapse</span>
            <span className="mt-0.5 block text-xs text-fg-muted">
              Replays this board being built: each machine lands, wires and drawers follow.
              Esc or a click stops it. Needs at least two cards.
            </span>
            <div className="mt-2.5 flex items-center gap-1.5 text-xs">
              <span className="w-14 shrink-0 text-fg-subtle">Speed</span>
              {BOARD_TIMELAPSE_SPEEDS.map((speed) => (
                <button
                  key={speed}
                  type="button"
                  onClick={() => {
                    setBoardTimelapseSpeed(speed);
                    setTimelapseSpeed(speed);
                  }}
                  className={[
                    "rounded border px-2 py-1 tabular-nums",
                    timelapseSpeed === speed
                      ? "border-cyan-600 bg-cyan-500/10 text-cyan-400"
                      : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
                  ].join(" ")}
                >
                  {speed}x
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <span className="w-14 shrink-0 text-fg-subtle">Volume</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(volume * 100)}
                onChange={(event) => {
                  setBoardTimelapseVolume(Number(event.target.value) / 100);
                  setVolume(getBoardTimelapseVolume());
                }}
                aria-label="Timelapse sound volume"
                className="h-1 w-full accent-cyan-500"
              />
              <span className="w-12 shrink-0 text-right tabular-nums text-fg-muted">
                {Math.round(volume * 100)}%
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <span className="w-14 shrink-0 text-fg-subtle">Style</span>
              {(["follow", "cinematic"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setBoardTimelapseCameraMode(mode);
                    setCameraMode(mode);
                  }}
                  className={[
                    "rounded border px-2 py-1 capitalize",
                    cameraMode === mode
                      ? "border-cyan-600 bg-cyan-500/10 text-cyan-400"
                      : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
                  ].join(" ")}
                >
                  {mode}
                </button>
              ))}
            </div>
            {cameraMode === "cinematic" ? (
              <div className="mt-2 flex items-center gap-1.5 text-xs">
                <span className="w-14 shrink-0 text-fg-subtle">Offset</span>
                <input
                  type="range"
                  min={TIMELAPSE_CINE_ZOOM_MIN}
                  max={TIMELAPSE_CINE_ZOOM_MAX}
                  step={0.05}
                  value={cineZoom}
                  onChange={(event) => {
                    setBoardTimelapseCineZoom(Number(event.target.value));
                    setCineZoom(getBoardTimelapseCineZoom());
                  }}
                  aria-label="A constant nudge on the crane's own framing: 1 is the island-exact fit"
                  title="A constant nudge on whatever the crane decides: 1.00x frames the island exactly, higher sits closer, lower hangs back"
                  className="h-1 w-full accent-cyan-500"
                />
                <span className="w-10 shrink-0 text-right tabular-nums text-fg-muted">
                  {cineZoom.toFixed(2)}x
                </span>
              </div>
            ) : null}
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <span className="w-14 shrink-0 text-fg-subtle">Camera</span>
              <input
                type="range"
                min={TIMELAPSE_CAMERA_PACE_MIN}
                max={TIMELAPSE_CAMERA_PACE_MAX}
                step={0.05}
                value={cameraPace}
                onChange={(event) => {
                  setBoardTimelapseCameraPace(Number(event.target.value));
                  setCameraPace(getBoardTimelapseCameraPace());
                }}
                aria-label="How briskly the camera travels between shots"
                title="How briskly the camera travels between shots"
                className="h-1 w-full accent-cyan-500"
              />
              <span className="w-12 shrink-0 text-right tabular-nums text-fg-muted">
                {cameraPace.toFixed(2)}x
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <span className="w-14 shrink-0 text-fg-subtle">Wire draw</span>
              <input
                type="range"
                min={TIMELAPSE_WIRE_DRAW_MIN_MS}
                max={TIMELAPSE_WIRE_DRAW_MAX_MS}
                step={20}
                value={wireDrawMs}
                onChange={(event) => {
                  setBoardTimelapseWireDrawMs(Number(event.target.value));
                  setWireDrawMs(getBoardTimelapseWireDrawMs());
                }}
                aria-label="How long a wire takes to draw itself in"
                title="How long a wire takes to draw itself in"
                className="h-1 w-full accent-cyan-500"
              />
              <span className="w-12 shrink-0 text-right tabular-nums text-fg-muted">
                {wireDrawMs}ms
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <span className="w-14 shrink-0 text-fg-subtle">Pop</span>
              <input
                type="range"
                min={TIMELAPSE_POP_MIN_MS}
                max={TIMELAPSE_POP_MAX_MS}
                step={20}
                value={popMs}
                onChange={(event) => {
                  setBoardTimelapsePopMs(Number(event.target.value));
                  setPopMs(getBoardTimelapsePopMs());
                }}
                aria-label="How long a card takes to fade and grow in"
                title="How long a card takes to fade and grow in"
                className="h-1 w-full accent-cyan-500"
              />
              <span className="w-12 shrink-0 text-right tabular-nums text-fg-muted">
                {popMs}ms
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <span className="w-14 shrink-0 text-fg-subtle">Closest</span>
              <input
                type="range"
                min={TIMELAPSE_ZOOM_FLOOR}
                max={TIMELAPSE_ZOOM_CEILING}
                step={0.01}
                value={zoomRange.max}
                onChange={(event) => patchZoomRange({ max: Number(event.target.value) })}
                aria-label="The closest the camera may get"
                className="h-1 w-full accent-cyan-500"
              />
              <span className="w-10 shrink-0 text-right tabular-nums text-fg-muted">
                {zoomRange.max.toFixed(2)}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <span className="w-14 shrink-0 text-fg-subtle">Widest</span>
              <input
                type="range"
                min={TIMELAPSE_ZOOM_FLOOR}
                max={TIMELAPSE_ZOOM_CEILING}
                step={0.01}
                value={zoomRange.min}
                onChange={(event) => patchZoomRange({ min: Number(event.target.value) })}
                aria-label="The widest the camera may go before the finale"
                className="h-1 w-full accent-cyan-500"
              />
              <span className="w-10 shrink-0 text-right tabular-nums text-fg-muted">
                {zoomRange.min.toFixed(2)}
              </span>
            </div>
            <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={holdEnding}
                onChange={(event) => {
                  setBoardTimelapseHoldEnding(event.target.checked);
                  setHoldEnding(getBoardTimelapseHoldEnding());
                }}
                className="accent-cyan-500"
              />
              Hold the final shot: when the last thing lands, the camera stays put
            </label>
            <button
              type="button"
              disabled={!canPlayTimelapse}
              onClick={() => {
                onClose();
                // Let the menu's backdrop leave before the board empties for
                // the first beat - the run starts on a clean canvas.
                requestAnimationFrame(() => startBoardTimelapse());
              }}
              className="mt-2.5 w-full rounded border border-cyan-700 bg-cyan-500/10 px-3 py-1.5 text-sm text-cyan-300 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-fg-subtle"
            >
              Play
            </button>
          </div>

          <div className="mt-2 rounded border border-line px-3 py-2.5">
            <span className="block text-base leading-tight text-fg">Board tilt</span>
            <span className="mt-0.5 block text-xs text-fg-muted">
              The demo-card lean the timelapse plays under. Edits apply live, mid-run too.
            </span>
            <div className="mt-2.5 flex items-center gap-1.5 text-xs">
              <span className="w-14 shrink-0 text-fg-subtle">Pitch</span>
              <input
                type="range"
                min={-BOARD_TILT_MAX_ANGLE}
                max={BOARD_TILT_MAX_ANGLE}
                step={0.5}
                value={tilt.pitch}
                onChange={(event) => patchTilt({ pitch: Number(event.target.value) })}
                aria-label="Tilt pitch"
                className="h-1 w-full accent-cyan-500"
              />
              <span className="w-10 shrink-0 text-right tabular-nums text-fg-muted">
                {tilt.pitch}&deg;
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <span className="w-14 shrink-0 text-fg-subtle">Turn</span>
              <input
                type="range"
                min={-BOARD_TILT_MAX_ANGLE}
                max={BOARD_TILT_MAX_ANGLE}
                step={0.5}
                value={tilt.yaw}
                onChange={(event) => patchTilt({ yaw: Number(event.target.value) })}
                aria-label="Tilt turn"
                className="h-1 w-full accent-cyan-500"
              />
              <span className="w-10 shrink-0 text-right tabular-nums text-fg-muted">
                {tilt.yaw}&deg;
              </span>
            </div>
            <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={tilt.drift}
                onChange={(event) => patchTilt({ drift: event.target.checked })}
                className="accent-cyan-500"
              />
              Slow sway on top of the set angles
            </label>
            <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={tilt.always}
                onChange={(event) => patchTilt({ always: event.target.checked })}
                className="accent-cyan-500"
              />
              Keep the board tilted outside the timelapse too
            </label>
          </div>

          <button
            type="button"
            onClick={() => {
              const next = !forceGlance;
              setNodeDetailGlanceForced(next);
              setForceGlance(next);
            }}
            aria-pressed={forceGlance}
            className={[
              "mt-2 flex w-full items-center gap-3 rounded border px-3 py-2.5 text-left",
              forceGlance
                ? "border-cyan-600 bg-cyan-500/10"
                : "border-line hover:border-line-strong hover:bg-surface-raised",
            ].join(" ")}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-base leading-tight text-fg">
                Zoomed-out card faces everywhere
              </span>
              <span className="mt-0.5 block text-xs text-fg-muted">
                Every card wears its glance face at every zoom, however far in you are.
              </span>
            </span>
            <Check
              aria-hidden
              className={["h-4 w-4 shrink-0", forceGlance ? "text-cyan-400" : "invisible"].join(
                " ",
              )}
            />
          </button>
        </div>
    </div>
  );
}

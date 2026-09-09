"use client";

import { Minus, Plus, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  APP_FONTS,
  getStoredAppFont,
  setAppFont,
  type AppFontId,
} from "@/lib/app-font";
import {
  DEFAULT_UI_SCALE_PERCENT,
  UI_SCALE_MAX_PERCENT,
  UI_SCALE_MIN_PERCENT,
  UI_SCALE_STEP_PERCENT,
  setUiScalePercent,
  useUiScalePercent,
} from "@/lib/ui-scale";
import {
  BOARD_TIMELAPSE_PRESETS,
  runBoardTimelapsePreset,
} from "@/components/flow/board-timelapse";
import { useFactoryStore } from "@/store/factory-store";
import {
  areBoardSoundsEnabled,
  getBoardSoundVolume,
  playBoardSound,
  setBoardSoundsEnabled,
  setBoardSoundVolume,
} from "@/lib/board-sounds";

/** The planner settings sheet. Changes apply immediately and persist locally. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [font, setFont] = useState<AppFontId>(() => getStoredAppFont());
  const [sounds, setSounds] = useState<boolean>(() => areBoardSoundsEnabled());
  const [volume, setVolume] = useState<number>(() => getBoardSoundVolume());
  const uiScalePercent = useUiScalePercent();
  const canPlayTimelapse = useFactoryStore(
    (state) => state.project.nodes.length + (state.project.storages?.length ?? 0) >= 2,
  );
  const previewTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(previewTimerRef.current), []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const chooseFont = (id: AppFontId) => {
    setAppFont(id);
    setFont(id);
  };
  const stepUiScale = (direction: -1 | 1) => {
    setUiScalePercent(uiScalePercent + direction * UI_SCALE_STEP_PERCENT);
  };

  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-neutral-950/75 p-4 backdrop-blur-sm compact:bg-neutral-950/92 compact:[backdrop-filter:none]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Planner settings"
        className="flex max-h-[calc(88*var(--ui-vh))] w-full max-w-sm flex-col overflow-hidden border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-[var(--mc-ink)] shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25),4px_4px_0_rgba(0,0,0,0.45)] compact:max-h-[calc(92*var(--ui-vh))]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b-2 border-[var(--mc-15)] px-4 py-2.5">
          <h2 className="text-sm font-bold">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`flex h-7 w-7 items-center justify-center border-2 border-[var(--mc-15)] font-mono ${FACE_OFF}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col divide-y divide-[var(--mc-36)] overflow-y-auto px-4">
          <Row label="Font">
            <select
              aria-label="Font"
              value={font}
              onChange={(event) => chooseFont(event.target.value as AppFontId)}
              className={`h-7 w-44 border-2 border-[var(--mc-15)] px-1 text-sm ${FACE_OFF}`}
              style={{ fontFamily: APP_FONTS.find((option) => option.id === font)?.stack }}
            >
              {APP_FONTS.map((option) => (
                <option key={option.id} value={option.id} style={{ fontFamily: option.stack }}>
                  {option.label}
                </option>
              ))}
            </select>
          </Row>

          <Row label="Size">
            {uiScalePercent !== DEFAULT_UI_SCALE_PERCENT ? (
              <button
                type="button"
                onClick={() => setUiScalePercent(DEFAULT_UI_SCALE_PERCENT)}
                className="mr-1 text-xs text-[var(--mc-ink-muted)] hover:text-[var(--mc-ink)]"
              >
                Reset
              </button>
            ) : null}
            <Key label="Smaller" disabled={uiScalePercent <= UI_SCALE_MIN_PERCENT} onClick={() => stepUiScale(-1)}>
              <Minus className="h-3.5 w-3.5" />
            </Key>
            <span className="w-12 text-center text-sm tabular-nums" aria-live="polite">
              {uiScalePercent}%
            </span>
            <Key label="Larger" disabled={uiScalePercent >= UI_SCALE_MAX_PERCENT} onClick={() => stepUiScale(1)}>
              <Plus className="h-3.5 w-3.5" />
            </Key>
          </Row>

          <ToggleRow
            label="Sounds"
            on={sounds}
            onChange={(next) => {
              setBoardSoundsEnabled(next);
              setSounds(next);
            }}
          />

          <Row label="Volume" dim={!sounds}>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(volume * 100)}
              disabled={!sounds}
              aria-label="Sound volume"
              onChange={(event) => {
                const next = Number(event.target.value) / 100;
                setBoardSoundVolume(next);
                setVolume(next);
                window.clearTimeout(previewTimerRef.current);
                previewTimerRef.current = window.setTimeout(() => playBoardSound("place"), 180);
              }}
              className="w-28 accent-[var(--mc-good)]"
            />
            <span className="w-9 text-right text-sm tabular-nums text-[var(--mc-ink-muted)]">
              {Math.round(volume * 100)}%
            </span>
          </Row>

          <Row label="Animation" dim={!canPlayTimelapse}>
            {BOARD_TIMELAPSE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                disabled={!canPlayTimelapse}
                onClick={() => {
                  onClose();
                  requestAnimationFrame(() => runBoardTimelapsePreset(preset));
                }}
                className={`h-7 border-2 border-[var(--mc-15)] px-2.5 text-sm ${FACE_OFF} disabled:cursor-not-allowed disabled:hover:brightness-100`}
              >
                {preset.name}
              </button>
            ))}
          </Row>

          <section className="py-2.5">
            <button
              type="button"
              onClick={() => {
                const next = !invertedClicks;
                setChipClicksInverted(next);
                setInvertedClicks(next);
              }}
              aria-pressed={invertedClicks}
              className="flex min-h-10 w-full items-center gap-2 text-left text-sm"
            >
              <span className="min-w-0 flex-1">Swap chip clicks</span>
              <span className={invertedClicks ? "text-[var(--mc-good)]" : "text-[var(--mc-ink-muted)]"}>
                {invertedClicks ? "ON" : "OFF"}
              </span>
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

const FACE_OFF =
  "bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:brightness-110";

function Row({ label, dim = false, children }: { label: string; dim?: boolean; children: ReactNode }) {
  return (
    <div className={["flex min-h-12 items-center gap-2 py-2", dim ? "opacity-40" : ""].join(" ")}>
      <span className="min-w-0 flex-1 text-sm">{label}</span>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

function ToggleRow({ label, on, onChange }: { label: string; on: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className="flex min-h-12 items-center gap-2 py-2">
      <span className="min-w-0 flex-1 text-sm">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className={[
          "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
          on ? "border-[var(--mc-good)] bg-[var(--mc-good)]/70" : "border-[var(--mc-15)] bg-[var(--mc-36)]",
        ].join(" ")}
      >
        <span className={["absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-[left]", on ? "left-[18px]" : "left-0.5"].join(" ")} />
      </button>
    </div>
  );
}

function Key({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`flex h-7 w-7 items-center justify-center border-2 border-[var(--mc-15)] ${FACE_OFF} disabled:cursor-default disabled:opacity-40 disabled:hover:brightness-100`}
    >
      {children}
    </button>
  );
}

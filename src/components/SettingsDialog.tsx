"use client";

import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  APP_FONTS,
  getStoredAppFont,
  setAppFont,
  type AppFontId,
} from "@/lib/app-font";
import { isUpdatePopupEnabled, setUpdatePopupEnabled } from "@/lib/whats-new";
import { areChipClicksInverted, setChipClicksInverted } from "@/lib/chip-clicks";
import {
  areBoardSoundsEnabled,
  getBoardSoundVolume,
  playBoardSound,
  setBoardSoundsEnabled,
  setBoardSoundVolume,
} from "@/lib/board-sounds";

/**
 * The planner's settings, in one small sheet.
 *
 * One section so far: the font. Each option's name is rendered IN that font,
 * which is the whole preview - a picker that describes typefaces in words was
 * never going to beat showing them. A click applies immediately, to the page
 * behind the dialog included, so choosing is looking rather than committing.
 *
 * Owned by AppHeader the same way the share dialog is, so the compact menu can
 * close behind it without unmounting it.
 */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [font, setFont] = useState<AppFontId>(() => getStoredAppFont());
  const [updatePopup, setUpdatePopup] = useState<boolean>(() => isUpdatePopupEnabled());
  const [invertedClicks, setInvertedClicks] = useState<boolean>(() => areChipClicksInverted());
  const [sounds, setSounds] = useState<boolean>(() => areBoardSoundsEnabled());
  const [volume, setVolume] = useState<number>(() => getBoardSoundVolume());
  // The preview thump fires when the drag SETTLES, not per input event: a
  // slider emits dozens of changes a second, and previewing each one had
  // the notes stealing each other into fragments while the repeat duck
  // faded the pile down.
  const previewTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(previewTimerRef.current), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const chooseFont = (id: AppFontId) => {
    setAppFont(id);
    setFont(id);
  };

  return (
    <div
      // Same no-backdrop-filter-on-a-phone rule as every other overlay.
      className="fixed inset-0 z-[120] grid place-items-center bg-neutral-950/75 p-4 backdrop-blur-sm compact:bg-neutral-950/92 compact:[backdrop-filter:none]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Planner settings"
        className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-line-strong bg-surface shadow-2xl compact:max-h-[92vh]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative shrink-0 border-b border-line bg-gradient-to-br from-surface-raised to-surface px-5 py-4 compact:px-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 rounded p-1.5 text-fg-subtle hover:bg-surface-raised hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
          <h2 className="text-xl font-black leading-none tracking-tight">Settings</h2>
          <p className="mt-1.5 text-sm text-fg-muted">
            Saved on this device, applied everywhere in the planner.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 compact:p-3">
          <section role="radiogroup" aria-label="Font">
            <h3 className="px-1 pb-1.5 text-[11px] font-bold uppercase tracking-widest text-fg-muted">
              Font
            </h3>
            <div className="flex flex-col gap-1">
              {APP_FONTS.map((option) => {
                const isSelected = option.id === font;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => chooseFont(option.id)}
                    className={[
                      "flex items-center gap-3 rounded border px-3 py-2.5 text-left",
                      isSelected
                        ? "border-cyan-600 bg-cyan-500/10"
                        : "border-line hover:border-line-strong hover:bg-surface-raised",
                    ].join(" ")}
                  >
                    <span className="min-w-0 flex-1">
                      {/* The name IS the preview: it renders in the font it names. */}
                      <span
                        className="block truncate text-base leading-tight text-fg"
                        style={{ fontFamily: option.stack }}
                      >
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-fg-muted">{option.blurb}</span>
                    </span>
                    <Check
                      aria-hidden
                      className={[
                        "h-4 w-4 shrink-0",
                        isSelected ? "text-cyan-400" : "invisible",
                      ].join(" ")}
                    />
                  </button>
                );
              })}
            </div>
          </section>

          <section className="mt-4">
            <h3 className="px-1 pb-1.5 text-[11px] font-bold uppercase tracking-widest text-fg-muted">
              Popups
            </h3>
            <button
              type="button"
              onClick={() => {
                const next = !updatePopup;
                setUpdatePopupEnabled(next);
                setUpdatePopup(next);
              }}
              aria-pressed={updatePopup}
              className={[
                "flex w-full items-center gap-3 rounded border px-3 py-2.5 text-left",
                updatePopup
                  ? "border-cyan-600 bg-cyan-500/10"
                  : "border-line hover:border-line-strong hover:bg-surface-raised",
              ].join(" ")}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-base leading-tight text-fg">Update notes popup</span>
                <span className="mt-0.5 block text-xs text-fg-muted">
                  A release that changes saved plans opens its notes when you arrive. Off, the
                  What&apos;s new button only shows a dot.
                </span>
              </span>
              <Check
                aria-hidden
                className={[
                  "h-4 w-4 shrink-0",
                  updatePopup ? "text-cyan-400" : "invisible",
                ].join(" ")}
              />
            </button>
          </section>

          <section className="mt-4">
            <h3 className="px-1 pb-1.5 text-[11px] font-bold uppercase tracking-widest text-fg-muted">
              Sound
            </h3>
            <button
              type="button"
              onClick={() => {
                const next = !sounds;
                setBoardSoundsEnabled(next);
                setSounds(next);
              }}
              aria-pressed={sounds}
              className={[
                "flex w-full items-center gap-3 rounded border px-3 py-2.5 text-left",
                sounds
                  ? "border-cyan-600 bg-cyan-500/10"
                  : "border-line hover:border-line-strong hover:bg-surface-raised",
              ].join(" ")}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-base leading-tight text-fg">Interface sounds</span>
                <span className="mt-0.5 block text-xs text-fg-muted">
                  Quiet notes when you place cards, wire them, change their settings, or a wire
                  is refused. Off, the planner is silent.
                </span>
              </span>
              <Check
                aria-hidden
                className={[
                  "h-4 w-4 shrink-0",
                  sounds ? "text-cyan-400" : "invisible",
                ].join(" ")}
              />
            </button>

            <div
              className={[
                "mt-1 flex items-center gap-3 rounded border border-line px-3 py-2.5",
                sounds ? "" : "opacity-40",
              ].join(" ")}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-base leading-tight text-fg">Volume</span>
                <span className="mt-0.5 block text-xs text-fg-muted">
                  Drag to hear the level.
                </span>
              </span>
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
                  previewTimerRef.current = window.setTimeout(() => {
                    playBoardSound("place");
                  }, 180);
                }}
                className="w-36 accent-cyan-500"
              />
              <span className="w-10 shrink-0 text-right text-sm tabular-nums text-fg-muted">
                {Math.round(volume * 100)}%
              </span>
            </div>
          </section>

          <section className="mt-4">
            <h3 className="px-1 pb-1.5 text-[11px] font-bold uppercase tracking-widest text-fg-muted">
              Controls
            </h3>
            <button
              type="button"
              onClick={() => {
                const next = !invertedClicks;
                setChipClicksInverted(next);
                setInvertedClicks(next);
              }}
              aria-pressed={invertedClicks}
              className={[
                "flex w-full items-center gap-3 rounded border px-3 py-2.5 text-left",
                invertedClicks
                  ? "border-cyan-600 bg-cyan-500/10"
                  : "border-line hover:border-line-strong hover:bg-surface-raised",
              ].join(" ")}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-base leading-tight text-fg">Swap chip clicks</span>
                <span className="mt-0.5 block text-xs text-fg-muted">
                  On, clicking a power chip steps it and shift-click opens the dropdown. Off,
                  clicking opens the dropdown and shift-click steps. Right click always steps back.
                </span>
              </span>
              <Check
                aria-hidden
                className={[
                  "h-4 w-4 shrink-0",
                  invertedClicks ? "text-cyan-400" : "invisible",
                ].join(" ")}
              />
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

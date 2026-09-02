"use client";

import { useState } from "react";
import { MinecraftSelect } from "./MinecraftSelect";
import { getPowerSource } from "@/lib/power/registry";
import type {
  PowerNumberSetting,
  PowerSettingCondition,
  PowerSourceDefinition,
} from "@/lib/power/types";
import { useFactoryStore } from "@/store/factory-store";

/** How many options a select can carry before it grows a filter box. */
const SEARCHABLE_FROM = 12;

/**
 * The knobs on a power card: the source definition's settings rendered on
 * the same tiles machine config controls use, but writing through
 * setPowerSetting so the card's owned recipe follows every change. Below
 * the knobs: the model's stat lines (efficiency, optimal flow, lifespans)
 * and any warning the current settings earn.
 */
export function PowerConfigPanel({
  nodeId,
  sourceId,
  values,
  stats,
  warnings,
}: {
  nodeId: string;
  sourceId: string;
  values: Record<string, string> | undefined;
  stats: Array<{ label: string; value: string }>;
  warnings?: string[];
}) {
  const setPowerSetting = useFactoryStore((state) => state.setPowerSetting);
  const source = getPowerSource(sourceId);
  if (!source) {
    return null;
  }

  const isEnabled = (condition: PowerSettingCondition | undefined) =>
    condition === undefined || settingValue(source, values, condition.settingId) === condition.equals;

  return (
    <div className="min-w-0 border-t border-[var(--mc-56)] py-1.5">
      <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-x-2 gap-y-1.5">
        {source.settings.map((setting) => {
          // The tier ladder lives on the header chip, like every machine's.
          if (setting.id === "tier") {
            return null;
          }
          const enabled = isEnabled(setting.enabledWhen);
          if (setting.type === "select") {
            const value =
              values?.[setting.id] &&
              setting.options.some((option) => option.key === values[setting.id])
                ? values[setting.id]
                : setting.defaultKey;
            return (
              <label
                key={setting.id}
                className={["flex min-w-0 flex-col gap-0.5", enabled ? "" : "opacity-40"].join(" ")}
              >
                <span className="truncate text-[10px] uppercase tracking-wide text-[var(--mc-ink-muted)]">
                  {setting.label}
                </span>
                <MinecraftSelect
                  value={value}
                  options={setting.options}
                  onSelect={(key) => setPowerSetting(nodeId, setting.id, key)}
                  ariaLabel={setting.label}
                  disabled={!enabled || setting.options.length <= 1}
                  searchable={setting.options.length >= SEARCHABLE_FROM}
                  wideMenu={setting.options.length >= SEARCHABLE_FROM}
                />
              </label>
            );
          }
          if (setting.type === "number") {
            return (
              <PowerNumberField
                key={setting.id}
                setting={setting}
                value={values?.[setting.id]}
                enabled={enabled}
                onCommit={(next) => setPowerSetting(nodeId, setting.id, next)}
              />
            );
          }
          const on = values?.[setting.id] === undefined ? setting.defaultOn : values[setting.id] === "1";
          return (
            <label
              key={setting.id}
              className={["flex min-w-0 flex-col gap-0.5", enabled ? "" : "opacity-40"].join(" ")}
            >
              <span className="truncate text-[10px] uppercase tracking-wide text-[var(--mc-ink-muted)]">
                {setting.label}
              </span>
              <button
                type="button"
                disabled={!enabled}
                onClick={(event) => {
                  event.stopPropagation();
                  setPowerSetting(nodeId, setting.id, on ? "0" : "1");
                }}
                onPointerDown={(event) => event.stopPropagation()}
                className={[
                  "nodrag h-6 border px-1.5 text-left text-[12px] disabled:cursor-not-allowed",
                  on
                    ? "border-amber-300/70 bg-[var(--mc-85)] text-amber-200"
                    : "border-[var(--mc-33)] bg-[var(--mc-71)] text-[var(--mc-ink-muted)]",
                ].join(" ")}
                title={setting.label}
              >
                {on ? "On" : "Off"}
              </button>
            </label>
          );
        })}
      </div>
      {stats.length > 0 ? (
        <div className="mt-1.5 flex min-w-0 flex-wrap gap-x-3 gap-y-0.5">
          {stats.map((line) => (
            <span key={line.label} className="whitespace-nowrap text-[10px] text-[var(--mc-ink-muted)]">
              {line.label}: <span className="text-[var(--mc-ink)]">{line.value}</span>
            </span>
          ))}
        </div>
      ) : null}
      {warnings?.map((warning) => (
        <p key={warning} className="mt-1 text-[11px] leading-tight text-amber-300">
          {warning}
        </p>
      ))}
    </div>
  );
}

/** A setting's live value with its default filled in, for enabledWhen checks. */
function settingValue(
  source: PowerSourceDefinition,
  values: Record<string, string> | undefined,
  settingId: string,
): string | undefined {
  const setting = source.settings.find((entry) => entry.id === settingId);
  if (!setting) {
    return undefined;
  }
  const raw = values?.[settingId];
  if (setting.type === "select") {
    return raw !== undefined && setting.options.some((option) => option.key === raw)
      ? raw
      : setting.defaultKey;
  }
  if (setting.type === "toggle") {
    return raw === undefined ? (setting.defaultOn ? "1" : "0") : raw;
  }
  return raw ?? String(setting.defaultValue);
}

/** Commits on blur or Enter; the draft is local so typing never re-solves. */
function PowerNumberField({
  setting,
  value,
  enabled,
  onCommit,
}: {
  setting: PowerNumberSetting;
  value: string | undefined;
  enabled: boolean;
  onCommit: (next: string) => void;
}) {
  const shown = value ?? String(setting.defaultValue);
  const [draft, setDraft] = useState<{ shown: string; draft: string }>({ shown, draft: shown });
  if (draft.shown !== shown) {
    setDraft({ shown, draft: shown });
  }

  const commit = () => {
    const parsed = Number.parseFloat(draft.draft.replace(/,/g, "").trim());
    if (!Number.isFinite(parsed)) {
      setDraft({ shown, draft: shown });
      return;
    }
    const clamped = Math.min(setting.max, Math.max(setting.min, parsed));
    onCommit(String(clamped));
  };

  return (
    <label className={["flex min-w-0 flex-col gap-0.5", enabled ? "" : "opacity-40"].join(" ")}>
      <span className="truncate text-[10px] uppercase tracking-wide text-[var(--mc-ink-muted)]">
        {setting.label}
        {setting.unit ? ` (${setting.unit})` : ""}
      </span>
      <input
        value={draft.draft}
        disabled={!enabled}
        onChange={(event) => setDraft({ shown, draft: event.target.value })}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            (event.target as HTMLInputElement).blur();
          }
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        inputMode="decimal"
        aria-label={setting.label}
        className="nodrag h-6 min-w-0 border border-[var(--mc-33)] bg-[var(--mc-93)] px-1 text-right text-[13px] text-[var(--mc-ink)] disabled:cursor-not-allowed"
      />
    </label>
  );
}

"use client";

import {
  ArrowBigUp,
  ArrowLeft,
  Check,
  Download,
  EyeOff,
  Globe,
  Image as ImageIcon,
  Link2,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { formatSlotRate } from "@/components/flow/flow-explainers";
import { fluidArtPixels, isSwatchFluid, ResourceIcon } from "@/components/nei/ResourceIcon";
import { TierBadge, type VoltageTier } from "@/components/shelf-cards";
import { normalizeBlueprintTags } from "@/lib/blueprints/types";
import type { PlanResourceStat } from "@/lib/community/types";
import type { EntryIcon } from "@/lib/model/types";
import { Face, formatEuT, type TileMarks } from "./LibraryTile";
import { PlanComments } from "./PlanComments";

/**
 * The step between a tile and the board: the grid gives way to one page
 * that fits on one screen. The board photograph in the top half, whole;
 * then the face, name, who and when, the figures, and on the right the
 * one big Open button over a short row of ICON keys (vote, link, public
 * or private, post, edit, close tab, delete); the description; needs and
 * makes as tight columns; then, for anything posted, the comments. Back
 * (or Escape) brings the grid back. Not a popup.
 *
 * The SAME page whether you came from your own grid or the network: what
 * differs is only which keys you have, because you own it or you do not.
 * Edit turns the header into a form for the name, description and tags.
 * Delete asks in words, in a strip under the keys, never by arming.
 */

/** The board photograph a post carries, taken when it was shared. */
export function previewUrlFor(planId: string): string {
  return `/api/community/plans/${encodeURIComponent(planId)}/preview`;
}

export interface DetailKey {
  /** What the key does, read aloud. */
  label: string;
  icon: "vote" | "link" | "public" | "private" | "post" | "delete";
  onClick: () => void;
  /** Lit, for a vote already cast. */
  active?: boolean;
  /** A number beside the icon: the vote count. */
  count?: number;
  /** Ask first, in these words, with a Delete and a Cancel under the keys. */
  confirm?: string;
}

export interface DetailEdit {
  name: string;
  description: string;
  tags: string[];
}

export interface LibraryDetailEntry {
  name: string;
  icon?: EntryIcon;
  creator?: string;
  /** Clicking the creator shows everything they posted. */
  onCreator?: () => void;
  when: string;
  tier?: VoltageTier;
  machines?: number;
  euT?: number;
  downloads?: number;
  description?: string;
  tags?: string[];
  needs?: PlanResourceStat[];
  outputs?: PlanResourceStat[];
  /** The board photograph, when there is one. */
  previewUrl?: string;
  marks?: TileMarks;
  /** The post whose comments show; a private design has none. */
  commentsPlanId?: string;
  /** The main action, with an optional adjacent action such as Open a copy. */
  primary: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
  actionBusy?: boolean;
  /** The icon keys under it. */
  keys?: DetailKey[];
  /** Owned: the Edit key and the form it opens. Tags only where they exist. */
  onEdit?: (patch: DetailEdit) => Promise<void> | void;
  editTags?: boolean;
  onPickIcon?: () => void;
}

export function LibraryDetail({
  entry,
  onClose,
}: {
  entry: LibraryDetailEntry;
  onClose: () => void;
}) {
  // The picture is probed up front: an <img> that 404s before React has
  // attached its onError never reports, and the frame would sit dark.
  const [probed, setProbed] = useState<{ url: string; ok: boolean }>();
  const [confirming, setConfirming] = useState<DetailKey>();
  const [flashKey, setFlashKey] = useState<string>();
  const [editing, setEditing] = useState<DetailEdit>();
  const [saving, setSaving] = useState(false);
  const marks = entry.marks ?? {};
  useEffect(() => {
    if (!entry.previewUrl) {
      return;
    }
    const url = entry.previewUrl;
    let alive = true;
    const probe = new Image();
    probe.onload = () => alive && setProbed({ url, ok: true });
    probe.onerror = () => alive && setProbed({ url, ok: false });
    probe.src = url;
    return () => {
      alive = false;
    };
  }, [entry.previewUrl]);
  const picture: "loading" | "ok" | "none" = !entry.previewUrl
    ? "none"
    : probed?.url === entry.previewUrl
      ? probed.ok
        ? "ok"
        : "none"
      : "loading";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (editing) {
          setEditing(undefined);
        } else if (confirming) {
          setConfirming(undefined);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, editing, confirming]);

  const pressKey = (key: DetailKey) => {
    if (key.confirm) {
      setConfirming(key);
      return;
    }
    key.onClick();
    if (key.icon === "link") {
      setFlashKey(key.label);
      window.setTimeout(
        () => setFlashKey((current) => (current === key.label ? undefined : current)),
        1200,
      );
    }
  };

  const saveEdit = async () => {
    if (!editing || !entry.onEdit) {
      return;
    }
    setSaving(true);
    try {
      await entry.onEdit({
        name: editing.name.trim() || entry.name,
        description: editing.description.trim(),
        tags: normalizeBlueprintTags(editing.tags),
      });
      setEditing(undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden text-[var(--mc-ink)]">
      {/* THE PHOTOGRAPH: the top half, whole, never cropped. */}
      <div className="relative h-1/2 w-full shrink-0 bg-[#0b0e12] compact:flex compact:h-auto compact:max-h-[calc(40*var(--ui-vh))] compact:min-h-0 compact:flex-col">
        {picture === "ok" && entry.previewUrl ? (
          // Not next/image: the picture is served by our own route and
          // changes when the post is re-shared.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.previewUrl}
            alt=""
            className="h-full w-full object-contain compact:h-auto compact:max-h-[calc(36*var(--ui-vh))]"
          />
        ) : picture === "loading" ? null : (
          <div className="flex h-full w-full items-center justify-center gap-2 text-[12px] text-[var(--mc-ink-muted)] compact:h-16">
            <ImageIcon className="h-4 w-4 opacity-50" aria-hidden />
            {entry.previewUrl
              ? "No picture of this board yet."
              : "No picture yet. One is taken when the design is posted."}
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="absolute left-3 top-3 flex h-7 items-center gap-1.5 border-2 border-[var(--mc-33)] bg-[var(--mc-61)] px-2 text-xs font-bold text-[var(--mc-ink)] hover:bg-[var(--mc-85)] compact:static compact:order-first compact:mx-2 compact:mt-2 compact:h-9 compact:w-fit compact:text-[13px]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2 px-5 py-3 compact:px-3">
          {/* THE HEAD, full width: who and what it is, Open and the keys. */}
          {/* FACE, NAME, WHO, WHEN, FIGURES; Open and the keys on the right. */}
          <div className="flex items-start gap-3 compact:flex-wrap">
            {entry.onPickIcon && editing ? (
              <button
                type="button"
                onClick={entry.onPickIcon}
                aria-label="Change the icon"
                className="ring-cyan-400 hover:ring-2"
              >
                <Face icon={entry.icon} size={48} />
              </button>
            ) : (
              <Face icon={entry.icon} size={48} />
            )}

            {editing ? (
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <input
                  autoFocus
                  value={editing.name}
                  onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                  aria-label="Name"
                  className="h-7 border border-cyan-500 bg-[var(--mc-33)] px-2 text-[13px] font-bold text-[var(--mc-ink)] outline-none"
                />
                <textarea
                  value={editing.description}
                  onChange={(event) => setEditing({ ...editing, description: event.target.value })}
                  rows={2}
                  placeholder="Describe it"
                  aria-label="Description"
                  className="resize-none border-2 border-[var(--mc-33)] bg-[#17191d] px-2 py-1 text-[12px] text-neutral-100 outline-none shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607] placeholder:text-[var(--mc-ink-muted)]"
                />
                {entry.editTags ? (
                  <input
                    value={editing.tags.join(", ")}
                    onChange={(event) =>
                      setEditing({ ...editing, tags: event.target.value.split(",") })
                    }
                    placeholder="Tags, separated by commas"
                    aria-label="Tags"
                    className="h-7 border-2 border-[var(--mc-33)] bg-[#17191d] px-2 text-[12px] text-neutral-100 outline-none shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607] placeholder:text-[var(--mc-ink-muted)]"
                  />
                ) : null}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void saveEdit()}
                    className="flex h-7 items-center border-2 border-[var(--mc-33)] bg-[var(--mc-61)] px-3 text-[12px] font-bold text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-85)] hover:border-cyan-400 hover:text-cyan-200 disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(undefined)}
                    className="flex h-7 items-center border-2 border-[var(--mc-33)] bg-[var(--mc-61)] px-3 text-[12px] font-bold text-[var(--mc-ink)] hover:bg-[var(--mc-85)]"
                  >
                    Cancel
                  </button>
                  {entry.onPickIcon ? (
                    <span className="text-[11px] text-[var(--mc-ink-muted)]">
                      Click the icon to change it.
                    </span>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <h2 className="min-w-0 truncate text-[17px] font-black leading-tight text-white">
                    {entry.name}
                  </h2>
                  {entry.tier ? <TierBadge tier={entry.tier} /> : null}
                  {marks.open ? (
                    <span className="bg-[var(--mc-61)] px-1 text-[9px] font-black uppercase tracking-wide text-neutral-300">
                      open
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-[var(--mc-ink-muted)]">
                  <span>
                    {entry.creator ? (
                      entry.onCreator ? (
                        <button
                          type="button"
                          onClick={entry.onCreator}
                          className="text-neutral-300 hover:text-cyan-200"
                        >
                          {entry.creator}
                        </button>
                      ) : (
                        <span className="text-neutral-300">{entry.creator}</span>
                      )
                    ) : null}
                    {entry.creator ? " · " : ""}
                    {entry.when}
                  </span>
                  {entry.machines !== undefined ? (
                    <span>
                      <span className="font-bold text-neutral-300">{entry.machines}</span> machines
                    </span>
                  ) : null}
                  {entry.euT !== undefined ? (
                    <span>
                      <span className="font-bold text-amber-300">{formatEuT(entry.euT)}</span> EU/t
                    </span>
                  ) : null}
                  {entry.downloads !== undefined ? (
                    <span className="flex items-center gap-1">
                      <Download className="h-3 w-3" aria-hidden />
                      {entry.downloads}
                    </span>
                  ) : null}
                  {marks.posted ? (
                    <span className="flex items-center gap-1 text-emerald-400">
                      <Globe className="h-3 w-3" aria-hidden />
                      {marks.privatePost ? "posted, private" : "posted"}
                    </span>
                  ) : null}
                </div>
              </div>
            )}

            {/* OPEN, then the keys: one job each, read by their label. */}
            {editing ? null : (
              <div className="flex shrink-0 flex-col items-end gap-1 compact:w-full compact:items-stretch">
                <div className="flex items-center gap-1.5 compact:w-full">
                  {[entry.primary, ...(entry.secondary ? [entry.secondary] : [])].map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={action.onClick}
                      disabled={entry.actionBusy}
                      className="flex h-6 items-center whitespace-nowrap border-2 border-[var(--mc-33)] bg-[var(--mc-61)] px-2.5 text-[11px] font-bold text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-85)] hover:border-cyan-400 hover:text-cyan-200 disabled:opacity-50 compact:h-9 compact:flex-1 compact:justify-center compact:text-[13px]"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
                <div className="flex max-w-[360px] flex-wrap items-center justify-end gap-1 compact:max-w-none compact:justify-start">
                  {entry.onEdit ? (
                    <IconKey
                      label="Edit the name, description and tags"
                      word="Edit"
                      onClick={() =>
                        setEditing({
                          name: entry.name,
                          description: entry.description ?? "",
                          tags: entry.tags ?? [],
                        })
                      }
                    >
                      <Pencil className="h-3 w-3" aria-hidden />
                    </IconKey>
                  ) : null}
                  {entry.keys?.map((key) => (
                    <IconKey
                      key={key.label}
                      label={key.label}
                      word={keyWord(key.icon)}
                      active={key.active}
                      danger={key.icon === "delete"}
                      count={key.count}
                      onClick={() => pressKey(key)}
                    >
                      {flashKey === key.label ? (
                        <Check className="h-3 w-3 text-emerald-300" aria-hidden />
                      ) : (
                        keyIcon(key.icon)
                      )}
                    </IconKey>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* THE QUESTION, in words, when a key asks one. */}
          {confirming ? (
            <div className="flex items-center gap-2 border border-red-900 bg-red-950/50 px-3 py-2 text-[12px] text-red-100">
              <span className="min-w-0 flex-1">{confirming.confirm}</span>
              <button
                type="button"
                onClick={() => {
                  const key = confirming;
                  setConfirming(undefined);
                  key.onClick();
                }}
                className="h-7 border border-red-600 bg-red-700 px-3 text-[12px] font-bold text-white hover:bg-red-600"
              >
                {confirming.icon === "delete" ? "Delete" : "Yes"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(undefined)}
                className="h-7 border-2 border-[var(--mc-33)] bg-[var(--mc-61)] px-3 text-[12px] font-bold text-[var(--mc-ink)] hover:bg-[var(--mc-85)]"
              >
                Cancel
              </button>
            </div>
          ) : null}

          {/* THE DESCRIPTION and its tags, right under the head. */}
          {entry.description ? (
            <p className="line-clamp-3 whitespace-pre-wrap text-[12px] leading-relaxed text-neutral-300">
              {entry.description}
            </p>
          ) : null}
          {entry.tags && entry.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {entry.tags.map((tag) => (
                <span
                  key={tag}
                  className="border border-neutral-700 bg-[#17191d] px-1.5 text-[10px] text-neutral-300"
                >
                  #{tag}
                </span>
              ))}
            </div>
          ) : null}

          {/* BELOW: comments on the left, needs and makes on the right. */}
          <div className="grid grid-cols-2 gap-4 compact:grid-cols-1">
            <div className="flex min-w-0 flex-col gap-3">
              {/* COMMENTS: only on something posted. */}
              {entry.commentsPlanId ? <PlanComments planId={entry.commentsPlanId} /> : null}
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              {/* NEEDS AND MAKES: tight columns, all of them. */}
              {(entry.needs && entry.needs.length > 0) ||
              (entry.outputs && entry.outputs.length > 0) ? (
                <div className="grid grid-cols-2 gap-3 compact:grid-cols-1">
                  <StatColumns label="Needs" stats={entry.needs ?? []} />
                  <StatColumns label="Makes" stats={entry.outputs ?? []} />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function keyIcon(icon: DetailKey["icon"]): ReactNode {
  switch (icon) {
    case "vote":
      return <ArrowBigUp className="h-3 w-3" aria-hidden />;
    case "link":
      return <Link2 className="h-3 w-3" aria-hidden />;
    case "public":
      return <Globe className="h-3 w-3" aria-hidden />;
    case "private":
      return <EyeOff className="h-3 w-3" aria-hidden />;
    case "post":
      return <Upload className="h-3 w-3" aria-hidden />;
    case "delete":
      return <Trash2 className="h-3 w-3" aria-hidden />;
  }
}

/** The short word on each key: the icon alone was unreadable, and there are no tooltips here. */
function keyWord(icon: DetailKey["icon"]): string {
  switch (icon) {
    case "vote":
      return "Vote";
    case "link":
      return "Link";
    case "public":
      return "Make public";
    case "private":
      return "Make private";
    case "post":
      return "Post";
    case "delete":
      return "Delete";
  }
}

function IconKey({
  label,
  word,
  active,
  danger,
  count,
  onClick,
  children,
}: {
  label: string;
  word: string;
  active?: boolean;
  danger?: boolean;
  count?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={[
        "flex h-6 items-center justify-center gap-1 border px-1.5 text-[10px] font-medium",
        active
          ? "border-cyan-500 bg-cyan-500/15 text-cyan-200"
          : danger
            ? "border-[var(--mc-61)] bg-[var(--mc-33)] text-[var(--mc-ink-muted)] hover:border-red-700 hover:text-red-300"
            : "border-[var(--mc-61)] bg-[var(--mc-33)] text-neutral-300 hover:text-[var(--mc-ink)]",
      ].join(" ")}
    >
      {children}
      <span>{word}</span>
      {count !== undefined ? <span className="tabular-nums">{count}</span> : null}
    </button>
  );
}

/** One side of needs or makes: every stat, in as many columns as fit. */
function StatColumns({ label, stats }: { label: string; stats: PlanResourceStat[] }) {
  return (
    <div className="min-w-0 border border-[var(--mc-33)] bg-[var(--mc-25)] p-2">
      <div className="mb-1 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--mc-ink)]">
        {label}
        <span className="ml-1.5 font-medium text-[var(--mc-ink-muted)]">{stats.length}</span>
      </div>
      {stats.length === 0 ? (
        <div className="text-[11px] text-[var(--mc-ink-muted)]">Nothing</div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3 gap-y-0.5">
          {stats.map((stat) => (
            <div
              key={`${stat.kind}:${stat.resourceId}`}
              className="flex min-w-0 items-center gap-1.5"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden">
                <ResourceIcon

                  itemZoom={1.5}
                  resource={{ ...stat, id: stat.resourceId, amount: 1 }}
                  bare
                  tooltip={false}
                  showAmount={false}
                  iconPixelSize={
                    stat.kind === "fluid"
                      ? isSwatchFluid(stat)
                        ? 30
                        : fluidArtPixels(16)
                      : undefined
                  }
                  className="!h-4 !w-4"
                />
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-300">
                {stat.displayName ?? stat.resourceId}
              </span>
              <span className="shrink-0 tabular-nums text-[11px] text-[var(--mc-ink-muted)]">
                {formatSlotRate(stat.ratePerSecond, stat.kind)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

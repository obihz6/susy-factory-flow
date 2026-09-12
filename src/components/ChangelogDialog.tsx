"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, History, X } from "lucide-react";
import { CHANGELOG, type ChangelogEntry } from "@/lib/changelog";
import { APP_VERSION } from "@/lib/version";

/**
 * What's new: what THIS reader missed, and the rest of the history behind a
 * button.
 *
 * The whole list used to render at once. That is fine at four entries and
 * hostile at eighty: someone who last opened the planner in the spring came
 * back to a wall and closed it, which loses exactly the person the popup
 * exists for. So the sheet opens on the releases they have not seen - usually
 * one to four - and the archive is one click below, for the reader who came
 * looking for it rather than the one who was handed it.
 *
 * The VERSION leads each entry. It is the thing a reader arrives holding - the
 * chip in the header told them theirs, a bug report asks for it - so entries
 * are anchored on the number and date in a rail down the left.
 *
 * Opened ON REQUEST only, from the version chip or the Welcome tab. It used
 * to arrive by itself after a release carrying a warning, dressed as an
 * interruption, with a second box guarding its close until the warning was
 * read; both were removed (Jack, 2026-09-08). A warning still renders as an
 * amber block inside its entry.
 */
export function ChangelogDialog({
  onClose,
  entries = CHANGELOG,
  unseenVersions,
}: {
  onClose: () => void;
  entries?: ChangelogEntry[];
  /** Which versions this reader has not seen; these are what opens on top. */
  unseenVersions?: ReadonlySet<string>;
}) {
  // Memoized because it feeds the useMemo below: a fresh empty Set every
  // render would re-split the list on every keystroke the dialog ever sees.
  const unseen = useMemo(() => unseenVersions ?? new Set<string>(), [unseenVersions]);

  /**
   * What the sheet opens on. Unseen releases if there are any; otherwise the
   * newest few, because someone who pressed the button with nothing unread
   * still wants to land on something rather than on a button that says the
   * rest is elsewhere.
   */
  const headline = useMemo(() => {
    const missed = entries.filter((entry) => unseen.has(entry.version));
    return missed.length > 0 ? missed : entries.slice(0, 3);
  }, [entries, unseen]);
  const history = entries.slice(headline.length);

  const [showHistory, setShowHistory] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const missedCount = headline.filter((entry) => unseen.has(entry.version)).length;
  const oldestMissed = missedCount > 0 ? headline[missedCount - 1]!.version : undefined;

  return (
    <div
      className={[
        "fixed inset-0 z-[120] grid place-items-center p-4",
        // NO BACKDROP FILTER ON A PHONE. A full-viewport backdrop-filter forces
        // everything under it into a composited layer and repaints that layer
        // whenever anything beneath moves - and beneath this sits the board,
        // plus the pulsing that marks unwired
        // slots. Desktop absorbs it. A phone does not: it is the heaviest first
        // paint the app can produce, and the tab dying and being restored by
        // the browser looks exactly like a reload loop.
        //
        // Compact gets opacity instead, turned up to compensate. The job here
        // is taking the board away, and a darker sheet does that for free.
        "bg-neutral-950/75 backdrop-blur-sm compact:bg-neutral-950/92 compact:[backdrop-filter:none]",
      ].join(" ")}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="What's new in GTNH Planner"
        className="flex max-h-[calc(88*var(--ui-vh))] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-line-strong bg-surface shadow-2xl compact:max-h-[calc(92*var(--ui-vh))]"
        onClick={(event) => event.stopPropagation()}
      >
        <Masthead missedCount={missedCount} oldestMissed={oldestMissed} onClose={onClose} />

        <div className="min-h-0 flex-1 overflow-y-auto px-5 compact:px-4">
          <ul>
            {headline.map((entry) => (
              <EntryRow key={entry.version} entry={entry} />
            ))}
          </ul>

          {history.length > 0 ? (
            <div className="border-t border-line py-4">
              {showHistory ? (
                <div ref={historyRef}>
                  <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-fg-muted">
                    Earlier releases
                  </p>
                  <ul>
                    {history.map((entry) => (
                      <EntryRow key={entry.version} entry={entry} />
                    ))}
                  </ul>
                </div>
              ) : (
                // Below the notes rather than beside them: the archive is the
                // thing you go looking for after you have read what you came
                // for, and a control up top would compete with it.
                <button
                  type="button"
                  onClick={() => {
                    setShowHistory(true);
                    // Land ON the archive, not wherever the sheet happened to
                    // be - the button is at the bottom, so expanding in place
                    // would leave the reader staring at the last old entry.
                    requestAnimationFrame(() =>
                      historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
                    );
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded border border-line-strong px-3 py-2.5 text-xs font-bold text-fg-subtle hover:border-cyan-700 hover:bg-surface-raised hover:text-cyan-300"
                >
                  <History className="h-3.5 w-3.5" aria-hidden />
                  {`Full history (${history.length} earlier release${history.length === 1 ? "" : "s"})`}
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The top of the sheet, branded.
 *
 * The app's own name and colour up front is the difference between "the
 * planner is telling me something" and "a box appeared".
 */
function Masthead({
  missedCount,
  oldestMissed,
  onClose,
}: {
  missedCount: number;
  oldestMissed?: string;
  onClose: () => void;
}) {
  return (
    <div
      className="relative shrink-0 overflow-hidden border-b border-line bg-gradient-to-br from-surface-raised to-surface px-6 py-5 compact:px-4 compact:py-4"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        // Above the title block, which is `relative` to clear the glow behind
        // it and would otherwise paint over this button and eat the click.
        className="absolute right-3 top-3 z-10 rounded p-1.5 text-fg-subtle hover:bg-surface-raised hover:text-fg"
      >
        <X className="h-4 w-4" />
      </button>

      <p className="relative text-sm font-black tracking-tight">
        GTNH <span className="text-cyan-400">Planner</span>
      </p>

      {/* No version number up here. The entry below leads with its own, the
          header chip carries the one you are running, and a third copy in the
          title just made the reader check whether the three agreed. */}
      <h2 className="relative mt-1.5 text-2xl font-black leading-none tracking-tight compact:text-xl">
        What&apos;s new
      </h2>

      <p className="relative mt-2 text-sm text-fg-muted">
        {missedCount === 1
          ? "One release since your last visit."
          : missedCount > 1
            ? // Counted and dated, because "some updates" is not a reason to
              // read anything.
              `${missedCount} releases since you were last here${
                oldestMissed ? ` (v${oldestMissed} onwards)` : ""
              }. Here they are.`
            : // Not "you are up to date": nobody opened this to be told nothing
              // happened, and it reads as a dead end rather than a document.
              "Everything that has changed, newest first."}
      </p>
    </div>
  );
}

function EntryRow({ entry }: { entry: ChangelogEntry }) {
  return (
    <li
      // A rule between releases, not a gap: at this width the eye needs telling
      // where one entry stops. Stacked on a narrow window, where a rail plus a
      // column of prose has no room to be two things.
      className="grid gap-x-6 border-t border-line py-4 first:border-t-0 sm:grid-cols-[7rem_minmax(0,1fr)]"
    >
      <div className="mb-1.5 sm:mb-0">
        <p
          className={[
            "text-lg font-black leading-none tabular-nums",
            entry.version === APP_VERSION ? "text-cyan-300" : "text-fg",
          ].join(" ")}
        >
          v{entry.version}
        </p>
        <p className="mt-1 text-[11px] tabular-nums text-fg-muted">{formatEntryDate(entry.date)}</p>
        {/* Marks the entry as one to actually stop at, in the rail where the
            eye is already scanning for a version. */}
        {entry.warning ? (
          <span className="mt-1.5 inline-flex items-center gap-1 rounded border border-amber-500/70 bg-amber-500/20 px-1.5 py-px text-[10px] font-black uppercase tracking-wide text-amber-200">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            Read this
          </span>
        ) : null}
      </div>
      <div className="min-w-0">
        <h3 className="text-base font-bold leading-snug text-fg">{entry.headline}</h3>
        <ul className="mt-2 space-y-2">
          {entry.notes.map((note) => (
            <li key={note} className="flex gap-2 text-sm leading-relaxed text-fg-muted">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-500" />
              <span>{renderEmphasis(note)}</span>
            </li>
          ))}
        </ul>
        {/* A release that also carries a WARNING puts it and its actions in
            one block: a caution the reader believes and a button that answers
            it, rather than a worrying sentence and a stray link. */}
        {entry.warning || (entry.actions && entry.actions.length > 0) ? (
          <div
            className={[
              "mt-3",
              entry.warning ? "rounded border border-amber-600 bg-amber-500/15 p-3" : "",
            ].join(" ")}
          >
            {entry.warning ? (
              <div className="mb-2.5 flex items-start gap-2.5">
                <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-amber-400" aria-hidden />
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-wide text-amber-300">
                    Heads up
                  </p>
                  {/* Lit in the callout's OWN colour: the cyan the notes use is
                      this app's "all fine" colour, and inside an amber warning
                      it read as a different message sitting in the middle of
                      this one. */}
                  <p className="mt-1 text-sm leading-relaxed text-amber-100/90">
                    {renderEmphasis(entry.warning, "text-amber-200")}
                  </p>
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {(entry.actions ?? []).map((action) => (
                <a
                  key={action.label}
                  href={action.href}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded border border-line-strong px-3 py-1.5 text-xs font-bold text-fg-subtle hover:bg-surface-raised"
                >
                  {action.label}
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * `*asterisks*` come out lit, the same convention the help cards use.
 *
 * Release notes are one paragraph after another of even grey, and a reader
 * skimming for the thing that affects them has nothing to catch on. Marking
 * the two or three words that carry each line turns a wall into something
 * scannable, without pulling in a markdown renderer for one piece of syntax.
 */
function renderEmphasis(text: string, litClass = "text-cyan-200"): React.ReactNode[] {
  return text.split(/\*([^*]+)\*/g).map((part, index) =>
    index % 2 === 1 ? (
      <strong key={index} className={`font-bold ${litClass}`}>
        {part}
      </strong>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

function formatEntryDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

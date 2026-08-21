"use client";

import {
  AlertTriangle,
  Check,
  Compass,
  Download,
  Factory,
  Play,
  Plus,
  ScrollText,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ChangelogDialog } from "@/components/ChangelogDialog";
import {
  downloadCommunityPlan,
  listCommunityPlans,
  tagPlanWithCommunityId,
} from "@/lib/community/client";
import type { CommunityPlanSummary } from "@/lib/community/types";
import { parseFactoryProjectJson } from "@/lib/import-export";
import { applyPlanView } from "@/lib/plan-view";
import { openSetupsTab } from "@/lib/setups-tab";
import { openSidebarTab } from "@/lib/sidebar-tab";
import { TOUR_LESSONS } from "@/lib/tour/lessons";
import { startLesson, useTourState } from "@/lib/tour/tour-state";
import { leaveWelcomeTab, setWelcomeOnStartup, useWelcomeTab } from "@/lib/tour/welcome-tab";
import { APP_VERSION } from "@/lib/version";
import { writeWorkspaceView } from "@/lib/workspace-view";
import { useDesignStore } from "@/store/design-store";

/**
 * How many multiblocks currently run on figures checked against the game's
 * code, out of the ones the planner knows about. Kept as plain numbers rather
 * than computed at runtime: working it out means walking every recipe in the
 * dataset, and this is a line of text on a page that has to open instantly.
 * Update it when `machine-table.ts` grows.
 */
const VERIFIED_MACHINE_COUNT = 49;
const TOTAL_MULTIBLOCK_COUNT = 81;

/**
 * The machines still running on unchecked figures, so a player can see whether
 * the one in front of them is affected instead of doubting every number.
 *
 * Steam is a group rather than a list: all eight are the same story, and eight
 * names would crowd out the two that matter. The other two groups are named in
 * full, because "some machines" is what makes people distrust all of them.
 *
 * Keep in step with `machine-table.ts`: a machine leaves this list on the
 * commit that adds it there.
 */
const UNVERIFIED_MACHINE_GROUPS: Array<{ label: string; note?: string; machines: string[] }> = [
  {
    label: "Steam machines",
    note: "all eight, speed not yet confirmed",
    machines: [],
  },
  {
    label: "Fusion reactors",
    machines: [
      "Fusion Control Computer Mark I",
      "Fusion Control Computer Mark II",
      "Fusion Control Computer Mark III",
      "FusionTech MK IV",
      "FusionTech MK V",
    ],
  },
  {
    label: "Everything else",
    machines: [
      "Exo-Foundry",
      "Mass Solidifier",
      "Helioflare Power Forge",
      "Precise Auto-Assembler MT-3662",
      "Industrial Chisel",
      "Industrial Bending Machine",
      "Cable Coating",
      "Industrial Chemical Bath",
      "Dangote Distillus",
      "Space Mining Module MK-I",
      "Space Mining Module MK-II",
      "Space Mining Module MK-III",
      "Bose-Einstein Condensate Observation Array",
      "Observation Array Teleportation Node",
      "PCB Factory",
      "Solar Factory",
      "Space Assembler Module MK-I",
      "Space Assembler Module MK-II",
      "Space Assembler Module MK-III",
      "Precise Assembler",
      "Beam Crafter",
      "Vacuum Furnace",
      "Naquadah Fuel Refinery",
      "Foundry Module Components",
      "Large Bronze Boiler",
      "Large Steel Boiler",
      "Large Titanium Boiler",
      "Large Tungstensteel Boiler",
    ],
  },
];

/**
 * Same form the header's report button uses, with the version prefilled. Spelt
 * out here rather than imported so this page does not depend on the header's
 * internals; if a third caller appears, lift both into one module.
 */
const BUG_REPORT_URL = `https://github.com/jackwrichards/gtnh-factory-flow/issues/new?template=bug_report.yml&version=${encodeURIComponent(
  APP_VERSION,
)}`;

/**
 * Says plainly that machine rates are still being worked through, and points
 * at the one thing a player can do about a number that looks wrong.
 *
 * Worth saying out loud on the way in rather than leaving people to find out
 * from a surprising number: the rates for a machine come from three places of
 * decreasing confidence, and which one a given machine falls into is not
 * something a player can see. Until every multiblock is on checked figures,
 * the honest thing is to name the gap and make reporting easy.
 */
function MachineAccuracyNotice() {
  return (
    <section className="flex items-start gap-2.5 rounded border border-amber-600 bg-amber-500/15 p-3">
      <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-amber-400" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-300">
          Machine rates are still being checked
        </p>
        <p className="mt-1 text-xs leading-relaxed text-amber-100/90">
          {`${VERIFIED_MACHINE_COUNT} of ${TOTAL_MULTIBLOCK_COUNT} multiblocks are verified against the game's code. The rest may be off, and steam and fusion are not converted yet. `}
          <a
            href={BUG_REPORT_URL}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-amber-200 underline underline-offset-2 hover:text-amber-100"
          >
            Report a wrong rate
          </a>
          .
        </p>

        {/* Folded away by default: the two sentences above are the point, and
            the list is only wanted by someone whose machine might be in it. */}
        <details className="group mt-2">
          <summary className="w-fit cursor-pointer list-none text-xs font-semibold text-amber-300/90 underline-offset-2 hover:text-amber-200 hover:underline">
            Which ones?
            <span className="ml-1 inline-block transition-transform group-open:rotate-90">›</span>
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {UNVERIFIED_MACHINE_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="text-[11px] font-bold uppercase tracking-wide text-amber-300/70">
                  {group.label}
                  {group.note ? (
                    <>
                      {" "}
                      <span className="font-medium normal-case tracking-normal text-amber-100/60">
                        {group.note}
                      </span>
                    </>
                  ) : null}
                </p>
                {group.machines.length > 0 ? (
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {group.machines.map((machine) => (
                      <li
                        key={machine}
                        className="rounded border border-amber-600/40 bg-amber-500/10 px-1.5 py-px text-[11px] leading-relaxed text-amber-100/90"
                      >
                        {machine}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      </div>
    </section>
  );
}

/**
 * What the Welcome tab shows: a way in for someone who has never opened the
 * app, and a way back to the tours for someone who has.
 *
 * Four things and no prose. The app explains itself perfectly well once you are
 * in it, and every sentence here is one more thing between a new player and the
 * board. The tours are the headline because they are the answer to "what is
 * this"; the shelf underneath is the answer to "show me one".
 *
 * It covers the BOARD, not the window: the plan underneath is never unmounted,
 * and both side columns are still there beside it. So a button here only steps
 * off this tab when what it does happens on the board - a new design, a tour, a
 * setup opening into its own tab. Anything that happens in a column stays put,
 * because there is nothing in the way of it.
 */
export function WelcomePage() {
  const { showOnStartup } = useWelcomeTab();
  const { completedLessonIds } = useTourState();
  const addDesign = useDesignStore((state) => state.addDesign);
  const [isChangelogOpen, setChangelogOpen] = useState(false);

  // `startLesson` steps off this tab itself now, so every entry point to a
  // tour behaves the same way rather than each one remembering to.
  const beginLesson = startLesson;

  const openBoardWith = (action: () => void) => {
    leaveWelcomeTab();
    action();
  };

  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-7 px-6 py-8 compact:gap-5 compact:px-4 compact:py-5">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-2xl font-bold tracking-tight text-fg compact:text-xl">
            GTNH <span className="text-cyan-500">Planner</span>
          </h2>
          <span className="rounded border border-line px-1.5 py-px text-[11px] font-semibold leading-none text-fg-muted tabular-nums">
            v{APP_VERSION}
          </span>
          {/* A button that says what it does, not a version number you have to
              guess is clickable. The chip beside it is just the number. */}
          <button
            type="button"
            onClick={() => setChangelogOpen(true)}
            className="ml-auto inline-flex items-center gap-2 rounded border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-fg-subtle hover:border-cyan-600 hover:text-cyan-300"
          >
            <ScrollText className="h-3.5 w-3.5" aria-hidden />
            What&apos;s new
          </button>
        </header>

        <section>
          <SectionTitle>Take a tour</SectionTitle>
          <div className="mt-2 flex flex-col gap-2">
            {TOUR_LESSONS.map((lesson) => {
              const isDone = completedLessonIds.includes(lesson.id);
              return (
                <div
                  key={lesson.id}
                  className={[
                    "flex items-center gap-3 rounded border p-3",
                    // A recommended lesson does not sit quietly in a row of
                    // equals: it takes the accent border and a lit face, so the
                    // eye lands on it before it lands on the ones beside it.
                    lesson.recommended
                      ? "border-cyan-600/70 bg-cyan-500/[0.07]"
                      : "border-line-strong bg-surface",
                  ].join(" ")}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-cyan-800 bg-cyan-950 text-cyan-400">
                    <Compass className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-semibold text-fg">
                      {lesson.title}
                      {/* Stays up after it has been done: see `recommended`. */}
                      {lesson.recommended ? (
                        <span
                          className="inline-flex items-center gap-1 rounded border border-cyan-500/70 bg-cyan-500/20 px-1.5 py-px text-[10px] font-black uppercase tracking-wide text-cyan-200"
                        >
                          <Sparkles className="h-3 w-3" aria-hidden />
                          Start here
                        </span>
                      ) : null}
                      {isDone ? (
                        <span
                          className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400"
                        >
                          <Check className="h-3 w-3" />
                          Done
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs leading-snug text-fg-muted">
                      {lesson.blurb} {lesson.steps.length} stops.
                    </p>
                    {lesson.recommended ? (
                      <p className="mt-1 text-xs font-semibold leading-snug text-cyan-300">
                        {isDone ? "This tour has changed since you took it." : "Do this one first."}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => beginLesson(lesson.id)}
                    className={[
                      "inline-flex shrink-0 items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-bold",
                      lesson.recommended
                        ? "border-cyan-400 bg-cyan-500/30 text-cyan-100 hover:bg-cyan-500/45"
                        : "border-cyan-600 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25",
                    ].join(" ")}
                  >
                    <Play className="h-3.5 w-3.5" />
                    {isDone ? "Again" : "Start"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <div className="grid gap-6 sm:grid-cols-[auto_minmax(0,1fr)]">
          <section>
            <SectionTitle>Start</SectionTitle>
            <div className="mt-1 flex flex-col items-start">
              <QuickAction
                icon={Plus}
                label="New design"
                onClick={() => openBoardWith(() => void addDesign())}
              />
              {/* Stays on this tab on purpose. The shelf lives in the left
                  column, which is beside the Welcome page rather than under
                  it, so there is nothing to step off for. */}
              <QuickAction
                icon={Factory}
                label="Browse shared setups"
                onClick={() => {
                  writeWorkspaceView({ leftPanelOpen: true });
                  // Both: the first survives the column being shut (it waits in
                  // module state for the panel to mount), the second is what
                  // lands the shelf on Public rather than Mine.
                  openSidebarTab("setups");
                  openSetupsTab("network");
                }}
              />
            </div>
          </section>

          <RecentUploads onOpened={leaveWelcomeTab} />
        </div>

        <footer className="mt-auto border-t border-line pt-3">
          <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-fg-muted hover:text-fg">
            <input
              type="checkbox"
              checked={showOnStartup}
              onChange={(event) => setWelcomeOnStartup(event.target.checked)}
              className="h-3.5 w-3.5 accent-cyan-500"
            />
            Show this tab when the planner opens
          </label>
        </footer>

        <MachineAccuracyNotice />
      </div>
      {isChangelogOpen ? <ChangelogDialog onClose={() => setChangelogOpen(false)} /> : null}
    </div>
  );
}

/**
 * The last few factories anybody posted.
 *
 * This used to list the reader's own designs, which is what an editor's welcome
 * screen does - but an editor's recent files are all files you made, and this
 * list quietly filled up with tabs the app had opened FOR you (a shared link, a
 * tour's example) under a heading claiming they were yours. The shelf is the
 * more honest and more interesting thing to put here anyway: on a first visit
 * your own list is empty, and this one never is.
 */
function RecentUploads({ onOpened }: { onOpened: () => void }) {
  const [plans, setPlans] = useState<CommunityPlanSummary[]>();
  const [failed, setFailed] = useState(false);
  const [openingId, setOpeningId] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    listCommunityPlans({ sort: "new", pageSize: 6 })
      .then((result) => {
        if (!cancelled) {
          setPlans(result.plans);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const open = async (plan: CommunityPlanSummary) => {
    setOpeningId(plan.id);
    try {
      const { plan: planJson } = await downloadCommunityPlan(plan.id);
      const project = parseFactoryProjectJson(
        JSON.stringify(tagPlanWithCommunityId(planJson, plan.id)),
      );
      // Named after the post, same as opening one from the shelf.
      await useDesignStore.getState().importProjectAsDesign(project, plan.name || project.name);
      // Opened the way its author arranged it, same as from the shelf.
      applyPlanView(project.view);
      onOpened();
    } catch {
      setFailed(true);
    } finally {
      setOpeningId(undefined);
    }
  };

  return (
    <section className="min-w-0">
      <SectionTitle>Recent uploads</SectionTitle>
      {failed ? (
        <p className="mt-2 text-xs text-fg-muted">Could not load shared setups.</p>
      ) : !plans ? (
        <p className="mt-2 text-xs text-fg-muted">Loading…</p>
      ) : plans.length === 0 ? (
        <p className="mt-2 text-xs text-fg-muted">Nothing posted yet.</p>
      ) : (
        <div className="mt-1 flex flex-col items-start">
          {plans.map((plan) => (
            <button
              key={plan.id}
              type="button"
              disabled={Boolean(openingId)}
              onClick={() => void open(plan)}
              title={`Open "${plan.name}"`}
              className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left hover:bg-surface-sunken disabled:opacity-50"
            >
              <span className="truncate text-xs font-medium text-cyan-400">{plan.name}</span>
              {plan.authorName ? (
                <span className="shrink-0 text-[11px] text-fg-muted">{plan.authorName}</span>
              ) : null}
              <span className="ml-auto flex shrink-0 items-center gap-0.5 text-[11px] text-fg-muted">
                <Download className="h-3 w-3" aria-hidden />
                {plan.downloads}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-bold uppercase tracking-widest text-fg-muted">{children}</h3>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Plus;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-2 rounded px-2 py-1 text-left hover:bg-surface-sunken"
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-cyan-500" />
      <span className="whitespace-nowrap text-xs font-medium text-cyan-400 group-hover:text-cyan-300">
        {label}
      </span>
    </button>
  );
}

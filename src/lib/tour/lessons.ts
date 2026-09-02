"use client";

import {
  Box,
  Compass,
  Download,
  Eye,
  Focus,
  Gauge,
  Globe,
  ImagePlus,
  Link,
  Network,
  Paintbrush,
  Search,
  Share2,
  Square,
  Trash2,
  Undo2,
  Upload,
  User,
} from "lucide-react";
import type { GlanceRow } from "@/components/tour/card-parts";
import { openSidebarTab } from "@/lib/sidebar-tab";
import {
  hideTourLoopNoticeExample,
  showTourLoopNoticeExample,
} from "@/lib/tour/tour-mock-notice";
import { writeWorkspaceView } from "@/lib/workspace-view";
import {
  clearTheDecks,
  frameTourWholeBoard,
  frameTourBlocked,
  frameTourBottleneck,
  frameTourBufferDrawer,
  frameTourProductDrawer,
  openTourPlan,
  restoreTheDecks,
  restoreTourRateUnit,
  tuneTourRateUnit,
  tourBlockedInputsSelector,
  tourBlockedUsageSelector,
  tourBottleneckSelector,
  tourBottleneckUsageSelector,
  tourBufferDrawerSelector,
  tourProductDrawerSelector,
} from "./tour-boards";

/**
 * The guided walks behind the Welcome tab.
 *
 * A lesson is a list of steps, and a step is a place on the screen plus what
 * that place is for. The overlay (`TourOverlay`) does the pointing: it finds
 * the step's anchor, cuts a hole in a dimmed screen around it, and parks a card
 * beside it.
 *
 * An anchor is an id, not a selector. The overlay looks for
 * `[data-tour-anchor="<id>"]` first and falls back to `[data-help-anchor=...]`,
 * which the hover help sheet already puts on every toolbar and column, so most
 * steps cost no markup at all. Several elements may share one id; their
 * rectangles union, and anything hidden is skipped, so a folded compact toolbar
 * points at its trigger instead of at the invisible row above the board.
 *
 * WRITING A STEP. A wall of prose gets skipped, so a step is a short stack of
 * ROWS, and every row leads with the same mark the screen does: the button's
 * own icon, a key chip, or a little mouse with the right button lit. Keep a row
 * to one line's worth of words, put the words that matter between *asterisks*
 * so they come out lit, and let the icon carry the rest. Five rows is the most
 * any step should ever want.
 *
 * EVERY CLAIM MUST BE TRUE ON THE LIVE BOARD. The second lesson's steps were
 * checked against the posted titanium line with the real solver (the equation
 * books, 2026-08-20). `tour-board-alive.test.ts` pins the solves the copy
 * leans on. Rewrite a row only with the board open.
 *
 * A tour only ever POINTS. It moves the camera and opens columns, but it never
 * edits the plan under the reader - the live pill-flip experiment the second
 * lesson used to run was removed for exactly that (2026-08-23).
 *
 * `before` runs just ahead of the step and is for making the target visible:
 * opening a column, landing the sidebar on a tab. A step must never leave the
 * app somewhere the user then has to dig their way out of.
 */

/** Where a step's card sits relative to the thing it points at. */
export type TourSide = "top" | "bottom" | "left" | "right" | "inside";

export interface TourStep {
  /**
   * The `data-tour-anchor` / `data-help-anchor` id to point at. Left out, or
   * missing from the page, the card sits in the middle of a dimmed screen.
   */
  anchor?: string;
  /**
   * A CSS selector worked out at the moment the step runs, for pointing at
   * something that has no anchor because it did not exist until now: one card
   * of a plan the lesson has just downloaded. Read every frame, and it wins
   * over `anchor`.
   */
  anchorSelector?: () => string | undefined;
  title: string;
  rows: GlanceRow[];
  /** Preferred side. Ignored when there is no room for it. */
  side?: TourSide;
  /** Make the target reachable before the step is measured. */
  before?: () => void;
}

export interface TourLesson {
  id: string;
  /** Shown on the Welcome tab's card. */
  title: string;
  blurb: string;
  /**
   * Worth pressing even if you think you know the app.
   *
   * Stays on after the lesson has been completed, deliberately. The rules this
   * one teaches - what the words on a card mean, what each drawer shape asks
   * for - are the ones that CHANGE, and somebody who walked it three releases
   * ago is exactly the person who now believes something that is no longer
   * true. A badge that disappears the moment you have seen it once only ever
   * reaches people on their first day.
   */
  recommended?: boolean;
  /** Put something on the board worth pointing at, before step one. */
  setup?: () => void | Promise<void>;
  /** Undo whatever `setup` did to the layout, however the lesson ends. */
  teardown?: () => void;
  /** Offered as a second button on the last step: keep going into this one. */
  nextLessonId?: string;
  steps: TourStep[];
}

function showColumn(side: "left" | "right") {
  writeWorkspaceView(side === "left" ? { leftPanelOpen: true } : { rightPanelOpen: true });
}

/** Open the left column AND land it on one tab: the tour walks all three. */
function showSidebarTab(tab: "items" | "blueprints" | "setups") {
  return () => {
    showColumn("left");
    openSidebarTab(tab);
  };
}

const LOOK_AROUND: TourLesson = {
  id: "look-around",
  title: "A look around the planner",
  blurb: "Where everything is: the board, the toolbars, and both columns.",
  nextLessonId: "read-the-board",
  steps: [
    {
      anchor: "board",
      side: "inside",
      title: "This is the board",
      rows: [
        { text: "Your factory gets built here." },
        { mouse: "left", text: "Drag the background to *move around*." },
        { mouse: "scroll", text: "Scroll to *zoom*." },
      ],
    },
    {
      anchor: "build",
      side: "bottom",
      title: "Build tools",
      rows: [
        { icon: Undo2, text: "Undo and redo. *Ctrl+Z*." },
        { icon: Gauge, text: "*Custom rate*: set any rate in or out by hand." },
        { chip: "/s", text: "The *rate unit*. Click it: tick, second, minute, hour." },
      ],
    },
    {
      anchor: "paint",
      side: "left",
      title: "Paint and notes",
      rows: [
        { icon: Paintbrush, text: "Pick a shade, then click cards to *paint them*." },
        { icon: Square, text: "*Draw*: box, zone, arrow or note, under one button." },
        { icon: ImagePlus, text: "Place a *picture* from your files." },
        { icon: Trash2, text: "*Bin*: click anything to delete it." },
      ],
    },
    {
      anchor: "view",
      side: "left",
      title: "View options",
      rows: [
        { text: "These change *the view*, not the plan." },
        { icon: Eye, text: "One menu: background, how the wires draw, motion." },
        { icon: Network, text: "Beside it: *setup rules* and *auto-arrange*." },
        { icon: Focus, text: "*Fits the whole plan* on the screen." },
        { icon: Box, text: "Zoomed out, cards can show *what they are*, *how hard they run*, or *power*." },
      ],
    },
    {
      anchor: "inspector",
      side: "left",
      before: () => showColumn("right"),
      title: "What the plan needs",
      rows: [
        { text: "Fills with three lists once machines are on the board." },
        { chip: "INPUTS", tone: "need", text: "You have to bring this in yourself." },
        { chip: "OUTPUTS", tone: "output", text: "This leaves the plan." },
        { chip: "INTERNAL", tone: "internal", text: "Made and used right here." },
        { text: "Hover a row and every card carrying it *lights up*." },
      ],
    },
    {
      anchor: "browser",
      side: "right",
      before: showSidebarTab("items"),
      title: "Every item in the pack",
      rows: [
        { icon: Search, text: "Search works like *NEI* in game." },
        { mouse: "left", text: "Left click asks *what makes it*." },
        { mouse: "right", text: "Right click asks *what uses it*." },
        { text: "Pick a recipe and the machine *lands on the board*, ready to wire." },
      ],
    },
    {
      anchor: "browser",
      side: "right",
      before: showSidebarTab("blueprints"),
      title: "Boards: group and fold",
      rows: [
        { chip: "Ctrl+G", text: "Select a few cards and *a board wraps around them*." },
        { text: "Drag the title bar and *everything on the board moves together*." },
        { chip: "✦", text: "Fold a board and it becomes *one card* showing its inputs and outputs." },
        { text: "This shelf holds your saved boards; place one and it lands folded." },
      ],
    },
    {
      anchor: "tabs",
      side: "bottom",
      title: "One tab, one factory",
      rows: [
        { chip: "+", text: "A new empty board." },
        { mouse: "left", text: "Double click a tab to *rename* it." },
        { text: "Everything saves in this browser as you work." },
      ],
    },
    {
      anchor: "plan-actions",
      side: "bottom",
      title: "Plans in and out",
      rows: [
        { icon: Upload, text: "*Import* a plan from a file." },
        { icon: Download, text: "*Export* it: an image, a GIF, or the plan as JSON." },
        { icon: Share2, text: "*Share* posts it to the Setups shelf." },
      ],
    },
    {
      anchor: "browser",
      side: "right",
      before: showSidebarTab("setups"),
      title: "Shared setups",
      rows: [
        { icon: Globe, text: "*Public*: every setup people have posted. Open one and it becomes *a new tab* you can edit." },
        { icon: Share2, text: "*Share* posts the board you have open, and you get a *link to send a friend*." },
        { icon: User, text: "*Mine*: the ones you have posted. Take one down any time." },
        { text: "Needs an account: just a *username and password*." },
      ],
    },
    {
      anchor: "help",
      side: "right",
      title: "Help",
      rows: [
        { chip: "?", text: "Names *every button on the screen* at once." },
        { icon: Compass, text: "Rerun both tours from the *Welcome* tab, or right here." },
        { text: "The next tour opens a real factory and explains it." },
      ],
    },
  ],
};

/**
 * The second walk: the canvas and nothing else.
 *
 * It opens a real posted setup, says what the board is at arm's length, then
 * flies in on one machine and reads it out loud. The cards it picks are the
 * real bottleneck and blocked machines (see `pickCards`), so there is always
 * a real number to explain rather than a shrug. It points and explains; it
 * never edits the plan under the reader.
 */
const READ_THE_BOARD: TourLesson = {
  id: "read-the-board",
  title: "Read the board",
  recommended: true,
  blurb: "Opens a real titanium line: what the words on the cards mean and what each drawer does.",
  // Both columns out of the way for the duration: this lesson is about the
  // canvas and nothing else, and with them open there is not enough board left
  // to magnify a card into. They come back exactly as they were.
  setup: () => {
    clearTheDecks();
    // AFTER the plan opens, not before: switching to the tour's design tab
    // applies that design's saved view, rate unit included, which would
    // stamp straight over a dial turned any earlier.
    return openTourPlan().then(tuneTourRateUnit);
  },
  // However the lesson ends - finished, skipped, closed - the rate dial and
  // the columns go back exactly as they were.
  teardown: () => {
    hideTourLoopNoticeExample();
    restoreTourRateUnit();
    restoreTheDecks();
  },
  steps: [
    {
      anchor: "board",
      side: "inside",
      title: "A factory of boxes and wires",
      rows: [
        { text: "Every box is *one machine* doing *one recipe*." },
        { text: "Every wire is *one thing moving*, from whoever makes it to whoever needs it." },
        { text: "Nothing here idles by choice: every machine runs *as fast as its supplies allow*." },
      ],
    },
    {
      anchorSelector: tourBottleneckSelector,
      side: "right",
      before: frameTourBottleneck,
      title: "A recipe",
      rows: [
        { text: "Three parts, always in the same places." },
        { text: "*Left*: what it needs." },
        { text: "*Right*: what it makes." },
        { text: "*Bottom*: how hard the machine is running." },
      ],
    },
    {
      anchorSelector: tourBottleneckSelector,
      side: "right",
      title: "Fed, and still short",
      rows: [
        { text: "The input bars are full: everything this machine wants *arrives*." },
        { text: "The next machine wants *far more* of its output than it can make." },
        {
          text: "The *percentage* on an output row is how much of what was asked for actually arrived.",
        },
      ],
    },
    {
      anchorSelector: tourBottleneckUsageSelector,
      side: "right",
      title: "Which makes this a bottleneck",
      rows: [
        {
          chip: "BOTTLENECK",
          tone: "bottleneck",
          text: "Fully fed and running at *100%*, and still not making enough.",
        },
        {
          text: "This word means *build more of this machine* or *raise its voltage*. More supply would not help: it already has everything it wants.",
        },
      ],
    },
    {
      anchorSelector: tourBlockedInputsSelector,
      side: "right",
      before: frameTourBlocked,
      title: "Only one input is the problem",
      rows: [
        { text: "A different machine, further down the chain." },
        { text: "The bars still look full: it gets all it asks for *at its current speed*." },
        {
          text: "One input is *marked*: the one whose supply sets that speed. Fix the marked one; the others are already covered.",
        },
      ],
    },
    {
      anchorSelector: tourBlockedUsageSelector,
      side: "right",
      title: "Why it does not say bottleneck",
      rows: [
        {
          chip: "BLOCKED",
          tone: "blocked",
          text: "Slowed because it is not being fed enough.",
        },
        {
          text: "Adding more of *this* machine would not help. It cannot use what it already gets.",
        },
        {
          text: "And everything after it goes short too: one short machine becomes *a whole chain of slowed machines*.",
        },
      ],
    },
    {
      anchorSelector: tourBottleneckUsageSelector,
      side: "right",
      before: frameTourBottleneck,
      title: "Three more words",
      rows: [
        {
          chip: "PACED",
          tone: "fine",
          text: "Fed, nothing jammed, still under 100%: it *runs at the speed of the machines around it*. Nothing to fix.",
        },
        {
          chip: "NO WIRES",
          tone: "starved",
          text: "A slot has no wire, so the machine cannot run. The bare slots *flash white*.",
        },
        {
          chip: "CLOGGED",
          tone: "clogged",
          text: "The spare it makes has *nowhere* to go, so it slows to its takers' pace, as in game. A *Byproduct* drawer fixes it.",
        },
      ],
    },
    {
      anchor: "loop-notice",
      side: "top",
      before: () => {
        frameTourWholeBoard();
        showTourLoopNoticeExample();
      },
      title: "When a line feeds itself",
      rows: [
        { text: "Machines can feed each other in a circle. Two diseases live there." },
        {
          chip: "DEAD LOOP",
          tone: "bottleneck",
          text: "*Red*: the circle loses material every pass, so every machine in it starves to zero.",
        },
        {
          chip: "CLOG LOCK",
          tone: "clogged",
          text: "*Blue*: the circle makes more of something than it uses. Every chest fills, then everything freezes at *0%*.",
        },
        {
          text: "These two are *examples*, not your board. On a real one, *Show me* walks you to the machines to fix.",
        },
      ],
    },
    {
      anchor: "board",
      side: "inside",
      before: frameTourWholeBoard,
      title: "Drawers decide",
      rows: [
        { text: "Machines make. *Drawers decide* what enters, what leaves, and what waits." },
        {
          chip: "SOURCE",
          tone: "need",
          text: "*Red, rounded*: never runs out. The plan's inputs, which *your real base must supply*.",
        },
        { chip: "PRODUCT", tone: "product", text: "*Blue, square*: what the plan outputs." },
        {
          chip: "BYPRODUCT",
          tone: "output",
          text: "*Green, shield*: catches the spare so it cannot back up and clog its maker.",
        },
        {
          chip: "BUFFER",
          tone: "internal",
          text: "*Steel, hexagon*: flow passes through, and extra piles up here.",
        },
      ],
    },
    {
      anchorSelector: tourProductDrawerSelector,
      side: "right",
      before: frameTourProductDrawer,
      title: "A Product is the goal",
      rows: [
        { text: "The *titanium ingot* drawer. The freezer fills it, and nothing draws from it." },
        {
          text: "It does not make the freezer run faster. No drawer does: *speed comes from supply*.",
        },
        {
          text: "The button on its header flips it to a Byproduct. That changes what the plan counts as its goal, *never a speed*.",
        },
      ],
    },
    {
      anchorSelector: tourBufferDrawerSelector,
      side: "right",
      before: frameTourBufferDrawer,
      title: "A Buffer catches",
      rows: [
        { text: "*Hot titanium ingot*, between the furnace and the freezer." },
        {
          chip: "BUFFER",
          tone: "internal",
          text: "It hands the freezer what arrives and *stores* anything the freezer does not take.",
        },
        {
          text: "It never creates supply: the freezer is short because the furnace makes too few, and no tank fixes that.",
        },
        {
          text: "Its header button can make it *strict*: a strict buffer stores nothing, so spare output backs up into its maker.",
        },
      ],
    },
    {
      anchor: "setup-rules",
      side: "bottom",
      title: "Setup rules",
      rows: [
        {
          text: "*Free inputs*: anything short of stock takes the rest from off the setup.",
        },
        {
          text: "*Free outputs*: anything with nowhere to go leaves the setup instead of backing up.",
        },
        {
          text: "Both off, you wire the boundary yourself and the setup tells you what is missing.",
        },
      ],
    },
  ],
};

export const TOUR_LESSONS: TourLesson[] = [LOOK_AROUND, READ_THE_BOARD];

export function findLesson(lessonId: string | undefined): TourLesson | undefined {
  return lessonId ? TOUR_LESSONS.find((lesson) => lesson.id === lessonId) : undefined;
}

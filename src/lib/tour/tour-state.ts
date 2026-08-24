"use client";

import { useSyncExternalStore } from "react";
import { findLesson } from "./lessons";
import { leaveWelcomeTab } from "./welcome-tab";

/**
 * Which lesson is being walked, and which lessons have been finished.
 *
 * Same shape as `board-view.ts`: module state read through
 * useSyncExternalStore, so the server can render "no tour running" without a
 * hydration mismatch and nothing has to set state from inside an effect. Only
 * the finished list is written to localStorage. A tour half walked is not worth
 * resuming a week later, and starting a page load inside a spotlight would be
 * alarming.
 */
export interface TourState {
  /** The lesson being walked, if any. */
  lessonId?: string;
  /** Which step of it, from zero. */
  stepIndex: number;
  /** Lessons walked all the way to the last step. */
  completedLessonIds: string[];
}

const COMPLETED_STORAGE_KEY = "susy-factory-flow-tours-done";

const IDLE: TourState = { stepIndex: 0, completedLessonIds: [] };

let state: TourState = IDLE;
let loaded = false;
const listeners = new Set<() => void>();

function readCompleted(): string[] {
  try {
    const raw = window.localStorage.getItem(COMPLETED_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function getSnapshot(): TourState {
  if (!loaded) {
    loaded = true;
    state = { ...IDLE, completedLessonIds: readCompleted() };
  }
  return state;
}

function getServerSnapshot(): TourState {
  return IDLE;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The same subscription the hook uses, for module code that has to react to
 * a step change without being a component - the tour board's get-ready
 * flash cancels itself through this, so no tile can keep blinking after
 * the reader moves on, whichever direction they went.
 */
export function subscribeTourState(listener: () => void): () => void {
  return subscribe(listener);
}

function publish(next: TourState) {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

function rememberCompleted(completedLessonIds: string[]) {
  try {
    window.localStorage.setItem(COMPLETED_STORAGE_KEY, JSON.stringify(completedLessonIds));
  } catch {
    // A full or blocked storage quota must never break the tour.
  }
}

export function useTourState(): TourState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function startLesson(lessonId: string) {
  if (!findLesson(lessonId)) {
    return;
  }
  /*
   * Onto the board first. EVERY lesson anchors to cards, ports and toolbars,
   * so a tour started while the Welcome page is up spotlights things that are
   * underneath it: the reader gets a card telling them to look at a blast
   * furnace, over a page with no board on it.
   *
   * Here rather than at the call sites. The Welcome page's own buttons did
   * this themselves and the What's new popup did not, which is precisely the
   * kind of thing every new entry point gets wrong once. A tour is a thing
   * that happens ON the board; making that true of the verb costs one line and
   * cannot be forgotten.
   */
  leaveWelcomeTab();
  publish({ ...getSnapshot(), lessonId, stepIndex: 0 });
}

/** Leave the tour where it stands. Nothing is marked finished. */
export function endLesson() {
  const current = getSnapshot();
  if (!current.lessonId) {
    return;
  }
  publish({ ...current, lessonId: undefined, stepIndex: 0 });
}

export function goToStep(stepIndex: number) {
  const current = getSnapshot();
  const lesson = findLesson(current.lessonId);
  if (!lesson) {
    return;
  }

  // Past the last step means the lesson is done. Before the first step is
  // simply the first step.
  if (stepIndex >= lesson.steps.length) {
    finishLesson();
    return;
  }

  publish({ ...current, stepIndex: Math.max(0, stepIndex) });
}

/**
 * Mark the running lesson finished and come down - or, with `nextLessonId`,
 * carry straight on into the one it offers.
 */
export function finishLesson(nextLessonId?: string) {
  const current = getSnapshot();
  const lesson = findLesson(current.lessonId);
  if (!lesson) {
    return;
  }

  const completedLessonIds = current.completedLessonIds.includes(lesson.id)
    ? current.completedLessonIds
    : [...current.completedLessonIds, lesson.id];
  rememberCompleted(completedLessonIds);

  const next = findLesson(nextLessonId);
  publish({ completedLessonIds, lessonId: next?.id, stepIndex: 0 });
}

export function nextStep() {
  goToStep(getSnapshot().stepIndex + 1);
}

export function previousStep() {
  goToStep(getSnapshot().stepIndex - 1);
}

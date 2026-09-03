/**
 * Temporary feature switches for this fork, in one place so re-enabling is a
 * one-line change per flag. They are UI-level gates only: the underlying APIs
 * still exist, so flipping a flag back on needs nothing besides this file.
 */

/**
 * The Ko-fi tip jar (header button + compact menu row). OFF while the fork's
 * own hosting settles; the upstream planner keeps its own link.
 */
export const DONATIONS_ENABLED = false;

/**
 * Community accounts: the sign-in button, the share dialog's auth form, and
 * the "sign in" prompts on the shelf panels. OFF while the community backend
 * is not part of this fork; sharing needs an account, so Share shows a notice
 * instead of the form while this is off.
 */
export const LOGIN_ENABLED = false;

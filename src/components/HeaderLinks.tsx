"use client";

import { Bug, Compass, Heart, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { openWelcomeTab } from "@/lib/tour/welcome-tab";
import {
  markVersionSeenAndNotify,
  subscribeToVersionSeen,
  unseenEntries,
} from "@/lib/whats-new";
import { APP_VERSION } from "@/lib/version";

const GITHUB_URL = "https://github.com/jackwrichards/gtnh-factory-flow";

/**
 * The planner's thread in the Greg Tech: New Horizons Discord. This is a
 * thread inside the pack's own server, not a server invite, so it only opens
 * for people who are already in there.
 */
const DISCORD_THREAD_URL = "https://discord.com/channels/181078474394566657/1531402304530682036";

/**
 * The tip jar. Clicks are counted through Umami's `data-umami-event`
 * auto-tracking (they land in the dashboard's Events panel, split by the
 * `source` field); the attribute is inert when the analytics script is off.
 */
const KOFI_URL = "https://ko-fi.com/gtnhplanner";

/**
 * Straight into the bug report form rather than a blank issue box, with the
 * version chip's value already filled in: the first thing anyone triaging a
 * report needs is which build it happened on, and that is the detail players
 * are least likely to think of.
 */
const BUG_REPORT_URL = `${GITHUB_URL}/issues/new?template=bug_report.yml&version=${encodeURIComponent(
  APP_VERSION,
)}`;

/**
 * Source and chat, sitting in the header beside the board actions.
 *
 * The bug report used to be a third icon here and read as one more thing to
 * ignore. It carries its own label now and sits further right, on its own.
 */
export function HeaderLinks() {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {/* The way back to the Welcome tab once it has been closed, which is the
          only way back to the guided tours. */}
      <button
        type="button"
        onClick={openWelcomeTab}
        title="Welcome"
        aria-label="Open the Welcome tab"
        className="inline-flex h-7 w-7 items-center justify-center rounded border border-line-strong bg-surface text-fg-subtle hover:bg-surface-raised hover:text-fg"
      >
        <Compass className="h-3.5 w-3.5" />
      </button>
      <HeaderLink href={GITHUB_URL} label="Source on GitHub">
        <GithubMark />
      </HeaderLink>
      <HeaderLink href={DISCORD_THREAD_URL} label="Discord thread">
        <DiscordMark />
      </HeaderLink>
    </div>
  );
}

/**
 * What's new, as a WORD rather than an icon, sitting immediately left of the
 * bug report.
 *
 * It was a glyph beside the compass for about an hour and that was the wrong
 * call: an unlabelled star in a row of unlabelled squares is one more thing to
 * ignore, and this is the control that tells somebody the rules of the board
 * changed under them. The two labelled buttons now read as a pair - here is
 * what we changed, here is where to complain about it.
 */
export function WhatsNewButton({
  onClick,
  onDevPreview,
}: {
  /** Handed what was unread at the moment of the click, for the divider. */
  onClick: (unseenVersions: Set<string>) => void;
  /** Shift-click: the hidden update-popup preview. See WhatsNewPreview. */
  onDevPreview: () => void;
}) {
  const [unread, setUnread] = useState(false);

  // After mount: it reads localStorage, which a server render does not have.
  useEffect(() => {
    setUnread(unseenEntries().length > 0);
    return subscribeToVersionSeen(() => setUnread(false));
  }, []);

  return (
    <button
      type="button"
      onClick={(event) => {
        if (event.shiftKey) {
          onDevPreview();
          return;
        }
        // Read what is unseen BEFORE stamping, or the dialog opens with
        // nothing above its divider - the click would have erased the very
        // thing the line is drawn around.
        const unseenNow = new Set(unseenEntries().map((entry) => entry.version));
        // Opening it IS reading it, so the dot goes now rather than when the
        // dialog is closed - otherwise anyone who reads and then presses
        // Escape gets the dot back and learns to distrust it.
        markVersionSeenAndNotify();
        onClick(unseenNow);
      }}
      title="What's new"
      aria-label="What's new in the planner"
      className="relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded border border-cyan-700 bg-cyan-950 px-2 text-xs font-semibold text-cyan-300 hover:border-cyan-500 hover:bg-cyan-900 hover:text-cyan-200 snug:w-7 snug:justify-center snug:px-0"
    >
      <Sparkles className="h-3.5 w-3.5" aria-hidden />
      <span className="snug:hidden">What&apos;s new</span>
      {/* The quiet half of the system: a release that does not warrant a
          dialog still gets noticed, without anything being put in the way. */}
      {unread ? (
        <span
          aria-label="Unread release notes"
          className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-surface bg-cyan-400"
        />
      ) : null}
    </button>
  );
}

/**
 * Reporting a bug is the one thing here worth interrupting someone for, so it
 * is the only header control that carries a colour and a word.
 */
export function ReportBugButton() {
  return (
    <a
      href={BUG_REPORT_URL}
      target="_blank"
      rel="noreferrer noopener"
      title="Report a bug"
      aria-label="Report a bug"
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded border border-red-800 bg-red-950 px-2 text-xs font-semibold text-red-300 hover:border-red-600 hover:bg-red-900 hover:text-red-200 snug:w-7 snug:justify-center snug:px-0"
    >
      <Bug className="h-3.5 w-3.5" aria-hidden />
      <span className="snug:hidden">Report Bug</span>
    </a>
  );
}

/**
 * The donation link, dressed like its two labelled neighbours but in its own
 * colour. The word on the bar is just "Support": the app's name is already the
 * first thing on the same line, and this is the button that has to survive the
 * snug squeeze down to its heart.
 */
export function SupportButton() {
  return (
    <a
      href={KOFI_URL}
      target="_blank"
      rel="noreferrer noopener"
      title="Support on Ko-fi"
      aria-label="Support GTNH Planner on Ko-fi"
      data-umami-event="support-kofi"
      data-umami-event-source="header"
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded border border-pink-800 bg-pink-950 px-2 text-xs font-semibold text-pink-300 hover:border-pink-600 hover:bg-pink-900 hover:text-pink-200 snug:w-7 snug:justify-center snug:px-0"
    >
      <Heart className="h-3.5 w-3.5 fill-current" aria-hidden />
      <span className="snug:hidden">Support</span>
    </a>
  );
}

/**
 * The same three links as labelled rows, for the compact menu. Two brand marks
 * a phone can read at a glance are still two brand marks nobody can hover for a
 * tooltip, so up here they carry their names.
 */
export function MenuLinks({ onAction }: { onAction?: () => void }) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => {
          openWelcomeTab();
          onAction?.();
        }}
        className="flex h-10 items-center gap-2.5 rounded px-2 text-left text-sm text-fg-subtle hover:bg-surface-sunken"
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          <Compass className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="truncate">Welcome and tours</span>
      </button>
      <MenuLink href={GITHUB_URL} label="Source on GitHub">
        <GithubMark />
      </MenuLink>
      <MenuLink href={DISCORD_THREAD_URL} label="Discord thread">
        <DiscordMark />
      </MenuLink>
      <MenuLink
        href={KOFI_URL}
        label="Support GTNH Planner"
        tone="support"
        umamiEvent="support-kofi"
      >
        <Heart className="h-3.5 w-3.5 fill-current" aria-hidden />
      </MenuLink>
      <MenuLink href={BUG_REPORT_URL} label="Report a bug" tone="danger">
        <Bug className="h-3.5 w-3.5" aria-hidden />
      </MenuLink>
    </div>
  );
}

function MenuLink({
  href,
  label,
  tone,
  umamiEvent,
  children,
}: {
  href: string;
  label: string;
  tone?: "danger" | "support";
  /** Umami auto-tracks clicks on elements carrying this event name. */
  umamiEvent?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      data-umami-event={umamiEvent}
      data-umami-event-source={umamiEvent ? "menu" : undefined}
      className={[
        "flex h-10 items-center gap-2.5 rounded px-2 text-sm hover:bg-surface-sunken",
        tone === "danger" ? "text-red-300" : tone === "support" ? "text-pink-300" : "text-fg-subtle",
      ].join(" ")}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{children}</span>
      <span className="truncate">{label}</span>
    </a>
  );
}

function HeaderLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={label}
      aria-label={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded border border-line-strong bg-surface text-fg-subtle hover:bg-surface-raised hover:text-fg"
    >
      {children}
    </a>
  );
}

/* Brand marks are drawn inline: lucide dropped its brand icons, and these two
   are the logos people scan for rather than read, so a generic glyph would
   cost more than the markup does. */

function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className="h-3.5 w-3.5">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function DiscordMark() {
  return (
    <svg viewBox="0 0 127.14 96.36" fill="currentColor" aria-hidden className="h-3.5 w-3.5">
      <path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z" />
    </svg>
  );
}

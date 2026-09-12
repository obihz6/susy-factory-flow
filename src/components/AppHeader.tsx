"use client";

import "./app-chrome.css";

import { Settings } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { OPEN_SHARE_DIALOG_EVENT } from "@/lib/setups-tab";
import { useIsCompactViewport } from "@/lib/compact-view";
import {
  markNotesReadAndNotify,
  markVersionSeen,
  readLastSeenVersion,
  subscribeToNotesRead,
  unseenEntries,
} from "@/lib/whats-new";
import {
  PREVIEW_RELEASE_SPOTLIGHT_EVENT,
  RELEASE_SPOTLIGHTS,
  markSpotlightSeen,
  pickSpotlight,
  readSeenSpotlights,
  type ReleaseSpotlight as Spotlight,
} from "@/lib/release-spotlight";
import { ReleaseSpotlight } from "./ReleaseSpotlight";
import { ChangelogDialog } from "./ChangelogDialog";
import { APP_VERSION } from "@/lib/version";
import { AccountMenu } from "./community/AccountMenu";
import { SharePlanDialog } from "./community/SharePlanDialog";
import { AppIdentity } from "./AppIdentity";
import { DesignTabs } from "./DesignTabs";
import { AppMenu } from "./AppMenu";
import { BoardActions } from "./BoardActions";
import { ExportImageDialog } from "./export/ExportImageDialog";
import { DevMenu } from "./DevMenu";
import { SettingsDialog } from "./SettingsDialog";
import { HeaderLinks, SupportButton } from "./HeaderLinks";

/** The dataset version selector is part of the planner's main controls. */
export const SHOW_PACK_PICKER = true;

interface AppHeaderProps {
  onLoadDatasetVersion: (versionId: string) => void;
}

/**
 * The one top bar for the whole app: title, version chip, game version, board
 * actions, account. The old Community page folded into the sidebar's Setups
 * tab, so there is no page switch up here anymore.
 */
export function AppHeader({ onLoadDatasetVersion }: AppHeaderProps) {
  // The chip wears a dot while a shipped release has notes this browser has
  // not opened. Its own stamp, not the release notice's — see whats-new.ts.
  const hasUnread = useSyncExternalStore(
    subscribeToNotesRead,
    () => unseenEntries().length > 0,
    () => false,
  );
  // Captured at the moment of the click, because opening the notes marks them
  // read: without this the sheet would have nothing above its divider.
  const [unseenVersions, setUnseenVersions] = useState<Set<string>>();
  const [isChangelogOpen, setChangelogOpen] = useState(false);
  // Shift-click the version chip. See DevMenu.
  const [isDevMenuOpen, setDevMenuOpen] = useState(false);
  // The release POSTER: the one thing allowed to arrive by itself, and only
  // for a release that was written one (release-spotlight.ts). Decided in an
  // effect, not during render, because the answer is in localStorage.
  const [spotlight, setSpotlight] = useState<Spotlight>();
  useEffect(() => {
    const due = pickSpotlight({
      lastSeenVersion: readLastSeenVersion(),
      seen: readSeenSpotlights(),
      appVersion: APP_VERSION,
    });
    setSpotlight(due);
    // Stamping is what tells the NEXT release that this browser has been here
    // before. It is not what the chip's dot reads — that has its own stamp,
    // written only by opening the notes, or this load would put it out before
    // anyone saw it. It waits while a notice is due, though: a notice is spent when
    // it is CLOSED, not when it is rendered, so somebody who reloads before
    // reading it gets it again. Closing files it in the seen list instead.
    if (!due) {
      markVersionSeen();
    }
  }, []);
  // The dev menu previews it without touching what this browser has seen.
  const [preview, setPreview] = useState<Spotlight>();
  useEffect(() => {
    const open = (event: Event) => {
      const version = (event as CustomEvent<string | undefined>).detail;
      setPreview(
        (version ? RELEASE_SPOTLIGHTS.find((entry) => entry.version === version) : undefined) ??
          RELEASE_SPOTLIGHTS[0],
      );
    };
    window.addEventListener(PREVIEW_RELEASE_SPOTLIGHT_EVENT, open);
    return () => window.removeEventListener(PREVIEW_RELEASE_SPOTLIGHT_EVENT, open);
  }, []);
  const shownSpotlight = preview ?? spotlight;
  const closeSpotlight = () => {
    if (preview) {
      setPreview(undefined);
      return;
    }
    if (spotlight) {
      markSpotlightSeen(spotlight.version);
      setSpotlight(undefined);
    }
  };
  // The share dialog lives up here rather than in BoardActions so the compact
  // menu can close behind it without unmounting it. The export dialog for the
  // same reason.
  const [isShareOpen, setShareOpen] = useState(false);
  const [isExportOpen, setExportOpen] = useState(false);
  // The shelf asks for the share dialog by event after putting a design on
  // the canvas ("Update post"): same dialog, same board, no second copy.
  useEffect(() => {
    const open = () => setShareOpen(true);
    window.addEventListener(OPEN_SHARE_DIALOG_EVENT, open);
    return () => window.removeEventListener(OPEN_SHARE_DIALOG_EVENT, open);
  }, []);
  // Settings lives up here for the same reason as the share dialog: the
  // compact menu closes behind it without unmounting it.
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  // Narrow windows keep the name and the version chip and fold the rest into
  // one menu — see AppMenu for why a bar that overflows costs a phone more than
  // the buttons that fall off the end of it.
  const isCompact = useIsCompactViewport();

  return (
    <header className="app-header relative flex h-[30px] shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-3 compact:h-auto compact:flex-wrap compact:gap-y-0">
      <h1 className="flex min-w-0 items-center gap-2 text-sm font-bold tracking-tight">
        <span className="shrink-0">
          SuSy <span className="text-cyan-500">Planner</span>
        </span>
        {/* THE CHIP OPENS THE NOTES AGAIN (Jack, 2026-09-09): players went
            looking for what's new and found nothing to press. The release
            NOTICE still arrives once on its own and says the headline; this
            is the way back to the whole history afterwards, and to a release
            somebody skipped. Shift-click is still the way in to the DEV
            MENU. */}
        <button
          type="button"
          onClick={(event) => {
            if (event.shiftKey) {
              setDevMenuOpen(true);
              return;
            }
            // Read what is unread BEFORE stamping, or the sheet opens with
            // nothing above its divider. Opening it IS reading it, so the dot
            // goes now rather than on close.
            setUnseenVersions(new Set(unseenEntries().map((entry) => entry.version)));
            markNotesReadAndNotify();
            setChangelogOpen(true);
          }}
          title="What's new"
          aria-label={`Version ${APP_VERSION}: see what's new`}
          className="relative shrink-0 rounded border border-line px-1 py-px text-[10px] font-semibold leading-none text-fg-muted tabular-nums hover:border-cyan-600 hover:text-cyan-500"
        >
          v{APP_VERSION}
          {hasUnread ? (
            <span
              aria-label="Unread release notes"
              className="absolute -right-1 -top-1 h-2 w-2 rounded-full border border-surface bg-cyan-400"
            />
          ) : null}
        </button>
        {/* The pack picker rides up here beside the app version rather than at
            the head of the browser column. Two versions that are easy to
            confuse now sit together and read as a pair, and the column below
            gets a whole row of its height back. On a phone it moves once more,
            into the menu: it is the widest control on the bar and the one people
            touch least. */}
        {/* Keep the dataset version selector visible so users can switch
            between published and experimental planner datasets. */}
        {isCompact || !SHOW_PACK_PICKER ? null : (
          <>
            <span className="ml-3 h-3.5 w-px bg-line" aria-hidden />
            <AppIdentity onLoadDatasetVersion={onLoadDatasetVersion} />
          </>
        )}
      </h1>
      <div className="app-header-tabs min-w-0 flex-1 compact:order-last compact:basis-full">
        <DesignTabs />
      </div>
      {shownSpotlight ? (
        <ReleaseSpotlight spotlight={shownSpotlight} onClose={closeSpotlight} />
      ) : null}
      {isChangelogOpen ? (
        <ChangelogDialog unseenVersions={unseenVersions} onClose={() => setChangelogOpen(false)} />
      ) : null}
      {isDevMenuOpen ? <DevMenu onClose={() => setDevMenuOpen(false)} /> : null}
      {isShareOpen ? <SharePlanDialog onClose={() => setShareOpen(false)} /> : null}
      {isExportOpen ? <ExportImageDialog onClose={() => setExportOpen(false)} /> : null}
      {isSettingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
      {isCompact ? (
        <AppMenu
          onLoadDatasetVersion={onLoadDatasetVersion}
          onShare={() => setShareOpen(true)}
          onExportImage={() => setExportOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : (
        // The global `font: inherit` reset outranks any text-* on a button, so
        // the cluster sets the one size every control in it renders at.
        <div className="app-header-tools flex shrink-0 items-center gap-3 text-xs">
          <BoardActions
            onShare={() => setShareOpen(true)}
            onExportImage={() => setExportOpen(true)}
          />
          {/* Dressed like the compass and the brand links: settings is a
              utility square, not one of the coloured calls to action. */}
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Open settings"
            className="inline-flex h-5 w-5 items-center justify-center rounded border border-line-strong bg-surface text-fg-subtle hover:bg-surface-raised hover:text-fg"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
          <SupportButton />
          <HeaderLinks />
          {/* No What's new button up here since 2026-09-06: the version chip
              at the other end of the bar opens the same notes and wears the
              unread dot, and the bar was two labelled buttons too wide. */}
          <AccountMenu />
        </div>
      )}
    </header>
  );
}

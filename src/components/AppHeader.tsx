"use client";

import { useState } from "react";
import { useIsCompactViewport } from "@/lib/compact-view";
import { unseenEntries } from "@/lib/whats-new";
import { APP_VERSION } from "@/lib/version";
import { AccountMenu } from "./community/AccountMenu";
import { SharePlanDialog } from "./community/SharePlanDialog";
import { AppIdentity } from "./AppIdentity";
import { AppMenu } from "./AppMenu";
import { BoardActions } from "./BoardActions";
import { ExportImageDialog } from "./export/ExportImageDialog";
import { ChangelogDialog } from "./ChangelogDialog";
import { HeaderLinks, ReportBugButton, SupportButton, WhatsNewButton } from "./HeaderLinks";
import { WhatsNewPreview } from "./WhatsNewPreview";

interface AppHeaderProps {
  onLoadDatasetVersion: (versionId: string) => void;
}

/**
 * The one top bar for the whole app: title, version chip, game version, board
 * actions, account. The old Community page folded into the sidebar's Setups
 * tab, so there is no page switch up here anymore.
 */
export function AppHeader({ onLoadDatasetVersion }: AppHeaderProps) {
  const [isChangelogOpen, setChangelogOpen] = useState(false);
  // Captured at the moment of the click, because opening the notes marks them
  // read: without this the divider would have nothing above it.
  const [unseenVersions, setUnseenVersions] = useState<Set<string>>();
  // Shift-click either what's-new control. See WhatsNewPreview.
  const [isPreviewOpen, setPreviewOpen] = useState(false);
  // The share dialog lives up here rather than in BoardActions so the compact
  // menu can close behind it without unmounting it. The export dialog for the
  // same reason.
  const [isShareOpen, setShareOpen] = useState(false);
  const [isExportOpen, setExportOpen] = useState(false);
  // Narrow windows keep the name and the version chip and fold the rest into
  // one menu — see AppMenu for why a bar that overflows costs a phone more than
  // the buttons that fall off the end of it.
  const isCompact = useIsCompactViewport();

  return (
    <header className="relative flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-3 py-1.5">
      <h1 className="flex min-w-0 items-center gap-2 text-sm font-bold tracking-tight">
        <span className="shrink-0">
          GTNH <span className="text-cyan-500">Planner</span>
        </span>
        <button
          type="button"
          onClick={(event) => {
            // Shift-click is the way in to the update-popup preview. Undiscovered
            // by accident, and the ordinary click is unchanged.
            if (event.shiftKey) {
              setPreviewOpen(true);
              return;
            }
            setUnseenVersions(new Set(unseenEntries().map((entry) => entry.version)));
            setChangelogOpen(true);
          }}
          title="What's new"
          aria-label={`Version ${APP_VERSION}: see what's new`}
          className="shrink-0 rounded border border-line px-1 py-px text-[10px] font-semibold leading-none text-fg-muted tabular-nums hover:border-cyan-600 hover:text-cyan-500"
        >
          v{APP_VERSION}
        </button>
        {/* The pack picker rides up here beside the app version rather than at
            the head of the browser column. Two versions that are easy to
            confuse now sit together and read as a pair, and the column below
            gets a whole row of its height back. On a phone it moves once more,
            into the menu: it is the widest control on the bar and the one people
            touch least. */}
        {isCompact ? null : (
          <>
            <span className="ml-3 h-5 w-px bg-line" aria-hidden />
            <AppIdentity onLoadDatasetVersion={onLoadDatasetVersion} />
          </>
        )}
      </h1>
      {isChangelogOpen ? (
        <ChangelogDialog
          unseenVersions={unseenVersions}
          onClose={() => setChangelogOpen(false)}
        />
      ) : null}
      {isPreviewOpen ? <WhatsNewPreview onClose={() => setPreviewOpen(false)} /> : null}
      {isShareOpen ? <SharePlanDialog onClose={() => setShareOpen(false)} /> : null}
      {isExportOpen ? <ExportImageDialog onClose={() => setExportOpen(false)} /> : null}
      {isCompact ? (
        <AppMenu
          onLoadDatasetVersion={onLoadDatasetVersion}
          onShare={() => setShareOpen(true)}
          onExportImage={() => setExportOpen(true)}
        />
      ) : (
        // The global `font: inherit` reset outranks any text-* on a button, so
        // the cluster sets the one size every control in it renders at.
        <div className="flex items-center gap-2 text-xs">
          <HeaderLinks />
          <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
          <BoardActions
            onShare={() => setShareOpen(true)}
            onExportImage={() => setExportOpen(true)}
          />
          <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
          <SupportButton />
          <WhatsNewButton
            onClick={(unseen) => {
              setUnseenVersions(unseen);
              setChangelogOpen(true);
            }}
            onDevPreview={() => setPreviewOpen(true)}
          />
          <ReportBugButton />
          <AccountMenu />
        </div>
      )}
    </header>
  );
}

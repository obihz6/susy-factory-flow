"use client";

import {
  ArrowBigUp,
  Check,
  ChevronDown,
  ChevronUp,
  Link2,
  LoaderCircle,
  RotateCcw,
  Save,
  Share2,
  Unlink,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  downloadCommunityPlan,
  getCommunityPlan,
  patchCommunityPlan,
  tagPlanWithCommunityId,
  voteCommunityPlan,
} from "@/lib/community/client";
import { planContentFingerprint } from "@/lib/community/plan-fingerprint";
import { computeCommunityPlanStats } from "@/lib/community/plan-stats";
import { noteSharedPlanGone, sharedPlanLink } from "@/lib/community/shared-link";
import type { CommunityPlanSummary } from "@/lib/community/types";
import { parseFactoryProjectJson } from "@/lib/import-export";
import { notifySetupsChanged } from "@/lib/setups-tab";
import { useDesignStore } from "@/store/design-store";
import { useFactoryStore } from "@/store/factory-store";
import { SharePlanDialog } from "@/components/community/SharePlanDialog";
import { EntryIconSlot, IconPicker, iconSuggestionsFromStats } from "@/components/IconPicker";
import { formatRelativeDate } from "@/components/shelf-cards";

/**
 * The plan bar: one permanent slim row under the board carrying the plan's
 * face - icon, name, blurb - and, when the plan is linked to a community
 * post, that post's life: author, dates, votes, and the way back to the
 * posted version.
 *
 * Everything edits IN PLACE and edits YOUR copy, whoever wrote the original:
 * the icon is a button, the name is an inline field (it is the tab's name -
 * every save stamps the tab's name over the plan, so renaming here IS a tab
 * rename), and the blurb sits behind the one chevron because a textarea is
 * the only thing that cannot live on a 36px bar. Post actions ride the right
 * end: vote, link, save-to-post for the owner, post-as-your-own for anyone
 * else, reset while the board has drifted.
 */

const OPEN_STORAGE_KEY = "gtnh-factory-flow.plan-card-open.v1";

/** The header-family square button the bar is made of. */
const BAR_BUTTON =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-line-strong bg-surface text-fg-subtle hover:bg-surface-raised disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-sunken disabled:text-fg-muted";

export function PlanIdentityDrawer() {
  const project = useFactoryStore((state) => state.project);
  const lastResult = useFactoryStore((state) => state.lastResult);
  const setProjectIdentity = useFactoryStore((state) => state.setProjectIdentity);

  // Closed until the browser says otherwise. Read in an effect rather than in
  // the initializer so the server-rendered bar matches the first client paint.
  const [isOpen, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(OPEN_STORAGE_KEY) === "1");
    } catch {
      // Blocked storage just means the blurb starts folded every visit.
    }
  }, []);
  const toggleOpen = () => {
    setOpen((open) => {
      try {
        window.localStorage.setItem(OPEN_STORAGE_KEY, open ? "0" : "1");
      } catch {
        // Same: the toggle still works for the session.
      }
      return !open;
    });
  };

  // The name is the design tab's name, committed as a tab rename - once, on
  // blur or Enter, never per keystroke. An emptied field snaps back.
  const activeDesignId = useDesignStore((state) => state.activeDesignId);
  const renameDesign = useDesignStore((state) => state.renameDesign);
  const [nameDraft, setNameDraft] = useState<string>();
  const commitName = () => {
    const next = nameDraft?.trim();
    setNameDraft(undefined);
    if (next && next !== project.name && activeDesignId) {
      void renameDesign(activeDesignId, next);
    }
  };
  const [isPickingIcon, setPickingIcon] = useState(false);

  // The blurb commits on a short debounce (plus blur), not per keystroke:
  // everything subscribed to the project re-renders per commit, and typing
  // deserves better than a board-wide render per letter.
  const [descriptionDraft, setDescriptionDraft] = useState<string>();
  const descriptionTimer = useRef<number | undefined>(undefined);
  const commitDescription = (value: string) => {
    window.clearTimeout(descriptionTimer.current);
    setProjectIdentity({ description: value });
    setDescriptionDraft(undefined);
  };
  useEffect(() => () => window.clearTimeout(descriptionTimer.current), []);

  const stats = useMemo(
    () => computeCommunityPlanStats(project, lastResult),
    [project, lastResult],
  );

  const linkedPlanId = project.metadata?.communityPlanId;
  // The unlinked plan's way onto the network, right where its face is. Once
  // linked, the strip carries its own Share in the same rightmost spot.
  const [isSharing, setSharing] = useState(false);

  return (
    // min-w-0 matters: the board column's grid sizes its one track to its
    // items, and a bar whose min-content is the full meta text would widen
    // the whole column under the inspector. The bar takes the width the
    // board gets, never the other way round.
    <section
      data-help-anchor="plan-card"
      className="min-w-0 shrink-0 border-t border-line bg-surface"
    >
      <div className="flex h-9 min-w-0 items-center gap-1.5 px-1.5">
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={isOpen}
          title={isOpen ? "Fold the description away" : "This plan's description"}
          aria-label={isOpen ? "Fold the plan description away" : "Open the plan description"}
          className={BAR_BUTTON}
        >
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>
        <EntryIconSlot
          icon={project.icon}
          editable
          onEdit={() => setPickingIcon(true)}
          className="!h-7 !w-7 shrink-0 border border-line-strong bg-surface-sunken"
        />
        <input
          value={nameDraft ?? project.name}
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          maxLength={80}
          aria-label="Plan name"
          title="Plan name"
          className="h-7 min-w-16 flex-1 rounded border border-transparent bg-transparent px-1.5 text-sm font-medium text-fg outline-none hover:border-line focus:border-line-strong focus:bg-surface-sunken"
        />
        {linkedPlanId ? (
          <LinkedPostStrip key={linkedPlanId} planId={linkedPlanId} />
        ) : (
          <button
            type="button"
            onClick={() => setSharing(true)}
            disabled={project.nodes.length === 0}
            title={project.nodes.length === 0 ? "Share: build something first" : "Share"}
            aria-label="Share this setup"
            className={BAR_BUTTON}
          >
            <Share2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {isSharing ? <SharePlanDialog onClose={() => setSharing(false)} /> : null}

      {isOpen ? (
        <div className="border-t border-line p-1.5">
          <textarea
            value={descriptionDraft ?? project.description ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              setDescriptionDraft(value);
              window.clearTimeout(descriptionTimer.current);
              descriptionTimer.current = window.setTimeout(() => commitDescription(value), 400);
            }}
            onBlur={(event) => commitDescription(event.target.value)}
            maxLength={2000}
            rows={2}
            placeholder="What does it make? Any setup notes? Sharing posts this with the plan."
            aria-label="Plan description"
            className="w-full resize-y rounded border border-line-strong bg-surface-sunken px-2 py-1.5 text-xs"
          />
        </div>
      ) : null}

      {isPickingIcon ? (
        <IconPicker
          title="Pick this plan's icon"
          suggestions={iconSuggestionsFromStats(stats.needs, stats.outputs)}
          onPick={(picked) => {
            setProjectIdentity({ icon: picked });
            setPickingIcon(false);
          }}
          onClear={
            project.icon
              ? () => {
                  setProjectIdentity({ icon: null });
                  setPickingIcon(false);
                }
              : undefined
          }
          onClose={() => setPickingIcon(false)}
        />
      ) : null}
    </section>
  );
}

/**
 * The post's life on the right end of the bar: quiet meta, then the action
 * buttons. Mounted only while the plan carries a link, keyed by it, so the
 * summary fetch and the fingerprint math track the link and nothing else.
 */
function LinkedPostStrip({ planId }: { planId: string }) {
  const project = useFactoryStore((state) => state.project);
  const setProject = useFactoryStore((state) => state.setProject);
  const frameBoardNodes = useFactoryStore((state) => state.frameBoardNodes);
  const setProjectIdentity = useFactoryStore((state) => state.setProjectIdentity);
  const clearProjectCommunityLink = useFactoryStore((state) => state.clearProjectCommunityLink);

  const [post, setPost] = useState<CommunityPlanSummary>();
  const [loadState, setLoadState] = useState<"loading" | "ready" | "gone" | "error">("loading");
  const [busy, setBusy] = useState<"reset" | "save" | "vote">();
  const [actionError, setActionError] = useState<string>();
  const [isLinkCopied, setLinkCopied] = useState(false);
  const [isSharingAsOwn, setSharingAsOwn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // A background lookup, not a reader opening the post: no view counted.
    void getCommunityPlan(planId, { countView: false }).then(
      (summary) => {
        if (!cancelled) {
          setPost(summary);
          setLoadState("ready");
        }
      },
      (error: unknown) => {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : "";
        if (/not found/i.test(message)) {
          setLoadState("gone");
          // The address bar must not go on advertising a dead link.
          noteSharedPlanGone(planId);
        } else {
          setLoadState("error");
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [planId]);

  // A copy downloaded before plans carried their own face adopts the post's:
  // one set of fields, directly editable, whoever wrote them first.
  const adoptedRef = useRef(false);
  useEffect(() => {
    if (!post || adoptedRef.current) {
      return;
    }
    adoptedRef.current = true;
    const adopted: Parameters<typeof setProjectIdentity>[0] = {};
    if (!project.description && post.description) {
      adopted.description = post.description;
    }
    if (!project.icon && post.icon) {
      adopted.icon = post.icon;
    }
    if (adopted.description !== undefined || adopted.icon !== undefined) {
      setProjectIdentity(adopted);
    }
    // The plan's own fields win once they exist; this only fills silence.
  }, [post, project.description, project.icon, setProjectIdentity]);

  // What the board IS right now, against what it was when board and post
  // last agreed. A copy from before fingerprints existed has no baseline and
  // keeps reset offered, because "unchanged" cannot be proven.
  const boardFingerprint = useMemo(() => planContentFingerprint(project), [project]);
  const baseline = project.metadata?.communityFingerprint;
  const isUnchanged = Boolean(baseline) && baseline === boardFingerprint;

  const runAction = async (kind: "reset" | "save" | "vote", action: () => Promise<void>) => {
    setBusy(kind);
    setActionError(undefined);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "That did not go through.");
    } finally {
      setBusy(undefined);
    }
  };

  const reset = () =>
    runAction("reset", async () => {
      if (
        !window.confirm(
          `Put the posted version of "${post?.name ?? project.name}" back on this board? ` +
            "Your changes here will be lost, and this cannot be undone.",
        )
      ) {
        return;
      }
      const { plan } = await downloadCommunityPlan(planId);
      setProject(parseFactoryProjectJson(JSON.stringify(tagPlanWithCommunityId(plan, planId))));
      frameBoardNodes();
    });

  const saveDetails = () =>
    runAction("save", async () => {
      await patchCommunityPlan(planId, {
        name: project.name,
        description: project.description ?? "",
        icon: project.icon ?? null,
      });
      setPost((current) =>
        current
          ? {
              ...current,
              name: project.name,
              description: project.description ?? "",
              icon: project.icon,
              updatedAt: new Date().toISOString(),
            }
          : current,
      );
      notifySetupsChanged();
    });

  const vote = () =>
    runAction("vote", async () => {
      const response = await voteCommunityPlan(planId, 1);
      setPost((current) =>
        current
          ? {
              ...current,
              upvotes: response.upvotes,
              downvotes: response.downvotes,
              score: response.score,
              myVote: response.myVote,
            }
          : current,
      );
    });

  const copyLink = async () => {
    const url = sharedPlanLink(planId);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this link:", url);
      return;
    }
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 1500);
  };

  if (loadState === "loading") {
    return <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-fg-muted" />;
  }

  if (loadState === "gone") {
    return (
      <>
        <span className="shrink-0 text-[11px] text-fg-muted compact:hidden">
          The post this came from is gone
        </span>
        <button
          type="button"
          onClick={clearProjectCommunityLink}
          title="Detach from the post"
          aria-label="Detach this plan from its deleted post"
          className={BAR_BUTTON}
        >
          <Unlink className="h-3.5 w-3.5" />
        </button>
      </>
    );
  }

  if (loadState === "error" || !post) {
    return null;
  }

  const wasEdited =
    post.updatedAt &&
    new Date(post.updatedAt).getTime() - new Date(post.createdAt).getTime() > 60_000;
  const meta = [
    post.isMine ? "your post" : post.authorName ? `by ${post.authorName}` : undefined,
    `posted ${formatRelativeDate(post.createdAt)}`,
    wasEdited && post.updatedAt ? `edited ${formatRelativeDate(post.updatedAt)}` : undefined,
    `${post.downloads} downloads`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <span
        title={actionError ?? meta}
        className={[
          "min-w-0 shrink-[2] truncate text-[11px] compact:hidden",
          actionError ? "text-red-500" : "text-fg-muted",
        ].join(" ")}
      >
        {actionError ?? meta}
      </span>
      <button
        type="button"
        onClick={() => void vote()}
        disabled={busy === "vote"}
        title={post.myVote === 1 ? "You voted this setup up" : "Vote this setup up"}
        className={[
          "inline-flex h-7 shrink-0 items-center gap-0.5 rounded border px-1.5 text-xs tabular-nums",
          post.myVote === 1
            ? "border-emerald-600 text-emerald-500"
            : "border-line-strong bg-surface text-fg-subtle hover:bg-surface-raised",
        ].join(" ")}
      >
        <ArrowBigUp className="h-3.5 w-3.5" /> {post.score}
      </button>
      <button
        type="button"
        onClick={() => void copyLink()}
        title="Copy link"
        aria-label="Copy the link to this post"
        className={BAR_BUTTON}
      >
        {isLinkCopied ? (
          <Check className="h-3.5 w-3.5 text-emerald-500" />
        ) : (
          <Link2 className="h-3.5 w-3.5" />
        )}
      </button>
      {post.isMine ? (
        <button
          type="button"
          onClick={() => void saveDetails()}
          disabled={busy === "save"}
          title="Save to the post"
          aria-label="Save the plan's name, icon and description to your post"
          className={BAR_BUTTON}
        >
          {busy === "save" ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => void reset()}
        disabled={isUnchanged || busy === "reset"}
        title={
          isUnchanged
            ? "The board still matches the post: nothing to reset"
            : "Replace this board with the posted version"
        }
        aria-label="Reset this board to the posted version"
        className={BAR_BUTTON}
      >
        {busy === "reset" ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RotateCcw className="h-3.5 w-3.5" />
        )}
      </button>
      {/* Same dialog as the top bar's Share, in the bar's rightmost spot. On
          your own post it offers update-or-post-anew; on someone else's the
          only thing it CAN do is a new post of your own, wearing this bar's
          name, icon and description - and posting relinks the plan to it. */}
      <button
        type="button"
        onClick={() => setSharingAsOwn(true)}
        title={post.isMine ? "Share" : "Post as your own"}
        aria-label={
          post.isMine ? "Share this setup" : "Post this board as your own setup"
        }
        className={BAR_BUTTON}
      >
        <Share2 className="h-3.5 w-3.5" />
      </button>
      {isSharingAsOwn ? <SharePlanDialog onClose={() => setSharingAsOwn(false)} /> : null}
    </>
  );
}

"use client";

import { Check, Link2, LoaderCircle, Share2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { normalizeBlueprintTags } from "@/lib/blueprints/types";
import {
  listCommunityPlans,
  updateCommunityPlan,
  uploadCommunityPlan,
  uploadPlanPreview,
} from "@/lib/community/client";
import { computeCommunityPlanStats } from "@/lib/community/plan-stats";
import { capturePlanPreviewPng } from "@/lib/community/plan-preview-capture";
import { sharedPlanLink } from "@/lib/community/shared-link";
import type { CommunityPlanSummary, EntryIcon } from "@/lib/community/types";
import { serializeFactoryProject } from "@/lib/import-export";
import { capturePlanView } from "@/lib/plan-view";
import { notifySetupsChanged, openSetupsTab } from "@/lib/setups-tab";
import { useFactoryStore } from "@/store/factory-store";
import { useDesignStore } from "@/store/design-store";
import { EntryIconSlot, IconPicker, iconSuggestionsFromStats } from "@/components/IconPicker";
import { renderIoStats, TierBadge } from "@/components/shelf-cards";
import { AuthForm, useCommunityUser } from "./auth";

/**
 * Posting the open tab to the network. The dialog leads with WHAT is being
 * posted (the tab, its headline numbers), then the post's face: icon, name,
 * description, tags. Updating a linked post keeps its votes and downloads.
 */
export function SharePlanDialog({ onClose }: { onClose: () => void }) {
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const manifest = useFactoryStore((state) => state.datasetManifest);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const setProjectCommunityLink = useFactoryStore((state) => state.setProjectCommunityLink);
  const setProjectIdentity = useFactoryStore((state) => state.setProjectIdentity);
  const activeTabName = useDesignStore(
    (state) =>
      state.designs.find((design) => design.id === state.activeDesignId)?.name ?? "Untitled",
  );
  const { user, isLoading: isUserLoading, setUser } = useCommunityUser();

  // The plan's own face comes first: whatever the plan card already says is
  // what the post should say, and the fields here are one last look at it.
  const [name, setName] = useState(project.name || activeTabName || "My factory");
  const [description, setDescription] = useState(project.description ?? "");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [icon, setIcon] = useState<EntryIcon | undefined>(project.icon);
  const [isPickingIcon, setPickingIcon] = useState(false);
  const [myPostsFor, setMyPostsFor] = useState<{
    username: string;
    posts: CommunityPlanSummary[];
  }>();
  const [postAsNew, setPostAsNew] = useState(false);
  const myPosts = user && myPostsFor?.username === user.username ? myPostsFor.posts : [];
  // The design remembers which post it was shared as / imported from; Share
  // only ever targets that one post (or creates a new one).
  const linkedPost = myPosts.find((post) => post.id === project.metadata?.communityPlanId);
  const updateTargetId = linkedPost && !postAsNew ? linkedPost.id : "";
  const [isUploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const [shared, setShared] = useState<{ kind: "created" | "updated"; planId: string }>();
  const [isLinkCopied, setLinkCopied] = useState(false);

  const stats = useMemo(() => computeCommunityPlanStats(project, result), [project, result]);
  const datasetVersion = manifest?.versions.find(
    (version) => version.id === selectedDatasetVersionId,
  );

  // Once signed in, load the user's existing posts so they can update one.
  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;
    void listCommunityPlans({ mine: true, pageSize: 48 }).then(
      (response) => {
        if (!cancelled) {
          setMyPostsFor({ username: user.username, posts: response.plans });
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Updating an existing post starts from its current face. Seeded the moment
  // the linked post arrives (adjust-during-render, so the user's later edits
  // are never overwritten), and the post only fills what the plan's own
  // fields left blank: updating a post must never blank its description just
  // because nobody retyped it.
  const [seededPostId, setSeededPostId] = useState<string>();
  if (linkedPost && seededPostId !== linkedPost.id) {
    setSeededPostId(linkedPost.id);
    setTags(linkedPost.tags ?? []);
    if (!project.icon) {
      setIcon(linkedPost.icon);
    }
    if (!project.description && linkedPost.description) {
      setDescription(linkedPost.description);
    }
  }

  const addTagFromInput = () => {
    const next = normalizeBlueprintTags([...tags, tagInput]);
    setTags(next);
    setTagInput("");
    return next;
  };

  const share = async () => {
    setUploading(true);
    setError(undefined);
    try {
      // Photograph the board while the plan uploads: the picture is what the
      // share link unfurls into in a chat. Best-effort — a failed photo must
      // never fail the post.
      const previewPromise = capturePlanPreviewPng();
      // Whatever is still sitting in the tag input counts as one last tag.
      const finalTags = tagInput.trim() ? addTagFromInput() : tags;
      const payload = {
        name,
        description,
        gameVersion: datasetVersion?.gtnhVersion ?? "",
        datasetVersionId: selectedDatasetVersionId ?? "",
        // The workspace goes with the plan: the author arranged the board and
        // the resource panel to make this build readable, and that arrangement
        // is part of what they are sharing. Captured at the moment of sharing
        // rather than carried on the project, so it can never leak into the
        // designs they are only working on.
        plan: JSON.parse(
          serializeFactoryProject({ ...project, view: capturePlanView() }),
        ) as unknown,
        tags: finalTags,
        icon,
      };

      let sharedPlanId: string;
      if (updateTargetId) {
        await updateCommunityPlan(updateTargetId, payload);
        setShared({ kind: "updated", planId: updateTargetId });
        setProjectCommunityLink(updateTargetId);
        sharedPlanId = updateTargetId;
      } else {
        const { id } = await uploadCommunityPlan(payload);
        setShared({ kind: "created", planId: id });
        setProjectCommunityLink(id);
        sharedPlanId = id;
      }

      const preview = await previewPromise;
      if (preview) {
        await uploadPlanPreview(sharedPlanId, preview).catch(() => undefined);
      }
      // The face the post just went out wearing becomes the plan's own, so
      // the plan card and the next share both start from it. Not the name:
      // the post's name and the tab's name are allowed to differ, and the
      // tab stamps its own name back over the plan on every save anyway.
      setProjectIdentity({ description, icon: icon ?? null });
      notifySetupsChanged();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Sharing failed.");
    } finally {
      setUploading(false);
    }
  };

  const copyShareLink = async () => {
    if (!shared) {
      return;
    }

    const url = sharedPlanLink(shared.planId);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this link:", url);
      return;
    }

    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-neutral-950/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-y-auto rounded border border-line-strong bg-surface p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Share2 className="h-4 w-4" /> Share your setup
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-fg-subtle hover:bg-surface-raised"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {shared ? (
          <div className="space-y-3">
            <p className="text-sm">
              {shared.kind === "updated"
                ? "Your post has been updated."
                : "Your setup is live."}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copyShareLink()}
                title="Share link"
                className="inline-flex items-center gap-1.5 rounded border border-line-strong px-3 py-1.5 text-sm hover:bg-surface-raised"
              >
                {isLinkCopied ? (
                  <Check className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
                Copy link
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                openSetupsTab();
              }}
              className="inline-flex rounded border border-cyan-700 bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500"
            >
              See it on the Setups shelf
            </button>
          </div>
        ) : isUserLoading ? (
          <div className="grid place-items-center py-8 text-fg-muted">
            <LoaderCircle className="h-5 w-5 animate-spin" />
          </div>
        ) : !user ? (
          <div className="space-y-3">
            <p className="text-sm text-fg-subtle">
              Sharing needs an account so your posts stay yours: just a username and password.
            </p>
            <AuthForm onSignedIn={setUser} />
          </div>
        ) : (
          <div className="space-y-3">
            {/* A board that never met the auto-arrange goes out exactly as
                messy as it looks right now, and the post wears it forever.
                One quiet nudge, only while the board looks untouched. */}
            {!(project.annotations ?? []).some((annotation) =>
              annotation.id.startsWith("auto-island-box"),
            ) && project.nodes.length >= 6 ? (
              <div className="rounded border border-cyan-700/60 bg-cyan-950/30 p-2 text-xs text-fg-subtle">
                Tip: the post shows your board exactly as it is. The auto-arrange
                button on the board lays it out cleanly in one press, and an icon
                gives the post a face.
              </div>
            ) : null}
            {/* What the board carries: the headline numbers with the tier
                in its GT colour, then the real resource lists side by
                side. No sentence needed — the dialog IS the open tab. */}
            <div className="rounded border border-line bg-surface-raised p-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs tabular-nums text-fg-subtle">
                <span>
                  <span className="font-semibold text-fg">{stats.nodeCount}</span> cards
                </span>
                <span>
                  <span className="font-semibold text-fg">{stats.machineCount}</span> machines
                </span>
                {stats.highestTier ? (
                  <span className="flex items-center gap-1.5">
                    up to <TierBadge tier={stats.highestTier} />
                  </span>
                ) : null}
                <span className="ml-auto text-fg-muted">
                  Game version:{" "}
                  <span className="text-fg-subtle">
                    {datasetVersion?.gtnhVersion
                      ? `GTNH ${datasetVersion.gtnhVersion}`
                      : "unknown"}
                  </span>
                </span>
              </div>
              <div className="mt-2 max-h-56 overflow-y-auto">
                {renderIoStats(stats.needs, stats.outputs, { layout: "side-by-side" }) ?? (
                  <p className="text-[11px] text-fg-muted">
                    Nothing comes in or leaves: this plan feeds itself.
                  </p>
                )}
              </div>
            </div>

            {linkedPost ? (
              <div className="rounded border border-line bg-surface-raised p-2 text-sm">
                <p className="mb-1.5 text-xs text-fg-subtle">
                  This tab is linked to your post &quot;{linkedPost.name}&quot;.
                </p>
                <div className="flex gap-3">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="share-target"
                      checked={!postAsNew}
                      onChange={() => setPostAsNew(false)}
                    />
                    Update that post
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="share-target"
                      checked={postAsNew}
                      onChange={() => setPostAsNew(true)}
                    />
                    Post as new
                  </label>
                </div>
              </div>
            ) : (
              <p className="text-xs text-fg-muted">
                Posting as <span className="font-semibold text-fg">{user.username}</span>
              </p>
            )}

            <div className="block text-sm">
              <span className="mb-1 block font-medium">Icon and name</span>
              <div className="flex items-center gap-2">
                <EntryIconSlot
                  icon={icon}
                  editable
                  onEdit={() => setPickingIcon(true)}
                  className="!h-9 !w-9 shrink-0 border border-line-strong bg-surface-sunken"
                />
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                  className="w-full min-w-0 rounded border border-line-strong bg-surface-sunken px-2 py-1.5"
                />
              </div>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Description (optional)</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="What does it make? Any setup notes?"
                className="w-full resize-y rounded border border-line-strong bg-surface-sunken px-2 py-1.5"
              />
            </label>
            <div className="block text-sm">
              <span className="mb-1 block font-medium">Tags (optional)</span>
              <div className="flex flex-wrap items-center gap-1 rounded border border-line-strong bg-surface-sunken px-2 py-1.5">
                {tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setTags(tags.filter((entry) => entry !== tag))}
                    title={`Remove #${tag}`}
                    className="rounded border border-line px-1.5 py-0.5 text-xs text-fg-subtle hover:border-red-500 hover:text-red-500"
                  >
                    #{tag} ×
                  </button>
                ))}
                <input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                      event.preventDefault();
                      addTagFromInput();
                    }
                  }}
                  placeholder={tags.length === 0 ? "platline, oil, early game..." : ""}
                  className="min-w-24 flex-1 bg-transparent text-sm outline-none"
                />
              </div>
            </div>

            {error ? <p className="text-sm text-red-500">{error}</p> : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-line-strong px-3 py-1.5 text-sm hover:bg-surface-raised"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void share()}
                disabled={isUploading || !name.trim() || project.nodes.length === 0}
                className="inline-flex items-center gap-2 rounded border border-cyan-700 bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isUploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                {updateTargetId ? `Update "${linkedPost?.name}"` : "Post this setup"}
              </button>
            </div>
          </div>
        )}
      </div>
      {isPickingIcon ? (
        <IconPicker
          title="Pick this setup's icon"
          suggestions={iconSuggestionsFromStats(stats.needs, stats.outputs)}
          onPick={(picked) => {
            setIcon(picked);
            setPickingIcon(false);
          }}
          onClear={
            icon
              ? () => {
                  setIcon(undefined);
                  setPickingIcon(false);
                }
              : undefined
          }
          onClose={() => setPickingIcon(false)}
        />
      ) : null}
    </div>
  );
}

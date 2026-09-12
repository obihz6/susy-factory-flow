"use client";

import {
  downloadCommunityPlan,
  getCommunityPlan,
  tagPlanWithCommunityId,
  untagCommunityPlan,
} from "@/lib/community/client";
import { parseFactoryProjectJson } from "@/lib/import-export";
import { applyPlanView } from "@/lib/plan-view";
import { useDesignStore } from "@/store/design-store";
import { useFactoryStore } from "@/store/factory-store";

/**
 * The one way a community post opens, from anywhere (a tile, a menu, the
 * Welcome page, a pasted link):
 *
 * - YOUR post is your design. If the design is in this library, it opens.
 *   If it is not (another browser, no account sync), it comes down as that
 *   design, linked, and the post follows it from then on.
 * - Someone else's post opens in a read-only viewing session. Only an explicit
 *   Open a copy creates a personal design, with no publishing connection.
 *
 * `isMine` is read from the summary when the caller has one; a bare id
 * (a pasted link) asks the server first.
 */
export async function openCommunityPost(plan: {
  id: string;
  name?: string;
  isMine?: boolean;
  authorName?: string;
}): Promise<"opened" | "viewed"> {
  const store = useDesignStore.getState();
  const existing = store.designs.find((design) => design.communityPlanId === plan.id);
  let isMine = plan.isMine;
  let name = plan.name;
  let authorName = plan.authorName;
  if (isMine === undefined) {
    // A background lookup: opening is what counts the view, and the
    // download below is that.
    const summary = await getCommunityPlan(plan.id, { countView: false });
    isMine = summary.isMine === true;
    name = name ?? summary.name;
    authorName = summary.authorName;
  }

  if (existing && isMine) {
    await store.switchToDesign(existing.id);
    return "opened";
  }

  const { plan: planJson, name: postName } = await downloadCommunityPlan(plan.id);
  const tagged = isMine ? tagPlanWithCommunityId(planJson, plan.id) : untagCommunityPlan(planJson);
  const project = parseFactoryProjectJson(JSON.stringify(tagged));
  if (!isMine) {
    if (!authorName) {
      const summary = await getCommunityPlan(plan.id, { countView: false });
      authorName = summary.authorName;
    }
    await useDesignStore
      .getState()
      .viewPublicProject(
        { id: plan.id, name: name || postName || project.name, authorName },
        project,
      );
    return "viewed";
  }
  // The post's name first: it is the one on the tile just clicked.
  await useDesignStore.getState().importProjectAsDesign(project, name || postName || project.name);
  applyPlanView(project.view);
  return "opened";
}

/** Copy directly from the library, without first opening a viewing session. */
export async function copyCommunityPost(post: { id: string; name?: string }): Promise<void> {
  const { plan, name } = await downloadCommunityPlan(post.id);
  const project = parseFactoryProjectJson(JSON.stringify(untagCommunityPlan(plan)));
  await useDesignStore.getState().importProjectAsDesign(project, post.name || name || project.name);
  applyPlanView(project.view);
}

/** A snapshot of the viewed post becomes a private, editable personal design. */
export async function copyViewedPost(): Promise<void> {
  const store = useDesignStore.getState();
  const view = store.publicView;
  if (!view) return;
  const project = parseFactoryProjectJson(
    JSON.stringify(untagCommunityPlan(useFactoryStore.getState().project)),
  );
  await store.importProjectAsDesign(project, view.name);
}

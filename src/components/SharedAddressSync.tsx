"use client";

import { useEffect } from "react";
import { readSharedPlanId, syncSharedPlanAddress } from "@/lib/community/shared-link";
import { useWelcomeTab } from "@/lib/welcome/welcome-tab";
import { useFactoryStore } from "@/store/factory-store";
import { useDesignStore } from "@/store/design-store";

/**
 * Keeps the address bar honest about the open board.
 *
 * A public viewing session and an owner's linked design both carry the post
 * URL. An independent personal copy does not. While an arrival is loading,
 * keep its URL rather than briefly advertising the remembered personal tab.
 */
export function SharedAddressSync() {
  const publicView = useDesignStore((state) => state.publicView);
  const project = useFactoryStore((state) => state.project);
  const isWelcomeCoveringBoard = useWelcomeTab().active;

  useEffect(() => {
    if (readSharedPlanId()) return;
    // A linked design IS its post, so the address may carry the post's id
    // whenever the board is showing.
    const linkedPlanId = publicView?.id ?? project.metadata?.communityPlanId;
    syncSharedPlanAddress(!isWelcomeCoveringBoard && linkedPlanId ? linkedPlanId : undefined);
  }, [project, publicView, isWelcomeCoveringBoard]);

  return null;
}

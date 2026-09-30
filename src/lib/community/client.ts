"use client";

import { randomUUID } from "@/lib/random-id";
import type {
  CommunityComment,
  CommunityPlanListRequest,
  CommunityPlanListResponse,
  CommunityPlanSummary,
  CommunityUploadRequest,
  CommunityUploadResponse,
  CommunityUser,
  CommunityVoteResponse,
  EntryIcon,
} from "./types";

const DEVICE_ID_STORAGE_KEY = "susy-factory-flow.device-id.v1";

/** Stable anonymous id for this browser; pairs with the IP hash server-side. */
export function getDeviceId(): string {
  if (typeof window === "undefined") {
    return "server";
  }

  let deviceId = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (!deviceId) {
    deviceId = randomUUID();
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
  }

  return deviceId;
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => undefined)) as
    | (T & { error?: string })
    | undefined;
  if (!response.ok || !body) {
    // The status rides the error so callers can tell "not yours" (403) and
    // "gone" (404) from a hiccup without matching message text.
    throw Object.assign(new Error(body?.error ?? `Request failed (${response.status})`), {
      status: response.status,
    });
  }

  return body;
}

export async function listCommunityPlans(
  params: CommunityPlanListRequest,
): Promise<CommunityPlanListResponse> {
  const search = new URLSearchParams();
  if (params.sort) search.set("sort", params.sort);
  if (params.search) search.set("search", params.search);
  if (params.maxTier) search.set("maxTierIndex", params.maxTier);
  if (params.mine) search.set("mine", "1");
  if (params.gameVersion) search.set("gameVersion", params.gameVersion);
  if (params.maxEuT !== undefined) search.set("maxEuT", String(params.maxEuT));
  if (params.makes?.length) search.set("makes", params.makes.join(","));
  if (params.takes?.length) search.set("takes", params.takes.join(","));
  if (params.page) search.set("page", String(params.page));
  if (params.pageSize) search.set("pageSize", String(params.pageSize));
  search.set("deviceId", getDeviceId());

  const response = await fetch(`/api/community/plans?${search.toString()}`);
  return parseJsonOrThrow<CommunityPlanListResponse>(response);
}

export async function getCommunityPlan(
  planId: string,
  options: { countView?: boolean } = {},
): Promise<CommunityPlanSummary> {
  const search = new URLSearchParams({ deviceId: getDeviceId() });
  // Background lookups (the plan card refreshing its post) are not views.
  if (options.countView === false) {
    search.set("countView", "0");
  }
  const response = await fetch(
    `/api/community/plans/${encodeURIComponent(planId)}?${search.toString()}`,
  );
  const body = await parseJsonOrThrow<{ plan: CommunityPlanSummary }>(response);
  return body.plan;
}

export async function downloadCommunityPlan(
  planId: string,
): Promise<{ name: string; plan: unknown }> {
  const response = await fetch(`/api/community/plans/${encodeURIComponent(planId)}/download`, {
    method: "POST",
  });
  return parseJsonOrThrow<{ name: string; plan: unknown }>(response);
}

export async function voteCommunityPlan(
  planId: string,
  value: 1 | -1,
): Promise<CommunityVoteResponse> {
  const response = await fetch(`/api/community/plans/${encodeURIComponent(planId)}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: getDeviceId(), value }),
  });
  return parseJsonOrThrow<CommunityVoteResponse>(response);
}

export async function uploadCommunityPlan(
  upload: Omit<CommunityUploadRequest, "deviceId">,
): Promise<CommunityUploadResponse> {
  const response = await fetch("/api/community/plans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...upload, deviceId: getDeviceId() }),
  });
  return parseJsonOrThrow<CommunityUploadResponse>(response);
}

/**
 * In-place edits of an owned post. Light fields (name, description, tags,
 * publish state, icon) travel alone; `plan` overwrites the content with a
 * fresh board and the server re-derives every stat.
 */
export async function patchCommunityPlan(
  planId: string,
  fields: {
    name?: string;
    description?: string;
    tags?: string[];
    isPublic?: boolean;
    icon?: EntryIcon | null;
    plan?: unknown;
  },
): Promise<{ id: string }> {
  const response = await fetch(`/api/community/plans/${encodeURIComponent(planId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  return parseJsonOrThrow<{ id: string }>(response);
}

/**
 * Puts the board photograph next to an owned post; the share link's embed
 * serves it back. Owner-only server-side, so failures here are the owner's
 * own session expiring — the post itself already went through.
 */
export async function uploadPlanPreview(planId: string, image: Blob): Promise<void> {
  const form = new FormData();
  form.set("image", image);
  const response = await fetch(
    `/api/community/plans/${encodeURIComponent(planId)}/preview`,
    { method: "POST", body: form },
  );
  await parseJsonOrThrow<{ ok: boolean }>(response);
}

export async function deleteCommunityPlan(planId: string): Promise<void> {
  const response = await fetch(`/api/community/plans/${encodeURIComponent(planId)}`, {
    method: "DELETE",
  });
  await parseJsonOrThrow<{ ok: boolean }>(response);
}

// ---------------------------------------------------------------------------
// Accounts: username + password, session lives in an httpOnly cookie.
// ---------------------------------------------------------------------------

export async function fetchCurrentUser(): Promise<CommunityUser | undefined> {
  const response = await fetch("/api/community/auth/me");
  const body = (await response.json().catch(() => undefined)) as
    | { user: CommunityUser | null }
    | undefined;
  return body?.user ?? undefined;
}

export async function registerCommunityUser(
  username: string,
  password: string,
): Promise<CommunityUser> {
  const response = await fetch("/api/community/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return parseJsonOrThrow<CommunityUser>(response);
}

export async function loginCommunityUser(
  username: string,
  password: string,
): Promise<CommunityUser> {
  const response = await fetch("/api/community/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return parseJsonOrThrow<CommunityUser>(response);
}

export async function logoutCommunityUser(): Promise<void> {
  await fetch("/api/community/auth/logout", { method: "POST" });
}

/**
 * Stamps a downloaded plan with the community post it IS: only for the
 * owner's own post coming back into their library. The link is what makes
 * the post follow the design from then on (see post-follow.ts).
 */
export function tagPlanWithCommunityId(plan: unknown, planId: string): unknown {
  if (typeof plan !== "object" || plan === null) {
    return plan;
  }

  const record = plan as { metadata?: Record<string, unknown> };
  return {
    ...record,
    metadata: { ...record.metadata, communityPlanId: planId },
  };
}

/**
 * A copy of someone else's setup is a plain design of your own: no link, so
 * nothing you do to it can touch their post, and posting it later makes an
 * ordinary post of yours.
 */
export function untagCommunityPlan(plan: unknown): unknown {
  if (typeof plan !== "object" || plan === null) {
    return plan;
  }
  const record = plan as { metadata?: Record<string, unknown> };
  if (!record.metadata) {
    return plan;
  }
  const { communityPlanId, communityFingerprint, ...metadata } = record.metadata;
  void communityPlanId;
  void communityFingerprint;
  return { ...record, metadata };
}

export async function listPlanComments(planId: string): Promise<CommunityComment[]> {
  const response = await fetch(`/api/community/plans/${encodeURIComponent(planId)}/comments`, {
    cache: "no-store",
  });
  const body = await parseJsonOrThrow<{ comments: CommunityComment[] }>(response);
  return body.comments;
}

export async function postPlanComment(planId: string, text: string): Promise<CommunityComment> {
  const response = await fetch(`/api/community/plans/${encodeURIComponent(planId)}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: text }),
  });
  const body = await parseJsonOrThrow<{ comment: CommunityComment }>(response);
  return body.comment;
}

export async function deletePlanComment(planId: string, commentId: string): Promise<void> {
  const response = await fetch(
    `/api/community/plans/${encodeURIComponent(planId)}/comments/${encodeURIComponent(commentId)}`,
    { method: "DELETE" },
  );
  await parseJsonOrThrow<{ ok: true }>(response);
}

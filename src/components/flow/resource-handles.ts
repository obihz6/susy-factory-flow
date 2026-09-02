import type { ResourceAmount, ResourceKind } from "@/lib/model/types";

/**
 * Handle identity is shared with the store and the load-time repairs, which
 * cannot import from the board. It lives in the model and is re-exported here so
 * board code keeps reaching for handles in one place.
 */
export { canonicalizeResourceHandleId } from "@/lib/model/edge-identity";

export type ResourceHandleSide = "input" | "output";

export interface ResourceHandlePayload {
  side: ResourceHandleSide;
  kind: ResourceKind;
  resourceId: string;
}

export function makeResourceHandleId(
  side: ResourceHandleSide,
  resource: Pick<ResourceAmount, "kind" | "id">,
  slotIndex?: number,
): string {
  return `${side}:${resource.kind}:${encodeURIComponent(resource.id)}${slotIndex === undefined ? "" : `:${slotIndex}`}`;
}

export function parseResourceHandleId(handleId?: string | null): ResourceHandlePayload | undefined {
  if (!handleId) {
    return undefined;
  }

  const [side, kind, encodedResourceId] = handleId.split(":");
  if (
    (side !== "input" && side !== "output") ||
    (kind !== "item" && kind !== "fluid" && kind !== "aspect" && kind !== "power") ||
    !encodedResourceId
  ) {
    return undefined;
  }

  return {
    side,
    kind,
    resourceId: decodeURIComponent(encodedResourceId),
  };
}

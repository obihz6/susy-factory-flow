import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

export const datasetRoot = path.join(process.cwd(), "public", "datasets", "susy");

export async function serveDatasetFile(
  filePath: string,
  options: {
    cacheControl?: string;
    contentType: string;
  },
) {
  const stats = await stat(filePath);
  if (!stats.isFile()) {
    return new Response("Not found", { status: 404 });
  }

  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    headers: {
      "Cache-Control": options.cacheControl ?? "public, max-age=0",
      "Content-Length": String(stats.size),
      "Content-Type": options.contentType,
    },
  });
}

export function isSafePathSegment(value: string) {
  return /^[a-zA-Z0-9._-]+$/.test(value) && value !== "." && value !== "..";
}

export function resolveDatasetChildPath(versionId: string, ...segments: string[]) {
  const versionRoot = path.resolve(datasetRoot, versionId);
  const filePath = path.resolve(versionRoot, ...segments);
  if (!filePath.startsWith(`${versionRoot}${path.sep}`)) {
    return undefined;
  }
  return filePath;
}

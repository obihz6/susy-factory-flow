import { NextResponse } from "next/server";

/**
 * A dataset version/artifact the caller asked for does not exist. Maps to a
 * clean 404 instead of a 500, and is the only "expected" dataset error the
 * runtime loader throws (missing versions, missing shards on the lookup path).
 */
export class DatasetNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetNotFoundError";
  }
}

/**
 * Translate a dataset-layer error into an HTTP response body. Any error that
 * is not a DatasetNotFoundError becomes a 500 with the message; the route
 * keeps ownership of the JSON shape.
 */
export function datasetErrorResponse(
  error: unknown,
  fallbackMessage: string,
  options?: { headers?: HeadersInit },
) {
  const status = error instanceof DatasetNotFoundError ? 404 : 500;
  const message = error instanceof Error ? error.message : fallbackMessage;
  return NextResponse.json(
    { error: message },
    options?.headers ? { status, headers: options.headers } : { status },
  );
}

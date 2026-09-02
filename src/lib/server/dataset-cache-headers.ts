/**
 * Cache policy for dataset API responses.
 *
 * Every dataset request the app makes carries a `datasetHash` cache-buster:
 * the version's content checksum, stamped onto the URL by the browser loader.
 * That makes the URL immutable - the same URL can never mean different bytes,
 * because republishing a dataset changes the checksum and therefore the URL.
 * Such responses are safe to cache indefinitely, in the browser and at a CDN,
 * and doing so is what keeps repeat recipe-book clicks off the server.
 *
 * A request without the fingerprint (someone curling the API by hand, an old
 * bookmark) gets no-store, because nothing ties that URL to the bytes it
 * described once the dataset is republished.
 */
export function datasetCacheHeaders(request: Request): Record<string, string> {
  // In dev the server code behind these responses changes all day; a
  // year-long immutable cache serves yesterday's catalog through every
  // reload and made "the fix is in but the browser will not show it" a
  // recurring mystery. Only production earns the immutable header.
  if (process.env.NODE_ENV !== "production") {
    return { "Cache-Control": "no-store" };
  }
  const fingerprinted = new URL(request.url).searchParams.has("datasetHash");
  return {
    "Cache-Control": fingerprinted ? "public, max-age=31536000, immutable" : "no-store",
  };
}

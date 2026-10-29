/**
 * Atomic file writing for the dataset pipeline.
 *
 * Every pipeline artifact (recipes.json, index gzips, shards, the manifest) is
 * written to a hidden temp file in the target directory, fsynced, and renamed
 * onto the final path. A crash mid-write can therefore only ever leave a
 * `.tmp` file behind, never a truncated artifact at the served path.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Write `filePath` atomically.
 *
 * `data` may be:
 *   - a string / Buffer / Uint8Array, or
 *   - an async (or sync) `write(handle)` function that receives the file
 *     handle and writes the file body incrementally. Temp files are only
 *     cleaned up when the write function throws.
 *
 * `cleanup` (optional, data-function form): called after a failed body write
 * so a caller can restore any in-place state before the step is re-routed.
 */
export async function writeFileAtomic(filePath, data, options = {}) {
  const directory = path.dirname(filePath);
  await fsp.mkdir(directory, { recursive: true });
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${randomBytes(6).toString("hex")}.tmp`,
  );

  let handle;
  try {
    handle = await fsp.open(tempPath, "w");
    try {
      if (typeof data === "function") {
        await data(handle);
      } else if (data !== undefined && data !== null) {
        await handle.write(data);
      }
      if (handle.fd !== undefined && typeof handle.sync === "function") {
        try {
          await handle.sync();
        } catch {
          // Some platforms/configs reject fsync on regular files; rename still
          // gives us all-or-nothing visibility within the same directory.
        }
      }
      await handle.close();
    } finally {
      if (handle.fd !== undefined) {
        try {
          await handle.close();
        } catch {
          // already closed/failed
        }
      }
    }
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => undefined);
    if (options.cleanup) {
      await options.cleanup().catch(() => undefined);
    }
    throw error;
  }

  try {
    await fsp.rename(tempPath, filePath);
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => undefined);
    if (options.cleanup) {
      await options.cleanup().catch(() => undefined);
    }
    throw error;
  }

  return filePath;
}

/**
 * Convenience wrapper for JSON payloads; the manifest reader relies on this
 * file being parseable after any interruption.
 */
export async function writeFileAtomicJson(filePath, value, options = {}) {
  return writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
}

/**
 * Synchronous variant for early bootstrap code that runs before async setup
 * (e.g. config/state files opened from fs.openSync loggers).
 */
export function writeFileSyncAtomic(filePath, data) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${randomBytes(6).toString("hex")}.tmp`,
  );
  const fd = fs.openSync(tempPath, "w");
  try {
    fs.writeFileSync(fd, data);
    try {
      fs.fsyncSync(fd);
    } catch {
      // Optional on some platforms; see the async variant above.
    }
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
  return filePath;
}

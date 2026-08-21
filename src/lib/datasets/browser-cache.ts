"use client";

import type { RecipeDataset } from "./types";

const DB_NAME = "susy-factory-flow";
const DB_VERSION = 1;
const STORE_NAME = "recipe-datasets";

interface CachedDatasetRecord {
  key: string;
  cachedAt: string;
  dataset: RecipeDataset;
}

export async function readCachedRecipeDataset(key: string): Promise<RecipeDataset | undefined> {
  const db = await openDatasetDb();
  const record = await requestToPromise<CachedDatasetRecord | undefined>(
    db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key),
  );
  db.close();
  return record?.dataset;
}

export async function writeCachedRecipeDataset(key: string, dataset: RecipeDataset): Promise<void> {
  const db = await openDatasetDb();
  await requestToPromise(
    db
      .transaction(STORE_NAME, "readwrite")
      .objectStore(STORE_NAME)
      .put({
        key,
        cachedAt: new Date().toISOString(),
        dataset,
      } satisfies CachedDatasetRecord),
  );
  db.close();
}

function openDatasetDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is not available."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB."));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

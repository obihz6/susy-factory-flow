/**
 * Vitest setup: guarantee usable web storage in every test environment.
 *
 * Why this exists: Node 26 ships an experimental `localStorage` global that is
 * `undefined` unless the process was started with `--localstorage-file`. Under
 * vitest's jsdom environment `window === globalThis`, and Node's broken own
 * property shadows jsdom's working Storage, so every test that touches
 * `window.localStorage` dies with "Cannot read properties of undefined".
 * CI runs Node 24, where jsdom's storage simply works and nothing here fires.
 */

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  key(index: number): string | null;
  readonly length: number;
};

function isUsableStorage(value: unknown): value is StorageLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as StorageLike).getItem === "function" &&
    typeof (value as StorageLike).setItem === "function"
  );
}

/** A small Map-backed Storage, standing in for the real thing. */
function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
    key: (index) => Array.from(map.keys())[index] ?? null,
  };
}

function ensureStorage(name: "localStorage" | "sessionStorage") {
  const existing = (globalThis as Record<string, unknown>)[name];
  if (isUsableStorage(existing)) {
    return;
  }
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: createMemoryStorage(),
  });
}

ensureStorage("localStorage");
ensureStorage("sessionStorage");

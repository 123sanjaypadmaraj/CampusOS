/**
 * Unit tests for the offline read-cache (doc §9 "Offline Mode"). Jest's
 * jsdom environment has no real `indexedDB`, so every test here exercises
 * the in-memory fallback path -- which is also exactly what a browser
 * without IndexedDB (or one that fails to open it) would fall back to, so
 * this is real coverage, not a workaround.
 */

import { cacheRead, cacheWrite, withOfflineCache } from "./offlineCache";

describe("cacheRead / cacheWrite", () => {
  it("returns null for a key that was never written", async () => {
    await expect(cacheRead("never-written-key")).resolves.toBeNull();
  });

  it("round-trips a written value with a cachedAt timestamp", async () => {
    await cacheWrite("round-trip-key", { hello: "world" });
    const entry = await cacheRead("round-trip-key");
    expect(entry.data).toEqual({ hello: "world" });
    expect(typeof entry.cachedAt).toBe("number");
  });

  it("overwrites a previous value under the same key", async () => {
    await cacheWrite("overwrite-key", "first");
    await cacheWrite("overwrite-key", "second");
    const entry = await cacheRead("overwrite-key");
    expect(entry.data).toBe("second");
  });
});

describe("withOfflineCache", () => {
  it("returns the fetcher's result on success and caches it", async () => {
    const fetcher = jest.fn().mockResolvedValue(["a", "b"]);
    const result = await withOfflineCache("wc-success-key", fetcher);
    expect(result).toEqual(["a", "b"]);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const cached = await cacheRead("wc-success-key");
    expect(cached.data).toEqual(["a", "b"]);
  });

  it("falls back to the cached value when the fetcher fails and a prior value exists", async () => {
    await cacheWrite("wc-fallback-key", ["stale", "but", "real"]);
    const fetcher = jest.fn().mockRejectedValue(new Error("offline"));

    const result = await withOfflineCache("wc-fallback-key", fetcher);
    expect(result).toEqual(["stale", "but", "real"]);
  });

  it("rethrows the original error when the fetcher fails and there is no cached value", async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error("offline, nothing cached yet"));
    await expect(withOfflineCache("wc-no-fallback-key", fetcher)).rejects.toThrow(
      "offline, nothing cached yet"
    );
  });

  it("refreshes the cache on the next success after having served a stale fallback", async () => {
    await cacheWrite("wc-refresh-key", "old");
    const failingFetcher = jest.fn().mockRejectedValue(new Error("offline"));
    await expect(withOfflineCache("wc-refresh-key", failingFetcher)).resolves.toBe("old");

    const succeedingFetcher = jest.fn().mockResolvedValue("new");
    await expect(withOfflineCache("wc-refresh-key", succeedingFetcher)).resolves.toBe("new");

    const cached = await cacheRead("wc-refresh-key");
    expect(cached.data).toBe("new");
  });
});

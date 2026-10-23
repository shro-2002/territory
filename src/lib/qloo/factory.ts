import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Cache, QlooClient, QlooClientOptions } from "./client";
import { createMockFetch, MockOptions } from "./mock";

/** Private on-disk cache. Lives in .private/ which is gitignored: Qloo data must never be committed. */
export class FileCache implements Cache {
  constructor(private readonly dir: string) {}
  async get(key: string) {
    try {
      return JSON.parse(await readFile(path.join(this.dir, `${key}.json`), "utf8"));
    } catch {
      return undefined; // cache miss is not an error
    }
  }
  async set(key: string, value: unknown) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(path.join(this.dir, `${key}.json`), JSON.stringify(value));
  }
}

/** Reads from the first layer that has the key; writes only to the first (writable) layer. */
export class LayeredCache implements Cache {
  constructor(private readonly layers: Cache[]) {}
  async get(key: string) {
    for (const layer of this.layers) {
      const hit = await layer.get(key);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  async set(key: string, value: unknown) {
    await this.layers[0].set(key, value);
  }
}

export const PRIVATE_DIR = path.join(process.cwd(), ".private");
const SEED_CACHE_DIR = path.join(PRIVATE_DIR, "qloo-cache");

// Serverless filesystems are read-only except the temp dir. On Vercel the deployment may carry a
// private, read-only seed of the cache (uploaded by `vercel deploy`, never committed to git).
function liveCache(): Cache {
  if (!process.env.VERCEL) return new FileCache(SEED_CACHE_DIR);
  return new LayeredCache([new FileCache(path.join(os.tmpdir(), "territory-qloo-cache")), new FileCache(SEED_CACHE_DIR)]);
}

export function hasLiveKey(): boolean {
  return Boolean(process.env.QLOO_API_KEY?.trim());
}

/** Live client when QLOO_API_KEY is set, otherwise a clearly labelled mock. */
export function createQlooClient(overrides: QlooClientOptions & { mock?: MockOptions; forceMock?: boolean } = {}): QlooClient {
  const { mock, forceMock, ...opts } = overrides;
  if (!forceMock && hasLiveKey()) {
    return new QlooClient({ cache: liveCache(), ...opts, apiKey: process.env.QLOO_API_KEY!.trim(), source: "live" });
  }
  return new QlooClient({ ...opts, apiKey: "mock", fetchImpl: createMockFetch(mock), source: "mock", sleep: async () => {} });
}

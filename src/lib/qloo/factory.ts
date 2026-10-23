import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Cache, QlooClient, QlooClientOptions } from "./client";
import { isHosted } from "../server/hosting";
import { hasRedis, redis } from "../server/redis";
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
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(path.join(this.dir, `${key}.json`), JSON.stringify(value));
    } catch {
      // A read-only or full filesystem must never fail a request; the response is still returned.
    }
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

/** Shared private cache in Upstash Redis; survives cold starts and is shared across instances. */
export class RedisCache implements Cache {
  async get(key: string) {
    const raw = await redis(["GET", `qloo:${key}`]);
    return typeof raw === "string" ? JSON.parse(raw) : undefined;
  }
  async set(key: string, value: unknown) {
    await redis(["SET", `qloo:${key}`, JSON.stringify(value)]);
  }
}

export const PRIVATE_DIR = path.join(process.cwd(), ".private");
const SEED_CACHE_DIR = path.join(PRIVATE_DIR, "qloo-cache");

// Serverless filesystems are read-only except the temp dir. A hosted deployment may carry a
// private, read-only seed of the cache (uploaded by `vercel deploy`, never committed to git).
function liveCache(): Cache {
  if (!isHosted()) return new FileCache(SEED_CACHE_DIR);
  const tmp = new FileCache(path.join(os.tmpdir(), "territory-qloo-cache"));
  const seed = new FileCache(SEED_CACHE_DIR);
  // Redis first so new research is shared; tmp and seed still answer when Redis is absent or down.
  return hasRedis() ? new LayeredCache([new RedisCache(), tmp, seed]) : new LayeredCache([tmp, seed]);
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

import { mkdir, readFile, writeFile } from "node:fs/promises";
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

export const PRIVATE_DIR = path.join(process.cwd(), ".private");

export function hasLiveKey(): boolean {
  return Boolean(process.env.QLOO_API_KEY?.trim());
}

/** Live client when QLOO_API_KEY is set, otherwise a clearly labelled mock. */
export function createQlooClient(overrides: QlooClientOptions & { mock?: MockOptions; forceMock?: boolean } = {}): QlooClient {
  const { mock, forceMock, ...opts } = overrides;
  if (!forceMock && hasLiveKey()) {
    return new QlooClient({ cache: new FileCache(path.join(PRIVATE_DIR, "qloo-cache")), ...opts, apiKey: process.env.QLOO_API_KEY!.trim(), source: "live" });
  }
  return new QlooClient({ ...opts, apiKey: "mock", fetchImpl: createMockFetch(mock), source: "mock", sleep: async () => {} });
}

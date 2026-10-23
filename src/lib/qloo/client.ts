import { createHash } from "node:crypto";

import { CallRecord, InsightsResponse, InsightsResponseSchema, Params, QlooError, SearchResponseSchema, type Entity } from "./types";

export const QLOO_BASE_URL = "https://hackathon.api.qloo.com";

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_CALL_BUDGET = 120;
const BACKOFF_BASE_MS = 400;

export interface Cache {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export class MemoryCache implements Cache {
  private readonly store = new Map<string, unknown>();
  async get(key: string) {
    return this.store.get(key);
  }
  async set(key: string, value: unknown) {
    this.store.set(key, value);
  }
}

export interface QlooClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  cache?: Cache;
  timeoutMs?: number;
  maxRetries?: number;
  concurrency?: number;
  callBudget?: number;
  source?: "live" | "mock";
  sleep?: (ms: number) => Promise<void>;
  /** Prefix for call ids so ids stay unique across requests that share one session. */
  callIdPrefix?: string;
}

/** Stable query string: sorted keys, undefined dropped. Cache key and URL share it. */
export function encodeParams(params: Params): string {
  const sp = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value !== undefined) sp.append(key, String(value));
  }
  return sp.toString();
}

export class QlooClient {
  readonly calls: CallRecord[] = [];
  readonly source: "live" | "mock";
  private active = 0;
  private readonly queue: Array<() => void> = [];
  private liveCalls = 0;
  private readonly opts: Required<Omit<QlooClientOptions, "apiKey">> & { apiKey?: string };

  constructor(options: QlooClientOptions = {}) {
    this.source = options.source ?? "live";
    this.opts = {
      apiKey: options.apiKey,
      baseUrl: options.baseUrl ?? QLOO_BASE_URL,
      fetchImpl: options.fetchImpl ?? fetch,
      cache: options.cache ?? new MemoryCache(),
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
      callBudget: options.callBudget ?? DEFAULT_CALL_BUDGET,
      source: this.source,
      sleep: options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      callIdPrefix: options.callIdPrefix ?? "q",
    };
    if (this.source === "live" && !this.opts.apiKey) {
      throw new QlooError("QLOO_API_KEY is not set; use the mock client or set the env var", "NO_KEY");
    }
  }

  get liveCallCount() {
    return this.liveCalls;
  }

  async search(query: string, types?: string[], take = 5): Promise<Entity[]> {
    const raw = await this.get("/search", { query, types: types?.join(","), take });
    const parsed = SearchResponseSchema.safeParse(raw);
    if (!parsed.success) throw new QlooError("Unexpected /search response shape", "BAD_RESPONSE", undefined, { cause: parsed.error });
    return parsed.data.results;
  }

  async insights(params: Params): Promise<InsightsResponse> {
    if (!params["filter.type"]) throw new QlooError("filter.type is required for /v2/insights", "BAD_RESPONSE");
    const raw = await this.get("/v2/insights", params);
    const parsed = InsightsResponseSchema.safeParse(raw);
    if (!parsed.success) throw new QlooError("Unexpected /v2/insights response shape", "BAD_RESPONSE", undefined, { cause: parsed.error });
    return parsed.data;
  }

  async get(path: string, params: Params): Promise<unknown> {
    const qs = encodeParams(params);
    const cacheKey = createHash("sha256").update(`${path}?${qs}`).digest("hex");
    const cached = await this.opts.cache.get(cacheKey);
    if (cached !== undefined) {
      this.record({ path, params, status: 200, latencyMs: 0, cacheHit: true, resultCount: countResults(cached), attempt: 0 });
      return cached;
    }
    if (this.liveCalls >= this.opts.callBudget) {
      throw new QlooError(`Qloo call budget of ${this.opts.callBudget} exhausted`, "BUDGET_EXCEEDED");
    }
    this.liveCalls += 1;
    const body = slimBody(await this.withSlot(() => this.fetchWithRetry(path, params, qs)));
    await this.opts.cache.set(cacheKey, body);
    return body;
  }

  private async fetchWithRetry(path: string, params: Params, qs: string): Promise<unknown> {
    const url = `${this.opts.baseUrl}${path}?${qs}`;
    for (let attempt = 1; ; attempt++) {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
      try {
        const res = await this.opts.fetchImpl(url, {
          method: "GET",
          headers: { "X-Api-Key": this.opts.apiKey ?? "mock", Accept: "application/json" },
          signal: controller.signal,
        });
        const latencyMs = Date.now() - started;
        if (res.ok) {
          const body = await res.json();
          this.record({ path, params, status: res.status, latencyMs, cacheHit: false, resultCount: countResults(body), attempt });
          return body;
        }
        const errText = (await res.text().catch(() => "")).slice(0, 300);
        this.record({ path, params, status: res.status, latencyMs, cacheHit: false, resultCount: 0, attempt, error: errText });
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt > this.opts.maxRetries) {
          throw new QlooError(`Qloo ${path} returned ${res.status}: ${errText}`, res.status === 429 ? "RATE_LIMITED" : "HTTP", res.status);
        }
        const retryAfter = Number(res.headers.get("retry-after"));
        await this.opts.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
      } catch (err) {
        if (err instanceof QlooError) throw err;
        const isTimeout = (err as Error)?.name === "AbortError";
        this.record({ path, params, status: isTimeout ? "timeout" : "network_error", latencyMs: Date.now() - started, cacheHit: false, resultCount: 0, attempt, error: String((err as Error)?.message ?? err) });
        if (attempt > this.opts.maxRetries) {
          throw new QlooError(`Qloo ${path} ${isTimeout ? "timed out" : "network error"}`, isTimeout ? "TIMEOUT" : "HTTP", undefined, { cause: err });
        }
        await this.opts.sleep(backoff(attempt));
      } finally {
        clearTimeout(timer);
      }
    }
  }

  private async withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.opts.concurrency) await new Promise<void>((r) => this.queue.push(r));
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }

  private record(rec: Omit<CallRecord, "id" | "source">) {
    this.calls.push({ ...rec, id: `${this.opts.callIdPrefix}${this.calls.length + 1}`, source: this.source });
  }
}

function backoff(attempt: number) {
  return BACKOFF_BASE_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * BACKOFF_BASE_MS);
}

/**
 * Keep only the fields Territory reads. Data minimisation: smaller private cache, and no Qloo
 * attributes are retained beyond what the product uses.
 */
export function slimBody(body: unknown): unknown {
  const slimEntity = (e: Record<string, unknown>) => {
    const props = e.properties as Record<string, unknown> | null | undefined;
    const query = e.query as Record<string, unknown> | null | undefined;
    return {
      entity_id: e.entity_id,
      name: e.name,
      ...(e.types ? { types: e.types } : {}),
      ...(e.subtype ? { subtype: e.subtype } : {}),
      ...(typeof e.popularity === "number" ? { popularity: e.popularity } : {}),
      ...(props?.release_year !== undefined ? { properties: { release_year: props.release_year } } : {}),
      ...(typeof query?.affinity === "number" ? { query: { affinity: query.affinity } } : {}),
    };
  };
  const b = body as { results?: unknown; query?: unknown; success?: unknown };
  if (Array.isArray(b?.results)) return { results: (b.results as Record<string, unknown>[]).map(slimEntity) };
  const r = b?.results as { entities?: Record<string, unknown>[] } | undefined;
  if (r?.entities) return { success: b.success, results: { entities: r.entities.map(slimEntity) }, ...(b.query ? { query: { localities: (b.query as Record<string, unknown>).localities ? true : undefined } } : {}) };
  return body;
}

function countResults(body: unknown): number {
  const b = body as { results?: unknown };
  if (Array.isArray(b?.results)) return b.results.length;
  const r = b?.results as { entities?: unknown[]; heatmap?: unknown[]; tags?: unknown[] } | undefined;
  return r?.entities?.length ?? r?.heatmap?.length ?? r?.tags?.length ?? 0;
}

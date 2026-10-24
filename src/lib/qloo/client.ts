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
  /** Epoch ms after which no new network call starts (host execution limits). Cache hits still work. */
  deadlineAt?: number;
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
      deadlineAt: options.deadlineAt ?? Number.POSITIVE_INFINITY,
    };
    if (this.source === "live" && !this.opts.apiKey) {
      throw new QlooError("QLOO_API_KEY is not set; use the mock client or set the env var", "NO_KEY");
    }
  }

  get liveCallCount() {
    return this.liveCalls;
  }

  /** HTTP attempts (retries included) that count against the real Qloo quota. A mock backend makes none. */
  get meteredCallCount() {
    return this.source === "live" ? this.liveCalls : 0;
  }

  async search(query: string, types?: string[], take = 5): Promise<Entity[]> {
    return (await this.searchTraced(query, types, take)).data;
  }

  /** Like search(), plus the id of the call record that answered it (for provenance under concurrency). */
  async searchTraced(query: string, types?: string[], take = 5): Promise<{ data: Entity[]; callId: string }> {
    const { body, callId } = await this.request("/search", { query, types: types?.join(","), take });
    const parsed = SearchResponseSchema.safeParse(body);
    if (!parsed.success) throw new QlooError("Unexpected /search response shape", "BAD_RESPONSE", undefined, { cause: parsed.error });
    return { data: parsed.data.results, callId };
  }

  async insights(params: Params): Promise<InsightsResponse> {
    return (await this.insightsTraced(params)).data;
  }

  /** Like insights(), plus the id of the call record that answered it (for provenance under concurrency). */
  async insightsTraced(params: Params): Promise<{ data: InsightsResponse; callId: string }> {
    if (!params["filter.type"]) throw new QlooError("filter.type is required for /v2/insights", "BAD_RESPONSE");
    const { body, callId } = await this.request("/v2/insights", params);
    const parsed = InsightsResponseSchema.safeParse(body);
    if (!parsed.success) throw new QlooError("Unexpected /v2/insights response shape", "BAD_RESPONSE", undefined, { cause: parsed.error });
    return { data: parsed.data, callId };
  }

  async get(path: string, params: Params): Promise<unknown> {
    return (await this.request(path, params)).body;
  }

  private async request(path: string, params: Params): Promise<{ body: unknown; callId: string }> {
    const qs = encodeParams(params);
    const cacheKey = createHash("sha256").update(`${path}?${qs}`).digest("hex");
    const cached = await this.opts.cache.get(cacheKey);
    if (cached !== undefined) {
      return { body: cached, callId: this.record({ path, params, status: 200, latencyMs: 0, cacheHit: true, resultCount: countResults(cached), attempt: 0 }) };
    }
    const { body, callId } = await this.withSlot(() => this.fetchWithRetry(path, params, qs));
    const slim = slimBody(body);
    await this.opts.cache.set(cacheKey, slim);
    return { body: slim, callId };
  }

  private async fetchWithRetry(path: string, params: Params, qs: string): Promise<{ body: unknown; callId: string }> {
    const url = `${this.opts.baseUrl}${path}?${qs}`;
    for (let attempt = 1; ; attempt++) {
      this.claimNetworkAttempt();
      const started = Date.now();
      const controller = new AbortController();
      // Never let one call outlive the request deadline.
      const timeoutMs = Math.max(1000, Math.min(this.opts.timeoutMs, this.opts.deadlineAt - Date.now()));
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await this.opts.fetchImpl(url, {
          method: "GET",
          headers: { "X-Api-Key": this.opts.apiKey ?? "mock", Accept: "application/json" },
          signal: controller.signal,
        });
        const latencyMs = Date.now() - started;
        if (res.ok) {
          const body = await res.json();
          return { body, callId: this.record({ path, params, status: res.status, latencyMs, cacheHit: false, resultCount: countResults(body), attempt }) };
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

  /**
   * Every HTTP attempt, retries and timed-out attempts included, counts against the reserved budget. Checked and
   * counted synchronously right before the request is sent, so concurrent calls can never overshoot the reservation.
   */
  private claimNetworkAttempt() {
    if (this.liveCalls >= this.opts.callBudget) {
      throw new QlooError(this.opts.callBudget === 0 ? "live Qloo research unavailable (quota guard); only cached evidence can be used" : `Qloo call budget of ${this.opts.callBudget} exhausted`, "BUDGET_EXCEEDED");
    }
    if (Date.now() >= this.opts.deadlineAt) throw new QlooError("research time limit reached", "TIMEOUT");
    this.liveCalls += 1;
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

  private record(rec: Omit<CallRecord, "id" | "source">): string {
    const id = `${this.opts.callIdPrefix}${this.calls.length + 1}`;
    this.calls.push({ ...rec, id, source: this.source });
    return id;
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
      // release_country lets Territory verify a nearby title's local production origin.
      ...(props?.release_year !== undefined || props?.release_country !== undefined
        ? { properties: { ...(props.release_year !== undefined ? { release_year: props.release_year } : {}), ...(props.release_country !== undefined ? { release_country: props.release_country } : {}) } }
        : {}),
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

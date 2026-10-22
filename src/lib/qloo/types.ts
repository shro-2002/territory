import { z } from "zod";

// Response schemas are deliberately lenient: the hackathon docs do not publish a
// full entity schema, so we validate only the fields we depend on and keep the rest.

export const EntitySchema = z
  .object({
    entity_id: z.string(),
    name: z.string(),
    types: z.array(z.string()).optional(),
    subtype: z.string().optional(),
    popularity: z.number().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    query: z
      .object({ affinity: z.number().optional() })
      .passthrough()
      .optional(),
    tags: z.array(z.object({ tag_id: z.string().optional(), id: z.string().optional(), name: z.string().optional() }).passthrough()).optional(),
  })
  .passthrough();
export type Entity = z.infer<typeof EntitySchema>;

export const SearchResponseSchema = z
  .object({ results: z.array(EntitySchema) })
  .passthrough();

export const InsightsResponseSchema = z
  .object({
    success: z.boolean().optional(),
    results: z
      .object({
        entities: z.array(EntitySchema).optional(),
        heatmap: z.array(z.unknown()).optional(),
        tags: z.array(z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
    query: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type InsightsResponse = z.infer<typeof InsightsResponseSchema>;

export type EntityType = "urn:entity:movie" | "urn:entity:tv_show" | "urn:entity:artist" | "urn:entity:book" | "urn:entity:person" | "urn:entity:podcast" | "urn:entity:brand";

export type Params = Record<string, string | number | boolean | undefined>;

/** One record per Qloo call; drives the Evidence Lab trace. Never contains the key. */
export interface CallRecord {
  id: string;
  path: string;
  params: Params;
  status: number | "timeout" | "network_error";
  latencyMs: number;
  cacheHit: boolean;
  resultCount: number;
  attempt: number;
  source: "live" | "mock";
  error?: string;
}

export class QlooError extends Error {
  constructor(
    message: string,
    readonly code: "NO_KEY" | "HTTP" | "TIMEOUT" | "RATE_LIMITED" | "BAD_RESPONSE" | "BUDGET_EXCEEDED",
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "QlooError";
  }
}

import { randomBytes } from "node:crypto";

import { z } from "zod";

import { LIMITS, replan, runAgent, Session, TraceEvent } from "@/lib/agent/agent";
import type { ResearchContext } from "@/lib/agent/research";
import { createQlooClient, qlooSource } from "@/lib/qloo/factory";
import type { CallRecord } from "@/lib/qloo/types";
import { researchDeadlineMs } from "@/lib/server/hosting";
import { checkRateLimitShared, clientIp, reserveQlooCalls } from "@/lib/server/rate-limit";
import { decrypt, encryptContext, MAX_CONTEXT_CHARS, seal, SealConfigError, verifySeal } from "@/lib/server/seal";
import { ConstraintsPatchSchema } from "@/lib/territory/planner";

// Below the stricter host limit (Netlify 60 s synchronous); research itself stops at researchDeadlineMs().
export const maxDuration = 60;
const MAX_BODY_BYTES = 400_000;

const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run"), input: z.unknown() }),
  z.object({
    action: z.literal("replan"),
    session: z.unknown(),
    token: z.string().min(10).max(200),
    context: z.string().min(10).max(MAX_CONTEXT_CHARS),
    patch: ConstraintsPatchSchema,
  }),
]);

/**
 * NDJSON stream messages consumed by the UI. The session sent to the browser has `context: null`:
 * the comps' raw Qloo neighbourhood lists travel only inside `context`, AES-256-GCM encrypted.
 */
export type StreamMessage =
  | { type: "trace"; event: TraceEvent }
  | { type: "notice"; message: string }
  | { type: "result"; session: Session; token: string; context: string | null; calls: CallRecord[] }
  | { type: "error"; code: string; message: string };

function json(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers: { "content-type": "application/json", ...headers } });
}

export async function POST(req: Request) {
  const source = qlooSource();
  const limited = await checkRateLimitShared(clientIp(req), source);
  if (!limited.ok) return json(429, "RATE_LIMITED", "Too many runs from this address. Try again shortly.", { "retry-after": String(limited.retryAfterSec) });

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, "TOO_LARGE", "Request body too large.");
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(JSON.parse(raw));
  } catch {
    return json(400, "BAD_REQUEST", "Malformed request.");
  }

  let prior: Session | null = null;
  try {
    if (body.action === "replan") {
      const context = decrypt<ResearchContext>(body.context);
      if (!verifySeal(body.session, body.token) || !context) return json(400, "BAD_SEAL", "Session was modified or is from another deployment; run the research again.");
      prior = { ...(body.session as Session), context };
    }
  } catch (err) {
    if (err instanceof SealConfigError) return json(503, "CONFIG", "Server is missing its session secret.");
    throw err;
  }

  const reservation = await reserveQlooCalls(LIMITS.maxQlooCalls, source);
  const client = createQlooClient({ callBudget: reservation.granted, callIdPrefix: `${randomBytes(3).toString("hex")}-`, deadlineAt: Date.now() + researchDeadlineMs() });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (m: StreamMessage) => controller.enqueue(encoder.encode(JSON.stringify(m) + "\n"));
      try {
        if (client.source === "live" && reservation.granted === 0) send({ type: "notice", message: `Live Qloo research is paused (${reservation.reason}). Only evidence already in the private cache can be used; uncached markets will show as unavailable.` });
        const onEvent = (event: TraceEvent) => send({ type: "trace", event });
        const session = prior ? await replan(prior, body.action === "replan" ? body.patch : {}, { client, onEvent }) : await runAgent(body.action === "run" ? body.input : null, { client, onEvent });
        // Only what the UI shows leaves the server: no raw neighbourhood lists, no undisplayed entity ids.
        const research = Object.fromEntries(Object.entries(session.research).map(([k, r]) => [k, { ...r, localNeighbourIds: [] }]));
        const publicSession: Session = { ...session, research, context: null };
        send({ type: "result", session: publicSession, token: seal(publicSession), context: session.context ? encryptContext(session.context) : null, calls: client.calls });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unexpected error";
        const code = err instanceof SealConfigError ? "CONFIG" : message.startsWith("Invalid input") || message.startsWith("Unsupported") ? "INVALID_INPUT" : "AGENT_ERROR";
        send({ type: "error", code, message: code === "CONFIG" ? "Server is missing its session secret." : message.slice(0, 400) });
      } finally {
        await reservation.release(client.meteredCallCount);
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-territory-source": client.source } });
}

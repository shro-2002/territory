import { randomBytes } from "node:crypto";

import { z } from "zod";

import { LIMITS, replan, runAgent, Session, TraceEvent } from "@/lib/agent/agent";
import { createQlooClient } from "@/lib/qloo/factory";
import type { CallRecord } from "@/lib/qloo/types";
import { checkRateLimitShared, clientIp, qlooBudgetRemainingShared, recordQlooCallsShared } from "@/lib/server/rate-limit";
import { seal, verifySeal } from "@/lib/server/seal";
import { ConstraintsSchema } from "@/lib/territory/planner";

export const maxDuration = 120;
const MAX_BODY_BYTES = 400_000;

const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run"), input: z.unknown() }),
  z.object({ action: z.literal("replan"), session: z.unknown(), token: z.string().min(10).max(200), patch: ConstraintsSchema.partial() }),
]);

/** NDJSON stream messages consumed by the UI. */
export type StreamMessage =
  | { type: "trace"; event: TraceEvent }
  | { type: "result"; session: Session; token: string; calls: CallRecord[] }
  | { type: "error"; code: string; message: string };

function json(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers: { "content-type": "application/json", ...headers } });
}

export async function POST(req: Request) {
  const limited = await checkRateLimitShared(clientIp(req));
  if (!limited.ok) return json(429, "RATE_LIMITED", "Too many runs from this address. Try again shortly.", { "retry-after": String(limited.retryAfterSec) });
  if ((await qlooBudgetRemainingShared()) < LIMITS.maxQlooCalls) return json(503, "QUOTA_GUARD", "Live research is paused to protect the shared Qloo quota. Explore the cached showcase.");

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, "TOO_LARGE", "Request body too large.");
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(JSON.parse(raw));
  } catch {
    return json(400, "BAD_REQUEST", "Malformed request.");
  }
  if (body.action === "replan" && !verifySeal(body.session, body.token)) return json(400, "BAD_SEAL", "Session was modified or is from another deployment; run the research again.");

  const client = createQlooClient({ callBudget: LIMITS.maxQlooCalls, callIdPrefix: `${randomBytes(3).toString("hex")}-` });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (m: StreamMessage) => controller.enqueue(encoder.encode(JSON.stringify(m) + "\n"));
      try {
        const onEvent = (event: TraceEvent) => send({ type: "trace", event });
        const session = body.action === "run" ? await runAgent(body.input, { client, onEvent }) : await replan(body.session as Session, body.patch, { client, onEvent });
        send({ type: "result", session, token: seal(session), calls: client.calls });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unexpected error";
        send({ type: "error", code: message.startsWith("Invalid input") || message.startsWith("Unsupported") ? "INVALID_INPUT" : "AGENT_ERROR", message: message.slice(0, 400) });
      } finally {
        await recordQlooCallsShared(client.liveCallCount);
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-territory-source": client.source } });
}

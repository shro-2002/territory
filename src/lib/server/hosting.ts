/** True on a hosted deployment: TERRITORY_HOSTED=1, or a detected serverless runtime (Vercel, Netlify/AWS Lambda). */
export function isHosted(): boolean {
  return process.env.TERRITORY_HOSTED === "1" || Boolean(process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
}

const DEFAULT_DEADLINE_MS = 50_000;

/**
 * Wall-clock budget for live Qloo research per request. Netlify's synchronous limit is 60 s and Vercel Hobby's
 * is 300 s; the default keeps a margin under the stricter one. After it, only cached evidence is used.
 */
export function researchDeadlineMs(): number {
  const v = Number(process.env.RESEARCH_DEADLINE_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_DEADLINE_MS;
}

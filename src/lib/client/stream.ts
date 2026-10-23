import type { StreamMessage } from "@/app/api/agent/route";

/** POST to the agent API and deliver each NDJSON message as it arrives. */
export async function streamAgent(body: unknown, onMessage: (m: StreamMessage) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    onMessage({ type: "error", code: err?.error?.code ?? `HTTP_${res.status}`, message: err?.error?.message ?? `Request failed (${res.status})` });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onMessage(JSON.parse(line) as StreamMessage);
    }
  }
}

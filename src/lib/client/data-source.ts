"use client";

import { useEffect, useState } from "react";

export type DataSource = "live" | "mock";

/**
 * Runtime data source for the badge. Asks the server what it will use now (`/api/status`), and lets a completed
 * run correct it with the source its own Qloo calls actually reported. `null` until known, so the UI never
 * claims "live" or "mock" from a stale build-time guess.
 */
export function useDataSource(reported: DataSource | null): DataSource | null {
  const [server, setServer] = useState<DataSource | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/status", { cache: "no-store", signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ source: DataSource }>) : null))
      .then((j) => j && setServer(j.source))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return reported ?? server;
}

// One-off: rewrite the private cache with slimmed bodies (no network calls).
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { slimBody } from "../src/lib/qloo/client";

const dir = path.join(process.cwd(), ".private", "qloo-cache");
for (const f of await readdir(dir)) {
  const p = path.join(dir, f);
  await writeFile(p, JSON.stringify(slimBody(JSON.parse(await readFile(p, "utf8")))));
}
process.stdout.write("slimmed\n");

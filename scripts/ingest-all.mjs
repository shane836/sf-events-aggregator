// One-command local ingest: apply pending DB migrations, then run every
// adapter sequentially. This is the durable fix for the "venues.city does not
// exist" class of crash — the schema is always brought up to date before any
// source writes. Point your local cron at `npm run ingest:all`.
//
// Reads DATABASE_URL (+ source API keys) from .env.local, same as the per-source
// `npm run ingest <name>` script.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(args) {
  console.log(`\n$ ${npm} ${args.join(" ")}`);
  return spawnSync(npm, args, { stdio: "inherit" }).status ?? 1;
}

// 1) Migrations first — never ingest against a stale schema.
if (run(["run", "db:migrate"]) !== 0) {
  console.error("\n✗ migration failed — aborting before ingest");
  process.exit(1);
}

// 2) Discover adapters: every lib/sources/*.ts except the shared contract.
const sources = readdirSync("lib/sources")
  .filter((f) => f.endsWith(".ts") && f !== "types.ts")
  .map((f) => f.slice(0, -3))
  .filter((name) => /^[a-z0-9-]+$/.test(name))
  .sort();

// 3) Run each source. A bad source doesn't abort the rest (matches the cron).
const failed = [];
for (const name of sources) {
  if (run(["run", "ingest", name]) !== 0) failed.push(name);
}

console.log(
  `\nDone: ${sources.length} sources run, ${failed.length} failed` +
    (failed.length ? `: ${failed.join(", ")}` : ""),
);
process.exit(failed.length ? 1 : 0);

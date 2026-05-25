import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runAdapter } from "@/lib/runner";
import type { SourceAdapter } from "@/lib/sources/types";

async function main() {
  const name = process.argv[2];
  if (!name || /[^a-z0-9-]/.test(name)) {
    console.error("usage: tsx ingest/run.ts <adapter-name>");
    console.error(
      "       adapter-name must match /^[a-z0-9-]+$/ and resolve to lib/sources/<name>.ts",
    );
    process.exit(2);
  }

  const adapterUrl = pathToFileURL(
    resolve("lib/sources", `${name}.ts`),
  ).href;
  const mod = (await import(adapterUrl)) as { default?: SourceAdapter };
  if (!mod.default || typeof mod.default !== "object") {
    console.error(`adapter '${name}' did not default-export a SourceAdapter`);
    process.exit(2);
  }

  const result = await runAdapter(mod.default);
  process.exit(result.errors.length > 0 && result.inserted === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      fatal: true,
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exit(2);
});

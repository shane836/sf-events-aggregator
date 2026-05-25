import type {
  Provenance,
  SourceAdapter,
  SourceError,
} from "@/lib/sources/types";
import { persistEvent, startRun, completeRun } from "@/lib/persist";

const PIPELINE_VERSION = "m1-v2";

export type SourceResult = {
  source: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  pages: number;
  fetched: number;
  inserted: number;
  updatedHigher: number;
  appendedSecondary: number;
  skippedLower: number;
  errors: SourceError[];
};

/**
 * Drive an adapter end-to-end: paginate via adapter.fetch(cursor),
 * normalize each RawEvent with provenance, persist via the sole writer.
 * Per-event errors are collected, not thrown — daily cron stays loud only on
 * uncategorized failure modes.
 */
export async function runAdapter(
  adapter: SourceAdapter,
): Promise<SourceResult> {
  const startedAt = new Date();
  const runId = await startRun(adapter.id);

  const errors: SourceError[] = [];
  let fetched = 0;
  let inserted = 0;
  let updatedHigher = 0;
  let appendedSecondary = 0;
  let skippedLower = 0;
  let pages = 0;
  let cursor: string | undefined;
  let lastCursor: string | null | undefined;

  try {
    do {
      pages++;
      const page = await adapter.fetch(cursor);
      errors.push(...page.errors);

      const provenance: Provenance = {
        adapterId: adapter.id,
        adapterVersion: "1.0",
        pipelineVersion: PIPELINE_VERSION,
        normalizedAt: new Date(),
      };

      for (const raw of page.events) {
        fetched++;
        try {
          const normalized = adapter.normalize(raw, provenance);
          const outcome = await persistEvent(normalized);
          switch (outcome.status) {
            case "inserted":
              inserted++;
              break;
            case "updated_higher_verification":
              updatedHigher++;
              break;
            case "appended_secondary":
              appendedSecondary++;
              break;
            case "skipped_lower_verification":
              skippedLower++;
              break;
          }
        } catch (err) {
          errors.push({
            source: adapter.id,
            externalId: raw.identity.externalId,
            stage: "persist",
            message: err instanceof Error ? err.message : String(err),
            retryable: false,
            occurredAt: new Date(),
          });
        }
      }
      lastCursor = page.nextCursor;
      cursor = lastCursor ?? undefined;
    } while (cursor);
  } catch (err) {
    errors.push({
      source: adapter.id,
      stage: "fetch",
      message: err instanceof Error ? err.message : String(err),
      retryable: true,
      occurredAt: new Date(),
    });
  }

  const finishedAt = new Date();
  const result: SourceResult = {
    source: adapter.id,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    pages,
    fetched,
    inserted,
    updatedHigher,
    appendedSecondary,
    skippedLower,
    errors,
  };

  const fatal = errors.length > 0 && inserted === 0 && updatedHigher === 0;
  await completeRun(runId, fatal ? "failed" : "completed", {
    fetched,
    inserted,
    skipped: appendedSecondary + skippedLower,
    errorCount: errors.length,
    cursor: lastCursor ?? null,
    errors: errors.length > 0 ? errors : null,
  });

  console.log(JSON.stringify(result));
  return result;
}

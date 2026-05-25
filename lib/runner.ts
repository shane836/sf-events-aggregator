import type { SourceAdapter, SourceError } from "@/lib/sources/types";
import { persistRow } from "@/lib/upsert";

export type SourceResult = {
  source: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  fetched: number;
  inserted: number;
  skipped: number;
  errors: SourceError[];
};

/**
 * Drive an adapter end-to-end: fetch → normalize each → persist.
 * Per-event errors are collected, not thrown — daily cron stays loud only on
 * uncategorized failure modes.
 */
export async function runAdapter(adapter: SourceAdapter): Promise<SourceResult> {
  const startedAt = new Date();
  const fetchResult = await adapter.fetch();
  const errors: SourceError[] = [...fetchResult.errors];
  let inserted = 0;
  let skipped = 0;

  for (const raw of fetchResult.events) {
    try {
      const normalized = adapter.normalize(raw);
      const { inserted: didInsert } = await persistRow(normalized);
      if (didInsert) inserted++;
      else skipped++;
    } catch (err) {
      errors.push({
        sourceId: raw.sourceId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const finishedAt = new Date();
  const result: SourceResult = {
    source: adapter.id,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    fetched: fetchResult.events.length,
    inserted,
    skipped,
    errors,
  };
  console.log(JSON.stringify(result));
  return result;
}

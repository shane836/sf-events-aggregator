import type {
  Provenance,
  FetchResult,
  SourceAdapter,
  SourceError,
} from "@/lib/sources/types";
import { persistEvent, startRun, completeRun } from "@/lib/persist";

const PIPELINE_VERSION = "m1-v2";

export type SourceResult = {
  source: string;
  status: "completed" | "partial" | "failed";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  pages: number;
  fetched: number;
  inserted: number;
  updatedHigher: number;
  updatedSameSource: number;
  appendedSecondary: number;
  skippedLower: number;
  errors: SourceError[];
};

function databaseCause(error: unknown): { code: string; constraint?: string } | undefined {
  let current = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const value = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (typeof value.code === "string" && /^[A-Z0-9]{5}$/.test(value.code)) {
      return {
        code: value.code,
        ...(typeof value.constraint_name === "string" && /^[a-zA-Z0-9_]+$/.test(value.constraint_name)
          ? { constraint: value.constraint_name } : {}),
      };
    }
    current = value.cause;
  }
}

async function fetchWithRetry(adapter: SourceAdapter, cursor?: string): Promise<FetchResult> {
  for (let attempt = 0; ; attempt++) {
    let page: FetchResult;
    try {
      page = await adapter.fetch(cursor);
    } catch (error) {
      page = { events: [], fetchedAt: new Date(), errors: [{ source: adapter.id, stage: "fetch", message: error instanceof Error ? error.message : String(error), retryable: true, occurredAt: new Date() }] };
    }
    const retryable = page.errors.length > 0 && page.errors.every(error => {
      const status = error.httpStatus ?? Number(error.message.match(/\bHTTP (\d{3})\b/)?.[1]);
      return error.stage === "fetch" && error.retryable && (!status || status >= 500 || status === 408 || status === 429);
    });
    if (page.events.length > 0 || !retryable || attempt >= 2) return page;
    console.warn(JSON.stringify({ source: adapter.id, retry: attempt + 1, errors: page.errors }));
    await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
  }
}

/**
 * Drive an adapter end-to-end: paginate via adapter.fetch(cursor),
 * normalize each RawEvent with provenance, persist via the sole writer.
 * Per-event errors are collected, not thrown — daily cron stays loud only on
 * uncategorized failure modes.
 */
export async function runAdapter(
  adapter: SourceAdapter,
  options: { concurrency?: number } = {},
): Promise<SourceResult> {
  const concurrency = options.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new Error("concurrency must be an integer from 1 to 4");
  }
  const startedAt = new Date();
  const runId = await startRun(adapter.id);

  const errors: SourceError[] = [];
  let fetched = 0;
  let inserted = 0;
  let updatedHigher = 0;
  let updatedSameSource = 0;
  let appendedSecondary = 0;
  let skippedLower = 0;
  let pages = 0;
  let cursor: string | undefined;
  let lastCursor: string | null | undefined;

  try {
    do {
      pages++;
      const page = await fetchWithRetry(adapter, cursor);
      errors.push(...page.errors);
      if (page.partial && page.errors.length === 0) {
        errors.push({ source: adapter.id, stage: "fetch", message: "adapter returned incomplete results", retryable: false, occurredAt: new Date() });
      }

      const provenance: Provenance = {
        adapterId: adapter.id,
        adapterVersion: "1.0",
        pipelineVersion: PIPELINE_VERSION,
        normalizedAt: new Date(),
      };

      const processEvent = async (raw: FetchResult["events"][number]) => {
        fetched++;
        let normalized;
        try {
          normalized = adapter.normalize(raw, provenance);
        } catch (error) {
          errors.push({ source: adapter.id, externalId: raw.identity.externalId, stage: "normalize", message: error instanceof Error ? error.message : String(error), retryable: false, occurredAt: new Date() });
          return;
        }
        try {
          const outcome = await persistEvent(normalized);
          switch (outcome.status) {
            case "inserted":
              inserted++;
              break;
            case "updated_higher_verification":
              updatedHigher++;
              break;
            case "updated_same_source":
              updatedSameSource++;
              break;
            case "appended_secondary":
              appendedSecondary++;
              break;
            case "skipped_lower_verification":
              skippedLower++;
              break;
          }
        } catch (err) {
          const cause = databaseCause(err);
          const message = err instanceof Error ? err.message : String(err);
          errors.push({
            source: adapter.id,
            externalId: raw.identity.externalId,
            stage: "persist",
            message: cause ? `database error ${cause.code}${cause.constraint ? ` (${cause.constraint})` : ""}`
              : message.startsWith("Failed query:") ? "database query failed (no PostgreSQL error code available)" : message,
            cause,
            retryable: cause != null && (cause.code.startsWith("08") || ["40001", "40P01", "55P03", "57014", "57P01"].includes(cause.code)),
            occurredAt: new Date(),
          });
        }
      };
      // Ticketmaster deduplicates source IDs before returning a page. Keep
      // other adapters sequential unless they explicitly opt into this bound.
      for (let offset = 0; offset < page.events.length; offset += concurrency) {
        await Promise.all(page.events.slice(offset, offset + concurrency).map(processEvent));
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
  const processed = inserted + updatedHigher + updatedSameSource + appendedSecondary + skippedLower;
  const status = errors.length === 0 ? "completed" : processed > 0 ? "partial" : "failed";
  const result: SourceResult = {
    source: adapter.id,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    pages,
    fetched,
    inserted,
    updatedHigher,
    updatedSameSource,
    appendedSecondary,
    skippedLower,
    errors,
  };

  await completeRun(runId, status, {
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

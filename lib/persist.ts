import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { venues, events, ingestionRuns } from "@/db/schema";
import { normalizeVenueName } from "@/lib/identity";
import type {
  NormalizedEvent,
  SecondarySource,
  VenueCandidate,
  VerificationLevel,
} from "@/lib/sources/types";

/**
 * Sole writer for events + venues. No other module imports db/client for
 * writes — that invariant is checked in the M1-v2 rubric (C1).
 *
 * Each event write is transactional. A transaction-scoped advisory lock
 * serializes matching identities across ingestion processes; both unique
 * indexes remain the final guard against other writers.
 */

const VERIFICATION_RANK: Record<VerificationLevel, number> = {
  unverified: 0,
  community: 1,
  trusted_partner: 2,
  official: 3,
};

export type PersistOutcome =
  | { status: "inserted"; id: string }
  | { status: "updated_same_source"; id: string }
  | { status: "updated_higher_verification"; id: string }
  | { status: "appended_secondary"; id: string }
  | { status: "skipped_lower_verification"; id: string };

type PersistenceTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function upsertVenue(tx: PersistenceTransaction, v: VenueCandidate): Promise<string> {
  const normalized = normalizeVenueName(v.name);

  const inserted = await tx
    .insert(venues)
    .values({
      normalizedName: normalized,
      name: v.name,
      // Default to the original single-city scope when an adapter omits city.
      city: v.city ?? "San Francisco",
      neighborhood: v.neighborhood ?? null,
      address: v.address ?? null,
      lat: v.lat != null ? v.lat.toString() : null,
      lng: v.lng != null ? v.lng.toString() : null,
      timezone: v.timezone ?? null,
    })
    .onConflictDoUpdate({
      target: venues.normalizedName,
      // COALESCE pattern: enrich, never overwrite with null
      set: {
        city: sql`coalesce(excluded.city, ${venues.city})`,
        neighborhood: sql`coalesce(excluded.neighborhood, ${venues.neighborhood})`,
        address: sql`coalesce(excluded.address, ${venues.address})`,
        lat: sql`coalesce(excluded.lat, ${venues.lat})`,
        lng: sql`coalesce(excluded.lng, ${venues.lng})`,
        timezone: sql`coalesce(excluded.timezone, ${venues.timezone})`,
      },
    })
    .returning({ id: venues.id });

  if (inserted.length === 0) {
    // ON CONFLICT DO UPDATE with no actual change returns nothing on older PG;
    // fall back to a SELECT.
    const existing = await tx
      .select({ id: venues.id })
      .from(venues)
      .where(sql`${venues.normalizedName} = ${normalized}`)
      .limit(1);
    if (existing.length === 0) {
      throw new Error(
        `venue upsert race: '${v.name}' (normalized='${normalized}')`,
      );
    }
    return existing[0].id;
  }
  return inserted[0].id;
}

/**
 * Source identity survives title/time/venue edits. Cross-source matches still
 * follow verification rank. Conflicting existing rows require manual review;
 * this writer never deletes or automatically combines those rows.
 */
export async function persistEvent(
  e: NormalizedEvent,
): Promise<PersistOutcome> {
  return db.transaction(async (tx) => {
    // Lock both identities, including ones not yet present. A consistent order
    // avoids lock cycles; unrelated events can still ingest concurrently.
    await tx.execute(sql`set local lock_timeout = '10s'`);
    await tx.execute(sql`set local statement_timeout = '30s'`);
    const lockKeys = [
      `canonical:${e.canonicalFingerprint}`,
      `source:${JSON.stringify([e.identity.source, e.identity.externalId])}`,
    ].sort();
    for (const key of lockKeys) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    }

    const matches = await tx
      .select({
        id: events.id,
        source: events.source,
        externalId: events.externalId,
        sourceUrl: events.sourceUrl,
        canonicalFingerprint: events.canonicalFingerprint,
        verificationLevel: events.verificationLevel,
        secondarySources: events.secondarySources,
      })
      .from(events)
      .where(sql`
        (${events.source} = ${e.identity.source} and ${events.externalId} = ${e.identity.externalId})
        or ${events.canonicalFingerprint} = ${e.canonicalFingerprint}
        or ${events.secondarySources} @> ${JSON.stringify([{ source: e.identity.source, externalId: e.identity.externalId }])}::jsonb
      `)
      .orderBy(events.id)
      .for("update");

    if (matches.length > 1) {
      throw new Error(
        `identity_conflict: ${e.identity.source}/${e.identity.externalId} matches multiple events; manual review required`,
      );
    }

    const existing = matches[0];
    const sameSource = existing?.source === e.identity.source && existing?.externalId === e.identity.externalId;
    if (existing && !sameSource && existing.canonicalFingerprint !== e.canonicalFingerprint) {
      throw new Error(
        `identity_conflict: secondary ${e.identity.source}/${e.identity.externalId} changed fingerprint; manual review required`,
      );
    }

    const incomingRank = VERIFICATION_RANK[e.verificationLevel];
    const existingRank = existing
      ? VERIFICATION_RANK[existing.verificationLevel as VerificationLevel] ?? 0
      : -1;
    if (sameSource && incomingRank < existingRank) {
      return { status: "skipped_lower_verification", id: existing.id };
    }

    // Resolve the venue only after identity checks. All writes roll back if a
    // later constraint fails, including venue enrichment.
    const venueId = await upsertVenue(tx, e.venue);
    const values = {
      source: e.identity.source,
      externalId: e.identity.externalId,
      sourceUrl: e.identity.sourceUrl,
      sourceVersion: e.identity.sourceVersion ?? null,
      title: e.title,
      description: e.description,
      category: e.category,
      startTimeUtc: e.startTimeUtc,
      endTimeUtc: e.endTimeUtc,
      timezone: e.timezone,
      venueId,
      priceMin: e.pricing.priceMin != null ? e.pricing.priceMin.toString() : null,
      priceMax: e.pricing.priceMax != null ? e.pricing.priceMax.toString() : null,
      isFree: e.pricing.isFree ?? false,
      seriesId: e.recurrence?.seriesId ?? null,
      occurrenceId: e.recurrence?.occurrenceId ?? null,
      canonicalFingerprint: e.canonicalFingerprint,
      verificationLevel: e.verificationLevel,
      provenance: e.provenance as unknown as object,
      rawPayload: e.rawPayload as unknown as object,
    };

    if (!existing) {
      const [inserted] = await tx.insert(events).values({ ...values, secondarySources: [] }).returning({ id: events.id });
      return { status: "inserted", id: inserted.id };
    }

    const secondaries = (existing.secondarySources as SecondarySource[]) ?? [];
    if (sameSource || incomingRank > existingRank) {
      // Drop legacy self-attribution. If the primary changes, retain the old
      // primary exactly once and remove the incoming primary from secondaries.
      const retained = secondaries.filter(s =>
        !(s.source === e.identity.source && s.externalId === e.identity.externalId),
      );
      if (!sameSource && !retained.some(s => s.source === existing.source && s.externalId === existing.externalId)) {
        retained.push({
          source: existing.source,
          externalId: existing.externalId,
          sourceUrl: existing.sourceUrl,
          verificationLevel: existing.verificationLevel as VerificationLevel,
          observedAt: new Date(),
        });
      }
      await tx.update(events).set({ ...values, secondarySources: retained, ingestedAt: new Date() })
        .where(sql`${events.id} = ${existing.id}`);
      return { status: sameSource ? "updated_same_source" : "updated_higher_verification", id: existing.id };
    }

    if (secondaries.some(s => s.source === e.identity.source && s.externalId === e.identity.externalId)) {
      return { status: "skipped_lower_verification", id: existing.id };
    }
    const secondary: SecondarySource = {
      source: e.identity.source,
      externalId: e.identity.externalId,
      sourceUrl: e.identity.sourceUrl,
      verificationLevel: e.verificationLevel,
      observedAt: new Date(),
    };
    await tx.update(events).set({ secondarySources: [...secondaries, secondary] })
      .where(sql`${events.id} = ${existing.id}`);
    return { status: "appended_secondary", id: existing.id };
  });
}

/* ---------- ingestion_runs helpers ---------- */

export async function startRun(source: string): Promise<string> {
  return db.transaction(async tx => {
    const now = new Date();
    const staleError = JSON.stringify([{ source, stage: "persist", message: "run exceeded 24 hours without completion; marked stale", retryable: false, occurredAt: now }]);
    await tx.update(ingestionRuns).set({
      status: "failed",
      completedAt: now,
      errorCount: sql`${ingestionRuns.errorCount} + 1`,
      errors: sql`coalesce(${ingestionRuns.errors}, '[]'::jsonb) || ${staleError}::jsonb`,
    }).where(sql`${ingestionRuns.source} = ${source} and ${ingestionRuns.status} = 'running' and ${ingestionRuns.startedAt} < now() - interval '24 hours'`);
    const [row] = await tx.insert(ingestionRuns)
      .values({ source, status: "running" })
      .returning({ id: ingestionRuns.id });
    return row.id;
  });
}

export async function completeRun(
  runId: string,
  status: "completed" | "partial" | "failed",
  stats: {
    fetched?: number;
    inserted?: number;
    skipped?: number;
    errorCount: number;
    cursor?: string | null;
    errors?: unknown;
  },
): Promise<void> {
  await db
    .update(ingestionRuns)
    .set({
      status,
      completedAt: new Date(),
      fetched: stats.fetched ?? null,
      inserted: stats.inserted ?? null,
      skipped: stats.skipped ?? null,
      errorCount: stats.errorCount,
      cursor: stats.cursor ?? null,
      errors: (stats.errors as object) ?? null,
    })
    .where(sql`${ingestionRuns.id} = ${runId}`);
}

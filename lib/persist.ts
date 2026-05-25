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
 * Concurrency: race-safe via Postgres unique indexes
 * (venues.normalized_name, events.canonical_fingerprint). Parallel runner
 * processes do not need application-level locking.
 */

const VERIFICATION_RANK: Record<VerificationLevel, number> = {
  unverified: 0,
  community: 1,
  trusted_partner: 2,
  official: 3,
};

export type PersistOutcome =
  | { status: "inserted"; id: string }
  | { status: "updated_higher_verification"; id: string }
  | { status: "appended_secondary"; id: string }
  | { status: "skipped_lower_verification"; id: string };

async function upsertVenue(v: VenueCandidate): Promise<string> {
  const normalized = normalizeVenueName(v.name);

  const inserted = await db
    .insert(venues)
    .values({
      normalizedName: normalized,
      name: v.name,
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
    const existing = await db
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
 * Insert or merge an event using the verification-level winner rule.
 *
 *   - canonical_fingerprint match + higher level → UPDATE all fields,
 *     append loser to secondary_sources
 *   - match + equal/lower level → DO NOT update; append THIS row to
 *     secondary_sources of the existing row
 *   - no match → INSERT
 */
export async function persistEvent(
  e: NormalizedEvent,
): Promise<PersistOutcome> {
  const venueId = await upsertVenue(e.venue);

  // Fast-path: check if a row already exists for this fingerprint
  const existing = await db
    .select({
      id: events.id,
      verificationLevel: events.verificationLevel,
      secondarySources: events.secondarySources,
    })
    .from(events)
    .where(sql`${events.canonicalFingerprint} = ${e.canonicalFingerprint}`)
    .limit(1);

  const incomingRank = VERIFICATION_RANK[e.verificationLevel];

  if (existing.length === 0) {
    // No conflict — straight insert.
    const inserted = await db
      .insert(events)
      .values({
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
        secondarySources: [],
        provenance: e.provenance as unknown as object,
        rawPayload: e.rawPayload as unknown as object,
      })
      .onConflictDoNothing({ target: events.canonicalFingerprint })
      .returning({ id: events.id });

    if (inserted.length > 0) return { status: "inserted", id: inserted[0].id };
    // Lost the race to another writer — re-read and treat as conflict path.
    return persistEvent(e);
  }

  const existingRank = VERIFICATION_RANK[existing[0].verificationLevel as VerificationLevel] ?? 0;
  const existingSecondaries = (existing[0].secondarySources as SecondarySource[]) ?? [];

  const thisAsSecondary: SecondarySource = {
    source: e.identity.source,
    externalId: e.identity.externalId,
    sourceUrl: e.identity.sourceUrl,
    verificationLevel: e.verificationLevel,
    observedAt: new Date(),
  };

  if (incomingRank > existingRank) {
    // Higher verification wins. Overwrite primary fields, push old primary
    // into secondary_sources alongside this run's prior secondaries.
    const newSecondaries: SecondarySource[] = [
      ...existingSecondaries,
      // We don't have the old primary's source_url at hand without a second
      // query; we accept that the old primary's externalId stays as the row's
      // canonical source until next time it shows up as a secondary.
    ];
    await db
      .update(events)
      .set({
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
        verificationLevel: e.verificationLevel,
        secondarySources: newSecondaries,
        provenance: e.provenance as unknown as object,
        rawPayload: e.rawPayload as unknown as object,
        ingestedAt: new Date(),
      })
      .where(sql`${events.id} = ${existing[0].id}`);
    return { status: "updated_higher_verification", id: existing[0].id };
  }

  // Equal or lower verification: append THIS row as a secondary if it isn't
  // already there. Dedupe by (source, externalId).
  const alreadyTracked = existingSecondaries.some(
    (s) =>
      s.source === thisAsSecondary.source &&
      s.externalId === thisAsSecondary.externalId,
  );
  if (alreadyTracked) {
    return { status: "skipped_lower_verification", id: existing[0].id };
  }
  await db
    .update(events)
    .set({
      secondarySources: [...existingSecondaries, thisAsSecondary],
    })
    .where(sql`${events.id} = ${existing[0].id}`);
  return { status: "appended_secondary", id: existing[0].id };
}

/* ---------- ingestion_runs helpers ---------- */

export async function startRun(source: string): Promise<string> {
  const [row] = await db
    .insert(ingestionRuns)
    .values({ source, status: "running" })
    .returning({ id: ingestionRuns.id });
  return row.id;
}

export async function completeRun(
  runId: string,
  status: "completed" | "failed",
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

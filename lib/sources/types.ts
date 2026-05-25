/**
 * Source adapter contract.
 *
 * This file is the frozen interface between ingestion sources (Streams B/C/D)
 * and the persister (Stream A). All cross-stream data flows through these
 * types. See docs/IDENTITY.md for ownership rules and the three-layer
 * identity model.
 *
 * Invariants enforced by this contract:
 *   - fetch() is the only IO entrypoint on an adapter
 *   - normalize() is pure and synchronous
 *   - adapters do not import each other and do not write to the DB
 *   - identity (canonicalFingerprint) is derived from name + venue + local time,
 *     never from a surrogate venueId
 */

export type Category = "music" | "comedy" | "lectures" | "dancing" | "food";

export type SourceTier = "api" | "ical" | "scrape";

export type VerificationLevel =
  | "official"        // first-party API or venue-owned feed
  | "trusted_partner" // Ticketmaster, SeatGeek, university iCal
  | "community"       // editorial aggregators (Eater, Funcheap)
  | "unverified";     // anything else

export type ExternalIdentity = {
  source: string;            // 'ticketmaster' | 'ical:stanford' | 'scrape:cobbs'
  externalId: string;        // stable per source
  sourceUrl: string;         // click-through, REQUIRED on every event
  sourceVersion?: string | null;
};

export type VenueCandidate = {
  externalVenueId?: string | null;
  name: string;
  address?: string | null;
  neighborhood?: string | null;
  lat?: number | null;
  lng?: number | null;
  timezone?: string | null;
};

export type PriceInfo = {
  priceMin?: number | null;
  priceMax?: number | null;
  isFree?: boolean;
};

/**
 * Recurrence representation for MVP.
 * iCal adapters expand RRULE in-adapter and emit one RawEvent per occurrence,
 * with each occurrence sharing the same seriesId. No RRULE column in DB.
 */
export type RecurrenceInfo = {
  seriesId: string;
  occurrenceId: string;
};

export type RawEvent = {
  identity: ExternalIdentity;

  title: string;
  description?: string | null;

  /** Always store UTC. Local-time grouping is derived from timezone below. */
  startTimeUtc: Date;
  endTimeUtc?: Date | null;

  /** IANA timezone, e.g. 'America/Los_Angeles'. Required for stable fingerprints. */
  timezone: string;

  venue: VenueCandidate;

  /** Adapter-chosen single category. Multi-category is out of scope for MVP. */
  primaryCategory: Category;

  pricing?: PriceInfo | null;

  recurrence?: RecurrenceInfo | null;

  verificationLevel: VerificationLevel;

  /**
   * Raw source payload for debugging.
   * Truncated to 50KB by persister; rows past that get the ref-only path.
   */
  rawPayload?: unknown;

  fetchedAt: Date;
};

export type ErrorStage = "fetch" | "parse" | "normalize" | "persist";

export type SourceError = {
  source?: string;
  externalId?: string;
  stage: ErrorStage;
  message: string;
  retryable: boolean;
  httpStatus?: number;
  rateLimited?: boolean;
  cause?: unknown;
  occurredAt: Date;
};

export type FetchResult = {
  events: RawEvent[];
  errors: SourceError[];
  fetchedAt: Date;
  /** True if the fetcher knows it returned incomplete results (rate limit, timeout). */
  partial?: boolean;
  /** Opaque cursor for the next page; absent means no more pages. */
  nextCursor?: string | null;
};

export type Provenance = {
  adapterId: string;
  adapterVersion: string;
  pipelineVersion: string;
  normalizedAt: Date;
};

/**
 * Typed attribution for cross-source merges. When two adapters produce the
 * same canonicalFingerprint, the higher-verification row wins and the loser
 * is appended here. Persisted as jsonb on the events table.
 */
export type SecondarySource = {
  source: string;
  externalId: string;
  sourceUrl: string;
  verificationLevel: VerificationLevel;
  observedAt: Date;
};

/**
 * Persistence-ready event. Decoupled from db/schema on purpose: the
 * persister (Stream A) bridges this shape to the DB row shape, which lets
 * the contract evolve faster than the schema.
 */
export type NormalizedEvent = {
  canonicalFingerprint: string;

  identity: ExternalIdentity;

  title: string;
  description: string | null;

  /** Persisted as timestamptz; UI derives local day via timezone. */
  startTimeUtc: Date;
  endTimeUtc: Date | null;

  timezone: string;

  category: Category;

  pricing: PriceInfo;

  /** Adapter-supplied venue data; persister resolves to a venues.id. */
  venue: VenueCandidate;

  recurrence: RecurrenceInfo | null;

  verificationLevel: VerificationLevel;

  rawPayload: unknown;

  provenance: Provenance;
};

export interface SourceAdapter {
  readonly id: string;
  readonly tier: SourceTier;
  readonly verificationLevel: VerificationLevel;

  /**
   * The only IO method on this interface. May paginate via the optional
   * cursor argument; callers loop until result.nextCursor is null/undefined.
   */
  fetch(cursor?: string): Promise<FetchResult>;

  /**
   * MUST be pure and synchronous. No network, no DB, no clock reads other
   * than provenance.normalizedAt being passed in by the caller.
   */
  normalize(raw: RawEvent, provenance: Provenance): NormalizedEvent;
}

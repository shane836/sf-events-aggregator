import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  boolean,
  jsonb,
  integer,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const categoryEnum = pgEnum("category", [
  "music",
  "comedy",
  "lectures",
  "dancing",
  "food",
]);

export const venues = pgTable(
  "venues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    normalizedName: text("normalized_name").notNull(),
    name: text("name").notNull(),
    neighborhood: text("neighborhood"),
    address: text("address"),
    lat: numeric("lat", { precision: 9, scale: 6 }),
    lng: numeric("lng", { precision: 9, scale: 6 }),
    timezone: text("timezone"),
    primaryCategory: categoryEnum("primary_category"),
    sourceMetadata: jsonb("source_metadata"),
  },
  (t) => [
    uniqueIndex("venues_normalized_name_idx").on(t.normalizedName),
    index("venues_neighborhood_idx").on(t.neighborhood),
  ],
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    // Source identity
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceVersion: text("source_version"),

    // Content
    title: text("title").notNull(),
    description: text("description"),
    category: categoryEnum("category").notNull(),

    // Time (UTC stored, local derived from timezone)
    startTimeUtc: timestamp("start_time_utc", { withTimezone: true }).notNull(),
    endTimeUtc: timestamp("end_time_utc", { withTimezone: true }),
    timezone: text("timezone").notNull(),

    // Venue link
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "restrict" }),

    // Pricing (structured; UI calls formatPriceDisplay() at render time)
    priceMin: numeric("price_min", { precision: 10, scale: 2 }),
    priceMax: numeric("price_max", { precision: 10, scale: 2 }),
    isFree: boolean("is_free").notNull().default(false),

    // Recurrence
    seriesId: text("series_id"),
    occurrenceId: text("occurrence_id"),

    // Cross-source identity + attribution
    canonicalFingerprint: text("canonical_fingerprint").notNull(),
    verificationLevel: text("verification_level").notNull(),
    secondarySources: jsonb("secondary_sources").notNull().default("[]"),

    // Provenance + debug
    provenance: jsonb("provenance"),
    rawPayload: jsonb("raw_payload"),

    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("events_canonical_fingerprint_idx").on(t.canonicalFingerprint),
    uniqueIndex("events_source_external_id_idx").on(t.source, t.externalId),
    index("events_start_time_utc_idx").on(t.startTimeUtc),
    index("events_category_idx").on(t.category),
    index("events_venue_idx").on(t.venueId),
    index("events_series_idx").on(t.seriesId),
  ],
);

export const ingestionRuns = pgTable(
  "ingestion_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: text("source").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    status: text("status").notNull(), // 'running' | 'completed' | 'failed'
    fetched: integer("fetched"),
    inserted: integer("inserted"),
    skipped: integer("skipped"),
    errorCount: integer("error_count").notNull().default(0),
    cursor: text("cursor"),
    errors: jsonb("errors"),
  },
  (t) => [
    index("ingestion_runs_source_idx").on(t.source),
    index("ingestion_runs_started_idx").on(t.startedAt),
  ],
);

export const digestSends = pgTable("digest_sends", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  filtersApplied: jsonb("filters_applied"),
  eventCount: integer("event_count").notNull(),
});

export type Venue = typeof venues.$inferSelect;
export type NewVenue = typeof venues.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type IngestionRun = typeof ingestionRuns.$inferSelect;
export type NewIngestionRun = typeof ingestionRuns.$inferInsert;
export type DigestSend = typeof digestSends.$inferSelect;
export type NewDigestSend = typeof digestSends.$inferInsert;

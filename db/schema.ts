import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  boolean,
  jsonb,
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
    name: text("name").notNull(),
    neighborhood: text("neighborhood"),
    address: text("address"),
    lat: numeric("lat", { precision: 9, scale: 6 }),
    lng: numeric("lng", { precision: 9, scale: 6 }),
    primaryCategory: categoryEnum("primary_category"),
    sourceMetadata: jsonb("source_metadata"),
  },
  (t) => [
    uniqueIndex("venues_name_address_idx").on(t.name, t.address),
    index("venues_neighborhood_idx").on(t.neighborhood),
  ],
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: text("source_id").notNull(),
    source: text("source").notNull(),
    sourceUrl: text("source_url").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    category: categoryEnum("category").notNull(),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "restrict" }),
    priceMin: numeric("price_min", { precision: 10, scale: 2 }),
    priceMax: numeric("price_max", { precision: 10, scale: 2 }),
    isFree: boolean("is_free").notNull().default(false),
    priceDisplay: text("price_display").notNull(),
    rawPayload: jsonb("raw_payload"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    fingerprint: text("fingerprint").notNull(),
  },
  (t) => [
    uniqueIndex("events_fingerprint_idx").on(t.fingerprint),
    uniqueIndex("events_source_sourceid_idx").on(t.source, t.sourceId),
    index("events_start_time_idx").on(t.startTime),
    index("events_category_idx").on(t.category),
    index("events_venue_idx").on(t.venueId),
  ],
);

export const digestSends = pgTable("digest_sends", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  filtersApplied: jsonb("filters_applied"),
  eventCount: numeric("event_count", { precision: 6, scale: 0 }).notNull(),
});

export type Venue = typeof venues.$inferSelect;
export type NewVenue = typeof venues.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type DigestSend = typeof digestSends.$inferSelect;
export type NewDigestSend = typeof digestSends.$inferInsert;

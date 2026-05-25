import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { venues, events } from "@/db/schema";
import type { NormalizedRow } from "@/lib/sources/types";

type PersistResult = { inserted: boolean; reason?: string };

async function upsertVenue(v: NormalizedRow["venue"]): Promise<string> {
  const inserted = await db
    .insert(venues)
    .values(v)
    .onConflictDoNothing({ target: [venues.name, venues.address] })
    .returning({ id: venues.id });

  if (inserted.length > 0) return inserted[0].id;

  const existing = await db
    .select({ id: venues.id })
    .from(venues)
    .where(
      v.address
        ? sql`${venues.name} = ${v.name} and ${venues.address} = ${v.address}`
        : sql`${venues.name} = ${v.name} and ${venues.address} is null`,
    )
    .limit(1);

  if (existing.length === 0) {
    throw new Error(
      `venue lookup raced: '${v.name}' / '${v.address ?? ""}'`,
    );
  }
  return existing[0].id;
}

export async function persistRow(row: NormalizedRow): Promise<PersistResult> {
  const venueId = await upsertVenue(row.venue);
  const eventRow = { ...row.event, venueId };
  try {
    const result = await db
      .insert(events)
      .values(eventRow)
      .onConflictDoNothing({ target: events.fingerprint })
      .returning({ id: events.id });
    if (result.length > 0) return { inserted: true };
    return { inserted: false, reason: "fingerprint_conflict" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("events_source_sourceid_idx")) {
      return { inserted: false, reason: "source_sourceid_conflict" };
    }
    throw err;
  }
}

import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { fingerprint } from "@/lib/identity";
import type { NormalizedEvent, SourceAdapter } from "@/lib/sources/types";

const state = vi.hoisted(() => ({ db: null as ReturnType<typeof drizzle<typeof schema>> | null }));

// Never use db/client's application connection, even when .env.local is loaded.
vi.mock("@/db/client", () => ({
  db: new Proxy({}, {
    get(_target, prop) {
      if (!state.db) throw new Error("isolated persistence test database is not initialized");
      const value = Reflect.get(state.db, prop);
      return typeof value === "function" ? value.bind(state.db) : value;
    },
  }),
}));

import { persistEvent, startRun } from "@/lib/persist";
import { runAdapter } from "@/lib/runner";

function event(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  const e: NormalizedEvent = {
    identity: { source: "ticketmaster", externalId: "show-1", sourceUrl: "https://example.com/show-1" },
    title: "Original show",
    description: null,
    startTimeUtc: new Date("2026-11-12T04:00:00Z"),
    endTimeUtc: null,
    timezone: "America/Los_Angeles",
    venue: { name: "Test Hall", city: "Oakland" },
    category: "music",
    pricing: { priceMin: 20, isFree: false },
    recurrence: null,
    verificationLevel: "trusted_partner",
    canonicalFingerprint: "",
    rawPayload: {},
    provenance: { adapterId: "ticketmaster", adapterVersion: "1", pipelineVersion: "test", normalizedAt: new Date() },
    ...overrides,
  };
  e.canonicalFingerprint = fingerprint({ title: e.title, venueName: e.venue.name, startTimeUtc: e.startTimeUtc, timezone: e.timezone });
  return e;
}

const testUrl = process.env.PERSIST_TEST_DATABASE_URL;
describe.skipIf(!testUrl)("persistence with isolated PostgreSQL (requires PERSIST_TEST_DATABASE_URL)", () => {
  let client: ReturnType<typeof postgres>;
  beforeAll(async () => {
    const url = new URL(testUrl!);
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/sf_events_ingestion_test") {
      throw new Error("Persistence tests require localhost database sf_events_ingestion_test");
    }
    client = postgres(testUrl!, { max: 8, prepare: false });
    // The disposable database must be empty. Never drop a pre-existing schema.
    await client.unsafe(readFileSync("drizzle/0000_long_blob.sql", "utf8"));
    await client.unsafe(readFileSync("drizzle/0001_opposite_mongoose.sql", "utf8"));
    state.db = drizzle(client, { schema });
  });
  beforeEach(async () => {
    await client`truncate events, venues, ingestion_runs`;
  });
  afterAll(async () => { if (client) await client.end(); });

  it.each([
    { title: "Renamed show" },
    { startTimeUtc: new Date("2026-11-13T04:00:00Z") },
    { venue: { name: "New Hall", city: "Oakland" } },
  ])("updates a source edit in place: %j", async (change) => {
    const original = await persistEvent(event());
    const edited = event(change);
    const result = await persistEvent(edited);
    const rows = await state.db!.select().from(schema.events);
    expect(result.id).toBe(original.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].canonicalFingerprint).toBe(edited.canonicalFingerprint);
    expect(rows[0].title).toBe(edited.title);
    expect(rows[0].startTimeUtc).toEqual(edited.startTimeUtc);
  });

  it("refreshes same-source content and price without adding self-attribution", async () => {
    const original = await persistEvent(event());
    await persistEvent(event({ description: "Updated details", pricing: { priceMin: 35 } }));
    const [row] = await state.db!.select().from(schema.events);
    expect(row.id).toBe(original.id);
    expect(row.description).toBe("Updated details");
    expect(row.priceMin).toBe("35.00");
    expect(row.secondarySources).toEqual([]);
  });

  it("rolls back both event and venue writes when source and fingerprint identify different rows", async () => {
    await persistEvent(event());
    const other = event({ title: "Other show", identity: { source: "official", externalId: "other", sourceUrl: "https://example.com/other" }, venue: { name: "Other Hall" } });
    await persistEvent(other);
    const before = await state.db!.select().from(schema.events);
    const venuesBefore = await state.db!.select().from(schema.venues);
    await expect(persistEvent(event({ title: other.title, venue: other.venue }))).rejects.toThrow(/identity.conflict/i);
    expect(await state.db!.select().from(schema.events)).toEqual(before);
    expect(await state.db!.select().from(schema.venues)).toEqual(venuesBefore);
  });

  it("preserves the previous primary's attribution when higher verification wins", async () => {
    const original = await persistEvent(event());
    await persistEvent(event({ identity: { source: "official", externalId: "venue-show", sourceUrl: "https://example.com/venue-show" }, verificationLevel: "official" }));
    const [row] = await state.db!.select().from(schema.events);
    expect(row.id).toBe(original.id);
    expect(row.source).toBe("official");
    expect(row.secondarySources).toEqual([expect.objectContaining({ source: "ticketmaster", externalId: "show-1", sourceUrl: "https://example.com/show-1" })]);
    await persistEvent(event());
    expect((await state.db!.select().from(schema.events))[0].secondarySources).toHaveLength(1);
  });

  it("does not create another event when an attributed secondary changes its fingerprint", async () => {
    await persistEvent(event({ identity: { source: "official", externalId: "venue-show", sourceUrl: "https://example.com/venue-show" }, verificationLevel: "official" }));
    await persistEvent(event());
    await expect(persistEvent(event({ title: "Secondary renamed" }))).rejects.toThrow(/identity.conflict/i);
    expect(await state.db!.select().from(schema.events)).toHaveLength(1);
  });

  it("retains the winner when a lower-verification source matches its fingerprint", async () => {
    await persistEvent(event({ verificationLevel: "official" }));
    await persistEvent(event({ identity: { source: "community", externalId: "other", sourceUrl: "https://example.com/community" }, verificationLevel: "community", pricing: { isFree: true } }));
    const [row] = await state.db!.select().from(schema.events);
    expect(row.source).toBe("ticketmaster");
    expect(row.priceMin).toBe("20.00");
    expect(row.secondarySources).toHaveLength(1);
  });

  it("keeps distinct performances separate", async () => {
    await persistEvent(event());
    await persistEvent(event({ identity: { source: "ticketmaster", externalId: "late-show", sourceUrl: "https://example.com/late" }, startTimeUtc: new Date("2026-11-12T06:00:00Z") }));
    expect(await state.db!.select().from(schema.events)).toHaveLength(2);
  });

  it("handles concurrent inserts and edits of the same source identity", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => persistEvent(event({ title: `Revision ${i}` }))));
    expect(new Set(results.map(r => r.id)).size).toBe(1);
    expect(await state.db!.select().from(schema.events)).toHaveLength(1);
  });

  it("preserves concurrent secondary attribution", async () => {
    await persistEvent(event({ verificationLevel: "official" }));
    await Promise.all(Array.from({ length: 5 }, (_, i) => persistEvent(event({ identity: { source: `community-${i}`, externalId: "other", sourceUrl: "https://example.com/community" }, verificationLevel: "community" }))));
    const [row] = await state.db!.select().from(schema.events);
    expect(row.secondarySources).toHaveLength(5);
  });

  it("counts successful source updates and continues after an ambiguous record", async () => {
    const first = event();
    const second = event({ title: "Second", identity: { source: "ticketmaster", externalId: "show-2", sourceUrl: "https://example.com/2" } });
    await persistEvent(first);
    await persistEvent(second);
    const edited = event({ description: "Fresh details" });
    const conflict = event({ identity: second.identity });
    const adapter: SourceAdapter = {
      id: "ticketmaster", tier: "api", verificationLevel: "trusted_partner",
      fetch: async () => ({ events: [conflict, edited].map(e => ({ ...e, primaryCategory: e.category, fetchedAt: new Date() })), errors: [], fetchedAt: new Date() }),
      normalize: raw => raw.identity.externalId === "show-2" ? conflict : edited,
    };
    const result = await runAdapter(adapter);
    expect(result.errors).toHaveLength(1);
    expect(result).toMatchObject({ updatedSameSource: 1, inserted: 0 });
    const [run] = await state.db!.select().from(schema.ingestionRuns);
    expect(run.status).toBe("partial");
    expect(run.errorCount).toBe(1);
    expect((await state.db!.select().from(schema.events)).find(e => e.externalId === "show-1")!.description).toBe("Fresh details");
  });

  it("closes only stale running jobs for the source being started", async () => {
    await state.db!.insert(schema.ingestionRuns).values([
      { source: "ticketmaster", status: "running", startedAt: new Date("2020-01-01"), errorCount: 1, errors: [{ message: "previous error" }] },
      { source: "ticketmaster", status: "running", startedAt: new Date() },
      { source: "other-source", status: "running", startedAt: new Date("2020-01-01") },
    ]);
    const newId = await startRun("ticketmaster");
    const rows = await state.db!.select().from(schema.ingestionRuns);
    const stale = rows.find(row => row.source === "ticketmaster" && row.startedAt.getUTCFullYear() === 2020)!;
    expect(stale).toMatchObject({ status: "failed", errorCount: 2 });
    expect(stale.completedAt).toBeInstanceOf(Date);
    expect(stale.errors).toEqual([expect.objectContaining({ message: "previous error" }), expect.objectContaining({ message: expect.stringContaining("24 hours") })]);
    expect(rows.filter(row => row.status === "running")).toHaveLength(3);
    expect(rows.find(row => row.id === newId)!.status).toBe("running");
  });
});

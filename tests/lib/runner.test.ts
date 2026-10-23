import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchResult, NormalizedEvent, RawEvent, SourceAdapter, SourceError } from "@/lib/sources/types";

const persistence = vi.hoisted(() => ({ persistEvent: vi.fn(), startRun: vi.fn(), completeRun: vi.fn() }));
vi.mock("@/lib/persist", () => persistence);
import { runAdapter } from "@/lib/runner";

const raw: RawEvent = {
  identity: { source: "test", externalId: "1", sourceUrl: "https://example.com/show" },
  title: "Show", startTimeUtc: new Date("2026-11-01T20:00:00Z"), timezone: "America/Los_Angeles",
  venue: { name: "Test Hall" }, primaryCategory: "music", verificationLevel: "official", fetchedAt: new Date(),
};
const normalized: NormalizedEvent = {
  ...raw, description: null, endTimeUtc: null, category: "music", pricing: {}, recurrence: null, canonicalFingerprint: "fingerprint", rawPayload: {},
  provenance: { adapterId: "test", adapterVersion: "1", pipelineVersion: "test", normalizedAt: new Date() },
};
const failure: SourceError = { source: "test", stage: "fetch", message: "HTTP 429", httpStatus: 429, retryable: true, occurredAt: new Date() };
function adapter(page: Partial<FetchResult> = {}): SourceAdapter {
  return { id: "test", tier: "api", verificationLevel: "official", normalize: vi.fn(() => normalized), fetch: vi.fn(async () => ({ events: [raw], errors: [], fetchedAt: new Date(), ...page })) };
}

describe("ingestion runner outcomes and diagnostics", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    persistence.startRun.mockResolvedValue("run-1");
    persistence.completeRun.mockResolvedValue(undefined);
    persistence.persistEvent.mockResolvedValue({ status: "inserted", id: "event-1" });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("reports a clean source update as completed", async () => {
    persistence.persistEvent.mockResolvedValue({ status: "updated_same_source", id: "event-1" });
    expect(await runAdapter(adapter())).toMatchObject({ status: "completed", updatedSameSource: 1 });
  });

  it("records partial success instead of masking errors behind inserts", async () => {
    const result = await runAdapter(adapter({ errors: [{ ...failure, retryable: false }] }));
    expect(result).toMatchObject({ status: "partial", inserted: 1 });
    expect(persistence.completeRun).toHaveBeenCalledWith("run-1", "partial", expect.objectContaining({ errorCount: 1 }));
  });

  it("reports a partial fetch even if the adapter supplies no error", async () => {
    const result = await runAdapter(adapter({ partial: true }));
    expect(result).toMatchObject({ status: "partial" });
    expect(result.errors).toEqual([expect.objectContaining({ stage: "fetch", message: expect.stringContaining("incomplete") })]);
  });

  it("classifies normalization exceptions separately from database writes", async () => {
    const source = adapter();
    source.normalize = () => { throw new Error("invalid timezone"); };
    const result = await runAdapter(source);
    expect(result).toMatchObject({ status: "failed" });
    expect(result.errors[0]).toMatchObject({ stage: "normalize", message: "invalid timezone" });
    expect(persistence.persistEvent).not.toHaveBeenCalled();
  });

  it("retains database SQLSTATE and constraint without serializing SQL, parameters, or detail", async () => {
    const inner = Object.assign(new Error("duplicate key"), { code: "23505", constraint_name: "events_source_external_id_idx", detail: "private payload" });
    persistence.persistEvent.mockRejectedValue(new Error("Failed query: insert; params: private payload", { cause: inner }));
    const result = await runAdapter(adapter());
    expect(result.errors[0]).toMatchObject({ stage: "persist", retryable: false, cause: { code: "23505", constraint: "events_source_external_id_idx" } });
    expect(JSON.stringify(result)).not.toContain("private payload");
  });

  it("marks transient database failures retryable", async () => {
    persistence.persistEvent.mockRejectedValue(new Error("Failed query", { cause: Object.assign(new Error("lock timeout"), { code: "55P03" }) }));
    const result = await runAdapter(adapter());
    expect(result.errors[0]).toMatchObject({ retryable: true, cause: { code: "55P03" } });
  });

  it("retries an empty transient fetch before any writes", async () => {
    vi.useFakeTimers();
    const source = adapter();
    vi.mocked(source.fetch).mockResolvedValueOnce({ events: [], errors: [failure], fetchedAt: new Date() });
    const pending = runAdapter(source);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ status: "completed", inserted: 1, errors: [] });
    expect(source.fetch).toHaveBeenCalledTimes(2);
    expect(persistence.persistEvent).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalled();
  });

  it("bounds retry attempts and retains the final failure", async () => {
    vi.useFakeTimers();
    const source = adapter({ events: [], errors: [failure] });
    const pending = runAdapter(source);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ status: "failed", errors: [failure] });
    expect(source.fetch).toHaveBeenCalledTimes(3);
    expect(persistence.persistEvent).not.toHaveBeenCalled();
  });

  it("does not retry partial pages with usable events", async () => {
    const source = adapter({ errors: [failure] });
    expect(await runAdapter(source)).toMatchObject({ status: "partial", inserted: 1 });
    expect(source.fetch).toHaveBeenCalledTimes(1);
  });
});

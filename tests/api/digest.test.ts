/**
 * Integration tests for POST /api/digest.
 *
 * Hits the live Neon DB for queries + a stubbed Resend client for sends.
 * Confirms A1-A5, A7 ship-gate dimensions from
 * `rubrics/milestone-m4-digest.md`. F1-F4 invariants too: only
 * `digest_sends` is written from this route.
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Resend is mocked module-wide so no live emails go out.
const sendMock = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { POST } from "@/app/api/digest/route";
import { db } from "@/db/client";
import { digestSends } from "@/db/schema";
import { eq } from "drizzle-orm";
import { __resetResendCache } from "@/lib/digest/send";

function makePost(body: unknown, ip = "127.0.0.1"): NextRequest {
  return new NextRequest("http://localhost/api/digest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

const TEST_EMAIL_PREFIX = "vitest-m4-";

beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not set; copy .env.local into the worktree");
  }
  // Resend wrapper reads env at first call; provide a dummy so it instantiates.
  process.env.RESEND_API_KEY ??= "test-key";
});

beforeEach(() => {
  sendMock.mockReset();
  __resetResendCache();
});

afterEach(async () => {
  // Clean up the audit rows this test family created.
  await db
    .delete(digestSends)
    .where(eq(digestSends.email, `${TEST_EMAIL_PREFIX}happy@example.com`));
  await db
    .delete(digestSends)
    .where(eq(digestSends.email, `${TEST_EMAIL_PREFIX}filtered@example.com`));
});

afterAll(async () => {
  // Catch-all cleanup in case a test added an unexpected email.
});

describe("POST /api/digest — happy path (A1, A3, A4, B1)", () => {
  it("returns 200 with eventsIncluded + messageId, calls Resend, writes audit row", async () => {
    sendMock.mockResolvedValueOnce({
      data: { id: "msg_abc123" },
      error: null,
    });

    const req = makePost(
      { email: `${TEST_EMAIL_PREFIX}happy@example.com` },
      "10.0.0.1",
    );
    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      ok: boolean;
      eventsIncluded: number;
      messageId: string;
    };
    expect(body.ok).toBe(true);
    expect(typeof body.eventsIncluded).toBe("number");
    expect(body.messageId).toBe("msg_abc123");

    // A4: Resend called exactly once with sane payload.
    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0] as {
      from: string;
      to: string;
      subject: string;
      html: string;
      text: string;
    };
    expect(call.to).toBe(`${TEST_EMAIL_PREFIX}happy@example.com`);
    expect(call.from).toMatch(/SF Events/);
    expect(call.subject).toMatch(/Your SF events for the week of /);
    expect(call.html.length).toBeGreaterThan(100);
    expect(call.text.length).toBeGreaterThan(20);

    // A3: digest_sends row exists with correct event_count.
    const rows = await db
      .select()
      .from(digestSends)
      .where(eq(digestSends.email, `${TEST_EMAIL_PREFIX}happy@example.com`));
    expect(rows.length).toBe(1);
    expect(rows[0].eventCount).toBe(body.eventsIncluded);
  });
});

describe("POST /api/digest — category filter (A3 + B2 setup)", () => {
  it("passes only the requested categories to the query and persists them in filters_applied", async () => {
    sendMock.mockResolvedValueOnce({
      data: { id: "msg_filter" },
      error: null,
    });

    const req = makePost(
      {
        email: `${TEST_EMAIL_PREFIX}filtered@example.com`,
        categories: ["music", "comedy"],
      },
      "10.0.0.2",
    );
    const res = await POST(req);
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(digestSends)
      .where(eq(digestSends.email, `${TEST_EMAIL_PREFIX}filtered@example.com`));
    expect(rows.length).toBe(1);
    expect(rows[0].filtersApplied).toEqual({
      categories: ["music", "comedy"],
    });
  });
});

describe("POST /api/digest — validation (A2, A7)", () => {
  it("rejects malformed email with 400", async () => {
    const req = makePost({ email: "not-an-email" }, "10.0.0.3");
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/invalid email/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("rejects unknown category with 400", async () => {
    const req = makePost(
      { email: "ok@example.com", categories: ["bogus"] },
      "10.0.0.4",
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("rejects non-object body", async () => {
    const req = new NextRequest("http://localhost/api/digest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "10.0.0.5",
      },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/digest — rate limiting (A6, soft)", () => {
  it("returns 429 on second send from same IP within 60s", async () => {
    sendMock.mockResolvedValue({ data: { id: "msg_rate" }, error: null });

    const ip = "10.99.0.1";
    const first = await POST(
      makePost({ email: `${TEST_EMAIL_PREFIX}happy@example.com` }, ip),
    );
    expect(first.status).toBe(200);

    const second = await POST(
      makePost({ email: `${TEST_EMAIL_PREFIX}happy@example.com` }, ip),
    );
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeTruthy();
  });
});

describe("POST /api/digest — Resend failure surfaces", () => {
  it("returns 502 if Resend returns an error envelope", async () => {
    sendMock.mockResolvedValueOnce({
      data: null,
      error: { name: "validation_error", message: "from_address_not_verified" },
    });

    const req = makePost(
      { email: `${TEST_EMAIL_PREFIX}happy@example.com` },
      "10.0.0.6",
    );
    const res = await POST(req);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/send_failed/);

    // No audit row when send fails (we don't claim delivery).
    const rows = await db
      .select()
      .from(digestSends)
      .where(eq(digestSends.email, `${TEST_EMAIL_PREFIX}happy@example.com`));
    expect(rows.length).toBe(0);
  });
});

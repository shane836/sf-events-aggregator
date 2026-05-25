/**
 * POST /api/digest
 *
 * Stream F entrypoint. Receives `{ email, categories? }` from the modal,
 * validates input, queries the next-7-days events, renders the react-email
 * template, sends via Resend, then writes a single `digest_sends` row.
 *
 * Per docs/IDENTITY.md, `digest_sends` is the ONLY table this route writes.
 * No subscriber list, no confirmation email, no unsubscribe link.
 */
import { render } from "@react-email/render";
import type { NextRequest } from "next/server";
import * as React from "react";
import { db } from "@/db/client";
import { digestSends } from "@/db/schema";
import type { Category } from "@/lib/sources/types";
import { queryDigestEvents } from "@/lib/digest/query";
import { getResend, resolveFromAddress } from "@/lib/digest/send";
import { DigestEmail } from "@/lib/digest/template";
import {
  EMAIL_REGEX,
  EVENT_CAP,
  FROM_NAME,
  VALID_CATEGORIES,
  type DigestRequest,
} from "@/lib/digest/types";

export const dynamic = "force-dynamic";

// Per A6 (soft): in-memory rate limit, 1 send per IP per 60s. Module-scoped
// Map is per-instance, not cluster-wide — acceptable for MVP since Vercel
// hobby is single-instance and the digest is a low-volume action.
const RATE_WINDOW_MS = 60_000;
const lastSendByIp = new Map<string, number>();

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/** "Monday of digest window" in PT, formatted as "Month Day". */
function weekOfLabel(now: Date): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
  // Find the Monday of the current week in PT.
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const WEEKDAY_INDEX: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  const offset = WEEKDAY_INDEX[weekday] ?? 0;
  const monday = new Date(now.getTime() - offset * 86_400_000);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(monday);
}

function parseBody(raw: unknown): DigestRequest | { error: string } {
  if (raw == null || typeof raw !== "object") {
    return { error: "invalid request body" };
  }
  const obj = raw as Record<string, unknown>;
  const email = obj.email;
  if (typeof email !== "string" || !EMAIL_REGEX.test(email)) {
    return { error: "invalid email" };
  }

  let categories: Category[] | undefined;
  if (obj.categories !== undefined) {
    if (!Array.isArray(obj.categories)) {
      return { error: "categories must be an array" };
    }
    const seen = new Set<string>();
    const out: Category[] = [];
    for (const c of obj.categories) {
      if (typeof c !== "string" || !VALID_CATEGORIES.includes(c as Category)) {
        return {
          error: `invalid category '${String(c)}' (allowed: ${VALID_CATEGORIES.join(", ")})`,
        };
      }
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c as Category);
      }
    }
    categories = out;
  }

  return { email, categories };
}

export async function POST(request: NextRequest) {
  // ---- parse body ----
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "invalid json body" }, { status: 400 });
  }

  const parsed = parseBody(raw);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const { email, categories } = parsed;

  // ---- rate limit (A6) ----
  const ip = getClientIp(request);
  const now = Date.now();
  const last = lastSendByIp.get(ip);
  if (last && now - last < RATE_WINDOW_MS) {
    const retryAfter = Math.ceil((RATE_WINDOW_MS - (now - last)) / 1000);
    return Response.json(
      { error: "rate_limited: try again shortly" },
      { status: 429, headers: { "retry-after": String(retryAfter) } },
    );
  }
  lastSendByIp.set(ip, now);

  // ---- query events ----
  const nowDate = new Date(now);
  let events;
  try {
    events = await queryDigestEvents({
      now: nowDate,
      categories: categories ?? null,
      limit: EVENT_CAP,
    });
  } catch (err) {
    console.error("[api/digest] query error:", err);
    return Response.json(
      { error: "internal_error: failed to load events" },
      { status: 500 },
    );
  }

  // ---- render email ----
  const subject = `Your SF events for the week of ${weekOfLabel(nowDate)}`;
  const element = React.createElement(DigestEmail, {
    events,
    weekOfLabel: weekOfLabel(nowDate),
    selectedCategories: categories ?? null,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  });

  let html: string;
  let text: string;
  try {
    [html, text] = await Promise.all([
      render(element),
      render(element, { plainText: true }),
    ]);
  } catch (err) {
    console.error("[api/digest] render error:", err);
    return Response.json(
      { error: "internal_error: failed to render email" },
      { status: 500 },
    );
  }

  // ---- send via Resend ----
  const { from } = resolveFromAddress(FROM_NAME);
  let messageId: string;
  try {
    const resend = getResend();
    const sendResult = await resend.emails.send({
      from,
      to: email,
      subject,
      html,
      text,
    });
    if (sendResult.error) {
      console.error("[api/digest] resend error:", sendResult.error);
      return Response.json(
        { error: `send_failed: ${sendResult.error.message}` },
        { status: 502 },
      );
    }
    if (!sendResult.data?.id) {
      console.error("[api/digest] resend returned no id");
      return Response.json(
        { error: "send_failed: no message id" },
        { status: 502 },
      );
    }
    messageId = sendResult.data.id;
  } catch (err) {
    console.error("[api/digest] resend exception:", err);
    return Response.json(
      { error: "send_failed: resend threw" },
      { status: 502 },
    );
  }

  // ---- audit log ----
  try {
    await db.insert(digestSends).values({
      email,
      filtersApplied: { categories: categories ?? null },
      eventCount: events.length,
    });
  } catch (err) {
    // Send succeeded but log failed — surface to ops but return success to
    // the client. We don't want to imply non-delivery when the email is gone.
    console.error("[api/digest] digest_sends insert failed:", err);
  }

  return Response.json(
    {
      ok: true,
      eventsIncluded: events.length,
      messageId,
    },
    { status: 200 },
  );
}

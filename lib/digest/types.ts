/**
 * Shared types for the M4 email digest.
 *
 * The digest renderer consumes a subset of the `/api/events` response shape
 * via an internal query (`lib/digest/query.ts`) — never via HTTP. Same DB,
 * same `formatPriceDisplay`, no UI dependency.
 */
import type { Category, PriceInfo, VerificationLevel } from "@/lib/sources/types";

export const VALID_CATEGORIES: ReadonlyArray<Category> = [
  "music",
  "comedy",
  "lectures",
  "dancing",
  "food",
];

/** Cap per rubric G2: keeps body under Gmail's 102KB clipping threshold. */
export const EVENT_CAP = 50;

/** Window: next 7 days from "now" in PT. */
export const DIGEST_WINDOW_DAYS = 7;

/** Sender display name; locked decision. */
export const FROM_NAME = "SF Events";

/** Resend test recipient — confirms delivery without actually mailing. */
export const RESEND_TEST_RECIPIENT = "delivered@resend.dev";

/** Email validation regex (per rubric A7). */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Single event row consumed by the email template. */
export type DigestEvent = {
  id: string;
  title: string;
  category: Category;
  startTimeUtc: string; // ISO
  endTimeUtc: string | null;
  timezone: string;
  venue: {
    name: string;
    neighborhood: string | null;
  };
  sourceUrl: string;
  verificationLevel: VerificationLevel;
  pricing: PriceInfo;
  priceDisplay: string;
};

/** POST /api/digest request body. */
export type DigestRequest = {
  email: string;
  categories?: Category[];
};

/** Successful POST /api/digest response body. */
export type DigestResponseOk = {
  ok: true;
  eventsIncluded: number;
  messageId: string;
};

/** Error response body. */
export type DigestResponseError = {
  error: string;
};

import type { NewEvent, NewVenue } from "@/db/schema";

export type Category = "music" | "comedy" | "lectures" | "dancing" | "food";

export type SourceTier = "api" | "ical" | "scrape";

export type RawEvent = {
  sourceId: string;
  title: string;
  description?: string | null;
  startTime: Date;
  endTime?: Date | null;
  venueName: string;
  venueAddress?: string | null;
  venueLat?: number | null;
  venueLng?: number | null;
  sourceUrl: string;
  priceMin?: number | null;
  priceMax?: number | null;
  isFree?: boolean;
  categoryHint?: Category;
  rawPayload: unknown;
};

export type SourceError = {
  sourceId?: string;
  message: string;
  cause?: unknown;
};

export type FetchResult = {
  events: RawEvent[];
  errors: SourceError[];
};

export type NormalizedRow = {
  event: Omit<NewEvent, "venueId">;
  venue: NewVenue;
};

export interface SourceAdapter {
  readonly id: string;
  readonly tier: SourceTier;
  readonly defaultCategory: Category;
  fetch(): Promise<FetchResult>;
  normalize(raw: RawEvent): NormalizedRow;
}

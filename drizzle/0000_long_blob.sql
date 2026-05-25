CREATE TYPE "public"."category" AS ENUM('music', 'comedy', 'lectures', 'dancing', 'food');--> statement-breakpoint
CREATE TABLE "digest_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"filters_applied" jsonb,
	"event_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"source_url" text NOT NULL,
	"source_version" text,
	"title" text NOT NULL,
	"description" text,
	"category" "category" NOT NULL,
	"start_time_utc" timestamp with time zone NOT NULL,
	"end_time_utc" timestamp with time zone,
	"timezone" text NOT NULL,
	"venue_id" uuid NOT NULL,
	"price_min" numeric(10, 2),
	"price_max" numeric(10, 2),
	"is_free" boolean DEFAULT false NOT NULL,
	"series_id" text,
	"occurrence_id" text,
	"canonical_fingerprint" text NOT NULL,
	"verification_level" text NOT NULL,
	"secondary_sources" jsonb DEFAULT '[]' NOT NULL,
	"provenance" jsonb,
	"raw_payload" jsonb,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"status" text NOT NULL,
	"fetched" integer,
	"inserted" integer,
	"skipped" integer,
	"error_count" integer DEFAULT 0 NOT NULL,
	"cursor" text,
	"errors" jsonb
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"normalized_name" text NOT NULL,
	"name" text NOT NULL,
	"neighborhood" text,
	"address" text,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"timezone" text,
	"primary_category" "category",
	"source_metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "events_canonical_fingerprint_idx" ON "events" USING btree ("canonical_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "events_source_external_id_idx" ON "events" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "events_start_time_utc_idx" ON "events" USING btree ("start_time_utc");--> statement-breakpoint
CREATE INDEX "events_category_idx" ON "events" USING btree ("category");--> statement-breakpoint
CREATE INDEX "events_venue_idx" ON "events" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "events_series_idx" ON "events" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "ingestion_runs_source_idx" ON "ingestion_runs" USING btree ("source");--> statement-breakpoint
CREATE INDEX "ingestion_runs_started_idx" ON "ingestion_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_normalized_name_idx" ON "venues" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "venues_neighborhood_idx" ON "venues" USING btree ("neighborhood");
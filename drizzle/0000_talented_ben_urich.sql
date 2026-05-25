CREATE TYPE "public"."category" AS ENUM('music', 'comedy', 'lectures', 'dancing', 'food');--> statement-breakpoint
CREATE TABLE "digest_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"filters_applied" jsonb,
	"event_count" numeric(6, 0) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"source" text NOT NULL,
	"source_url" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" "category" NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone,
	"venue_id" uuid NOT NULL,
	"price_min" numeric(10, 2),
	"price_max" numeric(10, 2),
	"is_free" boolean DEFAULT false NOT NULL,
	"price_display" text NOT NULL,
	"raw_payload" jsonb,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fingerprint" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"neighborhood" text,
	"address" text,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"primary_category" "category",
	"source_metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "events_fingerprint_idx" ON "events" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "events_source_sourceid_idx" ON "events" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "events_start_time_idx" ON "events" USING btree ("start_time");--> statement-breakpoint
CREATE INDEX "events_category_idx" ON "events" USING btree ("category");--> statement-breakpoint
CREATE INDEX "events_venue_idx" ON "events" USING btree ("venue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_name_address_idx" ON "venues" USING btree ("name","address");--> statement-breakpoint
CREATE INDEX "venues_neighborhood_idx" ON "venues" USING btree ("neighborhood");
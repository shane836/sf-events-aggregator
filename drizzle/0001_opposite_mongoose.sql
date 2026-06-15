ALTER TABLE "venues" ADD COLUMN "city" text DEFAULT 'San Francisco' NOT NULL;--> statement-breakpoint
CREATE INDEX "venues_city_idx" ON "venues" USING btree ("city");
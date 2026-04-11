-- Add lat/lng columns to saved_addresses
ALTER TABLE "saved_addresses" ADD COLUMN IF NOT EXISTS "lat" numeric(10, 6);
ALTER TABLE "saved_addresses" ADD COLUMN IF NOT EXISTS "lng" numeric(10, 6);

-- Create ride_messages table for in-app chat
CREATE TABLE IF NOT EXISTS "ride_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "ride_id" text NOT NULL REFERENCES "rides"("id") ON DELETE CASCADE,
  "sender_role" varchar(10) NOT NULL,
  "sender_id" text NOT NULL,
  "body" varchar(500) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ride_messages_ride_id_idx" ON "ride_messages" ("ride_id");
CREATE INDEX IF NOT EXISTS "ride_messages_created_at_idx" ON "ride_messages" ("ride_id", "created_at");

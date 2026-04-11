-- Add per_minute_rate column to ride_service_types for time-based fare calculation
ALTER TABLE "ride_service_types"
  ADD COLUMN IF NOT EXISTS "per_minute_rate" numeric(10,2) NOT NULL DEFAULT 0;

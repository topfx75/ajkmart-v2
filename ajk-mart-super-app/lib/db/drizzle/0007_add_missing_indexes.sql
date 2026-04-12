CREATE INDEX IF NOT EXISTS "wallet_txn_type_idx" ON "wallet_transactions" ("type");
CREATE INDEX IF NOT EXISTS "rider_profiles_vehicle_type_idx" ON "rider_profiles" ("vehicle_type");
CREATE INDEX IF NOT EXISTS "popular_locations_category_is_active_idx" ON "popular_locations" ("category", "is_active");

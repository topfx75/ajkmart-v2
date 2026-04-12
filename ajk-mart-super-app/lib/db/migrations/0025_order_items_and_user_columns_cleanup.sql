-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: order_items table + users legacy column removal
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Create order_items table initially WITHOUT the products FK on product_id
--    so that the JSON backfill step can safely ignore stale/deleted product refs.
--    The FK is added after the backfill (step 3) once product_id values are clean.
CREATE TABLE IF NOT EXISTS order_items (
  id                    TEXT PRIMARY KEY,
  order_id              TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id            TEXT,
  name                  TEXT,
  image                 TEXT,
  unit_price_at_purchase DECIMAL(10, 2) NOT NULL,
  quantity              INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS order_items_order_id_idx    ON order_items(order_id);
CREATE INDEX IF NOT EXISTS order_items_product_id_idx  ON order_items(product_id);

-- 2. Migrate existing order item data from the JSON blob into order_items rows.
--    Each element in the items JSON array becomes one row in order_items.
--    We generate a deterministic id via md5 of (order_id + index) to be idempotent.
--    Guards:
--    - Skips rows where items is not a JSON array (jsonb_typeof check).
--    - Sets product_id to NULL when the referenced product no longer exists
--      (keeps historical items by name/price/qty even without product link).
--    - Raises an exception and aborts the whole transaction if the migrated
--      count falls short of the expected non-empty orders, preventing silent loss.
DO $$
DECLARE
  r RECORD;
  item JSONB;
  idx INTEGER;
  new_id TEXT;
  parsed_price DECIMAL(10,2);
  parsed_qty INTEGER;
  raw_product_id TEXT;
  safe_product_id TEXT;
  orders_with_items INTEGER;
  migrated_orders INTEGER;
BEGIN
  -- Count orders that have a non-null, non-empty items blob that is a JSON array
  SELECT COUNT(*) INTO orders_with_items
  FROM orders
  WHERE items IS NOT NULL
    AND items::text NOT IN ('', 'null', '[]')
    AND jsonb_typeof(items::jsonb) = 'array';

  migrated_orders := 0;

  FOR r IN
    SELECT id, items FROM orders
    WHERE items IS NOT NULL
      AND jsonb_typeof(items::jsonb) = 'array'
  LOOP
    idx := 0;
    FOR item IN SELECT * FROM jsonb_array_elements(r.items::jsonb)
    LOOP
      new_id := md5(r.id || '_' || idx);
      parsed_price := COALESCE(
        NULLIF(item->>'unit_price_at_purchase', '')::DECIMAL(10,2),
        NULLIF(item->>'price', '')::DECIMAL(10,2),
        0
      );
      parsed_qty := COALESCE(
        NULLIF(item->>'quantity', '')::INTEGER,
        NULLIF(item->>'qty', '')::INTEGER,
        1
      );
      raw_product_id := NULLIF(item->>'productId', '');

      -- Only keep product_id if the product still exists; otherwise store NULL
      IF raw_product_id IS NOT NULL THEN
        SELECT id INTO safe_product_id FROM products WHERE id = raw_product_id LIMIT 1;
      ELSE
        safe_product_id := NULL;
      END IF;

      INSERT INTO order_items (id, order_id, product_id, name, image, unit_price_at_purchase, quantity)
      VALUES (new_id, r.id, safe_product_id, NULLIF(item->>'name', ''), NULLIF(item->>'image', ''), parsed_price, parsed_qty)
      ON CONFLICT (id) DO NOTHING;

      idx := idx + 1;
    END LOOP;
    IF idx > 0 THEN
      migrated_orders := migrated_orders + 1;
    END IF;
  END LOOP;

  -- Verify all non-empty array orders were migrated; abort if any were missed
  IF migrated_orders < orders_with_items THEN
    RAISE EXCEPTION 'order_items migration incomplete: expected % orders with items, migrated %. Aborting to prevent data loss.',
      orders_with_items, migrated_orders;
  END IF;
END;
$$;

-- 3. Now that product_id values are clean (stale refs nulled out), add the FK.
--    ON DELETE SET NULL ensures future product deletions preserve order history.
ALTER TABLE order_items
  ADD CONSTRAINT order_items_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

-- 4. Drop the items JSON blob column from orders
ALTER TABLE orders DROP COLUMN IF EXISTS items;

-- 5. Backfill vendor_profiles.store_name from users.store_name for existing vendors
--    before dropping the column, so historical data is preserved.
INSERT INTO vendor_profiles (user_id, store_name, store_category)
SELECT u.id, u.store_name, NULL
FROM users u
WHERE u.role = 'vendor'
  AND u.store_name IS NOT NULL
  AND u.store_name <> ''
ON CONFLICT (user_id) DO UPDATE
  SET store_name = COALESCE(EXCLUDED.store_name, vendor_profiles.store_name);

-- 6. Backfill rider_profiles.vehicle_type from users.vehicle_type for existing riders
--    before dropping the column, so historical data is preserved.
INSERT INTO rider_profiles (user_id, vehicle_type)
SELECT u.id, u.vehicle_type
FROM users u
WHERE u.role = 'rider'
  AND u.vehicle_type IS NOT NULL
  AND u.vehicle_type <> ''
ON CONFLICT (user_id) DO UPDATE
  SET vehicle_type = COALESCE(EXCLUDED.vehicle_type, rider_profiles.vehicle_type);

-- 7. Drop storeName and vehicleType from users (now safely preserved in profile tables)
ALTER TABLE users DROP COLUMN IF EXISTS store_name;
ALTER TABLE users DROP COLUMN IF EXISTS vehicle_type;

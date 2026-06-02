-- ============================================================
-- Fix price_data unique constraint to be NULL-safe
-- Run this in Supabase SQL Editor
-- ============================================================
-- Problem: expiry_date can be NULL. In Postgres, NULLs are treated
-- as distinct in unique constraints, which breaks ON CONFLICT upserts.
-- Fix: make expiry_date NOT NULL with a sentinel default date.

-- 1. Replace NULL expiry dates with a sentinel (for futures without expiry)
UPDATE price_data
SET expiry_date = '1900-01-01'
WHERE expiry_date IS NULL;

-- 2. Set a default and NOT NULL so future inserts never have NULL
ALTER TABLE price_data
    ALTER COLUMN expiry_date SET DEFAULT '1900-01-01';

ALTER TABLE price_data
    ALTER COLUMN expiry_date SET NOT NULL;

-- 3. Recreate the unique constraint (now NULL-safe)
ALTER TABLE price_data
    DROP CONSTRAINT IF EXISTS uq_price_data;

ALTER TABLE price_data
    ADD CONSTRAINT uq_price_data
    UNIQUE (symbol, trade_date, instrument_type, expiry_date);

DO $$
BEGIN
    RAISE NOTICE '✅ price_data constraint is now NULL-safe. Upserts will work.';
END $$;
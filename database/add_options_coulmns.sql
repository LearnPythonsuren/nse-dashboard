-- ============================================================
-- Add strike_price + option_type to price_data
-- and update the unique constraint to handle options
-- Run in Supabase SQL Editor (after fix_price_constraint.sql)
-- ============================================================

-- 1. Add new columns
ALTER TABLE price_data
    ADD COLUMN IF NOT EXISTS strike_price NUMERIC(15, 2),
    ADD COLUMN IF NOT EXISTS option_type VARCHAR(4);

-- 2. Make them NOT NULL with sentinels (for NULL-safe unique constraint)
UPDATE price_data SET strike_price = 0 WHERE strike_price IS NULL;
UPDATE price_data SET option_type = '' WHERE option_type IS NULL;

ALTER TABLE price_data ALTER COLUMN strike_price SET DEFAULT 0;
ALTER TABLE price_data ALTER COLUMN option_type SET DEFAULT '';
ALTER TABLE price_data ALTER COLUMN strike_price SET NOT NULL;
ALTER TABLE price_data ALTER COLUMN option_type SET NOT NULL;

-- 3. Rebuild unique constraint to include strike + option type
--    (futures use strike=0, option_type=''; options use real values)
ALTER TABLE price_data DROP CONSTRAINT IF EXISTS uq_price_data;
ALTER TABLE price_data
    ADD CONSTRAINT uq_price_data
    UNIQUE (symbol, trade_date, instrument_type, expiry_date, strike_price, option_type);

-- 4. Helpful indexes for charting
CREATE INDEX IF NOT EXISTS idx_price_inst_exp
    ON price_data(instrument_type, expiry_date);

DO $$
BEGIN
    RAISE NOTICE '✅ price_data now supports futures + options (3 nearest expiries).';
    RAISE NOTICE '   Futures: strike_price=0, option_type=''''';
    RAISE NOTICE '   Options: real strike_price + CE/PE';
END $$;
-- ============================================================
-- Additional tables for SEC bhavcopy and MWPL/OI data
-- Run this AFTER schema.sql in the Supabase SQL Editor
-- ============================================================

-- ============================================
-- SEC DATA (Cash market bhavcopy, filtered to F&O stocks)
-- ============================================
CREATE TABLE IF NOT EXISTS sec_data (
    id BIGSERIAL PRIMARY KEY,
    symbol VARCHAR(50) NOT NULL,
    series VARCHAR(10),
    trade_date DATE NOT NULL,
    prev_close NUMERIC(15, 2),
    open_price NUMERIC(15, 2),
    high_price NUMERIC(15, 2),
    low_price NUMERIC(15, 2),
    last_price NUMERIC(15, 2),
    close_price NUMERIC(15, 2),
    avg_price NUMERIC(15, 2),
    total_traded_qty BIGINT,
    turnover_lacs NUMERIC(20, 2),
    no_of_trades BIGINT,
    deliv_qty BIGINT,
    deliv_per NUMERIC(6, 2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_symbol_date ON sec_data(symbol, trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_sec_date ON sec_data(trade_date DESC);

-- ============================================
-- IO DATA (MWPL / combineoi, filtered to F&O stocks)
-- ============================================
CREATE TABLE IF NOT EXISTS io_data (
    id BIGSERIAL PRIMARY KEY,
    trade_date DATE NOT NULL,
    isin VARCHAR(20),
    scrip_name VARCHAR(150),
    nse_symbol VARCHAR(50) NOT NULL,
    mwpl BIGINT,
    open_interest BIGINT,
    future_equiv_oi NUMERIC(20, 6),
    limit_next_day VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_io_symbol_date ON io_data(nse_symbol, trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_io_date ON io_data(trade_date DESC);

-- ============================================
-- Prevent duplicate rows on re-run (idempotent inserts)
-- ============================================
-- Unique constraints let you safely re-run the function for a date
-- without creating duplicate rows.

-- price_data: unique per symbol + date + instrument + expiry
ALTER TABLE price_data
    DROP CONSTRAINT IF EXISTS uq_price_data;
ALTER TABLE price_data
    ADD CONSTRAINT uq_price_data
    UNIQUE (symbol, trade_date, instrument_type, expiry_date);

-- sec_data: unique per symbol + series + date
ALTER TABLE sec_data
    DROP CONSTRAINT IF EXISTS uq_sec_data;
ALTER TABLE sec_data
    ADD CONSTRAINT uq_sec_data
    UNIQUE (symbol, series, trade_date);

-- io_data: unique per symbol + date
ALTER TABLE io_data
    DROP CONSTRAINT IF EXISTS uq_io_data;
ALTER TABLE io_data
    ADD CONSTRAINT uq_io_data
    UNIQUE (nse_symbol, trade_date);

-- ============================================
-- Row Level Security
-- ============================================
ALTER TABLE sec_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE io_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view sec_data"
    ON sec_data FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view io_data"
    ON io_data FOR SELECT
    USING (auth.role() = 'authenticated');

-- ============================================
-- Enable Realtime
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE sec_data;
ALTER PUBLICATION supabase_realtime ADD TABLE io_data;

-- ============================================
-- Success message
-- ============================================
DO $$
BEGIN
    RAISE NOTICE '✅ SEC + IO tables created with unique constraints!';
    RAISE NOTICE '🔒 RLS enabled, Realtime enabled';
    RAISE NOTICE '♻️  Re-running the function for a date is now safe (upsert).';
END $$;
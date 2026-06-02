-- ============================================
-- NSE Dashboard - Complete Supabase Schema
-- Includes: Tables, RLS Policies, Functions, Triggers
-- ============================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- USER PROFILES (linked to auth.users)
-- ============================================
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username VARCHAR(100) UNIQUE,
    full_name VARCHAR(200),
    email VARCHAR(255),
    avatar_url TEXT,
    plan VARCHAR(50) DEFAULT 'free',
    license_status VARCHAR(20) DEFAULT 'active',
    license_expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '1 year'),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_profiles_username ON profiles(username);
CREATE INDEX idx_profiles_email ON profiles(email);

-- ============================================
-- TICKERS MASTER
-- ============================================
CREATE TABLE IF NOT EXISTS tickers (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(50) UNIQUE NOT NULL,
    company_name VARCHAR(255),
    sector VARCHAR(100),
    isin VARCHAR(20),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tickers_symbol ON tickers(symbol);
CREATE INDEX idx_tickers_active ON tickers(is_active) WHERE is_active = true;

-- ============================================
-- FUTURES TABLES METADATA
-- ============================================
CREATE TABLE IF NOT EXISTS futures_tables (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    table_date DATE NOT NULL,
    instrument_type VARCHAR(20),
    is_active BOOLEAN DEFAULT true,
    record_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_futures_tables_date ON futures_tables(table_date DESC);
CREATE INDEX idx_futures_tables_name ON futures_tables(name);

-- ============================================
-- PRICE DATA (Unified table for all instruments)
-- ============================================
CREATE TABLE IF NOT EXISTS price_data (
    id BIGSERIAL PRIMARY KEY,
    symbol VARCHAR(50) NOT NULL,
    trade_date DATE NOT NULL,
    instrument_type VARCHAR(10),
    expiry_date DATE,
    open_price NUMERIC(15, 2),
    high_price NUMERIC(15, 2),
    low_price NUMERIC(15, 2),
    close_price NUMERIC(15, 2),
    settlement_price NUMERIC(15, 2),
    volume BIGINT,
    open_interest BIGINT,
    change_in_oi BIGINT,
    turnover NUMERIC(20, 2),
    table_source VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_price_symbol_date ON price_data(symbol, trade_date DESC);
CREATE INDEX idx_price_date ON price_data(trade_date DESC);
CREATE INDEX idx_price_expiry ON price_data(expiry_date);
CREATE INDEX idx_price_instrument ON price_data(instrument_type);

-- ============================================
-- USER FAVORITES (Watchlist)
-- ============================================
CREATE TABLE IF NOT EXISTS user_favorites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    ticker_symbol VARCHAR(50) NOT NULL,
    notes TEXT,
    alert_price NUMERIC(15, 2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, ticker_symbol)
);

CREATE INDEX idx_favorites_user ON user_favorites(user_id);

-- ============================================
-- DOWNLOAD LOGS
-- ============================================
CREATE TABLE IF NOT EXISTS download_logs (
    id BIGSERIAL PRIMARY KEY,
    file_type VARCHAR(50),
    file_name VARCHAR(255),
    file_date DATE,
    status VARCHAR(20),
    records_processed INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_download_status ON download_logs(status);
CREATE INDEX idx_download_date ON download_logs(started_at DESC);

-- ============================================
-- USER ACTIVITY (For analytics)
-- ============================================
CREATE TABLE IF NOT EXISTS user_activity (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    action VARCHAR(100),
    resource VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activity_user ON user_activity(user_id);
CREATE INDEX idx_activity_date ON user_activity(created_at DESC);

-- ============================================
-- TRIGGER: Auto-create profile on signup
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, username, full_name)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'full_name', '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- TRIGGER: Update updated_at automatically
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at 
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tickers_updated_at 
    BEFORE UPDATE ON tickers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickers ENABLE ROW LEVEL SECURITY;
ALTER TABLE futures_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE download_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_activity ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES: PROFILES
-- ============================================
CREATE POLICY "Users can view their own profile"
    ON profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
    ON profiles FOR UPDATE
    USING (auth.uid() = id);

-- ============================================
-- RLS POLICIES: TICKERS (Public read)
-- ============================================
CREATE POLICY "Anyone can view active tickers"
    ON tickers FOR SELECT
    USING (is_active = true);

-- ============================================
-- RLS POLICIES: FUTURES TABLES (Public read)
-- ============================================
CREATE POLICY "Authenticated users can view futures tables"
    ON futures_tables FOR SELECT
    USING (auth.role() = 'authenticated');

-- ============================================
-- RLS POLICIES: PRICE DATA (Authenticated read)
-- ============================================
CREATE POLICY "Authenticated users can view price data"
    ON price_data FOR SELECT
    USING (auth.role() = 'authenticated');

-- ============================================
-- RLS POLICIES: USER FAVORITES
-- ============================================
CREATE POLICY "Users can view their own favorites"
    ON user_favorites FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can add favorites"
    ON user_favorites FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own favorites"
    ON user_favorites FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own favorites"
    ON user_favorites FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================
-- RLS POLICIES: USER ACTIVITY
-- ============================================
CREATE POLICY "Users can view their own activity"
    ON user_activity FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own activity"
    ON user_activity FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- ============================================
-- USEFUL FUNCTIONS
-- ============================================

-- Get chart data for a symbol
CREATE OR REPLACE FUNCTION get_chart_data(
    p_symbol VARCHAR,
    p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
    trade_date DATE,
    close_price NUMERIC,
    volume BIGINT,
    instrument_type VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pd.trade_date,
        pd.close_price,
        pd.volume,
        pd.instrument_type
    FROM price_data pd
    WHERE pd.symbol = p_symbol
        AND pd.trade_date >= CURRENT_DATE - p_days
    ORDER BY pd.trade_date ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get latest tickers with summary
CREATE OR REPLACE FUNCTION get_ticker_summary()
RETURNS TABLE (
    symbol VARCHAR,
    company_name VARCHAR,
    sector VARCHAR,
    last_price NUMERIC,
    last_volume BIGINT,
    last_date DATE
) AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT ON (t.symbol)
        t.symbol,
        t.company_name,
        t.sector,
        pd.close_price,
        pd.volume,
        pd.trade_date
    FROM tickers t
    LEFT JOIN price_data pd ON pd.symbol = t.symbol
    WHERE t.is_active = true
    ORDER BY t.symbol, pd.trade_date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- SEED DATA
-- ============================================

-- Insert default tickers (NIFTY 50 sample)
INSERT INTO tickers (symbol, company_name, sector) VALUES
    ('RELIANCE', 'Reliance Industries Ltd', 'Energy'),
    ('TCS', 'Tata Consultancy Services', 'IT'),
    ('HDFCBANK', 'HDFC Bank Ltd', 'Banking'),
    ('INFY', 'Infosys Ltd', 'IT'),
    ('ICICIBANK', 'ICICI Bank Ltd', 'Banking'),
    ('HINDUNILVR', 'Hindustan Unilever Ltd', 'FMCG'),
    ('SBIN', 'State Bank of India', 'Banking'),
    ('BHARTIARTL', 'Bharti Airtel Ltd', 'Telecom'),
    ('ITC', 'ITC Ltd', 'FMCG'),
    ('KOTAKBANK', 'Kotak Mahindra Bank', 'Banking'),
    ('LT', 'Larsen & Toubro Ltd', 'Construction'),
    ('AXISBANK', 'Axis Bank Ltd', 'Banking'),
    ('MARUTI', 'Maruti Suzuki India Ltd', 'Auto'),
    ('ASIANPAINT', 'Asian Paints Ltd', 'Paints'),
    ('WIPRO', 'Wipro Ltd', 'IT'),
    ('NESTLEIND', 'Nestle India Ltd', 'FMCG'),
    ('ULTRACEMCO', 'UltraTech Cement Ltd', 'Cement'),
    ('TITAN', 'Titan Company Ltd', 'Jewellery'),
    ('TATAMOTORS', 'Tata Motors Ltd', 'Auto'),
    ('SUNPHARMA', 'Sun Pharmaceutical Industries', 'Pharma')
ON CONFLICT (symbol) DO NOTHING;

-- Insert sample futures tables for testing
INSERT INTO futures_tables (name, table_date, instrument_type) VALUES
    ('FO_FUT_' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD'), CURRENT_DATE, 'FUT'),
    ('FO_FUT_' || TO_CHAR(CURRENT_DATE + INTERVAL '7 days', 'YYYYMMDD'), CURRENT_DATE + INTERVAL '7 days', 'FUT'),
    ('FO_FUT_' || TO_CHAR(CURRENT_DATE + INTERVAL '14 days', 'YYYYMMDD'), CURRENT_DATE + INTERVAL '14 days', 'FUT')
ON CONFLICT (name) DO NOTHING;

-- Insert sample price data for RELIANCE (last 30 days)
INSERT INTO price_data (symbol, trade_date, instrument_type, close_price, volume)
SELECT 
    'RELIANCE',
    CURRENT_DATE - (i || ' days')::INTERVAL,
    'EQ',
    2400 + (RANDOM() * 200)::NUMERIC(15,2),
    (1000000 + RANDOM() * 5000000)::BIGINT
FROM generate_series(0, 29) i
ON CONFLICT DO NOTHING;

INSERT INTO price_data (symbol, trade_date, instrument_type, close_price, volume)
SELECT 
    'TCS',
    CURRENT_DATE - (i || ' days')::INTERVAL,
    'EQ',
    3500 + (RANDOM() * 300)::NUMERIC(15,2),
    (500000 + RANDOM() * 2000000)::BIGINT
FROM generate_series(0, 29) i
ON CONFLICT DO NOTHING;

-- ============================================
-- ENABLE REALTIME
-- ============================================
-- These tables will broadcast changes via Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE price_data;
ALTER PUBLICATION supabase_realtime ADD TABLE download_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE futures_tables;

-- ============================================
-- SUCCESS MESSAGE
-- ============================================
DO $$
BEGIN
    RAISE NOTICE '✅ NSE Dashboard schema created successfully!';
    RAISE NOTICE '📊 Tables: profiles, tickers, futures_tables, price_data, user_favorites, download_logs, user_activity';
    RAISE NOTICE '🔒 RLS enabled on all tables';
    RAISE NOTICE '⚡ Realtime enabled for price_data, download_logs, futures_tables';
    RAISE NOTICE '👤 Auto-profile creation enabled on signup';
END $$;
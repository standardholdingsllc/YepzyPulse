-- ============================================================
-- Yepzy Transaction Processor – Database Schema
-- ============================================================

-- Reports table: one row per generated report
CREATE TABLE IF NOT EXISTS reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT UNIQUE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  title         TEXT,
  status        TEXT NOT NULL DEFAULT 'processing', -- processing | ready | error
  error_message TEXT,

  -- Filter settings used for this report
  in_us_filter  TEXT NOT NULL DEFAULT 'strict', -- strict | lenient | all

  -- Classification rule versions (JSON blob)
  classification_rules JSONB NOT NULL DEFAULT '{}',

  -- Processing stats
  stats         JSONB NOT NULL DEFAULT '{}',

  -- Optional password hash for protected reports
  password_hash TEXT,

  -- Uploader info
  uploader_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_reports_slug ON reports (slug);
CREATE INDEX IF NOT EXISTS idx_reports_expires ON reports (expires_at);

-- Normalized transactions: one row per CSV row
CREATE TABLE IF NOT EXISTS report_transactions (
  id                  BIGSERIAL PRIMARY KEY,
  report_id           UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,

  -- Raw fields
  raw_created_at      TIMESTAMPTZ,
  unit_id             TEXT,
  unit_type           TEXT,
  amount_cents        BIGINT NOT NULL DEFAULT 0,
  direction           TEXT,
  balance_cents       BIGINT NOT NULL DEFAULT 0,
  summary             TEXT,
  customer_id         TEXT,
  account_id          TEXT,
  counterparty_name   TEXT,
  counterparty_customer TEXT,
  counterparty_account TEXT,
  payment_id          TEXT,

  -- Enriched fields
  transaction_group   TEXT NOT NULL DEFAULT 'Other',
  remittance_vendor   TEXT NOT NULL DEFAULT 'Not remittance',
  vendor_match_evidence JSONB, -- { vendor, matchedKeyword, matchedField, matchPosition }
  employer_name       TEXT NOT NULL DEFAULT 'Unknown employer',
  employer_key        TEXT NOT NULL DEFAULT 'unknown_employer',

  -- Location
  location_raw        TEXT,
  location_city       TEXT,
  location_state      TEXT,
  location_country    TEXT,

  -- Customer US status (denormalized for query convenience)
  customer_in_us      TEXT NOT NULL DEFAULT 'unknown' -- true | false | unknown
);

CREATE INDEX IF NOT EXISTS idx_rt_report ON report_transactions (report_id);
CREATE INDEX IF NOT EXISTS idx_rt_customer ON report_transactions (report_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_rt_employer ON report_transactions (report_id, employer_key);
CREATE INDEX IF NOT EXISTS idx_rt_group ON report_transactions (report_id, transaction_group);
CREATE INDEX IF NOT EXISTS idx_rt_vendor ON report_transactions (report_id, remittance_vendor);
CREATE INDEX IF NOT EXISTS idx_rt_created ON report_transactions (report_id, raw_created_at);

-- Employer rollups: precomputed per-report aggregates
CREATE TABLE IF NOT EXISTS report_employer_rollups (
  id                    BIGSERIAL PRIMARY KEY,
  report_id             UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  employer_name         TEXT NOT NULL,
  employer_key          TEXT NOT NULL,

  worker_count          INT NOT NULL DEFAULT 0,
  transaction_count     INT NOT NULL DEFAULT 0,
  total_debit_cents     BIGINT NOT NULL DEFAULT 0,
  total_credit_cents    BIGINT NOT NULL DEFAULT 0,

  card_count            INT NOT NULL DEFAULT 0,
  card_amount_cents     BIGINT NOT NULL DEFAULT 0,
  atm_count             INT NOT NULL DEFAULT 0,
  atm_amount_cents      BIGINT NOT NULL DEFAULT 0,
  fee_count             INT NOT NULL DEFAULT 0,
  fee_amount_cents      BIGINT NOT NULL DEFAULT 0,
  book_count            INT NOT NULL DEFAULT 0,
  book_amount_cents     BIGINT NOT NULL DEFAULT 0,

  remittance_count      INT NOT NULL DEFAULT 0,
  remittance_amount_cents BIGINT NOT NULL DEFAULT 0,

  workers_in_us         INT NOT NULL DEFAULT 0,
  workers_not_in_us     INT NOT NULL DEFAULT 0,
  workers_unknown_us    INT NOT NULL DEFAULT 0,

  -- JSON: { vendorName: { count, amountCents } }
  vendor_breakdown      JSONB NOT NULL DEFAULT '{}',

  UNIQUE(report_id, employer_key)
);

CREATE INDEX IF NOT EXISTS idx_rer_report ON report_employer_rollups (report_id);

-- Vendor rollups: precomputed per-report aggregates
CREATE TABLE IF NOT EXISTS report_vendor_rollups (
  id                  BIGSERIAL PRIMARY KEY,
  report_id           UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  vendor_name         TEXT NOT NULL,

  transaction_count   INT NOT NULL DEFAULT 0,
  total_amount_cents  BIGINT NOT NULL DEFAULT 0,
  unique_customers    INT NOT NULL DEFAULT 0,

  UNIQUE(report_id, vendor_name)
);

CREATE INDEX IF NOT EXISTS idx_rvr_report ON report_vendor_rollups (report_id);

-- Customer location summary (for drill-down)
CREATE TABLE IF NOT EXISTS report_customer_locations (
  id                  BIGSERIAL PRIMARY KEY,
  report_id           UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  customer_id         TEXT NOT NULL,
  employer_name       TEXT,
  employer_key        TEXT,
  in_us               TEXT NOT NULL DEFAULT 'unknown', -- true | false | unknown
  latest_location_raw TEXT,
  latest_location_city TEXT,
  latest_location_state TEXT,
  latest_location_country TEXT,
  latest_location_date TIMESTAMPTZ,
  transaction_count   INT NOT NULL DEFAULT 0,

  UNIQUE(report_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_rcl_report ON report_customer_locations (report_id);
CREATE INDEX IF NOT EXISTS idx_rcl_employer ON report_customer_locations (report_id, employer_key);

-- Enable Row Level Security (but allow public read for shared reports)
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_employer_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_vendor_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_customer_locations ENABLE ROW LEVEL SECURITY;

-- Public read policies (reports are shareable by default)
CREATE POLICY "Public read reports" ON reports FOR SELECT USING (true);
CREATE POLICY "Public read transactions" ON report_transactions FOR SELECT USING (true);
CREATE POLICY "Public read employer rollups" ON report_employer_rollups FOR SELECT USING (true);
CREATE POLICY "Public read vendor rollups" ON report_vendor_rollups FOR SELECT USING (true);
CREATE POLICY "Public read customer locations" ON report_customer_locations FOR SELECT USING (true);

-- Service role can do everything
CREATE POLICY "Service insert reports" ON reports FOR INSERT WITH CHECK (true);
CREATE POLICY "Service update reports" ON reports FOR UPDATE USING (true);
CREATE POLICY "Service delete reports" ON reports FOR DELETE USING (true);

CREATE POLICY "Service insert transactions" ON report_transactions FOR INSERT WITH CHECK (true);
CREATE POLICY "Service update transactions" ON report_transactions FOR UPDATE USING (true);
CREATE POLICY "Service delete transactions" ON report_transactions FOR DELETE USING (true);

CREATE POLICY "Service insert employer rollups" ON report_employer_rollups FOR INSERT WITH CHECK (true);
CREATE POLICY "Service update employer rollups" ON report_employer_rollups FOR UPDATE USING (true);
CREATE POLICY "Service delete employer rollups" ON report_employer_rollups FOR DELETE USING (true);

CREATE POLICY "Service insert vendor rollups" ON report_vendor_rollups FOR INSERT WITH CHECK (true);
CREATE POLICY "Service update vendor rollups" ON report_vendor_rollups FOR UPDATE USING (true);
CREATE POLICY "Service delete vendor rollups" ON report_vendor_rollups FOR DELETE USING (true);

CREATE POLICY "Service insert customer locations" ON report_customer_locations FOR INSERT WITH CHECK (true);
CREATE POLICY "Service update customer locations" ON report_customer_locations FOR UPDATE USING (true);
CREATE POLICY "Service delete customer locations" ON report_customer_locations FOR DELETE USING (true);

-- ============================================================
-- Cleanup function: delete expired reports (run via pg_cron or scheduled job)
-- ============================================================
CREATE OR REPLACE FUNCTION cleanup_expired_reports()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM reports WHERE expires_at < now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- To schedule automatic cleanup, enable pg_cron extension in Supabase and run:
-- SELECT cron.schedule('cleanup-expired-reports', '0 3 * * *', 'SELECT cleanup_expired_reports()');

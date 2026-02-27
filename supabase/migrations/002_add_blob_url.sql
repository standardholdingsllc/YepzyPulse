-- ============================================================
-- Add blob URL column for large CSV file storage
-- ============================================================

-- Store the Vercel Blob URL for the raw CSV file
ALTER TABLE reports ADD COLUMN IF NOT EXISTS csv_blob_url TEXT;

-- Add index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_reports_csv_blob ON reports (csv_blob_url) WHERE csv_blob_url IS NOT NULL;

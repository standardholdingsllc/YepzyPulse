-- Add transactions_blob_path column to store path to JSON blob
-- This replaces storing individual transactions in the database

ALTER TABLE reports
ADD COLUMN IF NOT EXISTS transactions_blob_path TEXT;

COMMENT ON COLUMN reports.transactions_blob_path IS 'Path to JSON blob containing all transactions for this report';

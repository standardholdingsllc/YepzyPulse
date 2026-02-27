-- ============================================================
-- Add processing_started_at column to track when processing began
-- This enables detection of stale/timed-out processing jobs
-- ============================================================

ALTER TABLE reports
ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

-- Backfill existing processing reports with created_at as fallback
UPDATE reports
SET processing_started_at = created_at
WHERE status = 'processing' AND processing_started_at IS NULL;

-- Create index for efficient stale job queries
CREATE INDEX IF NOT EXISTS idx_reports_processing_started
ON reports (processing_started_at)
WHERE status = 'processing';

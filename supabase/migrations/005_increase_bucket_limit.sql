-- ============================================================
-- Ensure csv-uploads bucket has correct file size limit
-- This updates the bucket if it was created with a different limit
-- ============================================================

-- Update the file size limit to 500MB (524288000 bytes)
UPDATE storage.buckets
SET file_size_limit = 524288000
WHERE id = 'csv-uploads';

-- IMPORTANT: You must also set the GLOBAL file size limit in Supabase Dashboard:
-- 1. Go to Storage → Settings
-- 2. Set "Upload file size limit" to at least 500 MB
-- 3. Save changes
--
-- The global limit takes precedence over bucket-level limits.
-- If the global limit is lower than 118MB, large file uploads will fail with 413.

-- ============================================================
-- Create Supabase Storage bucket for CSV file uploads
-- Replaces Vercel Blob for large file storage
-- ============================================================

-- Create the csv-uploads bucket (private, not publicly readable)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'csv-uploads',
  'csv-uploads',
  false,
  524288000, -- 500 MB
  ARRAY['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel', 'application/octet-stream']
) ON CONFLICT (id) DO NOTHING;

-- No RLS policies needed: uploads use signed URLs (generated server-side
-- with the service role key), and downloads/deletes are done server-side
-- with the service role key which bypasses RLS.

-- ============================================================
-- Enable RLS INSERT policy on csv-uploads bucket
-- Required for client-side TUS resumable uploads using the anon key.
-- The bucket already restricts allowed MIME types and max file size (500 MB).
-- ============================================================

-- Allow anonymous users to INSERT objects into the csv-uploads bucket.
-- Downloads and deletes are still done server-side with the service role key.
CREATE POLICY "Allow anonymous CSV uploads"
  ON storage.objects
  FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'csv-uploads');

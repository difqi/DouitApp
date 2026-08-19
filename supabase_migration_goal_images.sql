-- ==============================================================================
-- Idempotent Migration: Goal Images Public Storage Bucket & Access Policies
-- ==============================================================================

-- 1. Create or ensure 'goal-images' bucket is public
INSERT INTO storage.buckets (id, name, public) 
VALUES ('goal-images', 'goal-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. Public SELECT policy for goal images
DROP POLICY IF EXISTS "Public goal images access" ON storage.objects;
CREATE POLICY "Public goal images access"
ON storage.objects FOR SELECT
USING (bucket_id = 'goal-images');

-- 3. Authenticated user upload policy for goal images
DROP POLICY IF EXISTS "Users can upload goal images" ON storage.objects;
CREATE POLICY "Users can upload goal images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'goal-images' AND auth.role() = 'authenticated');

-- 4. Authenticated user update policy for goal images
DROP POLICY IF EXISTS "Users can update goal images" ON storage.objects;
CREATE POLICY "Users can update goal images"
ON storage.objects FOR UPDATE
USING (bucket_id = 'goal-images' AND auth.role() = 'authenticated');

-- 5. Authenticated user delete policy for goal images
DROP POLICY IF EXISTS "Users can delete goal images" ON storage.objects;
CREATE POLICY "Users can delete goal images"
ON storage.objects FOR DELETE
USING (bucket_id = 'goal-images' AND auth.role() = 'authenticated');

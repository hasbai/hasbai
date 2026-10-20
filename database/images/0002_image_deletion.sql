BEGIN;
ALTER TABLE public.image ADD COLUMN deleted_at timestamptz;
GRANT DELETE ON public.image TO images_service;
-- An incomplete deletion must not be listed by the legacy blog Data API.
ALTER POLICY image_public ON public.image USING (ready AND deleted_at IS NULL);
NOTIFY pgrst, 'reload schema';
COMMIT;

BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='images_service') THEN CREATE ROLE images_service NOLOGIN; END IF;
END $$;
ALTER TABLE public.image ADD COLUMN owner text;
ALTER TABLE public.image ADD COLUMN source text NOT NULL DEFAULT 'upload';
ALTER TABLE public.image ADD COLUMN model text;
CREATE INDEX image_owner_created ON public.image(owner, created_at DESC, id);
-- Only the image Worker can finalize objects. Browser roles gain no write access.
GRANT USAGE ON SCHEMA public TO images_service;
GRANT SELECT, INSERT, UPDATE ON public.image TO images_service;
CREATE POLICY image_service ON public.image TO images_service USING (true) WITH CHECK (true);
REVOKE SELECT ON public.image FROM anonymous;
GRANT SELECT(id,name,sha256,content_type,size,width,height,ready,created_at) ON public.image TO anonymous;
NOTIFY pgrst, 'reload schema';
COMMIT;

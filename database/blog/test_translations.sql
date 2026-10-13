-- Run against an isolated migrated branch; all test writes roll back.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_inherits WHERE inhparent='public.content'::regclass) THEN RAISE EXCEPTION 'Content still has inherited tables'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='content' AND column_name IN ('title','markdown','excerpt')) THEN RAISE EXCEPTION 'Localized text leaked into metadata'; END IF;
END $$;
SET LOCAL ROLE superadmin;
SELECT public.save_content('f0000000-0000-4000-8000-000000000001','article',NULL,'zh-CN',
 '{"title":"测试","slug":"translation-test","markdown":"# 原文","excerpt":"摘要","status":"draft","published_at":null,"cover_id":null,"tag_ids":[]}');
DO $$ DECLARE stamp timestamptz; target_stamp timestamptz; content_stamp timestamptz; BEGIN
 SELECT updated_at INTO stamp FROM public.translation WHERE content_id='f0000000-0000-4000-8000-000000000001' AND locale='zh-CN';
 PERFORM public.save_translation('f0000000-0000-4000-8000-000000000001','zh-CN',stamp,'en-US',NULL,'{"title":"Test","markdown":"Original","excerpt":"Summary"}',true);
 PERFORM public.save_translation('f0000000-0000-4000-8000-000000000001','zh-CN',stamp,'en-US',NULL,'{"title":"Overwrite","markdown":"Changed","excerpt":"Summary"}',true);
 IF (SELECT title FROM public.translation WHERE content_id='f0000000-0000-4000-8000-000000000001' AND locale='en-US')<>'Test' THEN RAISE EXCEPTION 'Automatic translation overwrote existing version'; END IF;
 SELECT updated_at INTO target_stamp FROM public.translation WHERE content_id='f0000000-0000-4000-8000-000000000001' AND locale='en-US';
 PERFORM public.save_translation('f0000000-0000-4000-8000-000000000001','zh-CN',stamp,'en-US',target_stamp,'{"title":"Manual","markdown":"Manual","excerpt":"Summary"}',false);
 BEGIN
  PERFORM public.save_translation('f0000000-0000-4000-8000-000000000001','zh-CN',stamp,'en-US',target_stamp,'{"title":"Stale","markdown":"Stale","excerpt":"Summary"}',false);
  RAISE EXCEPTION 'Stale target accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 SELECT updated_at INTO content_stamp FROM public.content WHERE id='f0000000-0000-4000-8000-000000000001';
 PERFORM public.save_content('f0000000-0000-4000-8000-000000000001','article',content_stamp,'zh-CN','{"title":"测试","slug":"translation-test","markdown":"新原文","excerpt":"摘要","status":"draft","published_at":null,"cover_id":null,"tag_ids":[]}');
 BEGIN
  PERFORM public.save_translation('f0000000-0000-4000-8000-000000000001','zh-CN',stamp,'zh-TW',NULL,'{"title":"過期","markdown":"過期","excerpt":"摘要"}',true);
  RAISE EXCEPTION 'Stale source accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 SELECT updated_at INTO stamp FROM public.translation WHERE content_id='f0000000-0000-4000-8000-000000000001' AND locale='zh-CN';
 INSERT INTO public.translation(content_id,locale,title,markdown) VALUES('f0000000-0000-4000-8000-000000000001','zh-TW','空白','');
 PERFORM public.save_translation('f0000000-0000-4000-8000-000000000001','zh-CN',stamp,'zh-TW',NULL,'{"title":"完整","markdown":"完整翻譯","excerpt":"摘要"}',true);
 IF NOT (SELECT is_complete FROM public.translation WHERE content_id='f0000000-0000-4000-8000-000000000001' AND locale='zh-TW') THEN RAISE EXCEPTION 'Empty translation was not completed'; END IF;
END $$;
SET LOCAL ROLE anonymous;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.translation WHERE content_id='f0000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'Anonymous can read draft translations'; END IF;
 BEGIN
  INSERT INTO public.translation(content_id,locale) VALUES('f0000000-0000-4000-8000-000000000001','zh-TW');
  RAISE EXCEPTION 'Anonymous can write translations' USING ERRCODE='XX000';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;

-- Direct replacement of inherited content. Existing text and identifiers are preserved.
BEGIN;
LOCK TABLE public.content, public.article, public.note, public.page, public.article_tag, public.tag IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT id FROM public.content GROUP BY id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate content identifiers';
  END IF;
END $$;
CREATE TEMP TABLE old_writing ON COMMIT DROP AS
 SELECT id,kind,sequence,title,slug,legacy_path,excerpt,markdown,cover_id,status,published_at,created_at,updated_at FROM public.article
 UNION ALL SELECT id,kind,sequence,NULL,NULL,NULL,excerpt,markdown,cover_id,status,published_at,created_at,updated_at FROM public.note
 UNION ALL SELECT id,kind,NULL,title,slug,NULL,excerpt,markdown,cover_id,status,published_at,created_at,updated_at FROM public.page;
CREATE TEMP TABLE old_links ON COMMIT DROP AS SELECT * FROM public.article_tag;
ALTER SEQUENCE public.article_number_seq OWNED BY NONE;
ALTER SEQUENCE public.note_number_seq OWNED BY NONE;
DROP FUNCTION public.save_article(uuid,timestamptz,text,text,text,text,uuid,text,timestamptz,uuid[]);
DROP TABLE public.article_tag;
DROP TABLE public.article, public.note, public.page;
DROP TABLE public.content;
CREATE TYPE public.content_kind AS ENUM ('article','note','page');
CREATE TYPE public.content_status AS ENUM ('draft','published');
CREATE TYPE public.locale AS ENUM ('zh-CN','zh-TW','en-US');
CREATE TYPE public.image_content_type AS ENUM ('image/png','image/jpeg','image/webp','image/gif');
ALTER TABLE public.image DROP CONSTRAINT image_content_type_check;
ALTER TABLE public.image ALTER COLUMN content_type TYPE public.image_content_type USING content_type::public.image_content_type;
CREATE TABLE public.content (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind public.content_kind NOT NULL,
 source_locale public.locale NOT NULL DEFAULT 'zh-CN',
 sequence bigint,
 slug text CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,159}$'),
 legacy_path text UNIQUE,
 cover_id uuid REFERENCES public.image(id) ON DELETE SET NULL,
 status public.content_status NOT NULL DEFAULT 'draft',
 published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (kind,slug), UNIQUE (kind,sequence),
 CHECK ((kind='note' AND sequence IS NOT NULL AND slug IS NULL) OR (kind='article' AND sequence IS NOT NULL AND slug IS NOT NULL) OR (kind='page' AND sequence IS NULL AND slug IS NOT NULL)),
 CHECK (status<>'published' OR published_at IS NOT NULL),
 CHECK (kind<>'page' OR slug NOT IN ('articles','notes','timeline','tags','contents','studio','auth','api','images','assets','en','zh','en-us','zh-cn','zh-tw'))
);
CREATE TABLE public.translation (
 content_id uuid NOT NULL REFERENCES public.content(id) ON DELETE CASCADE,
 locale public.locale NOT NULL,
 title text NOT NULL DEFAULT '' CHECK (length(title)<=240),
 excerpt text NOT NULL DEFAULT '' CHECK (length(excerpt)<=600),
 markdown text NOT NULL DEFAULT '' CHECK (octet_length(markdown)<=1048576),
 is_complete boolean GENERATED ALWAYS AS (length(btrim(markdown))>0) STORED,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(content_id,locale)
);
INSERT INTO public.content(id,kind,sequence,slug,legacy_path,cover_id,status,published_at,created_at,updated_at)
 SELECT id,kind::public.content_kind,sequence,slug,legacy_path,cover_id,status::public.content_status,published_at,created_at,updated_at FROM old_writing;
INSERT INTO public.translation(content_id,locale,title,excerpt,markdown,updated_at)
 SELECT id,'zh-CN',coalesce(title,''),excerpt,markdown,updated_at FROM old_writing;
ALTER TABLE public.tag ADD COLUMN translations jsonb NOT NULL DEFAULT '{}';
UPDATE public.tag SET translations=jsonb_build_object('zh-CN',name);
CREATE UNIQUE INDEX tag_default_name_unique ON public.tag ((translations->>'zh-CN'));
-- Keep a stable localized name in the application; the DB stores only the JSON object.
ALTER TABLE public.tag DROP COLUMN name;
ALTER TABLE public.tag ADD CONSTRAINT tag_translations_check CHECK (jsonb_typeof(translations)='object' AND NOT jsonb_path_exists(translations, '$.* ? (@.type() != "string")') AND translations ? 'zh-CN' AND length(btrim(translations->>'zh-CN')) BETWEEN 1 AND 80);
CREATE TABLE public.article_tag (
 article_id uuid NOT NULL REFERENCES public.content(id) ON DELETE CASCADE,
 tag_id uuid NOT NULL REFERENCES public.tag(id) ON DELETE RESTRICT,
 PRIMARY KEY(article_id,tag_id)
);
INSERT INTO public.article_tag SELECT * FROM old_links;
CREATE INDEX article_tag_by_tag ON public.article_tag(tag_id,article_id);
CREATE INDEX content_published ON public.content(kind,published_at DESC,id) WHERE status='published';
ALTER TABLE public.content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.translation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_tag ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.content,public.translation,public.article_tag TO anonymous;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.content,public.translation,public.article_tag TO superadmin;
CREATE POLICY content_public ON public.content FOR SELECT TO anonymous USING(status='published' AND published_at<=now());
CREATE POLICY content_editor ON public.content TO superadmin USING(true) WITH CHECK(true);
CREATE POLICY translation_public ON public.translation FOR SELECT TO anonymous USING(EXISTS(SELECT 1 FROM public.content c WHERE c.id=content_id AND c.status='published' AND c.published_at<=now()));
CREATE POLICY translation_editor ON public.translation TO superadmin USING(true) WITH CHECK(true);
CREATE POLICY article_tag_public ON public.article_tag FOR SELECT TO anonymous USING(EXISTS(SELECT 1 FROM public.content c WHERE c.id=article_id AND c.kind='article' AND c.status='published' AND c.published_at<=now()));
CREATE POLICY article_tag_editor ON public.article_tag TO superadmin USING(true) WITH CHECK(true);
CREATE FUNCTION public.blog_locales() RETURNS SETOF public.locale LANGUAGE sql STABLE SECURITY INVOKER AS $$ SELECT unnest(enum_range(NULL::public.locale)) $$;
GRANT EXECUTE ON FUNCTION public.blog_locales() TO anonymous,superadmin;
CREATE FUNCTION public.save_content(p_id uuid,p_kind public.content_kind,p_updated_at timestamptz,p_locale public.locale,p_value jsonb)
RETURNS public.content LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE saved public.content; tag_ids uuid[]; BEGIN
 IF p_kind='page' AND EXISTS(SELECT 1 FROM unnest(enum_range(NULL::locale)) AS l WHERE lower(l::text)=p_value->>'slug' OR split_part(lower(l::text),'-',1)=p_value->>'slug') THEN RAISE EXCEPTION '页面路径与语言前缀冲突'; END IF;
 IF p_kind<>'note' AND length(btrim(p_value->>'title')) NOT BETWEEN 1 AND 240 THEN RAISE EXCEPTION '请填写标题' USING ERRCODE='22023'; END IF;
 IF p_value->>'status'='published' AND length(btrim(p_value->>'markdown'))=0 THEN RAISE EXCEPTION '发布前请填写正文' USING ERRCODE='22023'; END IF;
 IF p_updated_at IS NULL THEN
  INSERT INTO content(id,kind,source_locale,sequence,slug,cover_id,status,published_at)
  VALUES(p_id,p_kind,p_locale,CASE p_kind WHEN 'article' THEN nextval('article_number_seq') WHEN 'note' THEN nextval('note_number_seq') END,
   CASE WHEN p_kind<>'note' THEN p_value->>'slug' END,(p_value->>'cover_id')::uuid,(p_value->>'status')::content_status,(p_value->>'published_at')::timestamptz) RETURNING * INTO saved;
 ELSE
  UPDATE content SET slug=CASE WHEN p_kind<>'note' THEN p_value->>'slug' END,cover_id=(p_value->>'cover_id')::uuid,status=(p_value->>'status')::content_status,published_at=(p_value->>'published_at')::timestamptz,updated_at=clock_timestamp()
  WHERE id=p_id AND kind=p_kind AND updated_at=p_updated_at RETURNING * INTO saved;
  IF saved.id IS NULL THEN RAISE EXCEPTION '内容已被更新，请重新打开后编辑' USING ERRCODE='P0001'; END IF;
 END IF;
 INSERT INTO translation(content_id,locale,title,excerpt,markdown) VALUES(p_id,p_locale,coalesce(p_value->>'title',''),p_value->>'excerpt',p_value->>'markdown')
 ON CONFLICT(content_id,locale) DO UPDATE SET title=excluded.title,excerpt=excluded.excerpt,markdown=excluded.markdown,updated_at=clock_timestamp();
 IF p_kind='article' THEN
  SELECT coalesce(array_agg(value::uuid),'{}') INTO tag_ids FROM jsonb_array_elements_text(p_value->'tag_ids');
  IF cardinality(tag_ids)>30 THEN RAISE EXCEPTION '文章标签不能超过30个'; END IF;
  DELETE FROM article_tag WHERE article_id=p_id AND tag_id<>ALL(tag_ids);
  INSERT INTO article_tag SELECT p_id,unnest(tag_ids) ON CONFLICT DO NOTHING;
 END IF;
 RETURN saved;
END $$;
CREATE FUNCTION public.save_translation(p_id uuid,p_source public.locale,p_source_updated_at timestamptz,p_locale public.locale,p_updated_at timestamptz,p_value jsonb,p_missing_only boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM 1 FROM content WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '内容不存在'; END IF;
 IF NOT EXISTS(SELECT 1 FROM translation WHERE content_id=p_id AND locale=p_source AND updated_at=p_source_updated_at) THEN RAISE EXCEPTION '原文已更新，请重新翻译'; END IF;
 IF p_missing_only THEN
  INSERT INTO translation(content_id,locale,title,excerpt,markdown) VALUES(p_id,p_locale,p_value->>'title',p_value->>'excerpt',p_value->>'markdown') ON CONFLICT(content_id,locale) DO UPDATE SET title=excluded.title,excerpt=excluded.excerpt,markdown=excluded.markdown,updated_at=clock_timestamp() WHERE NOT translation.is_complete;
 ELSE
  IF p_updated_at IS NULL THEN
   INSERT INTO translation(content_id,locale,title,excerpt,markdown) VALUES(p_id,p_locale,p_value->>'title',p_value->>'excerpt',p_value->>'markdown');
  ELSE
   UPDATE translation SET title=p_value->>'title',excerpt=p_value->>'excerpt',markdown=p_value->>'markdown',updated_at=clock_timestamp()
   WHERE content_id=p_id AND locale=p_locale AND updated_at=p_updated_at;
   IF NOT FOUND THEN RAISE EXCEPTION '译文已更新，请重新打开'; END IF;
  END IF;
 END IF;
 UPDATE content SET updated_at=clock_timestamp() WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.save_content(uuid,public.content_kind,timestamptz,public.locale,jsonb),public.save_translation(uuid,public.locale,timestamptz,public.locale,timestamptz,jsonb,boolean) FROM PUBLIC,anonymous;
GRANT EXECUTE ON FUNCTION public.save_content(uuid,public.content_kind,timestamptz,public.locale,jsonb),public.save_translation(uuid,public.locale,timestamptz,public.locale,timestamptz,jsonb,boolean) TO superadmin;
NOTIFY pgrst,'reload schema';
COMMIT;

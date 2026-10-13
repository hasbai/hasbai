import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const seededPages = JSON.parse(readFileSync(new URL('./pages.json', import.meta.url), 'utf8'));
let pages = structuredClone(seededPages);

const tag = { id: '10000000-0000-4000-8000-000000000001', name: '随笔', translations: {'zh-CN':'随笔','zh-TW':'隨筆','en-US':'Writing'}, slug: 'writing' };
const article = {
  id: '20000000-0000-4000-8000-000000000001', kind: 'article', sequence: 1,
  title: 'Hello World，开始记录', slug: 'hello-world', legacy_path: '/notes/hello-world',
  excerpt: '写作让零散的想法有了形状。这里是一次新的开始。',
  markdown: '## 从一页空白开始\n\n这是北极小站的第一篇文章。把思考留下来，让日常值得回看。\n\n> 写下来，就有了下一次对话。',
  cover_id: null, status: 'published', published_at: '2026-09-23T00:00:00Z',
  created_at: '2026-09-23T00:00:00Z', updated_at: '2026-09-23T00:00:00Z',
};
const note = {
  id: '30000000-0000-4000-8000-000000000001', kind: 'note', sequence: 1,
  excerpt: '今天想把一个简单的念头留下来。',
  markdown: '今天想把一个简单的念头留下来。\n\n即使没有标题，也值得记录。',
  cover_id: null, status: 'published', published_at: '2026-09-22T00:00:00Z',
  created_at: '2026-09-22T00:00:00Z', updated_at: '2026-09-22T00:00:00Z',
};
let articles = [{ ...article }];
let notes = [{ ...note }];
let tags = [{ ...tag }];
let links = [{ article_id: article.id, tag_id: tag.id }];
let fail = false;
let locales = ['zh-CN','zh-TW','en-US'];
let extraTranslations = [];
function translated(row) { return {...row,source_locale:'zh-CN',article_tag:links.filter(t=>t.article_id===row.id),translation:[{content_id:row.id,locale:'zh-CN',is_complete:!!row.markdown?.trim(),title:row.title??'',excerpt:row.excerpt,markdown:row.markdown,updated_at:row.updated_at},...extraTranslations.filter(t=>t.content_id===row.id)]}; }

function filter(rows, url) {
  let result = rows;
  for (const [key, query] of url.searchParams) {
    if (!query.startsWith('eq.')) continue;
    const value = query.slice(3);
    result = result.filter((row) => String(row[key]) === value);
  }
  return result;
}
async function bodyOf(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return JSON.parse(body);
}
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.end(); return; }
  if(url.pathname === '/fixture/translation') {
    const value=await bodyOf(req);extraTranslations=extraTranslations.filter(t=>!(t.content_id===value.content_id&&t.locale===value.locale));extraTranslations.push(value);
    const item=[...articles,...notes,...pages].find(row=>row.id===value.content_id);if(item)item.updated_at=value.updated_at;
    res.end(JSON.stringify({...item,...value,id:value.content_id,translation:undefined,translations:translated(item).translation,tag_ids:links.filter(link=>link.article_id===item.id).map(link=>link.tag_id)}));return;
  }
  if (url.pathname === '/api/locales') {res.end(JSON.stringify({locales,available:["zh-CN","zh-TW","en-US"]}));return;}
  if (url.pathname === '/api/settings/locales') {
    if(req.method==='PUT')locales=(await bodyOf(req)).locales;
    res.end(JSON.stringify({locales,available:['zh-CN','zh-TW','en-US']}));return;
  }
  if (url.pathname === '/reset') {
    articles = [{ ...article }]; notes = [{ ...note }]; tags = [{ ...tag }]; pages = structuredClone(seededPages);
    links = [{ article_id: article.id, tag_id: tag.id }]; fail = false;extraTranslations=[];locales=['zh-CN','zh-TW','en-US'];
    res.end('{}'); return;
  }
  if (url.pathname === '/empty') { articles = []; notes = []; links = []; res.end('{}'); return; }
  if (url.pathname === '/fail') { fail = true; res.end('{}'); return; }
  if (url.pathname === '/auth/token/anonymous') { res.end(JSON.stringify({ token: 'guest' })); return; }
  if (fail) { res.statusCode = 503; res.end(JSON.stringify({ message: 'unavailable' })); return; }
  if (url.pathname === '/api/content' || url.pathname.endsWith('/rpc/save_content')) {
    const v=await bodyOf(req);const values=v.value??v.p_value;const kind=v.kind??v.p_kind;const id=v.id??v.p_id??crypto.randomUUID();
    const collection=kind==='article'?articles:kind==='note'?notes:pages;
    const stamp=v.updated_at??v.p_updated_at;const previous=stamp?collection.find(row=>row.id===id&&row.updated_at===stamp):null;
    if(stamp&&!previous){res.statusCode=409;res.end(JSON.stringify({message:'内容已被更新'}));return;}
    if(kind==='page'&&collection.some(row=>row.id!==id&&row.slug===values.slug)){res.statusCode=409;res.end(JSON.stringify({message:'页面路径已被使用，请换一个路径'}));return;}
    const locale=values.locale??v.p_locale??'zh-CN';const base=kind==='article'?article:kind==='note'?note:seededPages[0];
    const saved={...(previous??base),...values,id,kind,sequence:previous?.sequence??collection.length+1,updated_at:new Date().toISOString()};
    if(locale==='zh-CN'){if(previous)Object.assign(previous,saved);else collection.push(saved);}
    else {
      if(!previous)collection.push({...saved,title:'',excerpt:'',markdown:''});else previous.updated_at=saved.updated_at;
      extraTranslations=extraTranslations.filter(t=>!(t.content_id===id&&t.locale===locale));
      extraTranslations.push({content_id:id,locale,title:values.title??'',excerpt:values.excerpt,markdown:values.markdown,updated_at:saved.updated_at});
    }
    if(kind==='article'){links=links.filter(link=>link.article_id!==id);links.push(...values.tag_ids.map(tag_id=>({article_id:id,tag_id})));}
    res.end(JSON.stringify(url.pathname==='/api/content'?{item:saved}:saved));return;
  }
  if(url.pathname.endsWith('/rpc/blog_locales')){res.end(JSON.stringify(['zh-CN','zh-TW','en-US']));return;}

  const table = url.pathname.split('/').pop();
  const collections = { article: articles, note: notes, page: pages, content: [...articles, ...notes, ...pages].map(translated), translation: [...articles,...notes,...pages].flatMap(row=>translated(row).translation), tag: tags, article_tag: links };
  let data = collections[table] ?? [];
  if (req.method === 'GET') data = filter(data, url);
  if (req.method === 'POST') {
    const payload = await bodyOf(req);
    const values = Array.isArray(payload) ? payload : [payload];
    if (table === 'article') {
      data = values.map((value) => ({ ...article, ...value, kind: 'article', sequence: articles.length + 1 }));
      articles.push(...data);
    } else if (table === 'note') {
      data = values.map((value) => ({ ...note, ...value, kind: 'note', sequence: notes.length + 1 }));
      notes.push(...data);
    } else if (table === 'page') {
      if (values.some((value) => pages.some((row) => row.slug === value.slug))) {
        res.statusCode = 409; res.end(JSON.stringify({ code: '23505', message: 'duplicate path' })); return;
      }
      data = values.map((value) => ({ ...seededPages[0], ...value, kind: 'page' }));
      pages.push(...data);
    } else if (table === 'tag') {
      data = values.map((value) => ({ ...value, id: crypto.randomUUID() })); tags.push(...data);
    } else if (table === 'article_tag') { data = values; links.push(...values); }
  }
  if (req.method === 'PATCH') {
    const payload = await bodyOf(req);
    const selected = filter(data, url);
    if (table === 'page' && selected.some((row) => pages.some((other) => other.id !== row.id && other.slug === payload.slug))) {
      res.statusCode = 409; res.end(JSON.stringify({ code: '23505', message: 'duplicate path' })); return;
    }
    data = selected.map((row) => Object.assign(row, payload));
  }
  if (req.method === 'DELETE') {
    data = filter(data, url);
    if (table === 'content') {const ids=new Set(data.map(row=>row.id));articles=articles.filter(row=>!ids.has(row.id));notes=notes.filter(row=>!ids.has(row.id));pages=pages.filter(row=>!ids.has(row.id));}
    if (table === 'article') articles = articles.filter((row) => !data.includes(row));
    if (table === 'page') pages = pages.filter((row) => !data.includes(row));
    if (table === 'note') notes = notes.filter((row) => !data.includes(row));
    if (table === 'article_tag') links = links.filter((row) => !data.includes(row));
  }
  if (req.headers.accept?.includes('vnd.pgrst.object')) data = data[0] ?? null;
  res.end(JSON.stringify(data));
}).listen(4180, '127.0.0.1');

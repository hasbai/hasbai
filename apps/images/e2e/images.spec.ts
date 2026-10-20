import {expect,test,type Page} from '@playwright/test';
const names=['港城的雨夜','银发旅人 · 立绘','山间小站','午后的窗边'];
const assets=names.map((name,i)=>({id:`c51f7180-6795-4a3a-8ec6-060ebc3fe98${i}`,name,size:204800+i*1000,content_type:'image/png',created_at:'2026-10-20T00:00:00Z',model:i===1?'gpt-image-2.5-sunburst':null,url:`https://images.hasbai.xyz/images/c51f7180-6795-4a3a-8ec6-060ebc3fe98${i}`}));
async function fixture(page:Page,mode='ready'){
 const rows=structuredClone(assets);
 await page.route('**/library/**',async route=>{const response=await route.fetch({url:new URL('/e2e/index.html',route.request().url()).href});return route.fulfill({response});});
 await page.route('https://images.hasbai.xyz/images/**',route=>route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240"><rect width="320" height="240" fill="#e4e8e7"/><circle cx="225" cy="70" r="30" fill="#c4d3c9"/><path d="M0 210L100 80L210 240H0M100 240L220 110L320 220V240" fill="#92a69c"/></svg>`}));
 await page.route('**/api/**',async route=>{
 const r=route.request(),url=new URL(r.url());
 if(url.pathname==='/api/me')return route.fulfill({json:{admin:mode!=='ordinary'}});
 if(mode==='error')return route.fulfill({status:503,json:{message:'图片暂时不可用'}});
 if(r.method()==='DELETE'){const index=rows.findIndex(x=>url.pathname.endsWith(x.id));if(index>=0)rows.splice(index,1);return route.fulfill({status:204});}
 if(r.method()==='GET'&&url.pathname.startsWith('/api/images/')){const row=rows.find(x=>url.pathname.endsWith(x.id));return row?route.fulfill({json:{...row,can_manage:mode!=='ordinary',deleting:false}}):route.fulfill({status:404,json:{message:'图片不存在'}});}
 if(r.method()==='PATCH'){const row=rows.find(x=>url.pathname.endsWith(x.id))!;row.name=r.postDataJSON().name;return route.fulfill({json:row});}
 if(r.method()==='POST')return route.fulfill({json:assets[0]});
 return route.fulfill({json:{images:mode==='empty'||mode==='ordinary'?[]:rows.filter(x=>x.name.includes(url.searchParams.get('q')??'')),hasMore:false}});
 });
 await page.goto('/e2e/index.html');await expect(page.getByRole('heading',{name:'图片库',exact:true})).toBeVisible();await expect(page.getByText('正在加载图片…')).toHaveCount(0);
}
test('image library models generation rename search and theme',async({page})=>{
 await fixture(page);await expect(page.getByRole('img')).toHaveCount(4);await expect(page.getByLabel('生成模型')).toHaveValue('gpt-image-2.5-flare');await expect(page).toHaveScreenshot('images-library.png',{fullPage:true});
 await page.getByLabel('生成模型').selectOption('gpt-image-2.5-sunburst');await page.getByLabel('图片描述',{exact:true}).fill('夜色中的港口');const request=page.waitForRequest(r=>r.url().endsWith('/api/generate'));await page.getByRole('button',{name:'生成图片',exact:true}).click();expect((await request).postDataJSON()).toEqual({prompt:'夜色中的港口',model:'gpt-image-2.5-sunburst'});await expect(page.getByText('已生成并保存')).toBeVisible();
 await page.getByRole('link',{name:'查看 港城的雨夜',exact:true}).first().click();await expect(page).toHaveURL(/\/library\//);await expect(page.getByRole('heading',{name:'港城的雨夜',exact:true})).toBeVisible();await expect(page).toHaveScreenshot('images-detail.png',{fullPage:true});
 await page.getByRole('button',{name:'重命名',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByLabel('图片名称',{exact:true}).fill('港城 · 雨夜');await expect(page.getByRole('dialog')).toHaveScreenshot('images-rename.png',{stylePath:new URL('./dialog-snapshot.css',import.meta.url).pathname});await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('heading',{name:'港城 · 雨夜',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'切换深色模式'}).click();await expect(page).toHaveScreenshot('images-dark.png',{fullPage:true});
 await page.getByRole('button',{name:'返回图片库'}).click();await page.getByLabel('搜索图片',{exact:true}).first().fill('没有这样的图片');await page.getByRole('button',{name:'搜索图片',exact:true}).click();await expect(page.getByText('没有匹配的图片')).toBeVisible();await expect(page).toHaveScreenshot('images-search-empty.png',{fullPage:true});
});
test('image library empty and failure keep generation and upload available',async({page})=>{
 await fixture(page,'empty');await expect(page.getByText('还没有图片')).toBeVisible();await expect(page).toHaveScreenshot('images-empty.png',{fullPage:true});
 await fixture(page,'error');await expect(page.getByRole('alert')).toContainText('图片暂时不可用');await expect(page.getByRole('button',{name:'上传图片',exact:true})).toBeEnabled();await expect(page).toHaveScreenshot('images-error.png',{fullPage:true});
});
test('image generation can be cancelled without clearing the prompt',async({page})=>{
 await fixture(page);let release:(()=>void)|undefined;await page.route('**/api/generate',async route=>{await new Promise<void>(resolve=>release=resolve);await route.fulfill({json:assets[0]}).catch(()=>{});});
 await page.getByLabel('图片描述',{exact:true}).fill('保留这份描述');await page.getByRole('button',{name:'生成图片',exact:true}).click();await expect(page.getByText('正在生成图片…')).toBeVisible();await expect(page.getByLabel('生成模型')).toBeDisabled();await expect(page).toHaveScreenshot('images-generating.png',{fullPage:true});await page.getByRole('button',{name:'取消生成',exact:true}).click();release?.();await expect(page.getByLabel('图片描述',{exact:true})).toHaveValue('保留这份描述');await expect(page.getByText('已生成并保存')).toHaveCount(0);
});

test('ordinary users can use a duplicate public upload even when it belongs to another owner',async({page})=>{
 await fixture(page,'ordinary');await expect(page.getByText('还没有图片')).toBeVisible();await page.getByLabel('上传图片文件').setInputFiles({name:'duplicate.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10])});await expect(page.locator('.recent a')).toHaveAttribute('href','/library/'+assets[0].id);await expect(page.locator('.recent img')).toHaveAttribute('src',assets[0].url+'?variant=thumb');await page.locator('.recent a').click();await expect(page.getByLabel('图片 URL',{exact:true})).toHaveValue(assets[0].url);await expect(page.getByRole('button',{name:'删除图片',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'返回图片库'}).click();await expect(page.getByText('还没有图片')).toBeVisible();
});

test('image details support direct reload download rename failures and deletion retry',async({page})=>{
 await fixture(page);
 await expect(page.locator('.image-card h2')).toHaveCount(0);
 await expect(page.locator('.image-card img').first()).toHaveAttribute('src',assets[0].url+'?variant=thumb');
 await page.getByRole('link',{name:'查看 港城的雨夜',exact:true}).click();
 await page.reload();await expect(page.getByRole('heading',{name:'港城的雨夜',exact:true})).toBeVisible();
 await expect(page.locator('.detail-preview img')).toHaveAttribute('src',assets[0].url+'?variant=display');
 await expect(page.getByRole('link',{name:'下载原图'})).toHaveAttribute('href','/images/'+assets[0].id+'?download=1');
 await page.route('**/api/images/'+assets[0].id,async route=>{if(route.request().method()==='PATCH')return route.fulfill({status:503,json:{message:'保存失败'}});return route.fallback();});
 await page.getByRole('button',{name:'重命名',exact:true}).click();await page.getByLabel('图片名称',{exact:true}).fill('保留输入');await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('alert')).toContainText('保存失败');await expect(page.getByLabel('图片名称',{exact:true})).toHaveValue('保留输入');await page.getByRole('button',{name:'取消',exact:true}).click();
 await page.getByRole('button',{name:'删除图片',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('公开链接将失效');const dialog=await page.getByRole('dialog').boundingBox();const viewport=page.viewportSize()!;expect(Math.abs(dialog!.x+dialog!.width/2-viewport.width/2)).toBeLessThan(2);expect(Math.abs(dialog!.y+dialog!.height/2-viewport.height/2)).toBeLessThan(2);await expect(page.getByRole('dialog')).toHaveScreenshot('images-delete.png',{stylePath:new URL('./dialog-snapshot.css',import.meta.url).pathname});
 await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 let failed=false;await page.route('**/api/images/'+assets[0].id,async route=>{if(route.request().method()==='DELETE'&&!failed){failed=true;return route.fulfill({status:503,json:{message:'清理失败'}});}return route.fallback();});
 await page.getByRole('button',{name:'删除图片',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();await expect(page.getByRole('alert')).toContainText('清理失败');await page.getByRole('button',{name:'重试删除',exact:true}).click();await expect(page).toHaveURL(/\/$/);await expect(page.getByRole('img')).toHaveCount(3);await expect(page.getByText('已删除图片')).toBeVisible();
});

test('deleting the only image on a later page returns to an available page',async({page})=>{
 await fixture(page);let deleted=false;
 await page.route('**/api/images?**',route=>{const url=new URL(route.request().url());return route.fulfill({json:{images:url.searchParams.get('page')==='2'?(deleted?[]:[assets[0]]):assets.slice(1),hasMore:!deleted&&url.searchParams.get('page')!=='2'}});});
 await page.getByRole('button',{name:'搜索图片',exact:true}).click();await page.getByRole('button',{name:'下一页',exact:true}).click();await expect(page.getByText('第 2 页')).toBeVisible();
 await page.getByRole('link',{name:'查看 港城的雨夜',exact:true}).click();await page.route('**/api/images/'+assets[0].id,route=>{if(route.request().method()==='DELETE'){deleted=true;return route.fulfill({status:204});}return route.fallback();});
 await page.getByRole('button',{name:'删除图片',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();await expect(page.getByText('第 1 页')).toBeVisible();await expect(page.getByRole('img')).toHaveCount(3);
});

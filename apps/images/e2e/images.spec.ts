import {expect,test,type Page} from '@playwright/test';
const names=['港城的雨夜','银发旅人 · 立绘','山间小站','午后的窗边'];
const assets=names.map((name,i)=>({id:`c51f7180-6795-4a3a-8ec6-060ebc3fe98${i}`,name,size:204800+i*1000,content_type:'image/png',created_at:'2026-10-20T00:00:00Z',model:i===1?'gpt-image-2.5-sunburst':null,url:`https://images.hasbai.xyz/images/fixture-${i}`}));
async function fixture(page:Page,mode='ready'){
 const rows=structuredClone(assets);
 await page.route('https://images.hasbai.xyz/images/**',route=>route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240"><rect width="320" height="240" fill="#e4e8e7"/><circle cx="225" cy="70" r="30" fill="#c4d3c9"/><path d="M0 210L100 80L210 240H0M100 240L220 110L320 220V240" fill="#92a69c"/></svg>`}));
 await page.route('**/api/**',async route=>{
 const r=route.request(),url=new URL(r.url());
 if(url.pathname==='/api/me')return route.fulfill({json:{admin:mode!=='ordinary'}});
 if(mode==='error')return route.fulfill({status:503,json:{message:'图片暂时不可用'}});
 if(r.method()==='PATCH'){const row=rows.find(x=>url.pathname.endsWith(x.id))!;row.name=r.postDataJSON().name;return route.fulfill({json:row});}
 if(r.method()==='POST')return route.fulfill({json:assets[0]});
 return route.fulfill({json:{images:mode==='empty'||mode==='ordinary'?[]:rows.filter(x=>x.name.includes(url.searchParams.get('q')??'')),hasMore:false}});
 });
 await page.goto('/e2e/index.html');await expect(page.getByRole('heading',{name:'图片库',exact:true})).toBeVisible();await expect(page.getByText('正在加载图片…')).toHaveCount(0);
}
test('image library models generation rename search and theme',async({page})=>{
 await fixture(page);await expect(page.getByRole('img')).toHaveCount(4);await expect(page.getByLabel('生成模型')).toHaveValue('gpt-image-2.5-flare');await expect(page).toHaveScreenshot('images-library.png',{fullPage:true});
 await page.getByLabel('生成模型').selectOption('gpt-image-2.5-sunburst');await page.getByLabel('图片描述',{exact:true}).fill('夜色中的港口');const request=page.waitForRequest(r=>r.url().endsWith('/api/generate'));await page.getByRole('button',{name:'生成图片',exact:true}).click();expect((await request).postDataJSON()).toEqual({prompt:'夜色中的港口',model:'gpt-image-2.5-sunburst'});await expect(page.getByText('已生成并保存')).toBeVisible();
 await page.getByLabel('重命名 港城的雨夜').click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByLabel('图片名称',{exact:true}).fill('港城 · 雨夜');await expect(page).toHaveScreenshot('images-rename.png',{fullPage:true});await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('heading',{name:'港城 · 雨夜',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'切换深色模式'}).click();await expect(page).toHaveScreenshot('images-dark.png',{fullPage:true});
 await page.getByLabel('搜索图片',{exact:true}).first().fill('没有这样的图片');await page.getByRole('button',{name:'搜索图片',exact:true}).click();await expect(page.getByText('没有匹配的图片')).toBeVisible();await expect(page).toHaveScreenshot('images-search-empty.png',{fullPage:true});
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
 await fixture(page,'ordinary');await expect(page.getByText('还没有图片')).toBeVisible();await page.getByLabel('上传图片文件').setInputFiles({name:'duplicate.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10])});await expect(page.locator('.recent a')).toHaveAttribute('href',assets[0].url);await expect(page.locator('.recent').getByRole('button',{name:'复制链接',exact:true})).toBeVisible();await expect(page.getByText('还没有图片')).toBeVisible();
});

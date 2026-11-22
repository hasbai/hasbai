import {test,expect,type Page,type TestInfo} from '@playwright/test';
async function shot(page:Page,info:TestInfo,name:string){
 const fullPage=name!=='key-form';
 if(!fullPage){
  // A fixed dialog belongs to the viewport; the page behind it can be taller.
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(()=>window.scrollTo({top:0,left:0,behavior:'instant'}));
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0);
 }
 await expect(page).toHaveScreenshot(name+'.png',{fullPage});
 const path=info.outputPath(name+'.png');
 await page.screenshot({path,fullPage});
 await info.attach(name,{path,contentType:'image/png'});
}
async function fixture(page:Page,admin=false){
 await page.addInitScript(()=>{document.documentElement.classList.toggle('dark',matchMedia('(prefers-color-scheme:dark)').matches);});
 await page.route('**/v1/models',route=>route.fulfill({json:{object:'list',data:[{id:'custom-codex/gpt-6.1-sol',name:'gpt-6.1-sol',type:'chat',context_tokens:131072},{id:'custom-codex/gpt-6-luna',name:'gpt-6-luna',type:'chat'},{id:'custom-main/qwen3',name:'qwen3',type:'chat',context_tokens:32768},{id:'dynamic/rp',name:'rp',type:'chat'},{id:'gpt-image-2.5-flare',name:'Flare',type:'image'}]}}));
 await page.route('**/api/me',route=>route.fulfill({json:{username:'测试用户',admin}}));
 await page.route('**/api/admin/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(route.request().method()!=='GET')return route.fulfill({json:{result:{id:'saved'}}});
  if(path.endsWith('/routes'))return route.fulfill({json:{result:[{id:'route-id',name:'rp',deployment:{version_id:'v1'},elements:[{id:'start',type:'start',outputs:{next:{elementId:'model'}}},{id:'model',type:'model',properties:{provider:'custom-main',model:'qwen3',timeout:60000,retries:0},outputs:{success:{elementId:'end'},fallback:{elementId:'end'}}},{id:'end',type:'end',outputs:{}}]}]}});
  if(path.endsWith('/versions'))return route.fulfill({json:{result:[{version_id:'v1',created_at:'2026-11-15T08:00:00Z'},{version_id:'v0',created_at:'2026-11-14T08:00:00Z'}]}});
  return route.fulfill({json:{result:path.endsWith('/gateways')?[{id:'default'}]:path.endsWith('/keys')?[{id:'key-id',provider_slug:'custom-codex',alias:'default',default_config:true}]:[{id:'provider-id',name:'Codex',slug:'codex',base_url:'https://example.com',enable:true}]}});
 });
 await page.goto('/e2e/index.html');
 await expect(page.getByRole('heading',{name:'开始一段对话'})).toBeVisible();
}
test('ordinary user streams a reply and retains the prompt after cancellation',async({page},info)=>{
 await fixture(page);
 await expect(page.getByRole('button',{name:'Provider 与密钥'})).toHaveCount(0);
 await page.getByRole('textbox',{name:'你的消息',exact:true}).fill('你好');await expect(page.getByRole('button',{name:'发送',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'选择模型',exact:true}).click();await page.getByRole('button',{name:'使用此模型',exact:true}).first().click();
 const bodies:unknown[]=[];
 await page.route('**/v1/chat/completions',route=>{bodies.push(route.request().postDataJSON());return route.fulfill({contentType:'text/event-stream',body:'data: {"choices":[{"delta":{"content":"你好，欢迎使用。"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'});});
 await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.locator('.chat-message:not(.from-user) .message-text')).toHaveText('你好，欢迎使用。');
 await expect(page.getByRole('textbox',{name:'你的消息',exact:true})).toHaveValue('');
 await shot(page,info,'workbench');
 await page.getByRole('textbox',{name:'你的消息',exact:true}).fill('继续');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.locator('.chat-message')).toHaveCount(4);
 expect(bodies[1]).toMatchObject({model:'custom-codex/gpt-6.1-sol',messages:[{role:'user',content:'你好'},{role:'assistant',content:'你好，欢迎使用。'},{role:'user',content:'继续'}]});
 await page.unroute('**/v1/chat/completions');let release!:()=>void;await page.route('**/v1/chat/completions',async route=>{await new Promise<void>(resolve=>{release=resolve;});await route.abort().catch(()=>{});});
 await page.getByRole('textbox',{name:'你的消息',exact:true}).fill('保留草稿');const pending=page.waitForRequest('**/v1/chat/completions');await page.getByRole('button',{name:'发送',exact:true}).click();await pending;await page.getByRole('button',{name:'停止',exact:true}).click();release();await expect(page.getByRole('textbox',{name:'你的消息',exact:true})).toHaveValue('保留草稿');await expect(page.getByRole('button',{name:'发送',exact:true})).toBeEnabled();
 await page.unroute('**/v1/chat/completions');await page.route('**/v1/chat/completions',route=>route.fulfill({contentType:'text/event-stream',body:'data: {"choices":[{"delta":{"content":"未完成的回复"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'}));await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByRole('alert')).toContainText('模型回复未完成');
 await page.getByRole('button',{name:'新对话',exact:true}).click();await expect(page.getByRole('button',{name:'选择模型',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'发送',exact:true})).toBeDisabled();
});
test('model catalog groups cards by provider and closes by button escape and outside click',async({page},info)=>{
 await fixture(page);const trigger=page.getByRole('button',{name:'选择模型',exact:true});
 await trigger.focus();await expect(trigger).toHaveCSS('outline-offset','-2px');await expect(trigger).toHaveCSS('outline-width','2px');
 await trigger.click();
 await expect(page.getByRole('dialog')).toBeVisible();await expect(page.locator('.provider-group')).toHaveCount(3);await expect(page.locator('.model-card')).toHaveCount(4);await shot(page,info,'model-catalog');
 await page.getByRole('button',{name:'关闭模型选择'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(trigger).toBeFocused();
 await trigger.click();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await trigger.click();await page.mouse.click(2,2);await expect(page.getByRole('dialog')).toHaveCount(0);
 await trigger.click();const search=page.getByLabel('搜索模型');await search.focus();await expect(search).toHaveCSS('outline-style','none');await search.fill('main');await expect(page.locator('.model-card')).toHaveCount(1);await expect(page.getByText('32,768 tokens')).toBeVisible();await page.getByRole('button',{name:'使用此模型'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.model-trigger')).toContainText('qwen3');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('admin manages route versions and explicitly deploys a rollback',async({page},info)=>{
 await fixture(page,true);await page.getByRole('button',{name:'动态路由',exact:true}).click();await expect(page.getByRole('heading',{name:'rp',exact:true})).toBeVisible();await shot(page,info,'routes');
 await page.getByRole('button',{name:'编辑规则'}).click();await expect(page.getByLabel('模型 ID',{exact:true})).toHaveValue('qwen3');await shot(page,info,'route-editor');
 let deployed=0;page.on('request',req=>{if(req.method()==='POST'&&req.url().includes('/deployments'))deployed++;});
 await page.getByRole('dialog').locator('.model-trigger').click();await page.getByRole('button',{name:'使用此模型'}).first().click();await expect(page.getByLabel('模型 ID',{exact:true})).toHaveValue('gpt-6.1-sol');await page.getByLabel('重试次数').fill('2');
 const saved=page.waitForRequest(req=>req.method()==='POST'&&req.url().includes('/versions'));await page.getByRole('button',{name:'保存版本',exact:true}).click();const nodes=(await saved).postDataJSON().elements;expect(nodes).toHaveLength(3);expect(nodes[1]).toMatchObject({properties:{provider:'custom-codex',model:'gpt-6.1-sol',retries:2},outputs:{success:{elementId:'end'},fallback:{elementId:'end'}}});expect(deployed).toBe(0);
 await expect(page.getByRole('button',{name:'当前版本',exact:true})).toBeDisabled();const published=page.waitForRequest(req=>req.method()==='POST'&&req.url().includes('/deployments'));await page.getByRole('button',{name:'发布',exact:true}).click();expect((await published).postDataJSON()).toEqual({version_id:'v0'});await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('admin manages providers and write-only BYOK keys',async({page},info)=>{
 await fixture(page,true);await page.getByRole('button',{name:'Provider 与密钥'}).click();await expect(page.getByRole('heading',{name:/^Codex / })).toBeVisible();
 await shot(page,info,'management');
 await page.getByRole('button',{name:'添加 Provider',exact:true}).click();await page.getByLabel('名称',{exact:true}).fill('New Provider');await page.getByLabel('Slug',{exact:true}).fill('new-provider');await page.getByLabel('Base URL').fill('https://new.example.com');
 const created=page.waitForRequest(req=>req.method()==='POST'&&req.url().includes('/api/admin/providers'));await page.getByRole('button',{name:'保存',exact:true}).click();expect((await created).postDataJSON()).toMatchObject({slug:'new-provider',base_url:'https://new.example.com'});
 await page.getByRole('button',{name:'添加密钥',exact:true}).click();await page.getByLabel('Provider slug',{exact:true}).fill('custom-new-provider');await page.getByLabel('API Key',{exact:true}).fill('fixture-secret');
 await shot(page,info,'key-form');
 const key=page.waitForRequest(req=>req.method()==='POST'&&req.url().includes('/keys'));await page.getByRole('button',{name:'保存密钥',exact:true}).click();expect((await key).postDataJSON().secret).toBe('fixture-secret');
 await page.getByRole('button',{name:'轮换',exact:true}).click();await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('');await page.getByLabel('API Key',{exact:true}).fill('rotated-secret');const rotated=page.waitForRequest(req=>req.method()==='PUT');await page.getByRole('button',{name:'保存密钥',exact:true}).click();expect((await rotated).postDataJSON()).toEqual({secret:'rotated-secret'});
 await page.getByRole('button',{name:'删除 Codex',exact:true}).click();await expect(page.getByRole('alertdialog').or(page.getByRole('dialog'))).toBeVisible();await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.getByRole('heading',{name:/^Codex / })).toBeVisible();
});

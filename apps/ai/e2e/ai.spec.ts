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
 await page.route('**/v1/models',route=>route.fulfill({json:{object:'list',data:[{id:'default',name:'平台默认 · qwen3',type:'chat'},{id:'custom-main/qwen3',name:'qwen3',type:'chat'},{id:'gpt-image-2.5-flare',name:'Flare',type:'image'}]}}));
 await page.route('**/api/me',route=>route.fulfill({json:{username:'测试用户',admin}}));
 await page.route('**/api/admin/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(route.request().method()!=='GET')return route.fulfill({json:{result:{id:'saved'}}});
  return route.fulfill({json:{result:path.endsWith('/gateways')?[{id:'default'}]:path.endsWith('/keys')?[{id:'key-id',provider_slug:'custom-codex',alias:'default',default_config:true}]:[{id:'provider-id',name:'Codex',slug:'codex',base_url:'https://example.com',enable:true}]}});
 });
 await page.goto('/e2e/index.html');
 await expect(page.getByRole('heading',{name:'新对话'})).toBeVisible();
}
test('ordinary user streams a reply and retains the prompt after cancellation',async({page},info)=>{
 await fixture(page);await expect(page.getByRole('button',{name:'Provider 与密钥'})).toHaveCount(0);
 await page.route('**/v1/chat/completions',route=>route.fulfill({contentType:'text/event-stream',body:'data: {"choices":[{"delta":{"content":"你好，欢迎使用。"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'}));
 await page.getByLabel('你的消息').fill('你好');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.locator('.response pre')).toHaveText('你好，欢迎使用。');
 await shot(page,info,'workbench');
 await page.unroute('**/v1/chat/completions');let release!:()=>void;await page.route('**/v1/chat/completions',async route=>{await new Promise<void>(resolve=>{release=resolve;});await route.abort().catch(()=>{});});
 const pending=page.waitForRequest('**/v1/chat/completions');await page.getByRole('button',{name:'发送',exact:true}).click();await pending;await page.getByRole('button',{name:'停止',exact:true}).click();release();await expect(page.getByLabel('你的消息')).toHaveValue('你好');await expect(page.getByRole('button',{name:'发送',exact:true})).toBeEnabled();
 await page.unroute('**/v1/chat/completions');await page.route('**/v1/chat/completions',route=>route.fulfill({contentType:'text/event-stream',body:'data: {"choices":[{"delta":{"content":"未完成的回复"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'}));await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByRole('alert')).toContainText('模型回复未完成');await expect(page.locator('.response pre')).toHaveText('未完成的回复');
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

import {defineConfig,devices} from '@playwright/test';
const local=process.env.USE_SYSTEM_CHROMIUM==='1';
export default defineConfig({
 testDir:'e2e',workers:1,retries:0,forbidOnly:!!process.env.CI,updateSnapshots:'none',
 snapshotPathTemplate:process.env.LOCAL_VISUAL_CAPTURE_DIR?`${process.env.LOCAL_VISUAL_CAPTURE_DIR}/{projectName}/{arg}{ext}`:'{testDir}/__screenshots__/linux-ci/{projectName}/{arg}{ext}',
 expect:{toHaveScreenshot:{animations:'disabled',caret:'hide',maxDiffPixels:50}},
 reporter:[['list'],['../financial/scripts/visual-coverage-reporter.mjs']],
 use:{baseURL:'http://127.0.0.1:4178',locale:'zh-CN',timezoneId:'Asia/Shanghai',reducedMotion:'reduce',trace:'retain-on-failure',...(local?{launchOptions:{executablePath:'/usr/bin/chromium'}}:{})},
 projects:[
  {name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000}}},
  {name:'mobile',use:{...devices['Pixel 7'],viewport:{width:390,height:844}}},
  {name:'dark',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000},colorScheme:'dark'}},
  {name:'short',use:{...devices['Desktop Chrome'],viewport:{width:1280,height:620}}},
 ],
 webServer:{command:'pnpm exec vite preview --outDir dist-e2e --host 127.0.0.1 --port 4178',url:'http://127.0.0.1:4178/e2e/index.html',reuseExistingServer:false},
});

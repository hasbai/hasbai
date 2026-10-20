import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const base = process.argv[2];
const files = base ? execFileSync('git',['diff','--name-only',`${base}...HEAD`],{encoding:'utf8'}).trim().split('\n') : ['packages/'];
const shared = files.some(p=> /^(packages\/|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|package\.json$|scripts\/(affected|visual-linux|visual-capture|import-local-visual)\.mjs$)/.test(p));
for(const app of ['financial','blog','zboard','tavern','images']) {
 const workflow=app==='financial'?'check.yml':`${app}.yml`;
 const affected=shared||files.some(p=>p.startsWith(`apps/${app}/`)||p===`.github/workflows/${workflow}`||p.startsWith(`database/${app}/`)||(app==='financial'&&p.startsWith('database/migrations/')));
 const output=`${app}=${affected}\n`;
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,output);else process.stdout.write(output);
}

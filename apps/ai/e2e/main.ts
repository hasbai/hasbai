import {mount} from 'svelte';
import Console from '../src/Console.svelte';
import {createApi} from '../src/lib';
import '../src/app.css';
document.documentElement.classList.toggle('dark',matchMedia('(prefers-color-scheme: dark)').matches);
mount(Console,{target:document.getElementById('app')!,props:{api:createApi(async()=>'fixture-only'),logout:()=>{document.body.textContent='已退出';}}});

import {mount} from 'svelte';
import Library from '../src/pages/Library.svelte';
import {createApi} from '../src/lib';
import '../src/app.css';
mount(Library,{target:document.getElementById('app')!,props:{api:createApi(async()=>'fixture-only'),logout:()=>{document.body.textContent='已退出';}}});

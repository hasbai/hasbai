<script lang="ts">
 import { characterImageUrl } from '../../shared/character-images';
 let { imageId, name }: {imageId?:string;name:string}=$props();
 const url=$derived(imageId?characterImageUrl(imageId,'avatar'):'');
 let failed=$state('');
</script>
<div class="avatar">{#if url&&failed!==url}<img src={url} alt={name} width="64" height="64" loading="lazy" decoding="async" onerror={()=>failed=url}/>{:else}<span aria-hidden="true">{name.slice(0,1)}</span>{/if}</div>

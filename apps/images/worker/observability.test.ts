import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeRequest } from '@hasbai/observability';

afterEach(() => vi.restoreAllMocks());
describe('request telemetry', () => {
 it('redacts credentials and preserves the original streaming response without reading it', async () => {
  const log=vi.spyOn(console,'info').mockImplementation(()=>{});
  const response=new Response(new ReadableStream({start(){}}));
  const request=new Request('https://images.hasbai.xyz/api/images/private-id?token=secret', {headers:{Authorization:'Bearer secret'}});
  expect(await observeRequest(request,'images','version-id',async()=>response)).toBe(response);
  expect(response.bodyUsed).toBe(false);
  expect(log).toHaveBeenCalledOnce();
  expect(log.mock.calls[0][0]).toMatchObject({event:'http_request',route:'/api/images/*',status:200,service:'images',version:'version-id'});
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-id|secret|Authorization/);
  await response.body?.cancel();
 });
 it('does not emit console events on subscription paths, including failures',async()=>{
  const logs=['info','warn','error'].map(level=>vi.spyOn(console,level as 'info'|'warn'|'error').mockImplementation(()=>{}));
  const request=new Request('https://zboard.hasbai.xyz/sub/private-token?token=secret');
  const response=await observeRequest(request,'zboard','v1',async()=>new Response(null,{status:500}));
  expect(response.status).toBe(500);
  const error=new Error('sensitive-failure');
  await expect(observeRequest(request,'zboard','v1',async()=>{throw error;})).rejects.toBe(error);
  for(const log of logs)expect(log).not.toHaveBeenCalled();
 });
 it('records handled server failures at error severity',async()=>{
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  const response=await observeRequest(new Request('https://images.hasbai.xyz/api/images/private-id?key=secret'),'images',undefined,async()=>new Response(null,{status:503}));
  expect(response.status).toBe(503);
  expect(log.mock.calls[0][0]).toMatchObject({level:'error',route:'/api/images/*',status:503});
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-id|secret/);
 });
 it('keeps thrown errors and does not log their sensitive message',async()=>{
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  const error=new Error('postgres://password@private-host');
  await expect(observeRequest(new Request('https://hasbai.xyz/private-slug'),'blog','v1',async()=>{throw error;})).rejects.toBe(error);
  expect(log).toHaveBeenCalledOnce();
  expect(log.mock.calls[0][0]).toMatchObject({status:500,route:'/:route'});
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/password|private-host|private-slug/);
 });
 it('uses warning severity for expected client failures',async()=>{
  const log=vi.spyOn(console,'warn').mockImplementation(()=>{});
  await observeRequest(new Request('https://tavern.hasbai.xyz/api/sessions/secret'),'tavern','v1',async()=>new Response(null,{status:401}));
  expect(log.mock.calls[0][0]).toMatchObject({level:'warn',route:'/api/sessions/*',status:401});
 });
});

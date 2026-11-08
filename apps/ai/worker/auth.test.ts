import {afterEach,expect,it,vi} from 'vitest';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {identity} from './auth';
afterEach(()=>vi.unstubAllGlobals());
it('cryptographically verifies users, rejects invalid issuer/audience/expiry/signature and machines, and uses native permissions',async()=>{
 const keys=await generateKeyPair('RS256'),jwk=await exportJWK(keys.publicKey);jwk.kid='ai-test';
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({keys:[jwk]})));
 const sign=(aud='https://financial.hasbai.xyz/api',exp='1h',issuer='https://auth.hasbai.xyz/',sub='auth0|user',permissions:string[]=[])=>new SignJWT({username:'verified',permissions,role:'superadmin',_roles:['superadmin']}).setProtectedHeader({alg:'RS256',kid:'ai-test'}).setIssuer(issuer).setAudience(aud).setSubject(sub).setIssuedAt().setExpirationTime(exp).sign(keys.privateKey);
 const req=(token:string)=>new Request('https://ai.test/api/me',{headers:{Authorization:'Bearer '+token}});
 expect(await identity(req(await sign()))).toEqual({username:'verified',admin:false});
 expect((await identity(req(await sign(undefined,undefined,undefined,undefined,['ai.all:all'])))).admin).toBe(true);
 for(const token of [await sign('wrong'),await sign(undefined,'-1h'),await sign(undefined,undefined,'https://wrong.test/'),await sign(undefined,undefined,undefined,'app@clients'),'invalid'])await expect(identity(req(token))).rejects.toMatchObject({status:401});
 const other=await generateKeyPair('RS256');const forged=await new SignJWT({}).setProtectedHeader({alg:'RS256',kid:'ai-test'}).setIssuer('https://auth.hasbai.xyz/').setAudience('https://financial.hasbai.xyz/api').setSubject('auth0|user').setIssuedAt().setExpirationTime('1h').sign(other.privateKey);await expect(identity(req(forged))).rejects.toMatchObject({status:401});
});

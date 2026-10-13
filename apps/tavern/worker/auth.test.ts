import { it, expect, vi, afterEach } from "vitest";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { identity, authenticatedUsername, EMAIL_CLAIM, ROLE_CLAIM, USERNAME_CLAIM } from "./auth";
afterEach(() => vi.unstubAllGlobals());
it("verifies signature, issuer, audience, expiry and grants admin only from the signed claim", async () => {
  const keys = await generateKeyPair("RS256");
  const jwk = await exportJWK(keys.publicKey);
  jwk.kid = "test";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ keys: [jwk] })),
  );
  const env = {
    AUTH0_DOMAIN: "auth.hasbai.xyz",
    AUTH0_AUDIENCE: "https://financial.hasbai.xyz/api",
  } as const;
  const sign = (
    aud = env.AUTH0_AUDIENCE as string,
    exp = "1h",
    issuer = "https://auth.hasbai.xyz/",
    role: unknown = ["member", "superadmin"],
    granted: unknown = ["tavern.all:all"],
  ) =>
    new SignJWT({ permissions: granted, [ROLE_CLAIM]: role, [EMAIL_CLAIM]: "owner@example.test", [USERNAME_CLAIM]: "月石" })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setSubject("auth0|test")
      .setIssuer(issuer)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(keys.privateKey);
  const req = (token: string) =>
    new Request("https://tavern.test/api/me", {
      headers: { Authorization: "Bearer " + token },
    });
  const verified=await identity(req(await sign()),env);
  expect(USERNAME_CLAIM).toBe("username"); expect(ROLE_CLAIM).toBe("_roles"); expect(EMAIL_CLAIM).toBe("email");
  expect(verified.email).toBe("owner@example.test");
  expect(verified.admin).toBe(true);expect(verified.username).toBe("月石");
  expect(authenticatedUsername(verified)).toBe("月石");
  for (const token of [
    await sign("https://tavern.hasbai.xyz/api"),
    await sign(env.AUTH0_AUDIENCE, "-1h"),
    await sign(env.AUTH0_AUDIENCE, "1h", "https://wrong.test/"),
    await sign(env.AUTH0_AUDIENCE, "1h", "https://hasbai.eu.auth0.com/"),
    "invalid",
  ])
    await expect(identity(req(token), env)).rejects.toMatchObject({
      status: 401,
    });
  const noRole = await new SignJWT({}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('auth0|ordinary').setIssuer('https://auth.hasbai.xyz/').setAudience(env.AUTH0_AUDIENCE).setIssuedAt().setExpirationTime('1h').sign(keys.privateKey);
  expect((await identity(req(noRole),env)).admin).toBe(false);
  for (const role of [[], ["member"], "superadmin", null, {superadmin: true}]) {
    const request = req(await sign(env.AUTH0_AUDIENCE, "1h", "https://auth.hasbai.xyz/", role));
    expect((await identity(request, env)).admin).toBe(true);
  }
  for (const granted of [[], undefined, "tavern.all:all", { "tavern.all:all": true }, ["manage:other"], ["manage:tavern"]]) {
    const request = req(await sign(env.AUTH0_AUDIENCE, "1h", "https://auth.hasbai.xyz/", ["superadmin"], granted ?? null));
    expect((await identity(request, env)).admin).toBe(false);
  }
  const machine = await new SignJWT({ permissions: ["tavern.all:all"] }).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('app@clients').setIssuer('https://auth.hasbai.xyz/').setAudience(env.AUTH0_AUDIENCE).setIssuedAt().setExpirationTime('1h').sign(keys.privateKey);
  await expect(identity(req(machine),env)).rejects.toMatchObject({status:401});
  await expect(
    identity(new Request("https://tavern.test/api/me"), env),
  ).rejects.toMatchObject({ status: 401 });
});


it("requires a real signed account name without calling an identity API or falling back to the subject",()=>{
 const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
 for(const username of [undefined," ","auth0|owner","bad\nname","x".repeat(257)]){
  expect(()=>authenticatedUsername({sub:"auth0|owner",admin:true,email:"owner@example.test",username})).toThrow("账户名称未更新，请重新登录后重试");
 }
 expect(authenticatedUsername({sub:"auth0|owner",admin:true,email:"owner@example.test",username:"真实姓名"})).toBe("真实姓名");
 expect(fetcher).not.toHaveBeenCalled();
});

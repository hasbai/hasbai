import { beforeEach, expect, it, vi } from "vitest";
import { createAuth } from "./auth.svelte";
import { config } from "./config";
import { router } from "./router.svelte";
import { createBrowserClient } from "@hasbai/auth";
const sdk = vi.hoisted(() => ({
  constructor: vi.fn(),
  checkSession: vi.fn(),
  getUser: vi.fn(),
  handleRedirectCallback: vi.fn(),
  loginWithRedirect: vi.fn(),
  logout: vi.fn(),
  getTokenSilently: vi.fn(),
}));
vi.mock("@auth0/auth0-spa-js", () => ({
  Auth0Client: class {
    constructor(options: unknown) {
      sdk.constructor(options);
    }
    checkSession = sdk.checkSession;
    getUser = sdk.getUser;
    handleRedirectCallback = sdk.handleRedirectCallback;
    loginWithRedirect = sdk.loginWithRedirect;
    logout = sdk.logout;
    getTokenSilently = sdk.getTokenSilently;
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  router.navigate("/", true, true);
  sdk.getUser.mockResolvedValue({ sub: "auth0|test" });
  sdk.getTokenSilently.mockResolvedValue("e30." + btoa(JSON.stringify({ permissions: ["financial.all:all"] })) + ".signature");
});
it("offers organization login methods with the shared audience and persistent cache and refresh token renewal", async () => {
  const auth = createAuth();
  await auth.init(vi.fn());
  expect(sdk.constructor).toHaveBeenCalledWith(
    expect.objectContaining({
      cacheLocation: "localstorage",
      useRefreshTokens: true,
      useRefreshTokensFallback: true,
      domain: "auth.hasbai.xyz",
      clientId: config.clientId,
      authorizationParams: {
        redirect_uri: `${window.location.origin}/auth/callback`,
        audience: config.audience,
        scope: "openid profile email",
        organization: config.organization,
      },
    }),
  );
  expect(auth.user?.sub).toBe("auth0|test");
  expect(auth.loading).toBe(false);
});
it("offers the same login methods while preserving the separate Zboard audience", () => {
  createBrowserClient("https://zboard.hasbai.xyz", {
    audience: "https://zboard.hasbai.xyz/api",
  });
  expect(sdk.constructor.mock.lastCall![0].domain).toBe("auth.hasbai.xyz");
  expect(sdk.constructor.mock.lastCall![0].authorizationParams).toEqual({
    redirect_uri: "https://zboard.hasbai.xyz/auth/callback",
    audience: "https://zboard.hasbai.xyz/api",
    scope: "openid profile email",
    organization: config.organization,
  });
});
it("handles callback and returns to a safe filtered route", async () => {
  router.navigate("/auth/callback?code=mock&state=mock", true, true);
  // Callback is an SDK-owned route, unlike user return paths.
  window.history.replaceState({}, "", "/auth/callback?code=mock&state=mock");
  sdk.handleRedirectCallback.mockResolvedValue({
    appState: { returnTo: "/transactions?review=needed" },
  });
  const clear = vi.fn();
  const auth = createAuth();
  await auth.init(clear);
  expect(router.location).toEqual({
    pathname: "/transactions",
    search: "?review=needed",
  });
  expect(clear).toHaveBeenCalled();
});
it("rejects external callback destinations and never retains callback parameters", async () => {
  window.history.replaceState({}, "", "/auth/callback?code=mock&state=mock");
  sdk.handleRedirectCallback.mockResolvedValue({
    appState: { returnTo: "//outside.example" },
  });
  await createAuth().init(vi.fn());
  expect(window.location.pathname + window.location.search).toBe("/");
});
it("obtains a fresh access token for each request and clears cache on logout", async () => {
  const auth = createAuth();
  await auth.init(vi.fn());
  sdk.getTokenSilently.mockClear();
  await auth.getToken();
  await auth.getToken();
  expect(sdk.getTokenSilently).toHaveBeenCalledTimes(2);
  const clear = vi.fn();
  await auth.logout(clear);
  expect(clear).toHaveBeenCalled();
  expect(auth.user).toBeUndefined();
  expect(sdk.logout).toHaveBeenCalledWith({
    logoutParams: { returnTo: window.location.origin },
  });
});
it("reports callback errors and leaves the user signed out", async () => {
  window.history.replaceState(
    {},
    "",
    "/auth/callback?error=access_denied&state=mock",
  );
  sdk.handleRedirectCallback.mockRejectedValue(new Error("access_denied"));
  const auth = createAuth();
  const clear = vi.fn();
  await auth.init(clear);
  expect(auth.error).toBe("access_denied");
  expect(auth.loading).toBe(false);
  expect(auth.user).toBeUndefined();
  expect(clear).toHaveBeenCalled();
});

it("automatically redirects once when no local session can be restored", async () => {
  sdk.getUser.mockResolvedValue(undefined);
  router.navigate("/accounts", true, true);
  const auth = createAuth();
  await auth.init(vi.fn());
  expect(sdk.checkSession).toHaveBeenCalledWith({ timeoutInSeconds: 3 });
  expect(sdk.loginWithRedirect).toHaveBeenCalledWith({
    appState: { returnTo: "/accounts" },
  });
  expect(auth.loading).toBe(true);
  const retry = createAuth();
  await retry.init(vi.fn());
  expect(sdk.loginWithRedirect).toHaveBeenCalledTimes(1);
  expect(retry.loading).toBe(false);
});
it("continues login after a silent iframe timeout and permits manual retry on failure", async () => {
  sdk.getUser.mockResolvedValue(undefined);
  sdk.checkSession.mockRejectedValue({ error: "timeout" });
  sdk.loginWithRedirect.mockRejectedValueOnce(new Error("网络不可用"));
  const auth = createAuth();
  await auth.init(vi.fn());
  expect(auth.loading).toBe(false);
  expect(auth.error).toBe("网络不可用");
  sdk.loginWithRedirect.mockResolvedValue(undefined);
  await auth.login();
  expect(auth.loading).toBe(true);
  expect(sdk.loginWithRedirect).toHaveBeenCalledTimes(2);
});
it("does not automatically sign in again after explicit logout", async () => {
  const auth = createAuth();
  await auth.init(vi.fn());
  await auth.logout(vi.fn());
  sdk.getUser.mockResolvedValue(undefined);
  sdk.checkSession.mockClear();
  const next = createAuth();
  await next.init(vi.fn());
  expect(next.loading).toBe(false);
  expect(sdk.checkSession).not.toHaveBeenCalled();
  expect(sdk.loginWithRedirect).not.toHaveBeenCalled();
  await next.login();
  expect(sdk.loginWithRedirect).toHaveBeenCalledTimes(1);
});

it("authorizes from API permissions rather than a specific account or role", async () => {
  sdk.getUser.mockResolvedValue({ sub: "github|another-admin" });
  const admin = createAuth();
  await admin.init(vi.fn());
  expect(admin.authorized).toBe(true);
  for (const claims of [{ _roles: ["superadmin"] }, { permissions: [] }, { permissions: "financial.all:all" }, { permissions: ["access:financial"] }]) {
    sdk.getTokenSilently.mockResolvedValue("e30." + btoa(JSON.stringify(claims)) + ".signature");
    const auth = createAuth();
    await auth.init(vi.fn());
    expect(auth.authorized).toBe(false);
    await expect(auth.getToken()).rejects.toThrow("当前账号没有访问权限");
  }
});

it("reports token renewal failures as login errors and keeps ledger access closed", async () => {
  sdk.getTokenSilently.mockRejectedValue(new Error("网络不可用"));
  const auth = createAuth();
  await auth.init(vi.fn());
  expect(auth.user).toBeUndefined();
  expect(auth.authorized).toBe(false);
  expect(auth.error).toBe("网络不可用");
  expect(auth.loading).toBe(false);
});

it("keeps access closed when the SDK has no access token", async () => {
  sdk.getTokenSilently.mockResolvedValue(undefined);
  const auth = createAuth();
  await auth.init(vi.fn());
  expect(auth.authorized).toBe(false);
  await expect(auth.getToken()).rejects.toThrow("login_required");
});

import { permissions, tokenHasPermission } from "@hasbai/auth/config";
import { goto } from "$app/navigation";
import { createBrowserClient, type Auth0Client, type User } from "@hasbai/auth";

// A redirect callback and the editor are separate SvelteKit routes. Keep the
// browser SDK instance shared while navigating between callback and editor.
let sharedClient: Auth0Client | undefined;
function browserClient() {
  return (sharedClient ??= createBrowserClient(location.origin));
}

export function createAuth() {
  let user = $state<User>();
  let loading = $state(true);
  let canEdit = $state(false);
  let error = $state("");
  const safe = (path: unknown) =>
    typeof path === "string" &&
    /^\/studio(?:\/|$)/.test(path) &&
    !path.includes("\\")
      ? path
      : "/studio";
  return {
    get canEdit() {
      return canEdit;
    },
    get user() {
      return user;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    async init() {
      try {
        const client = browserClient();
        if (location.pathname === "/auth/callback") {
          const result = await client.handleRedirectCallback<{
            returnTo?: string;
          }>();
          await goto(safe(result.appState?.returnTo), { replaceState: true });
          return;
        }
        user = await client.getUser();
        if (!user) {
          await client.checkSession({ timeoutInSeconds: 3 });
          user = await client.getUser();
        }
        if (user) canEdit = tokenHasPermission(await browserClient().getTokenSilently(), permissions.blog);
      } catch (e) {
        user = undefined;
        canEdit = false;
        const code = (e as { error?: string }).error;
        if (
          ![
            "login_required",
            "consent_required",
            "interaction_required",
            "timeout",
          ].includes(code ?? "")
        )
          error = e instanceof Error ? e.message : "登录失败";
      } finally {
        loading = false;
      }
    },
    async login() {
      error = "";
      try {
        await browserClient().loginWithRedirect({
          appState: { returnTo: safe(location.pathname) },
        });
      } catch {
        error = "登录失败，请重试";
      }
    },
    async logout() {
      await browserClient().logout({
        logoutParams: { returnTo: location.origin },
      });
      sharedClient = undefined;
      user = undefined;
      canEdit = false;
    },
    async token() {
      const value = await browserClient().getTokenSilently();
      if (!value) throw new Error("请重新登录");
      canEdit = tokenHasPermission(value, permissions.blog);
      if (!canEdit) throw new Error("当前账号没有编辑权限");
      return value;
    },
  };
}
export type BlogAuth = ReturnType<typeof createAuth>;

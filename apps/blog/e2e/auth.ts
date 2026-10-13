// Compiled only with the separate e2e build, never into the production Worker.
export const authConfig={domain:'test.invalid',clientId:'fixture',audience:'fixture'};
export function createBrowserClient(){return {checkSession:async()=>{},getUser:async()=>({sub:'fixture'}),getTokenSilently:async()=>'e30.'+btoa(JSON.stringify({permissions:sessionStorage.getItem('fixture-ordinary')?[]:['blog.all:all']}))+'.fixture',loginWithRedirect:async()=>{},logout:async()=>{location.href='/';},handleRedirectCallback:async()=>({appState:{returnTo:'/studio'}})};}
export type Auth0Client=ReturnType<typeof createBrowserClient>;export type User={sub:string};

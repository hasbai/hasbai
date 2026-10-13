// Included only in the e2e build.
export async function verifyUserToken(token: string) {
 const claims = JSON.parse(atob(token.split('.')[1]));
 return { ...claims, sub: 'auth0|fixture' };
}

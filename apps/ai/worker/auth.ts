import { verifyUserToken } from '@hasbai/auth/server';
import { authClaims, hasPermission, permissions } from '@hasbai/auth/config';
import { HttpError } from './http';
export async function identity(request: Request) {
  const token = request.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) throw new HttpError(401, '请先登录');
  let claims;
  try { claims = await verifyUserToken(token); } catch { throw new HttpError(401, '登录已失效，请重新登录'); }
  const raw = claims[authClaims.username];
  const username = typeof raw === 'string' && raw.trim() && !/[\u0000-\u001f\u007f]/.test(raw) ? raw.trim() : claims.sub!;
  return {username, admin: hasPermission(claims, permissions.ai)};
}

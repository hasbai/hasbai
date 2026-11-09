import { verifyUserToken } from '@hasbai/auth/server';
import { hasPermission, permissions } from '@hasbai/auth/config';
import { HttpError } from './http';

/** Returns the verified Auth0 subject; data is isolated per subject. */
export async function identity(request: Request): Promise<string> {
  const token = request.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) throw new HttpError(401, '请先登录');
  let claims;
  try { claims = await verifyUserToken(token); } catch { throw new HttpError(401, '登录已失效，请重新登录'); }
  if (!claims.sub) throw new HttpError(401, '登录已失效，请重新登录');
  if (!hasPermission(claims, permissions.wechat)) throw new HttpError(403, '需要 wechat.all:all 权限');
  return claims.sub;
}

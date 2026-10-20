// Read-only by default. --apply updates only existing custom APIs and superadmin grants.
import { execFileSync } from 'node:child_process';
import { authConfig, permissions } from '../packages/auth/src/config.ts';

const apply = process.argv.includes('--apply');
if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Use --apply to update Auth0.');
function api(method, path, data) {
  try {
    const out = execFileSync('auth0', ['api', method, path, ...(data ? ['--data', JSON.stringify(data)] : [])],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
    return out.trim() ? JSON.parse(out) : {};
  } catch { throw new Error(`Auth0 ${method} ${path} failed; credentials and response suppressed.`); }
}
const additions = new Map([
  [authConfig.audience, [
    { value: permissions.financial, description: '北极账本：访问全部财务功能，仅 Super Admin' },
    { value: permissions.images, description: '图床：管理全部图片，仅 Super Admin' },
    { value: permissions.blog, description: '北极小站：编辑、发布、删除内容和上传图片，仅 Super Admin' },
    { value: permissions.tavern, description: '酒馆：全站模型、网关、公共目录及他人数据管理，仅 Super Admin' },
  ]],
  ['https://zboard.hasbai.xyz/api', [
    { value: permissions.zboard, description: 'Zboard：用户、节点、配额及模板管理，仅 Super Admin' },
  ]],
]);
// Retired names are removed, never accepted as authorization aliases.
const retired = new Set(['access:financial', 'manage:blog', 'manage:tavern', 'manage:zboard']);
const resources = api('get', 'resource-servers');
const roles = api('get', 'roles');
const admin = roles.find(role => role.name === 'superadmin' && role.type !== 'organization');
if (!admin) throw new Error('Existing tenant superadmin role not found.');
for (const audience of additions.keys()) {
  if (!resources.some(resource => resource.identifier === audience)) throw new Error(`Missing existing API: ${audience}`);
}
const custom = resources.filter(resource => !resource.identifier.endsWith('/api/v2/'));
const granted = api('get', `roles/${admin.id}/permissions?per_page=100`);
const desired = [...additions].flatMap(([resource_server_identifier, scopes]) => scopes.map(scope => ({
  resource_server_identifier, permission_name: scope.value,
})));
const missing = desired.filter(permission => !granted.some(current =>
  current.resource_server_identifier === permission.resource_server_identifier && current.permission_name === permission.permission_name));
for (const resource of custom) {
  const scopes = (resource.scopes ?? []).filter(scope => !retired.has(scope.value));
  for (const scope of additions.get(resource.identifier) ?? []) {
    if (!scopes.some(current => current.value === scope.value)) scopes.push(scope);
  }
  const dialect = resource.token_dialect?.startsWith('rfc9068_') ? 'rfc9068_profile_authz' : 'access_token_authz';
  const patch = { enforce_policies: true, token_dialect: dialect, ...(additions.has(resource.identifier) ? { scopes } : {}) };
  let observed = resource;
  if (apply) {
    api('patch', `resource-servers/${resource.id}`, patch);
    const verified = api('get', `resource-servers/${resource.id}`);
    observed = verified;
    if (verified.enforce_policies !== true || verified.token_dialect !== dialect ||
      scopes.some(scope => !verified.scopes?.some(current => current.value === scope.value)) ||
      verified.scopes?.some(scope => retired.has(scope.value))) {
      throw new Error(`API verification failed: ${resource.name}`);
    }
  }
  console.log(JSON.stringify({ applied: apply, name: resource.name, audience: resource.identifier,
    current: { rbac: observed.enforce_policies === true, tokenDialect: observed.token_dialect ?? 'access_token', permissions: (observed.scopes ?? []).map(scope => scope.value) },
    desired: { rbac: true, tokenDialect: dialect, permissions: scopes.map(scope => scope.value) } }));
}
if (apply && missing.length) api('post', `roles/${admin.id}/permissions`, { permissions: missing });
const observedGrants = apply ? api('get', `roles/${admin.id}/permissions?per_page=100`) : granted;
const retiredGrants = observedGrants.filter(permission => retired.has(permission.permission_name)
  && additions.has(permission.resource_server_identifier)).map(({ resource_server_identifier, permission_name }) => ({
    resource_server_identifier, permission_name,
  }));
if (apply && retiredGrants.length) api('delete', `roles/${admin.id}/permissions`, { permissions: retiredGrants });
if (apply) {
  const verified = api('get', `roles/${admin.id}/permissions?per_page=100`);
  if (desired.some(permission => !verified.some(current =>
    current.resource_server_identifier === permission.resource_server_identifier && current.permission_name === permission.permission_name))) {
    throw new Error('Superadmin permission assignment verification failed.');
  }
  if (verified.some(permission => retired.has(permission.permission_name) && additions.has(permission.resource_server_identifier)))
    throw new Error('Retired permission assignment still present.');
}
console.log(JSON.stringify({ applied: apply, role: admin.name, newGrants: missing,
  ordinaryUsers: 'Verified user JWT; no Auth0 role required', managementApi: 'Unchanged' }));

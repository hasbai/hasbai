import { observeRequest } from '@hasbai/observability';
import { identity, AuthError } from "./auth";
import { clientConfig, subscription } from "./subscription";
import {
  DEFAULT_CLASH_TEMPLATE,
  renderClashTemplate,
  resolveClashSettings,
  type ClashSettings,
} from "./clash-template";

type RuntimeEnv = Env;

type NodeRow = {
  id: number;
  name: string;
  token: string;
  node_type: string;
  enabled: number;
  config_template_id: number | null;
  config_json: string;
  client_json: string;
  config_revision: number;
  users_revision: number;
};

type UserRow = {
  id: number;
  email: string;
  auth0_sub: string | null;
  subscription_token: string | null;
  uuid: string;
  speed_limit: number;
  device_limit: number;
  enabled: number;
  expired_at: number | null;
  transfer_enable: number;
  upload: number;
  download: number;
};

type TemplateRow = {
  id: number;
  name: string;
  description: string;
  protocol: string;
  template_json: string;
};

type AuthContext = {
  node: NodeRow;
  nodeId: number;
};

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};
const PUBLIC_ORIGIN = "https://zboard.hasbai.xyz";

function subscriptionOrigin(url: URL): string {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    ? url.origin
    : PUBLIC_ORIGIN;
}

export default {
  async fetch(request: Request, env: Env) {
    return observeRequest(request, "zboard", env.VERSION?.id, async () => {
    const url = new URL(request.url);
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders() });
      }
      if (url.pathname === "/health") {
        return json({ ok: true, service: "zboard", version: env.VERSION?.id });
      }
      if (url.pathname.startsWith("/sub/"))
        return await handleSubscription(request, env, url);
      if (url.pathname === "/api/me" || url.pathname === "/api/me/rotate")
        return await handleMe(request, env, url);
      if (url.pathname.startsWith("/api/admin/")) {
        return await handleAdmin(request, env as RuntimeEnv, url);
      }
      if (
        url.pathname.startsWith("/api/v1/server/") ||
        url.pathname.startsWith("/api/v2/server/")
      ) {
        return await handleNode(request, env as RuntimeEnv, url);
      }
      if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
      return json({ message: "not found" }, 404);
    } catch (error) {
      if (error instanceof HttpError || error instanceof AuthError) {
        return json({ message: error.message }, error.status);
      }
      if (errorToString(error).includes("UNIQUE constraint"))
        return json({ message: "名称或用户身份已存在" }, 409);
      return json({ message: "internal error" }, 500);
    }
    });
  },
} satisfies ExportedHandler<Env>;

async function handleNode(
  request: Request,
  env: RuntimeEnv,
  url: URL,
): Promise<Response> {
  if (isConfigPath(url.pathname) && request.method === "GET") {
    const auth = await authenticateNode(env, url);
    if (!auth) return json({ message: "unauthorized" }, 401);
    return nodeConfigResponse(request, auth.node);
  }

  if (isUsersPath(url.pathname) && request.method === "GET") {
    const auth = await authenticateNode(env, url);
    if (!auth) return json({ message: "unauthorized" }, 401);
    return nodeUsersResponse(request, env, auth.node);
  }

  if (
    url.pathname === "/api/v1/server/UniProxy/push" &&
    request.method === "POST"
  ) {
    const auth = await authenticateNode(env, url);
    if (!auth) return json({ message: "unauthorized" }, 401);
    const body = await readJsonValue(request);
    await persistTraffic(env, auth.node.id, normalizeTrafficPayload(body));
    return json({ ok: true });
  }

  if (
    url.pathname === "/api/v1/server/UniProxy/alive" &&
    request.method === "POST"
  ) {
    const auth = await authenticateNode(env, url);
    if (!auth) return json({ message: "unauthorized" }, 401);
    const body = await readJsonValue(request);
    await persistReport(env, auth.node.id, "report.devices", body);
    return json({ ok: true });
  }

  if (
    url.pathname === "/api/v1/server/UniProxy/status" &&
    request.method === "POST"
  ) {
    const auth = await authenticateNode(env, url);
    if (!auth) return json({ message: "unauthorized" }, 401);
    const body = await readJsonValue(request);
    await persistReport(env, auth.node.id, "node.status", body);
    return json({ ok: true });
  }

  return json({ message: "not found" }, 404);
}

function isConfigPath(pathname: string): boolean {
  return pathname === "/api/v1/server/UniProxy/config";
}

function isUsersPath(pathname: string): boolean {
  return pathname === "/api/v1/server/UniProxy/user";
}

function nodeConfigResponse(request: Request, node: NodeRow): Response {
  const etag = `W/"node-${node.id}-config-v2-${node.config_revision}"`;
  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": "private, no-cache" },
    });
  }
  return json(configForNode(node), 200, {
    ETag: etag,
    "Cache-Control": "private, no-cache",
  });
}

async function nodeUsersResponse(
  request: Request,
  env: RuntimeEnv,
  node: NodeRow,
): Promise<Response> {
  // Eligibility can change through time or traffic without an admin revision.
  const payload = JSON.stringify({ users: await listNodeUsers(env, node.id) });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const etag = `W/"node-${node.id}-users-${node.users_revision}-${hash}"`;
  const headers = {
    ...JSON_HEADERS,
    ETag: etag,
    "Cache-Control": "private, no-cache",
  };
  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(payload, { headers });
}

function configForNode(node: NodeRow): Record<string, unknown> {
  const parsed = parseObject(node.config_json);
  // NewV2board reads snake_case transport settings for VLESS.
  if (
    node.node_type.toLowerCase() === "vless" &&
    parsed.network_settings === undefined
  ) {
    parsed.network_settings = parsed.networkSettings ?? {};
  }
  // Upstream appends :server_port itself. Adapt older zboard host:port snapshots.
  const tls = { ...objectValue(parsed.tls_settings) };
  if (typeof tls.dest === "string") {
    const match = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(tls.dest);
    if (match) {
      tls.dest = match[1];
      tls.server_port = match[2];
    }
  }
  if (tls.server_port !== undefined) tls.server_port = String(tls.server_port);
  if (parsed.tls_settings !== undefined) parsed.tls_settings = tls;
  return {
    ...parsed,
    node_id: node.id,
    protocol: stringValue(parsed.protocol, node.node_type),
  };
}

async function listNodeUsers(
  env: RuntimeEnv,
  nodeId: number,
): Promise<Array<Record<string, unknown>>> {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.uuid, u.speed_limit, u.device_limit
     FROM users u
     INNER JOIN node_users nu ON nu.user_id = u.id
     WHERE nu.node_id = ? AND nu.enabled = 1 AND u.enabled = 1
       AND (u.expired_at IS NULL OR u.expired_at > ?)
       AND (u.transfer_enable = 0 OR (u.upload + u.download) < u.transfer_enable)
     ORDER BY u.id ASC`,
  )
    .bind(nodeId, now())
    .all();
  return (results ?? []).map((row) => ({
    id: Number(row.id),
    uuid: String(row.uuid),
    speed_limit: Number(row.speed_limit ?? 0),
    device_limit: Number(row.device_limit ?? 0),
  }));
}

async function authenticateNode(
  env: RuntimeEnv,
  url: URL,
  body?: Record<string, unknown>,
): Promise<AuthContext | null> {
  const token = stringValue(body?.token, url.searchParams.get("token") ?? "");
  const nodeId = numberValue(
    body?.node_id,
    numberValue(url.searchParams.get("node_id"), 0),
  );
  if (!token || nodeId <= 0) return null;
  const node = await getNodeById(env, nodeId);
  if (!node || node.enabled !== 1) return null;
  if (!(await timingSafeEqual(token, node.token))) return null;
  return { node, nodeId };
}

async function getNodeById(
  env: RuntimeEnv,
  nodeId: number,
): Promise<NodeRow | null> {
  return env.DB.prepare(
    `SELECT id, name, token, node_type, enabled, config_template_id, config_json,
            config_revision, users_revision, client_json
     FROM nodes
     WHERE id = ?`,
  )
    .bind(nodeId)
    .first<NodeRow>();
}

async function handleAdmin(
  request: Request,
  env: RuntimeEnv,
  url: URL,
): Promise<Response> {
  const actor = await identity(request, env);
  if (!actor.admin) return json({ message: "需要管理员权限" }, 403);

  const path = url.pathname.replace(/^\/api\/admin/, "") || "/";
  const parts = path.split("/").filter(Boolean);

  if (parts.length === 1 && parts[0] === "nodes") {
    if (request.method === "GET") return listNodes(env);
    if (request.method === "POST") return createNode(request, env);
  }

  if (parts.length === 2 && parts[0] === "nodes") {
    const nodeId = Number(parts[1]);
    if (!Number.isInteger(nodeId))
      return json({ message: "invalid node id" }, 400);
    if (request.method === "GET") return getNode(env, nodeId);
    if (request.method === "PATCH") return updateNode(request, env, nodeId);
    if (request.method === "DELETE") return deleteNode(env, nodeId);
  }

  if (parts.length === 4 && parts[0] === "nodes" && parts[2] === "users") {
    const nodeId = Number(parts[1]);
    const userId = Number(parts[3]);
    if (request.method === "POST") return attachUserToNode(env, nodeId, userId);
    if (request.method === "DELETE")
      return detachUserFromNode(env, nodeId, userId);
  }

  if (parts.length === 3 && parts[0] === "nodes" && parts[2] === "push") {
    const nodeId = Number(parts[1]);
    if (request.method === "POST")
      return bumpNodeRevisions(env, nodeId, true, true);
  }

  if (
    parts.length === 3 &&
    parts[0] === "nodes" &&
    parts[2] === "apply-template" &&
    request.method === "POST"
  ) {
    return applyTemplateToNode(request, env, Number(parts[1]));
  }

  if (parts.length === 1 && parts[0] === "users") {
    if (request.method === "GET") return listUsers(env);
    if (request.method === "POST") return createUser(request, env);
  }

  if (parts.length === 2 && parts[0] === "users") {
    const userId = Number(parts[1]);
    if (request.method === "GET") return getUser(env, userId);
    if (request.method === "PATCH") return updateUser(request, env, userId);
    if (request.method === "DELETE") return deleteUser(env, userId);
  }

  if (parts.length === 1 && parts[0] === "templates") {
    if (request.method === "GET") return listTemplates(env);
    if (request.method === "POST") return createTemplate(request, env);
  }

  if (parts.length === 1 && parts[0] === "clash") {
    if (request.method === "GET") return json(await clashSettings(env));
    if (request.method === "PUT") return updateClashSettings(request, env);
  }

  if (
    parts.length === 3 &&
    parts[0] === "templates" &&
    parts[2] === "render" &&
    request.method === "POST"
  ) {
    const template = await env.DB.prepare(
      "SELECT * FROM config_templates WHERE id=?",
    )
      .bind(Number(parts[1]))
      .first<TemplateRow>();
    if (!template) throw new HttpError(404, "模板不存在");
    const body = await readJsonObject(request);
    return json({
      config: JSON.parse(
        renderTemplate(template.template_json, objectValue(body.vars)),
      ),
      protocol: template.protocol,
    });
  }

  if (parts.length === 2 && parts[0] === "templates") {
    const templateId = Number(parts[1]);
    if (request.method === "GET") return getTemplate(env, templateId);
    if (request.method === "PATCH")
      return updateTemplate(request, env, templateId);
    if (request.method === "DELETE") return deleteTemplate(env, templateId);
  }

  if (
    parts.length === 1 &&
    parts[0] === "reports" &&
    request.method === "GET"
  ) {
    return listReports(env, url);
  }

  return json({ message: "not found" }, 404);
}

async function listNodes(env: RuntimeEnv): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT n.id, n.name, n.node_type, n.enabled, n.config_template_id,
            n.config_revision, n.users_revision, n.last_seen_at, n.created_at,
            n.updated_at, n.client_json, COUNT(nu.user_id) AS user_count
     FROM nodes n
     LEFT JOIN node_users nu ON nu.node_id = n.id
     GROUP BY n.id
     ORDER BY n.id ASC`,
  ).all();
  return json({ nodes: results ?? [] });
}

async function getNode(env: RuntimeEnv, nodeId: number): Promise<Response> {
  const node = await getNodeById(env, nodeId);
  if (!node) return json({ message: "node not found" }, 404);
  return json({
    node: {
      ...publicNode(node),
      token: node.token,
      config: configForNode(node),
      client: JSON.parse(node.client_json),
      assigned_users: await listAssignedUsers(env, node.id),
    },
  });
}

async function createNode(
  request: Request,
  env: RuntimeEnv,
): Promise<Response> {
  const body = await readJsonObject(request);
  const name = requiredString(body.name, "name");
  const token = stringValue(body.token, crypto.randomUUID());
  const nodeType = protocolValue(body.node_type ?? body.protocol ?? "vless");
  const templateId = nullableNumber(body.config_template_id);
  const config = await resolveCreateNodeConfig(env, body, templateId, nodeType);
  const result = await env.DB.prepare(
    `INSERT INTO nodes (name, token, node_type, enabled, config_template_id, config_json, client_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      name,
      token,
      nodeType,
      boolToInt(body.enabled, true),
      templateId,
      JSON.stringify(config),
      parseClient(body.client, nodeType),
    )
    .run();
  return json({ id: result.meta.last_row_id, token }, 201);
}

async function updateNode(
  request: Request,
  env: RuntimeEnv,
  nodeId: number,
): Promise<Response> {
  const existing = await getNodeById(env, nodeId);
  if (!existing) return json({ message: "node not found" }, 404);
  const body = await readJsonObject(request);
  const config =
    body.config === undefined
      ? parseObject(existing.config_json)
      : parseConfigInput(body.config, existing.node_type);
  const nodeType = protocolValue(body.node_type ?? existing.node_type);
  await env.DB.prepare(
    `UPDATE nodes
     SET name = ?, token = ?, node_type = ?, enabled = ?, config_template_id = ?,
         config_json = ?, client_json = ?, config_revision = config_revision + 1, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      stringValue(body.name, existing.name),
      stringValue(body.token, existing.token),
      nodeType,
      boolToInt(body.enabled, existing.enabled === 1),
      body.config_template_id === undefined
        ? existing.config_template_id
        : nullableNumber(body.config_template_id),
      JSON.stringify(config),
      body.client === undefined
        ? existing.client_json
        : parseClient(body.client, nodeType),
      now(),
      nodeId,
    )
    .run();
  return getNode(env, nodeId);
}

async function deleteNode(env: RuntimeEnv, nodeId: number): Promise<Response> {
  await env.DB.prepare("DELETE FROM nodes WHERE id = ?").bind(nodeId).run();
  return json({ ok: true });
}

async function attachUserToNode(
  env: RuntimeEnv,
  nodeId: number,
  userId: number,
): Promise<Response> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR REPLACE INTO node_users (node_id, user_id, enabled) VALUES (?, ?, 1)",
    ).bind(nodeId, userId),
    env.DB.prepare(
      "UPDATE nodes SET users_revision = users_revision + 1, updated_at = ? WHERE id = ?",
    ).bind(now(), nodeId),
  ]);
  return json({ ok: true });
}

async function detachUserFromNode(
  env: RuntimeEnv,
  nodeId: number,
  userId: number,
): Promise<Response> {
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM node_users WHERE node_id = ? AND user_id = ?",
    ).bind(nodeId, userId),
    env.DB.prepare(
      "UPDATE nodes SET users_revision = users_revision + 1, updated_at = ? WHERE id = ?",
    ).bind(now(), nodeId),
  ]);
  return json({ ok: true });
}

async function bumpNodeRevisions(
  env: RuntimeEnv,
  nodeId: number,
  config: boolean,
  users: boolean,
): Promise<Response> {
  const configSql = config ? "config_revision = config_revision + 1," : "";
  const usersSql = users ? "users_revision = users_revision + 1," : "";
  await env.DB.prepare(
    `UPDATE nodes SET ${configSql} ${usersSql} updated_at = ? WHERE id = ?`,
  )
    .bind(now(), nodeId)
    .run();
  return json({ ok: true });
}

async function applyTemplateToNode(
  request: Request,
  env: RuntimeEnv,
  nodeId: number,
): Promise<Response> {
  const body = await readJsonObject(request);
  const templateId = requiredNumber(body.template_id, "template_id");
  const template = await env.DB.prepare(
    "SELECT * FROM config_templates WHERE id = ?",
  )
    .bind(templateId)
    .first<TemplateRow>();
  if (!template) return json({ message: "template not found" }, 404);
  const rendered = renderTemplate(
    template.template_json,
    objectValue(body.vars),
  );
  assertJsonObject(rendered, "rendered template");
  await env.DB.prepare(
    `UPDATE nodes
     SET config_template_id = ?, node_type = ?, config_json = ?,
         config_revision = config_revision + 1, updated_at = ?
     WHERE id = ?`,
  )
    .bind(template.id, template.protocol, rendered, now(), nodeId)
    .run();
  return getNode(env, nodeId);
}

async function listUsers(env: RuntimeEnv): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, email, uuid, speed_limit, device_limit, enabled, expired_at,
            transfer_enable, upload, download, auth0_sub, created_at, updated_at
     FROM users
     ORDER BY id ASC`,
  ).all();
  return json({ users: results ?? [] });
}

async function listAssignedUsers(
  env: RuntimeEnv,
  nodeId: number,
): Promise<Array<Record<string, unknown>>> {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, u.uuid, u.enabled, nu.created_at
     FROM node_users nu
     INNER JOIN users u ON u.id = nu.user_id
     WHERE nu.node_id = ?
     ORDER BY u.id ASC`,
  )
    .bind(nodeId)
    .all();
  return (results ?? []) as Array<Record<string, unknown>>;
}

async function getUser(env: RuntimeEnv, userId: number): Promise<Response> {
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(userId)
    .first<UserRow>();
  if (!user) return json({ message: "user not found" }, 404);
  const { subscription_token: _token, ...safeUser } = user;
  return json({ user: safeUser });
}

async function createUser(
  request: Request,
  env: RuntimeEnv,
): Promise<Response> {
  const body = await readJsonObject(request);
  const email = requiredString(body.email, "email");
  const uuid = stringValue(body.uuid, crypto.randomUUID());
  const result = await env.DB.prepare(
    `INSERT INTO users (email, uuid, speed_limit, device_limit, enabled, expired_at, transfer_enable, auth0_sub, subscription_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      email,
      uuid,
      counter(body.speed_limit, 0),
      counter(body.device_limit, 0),
      boolToInt(body.enabled, true),
      expiryValue(body.expired_at),
      counter(body.transfer_enable, 0),
      requiredString(body.auth0_sub, "Auth0 用户 ID"),
      crypto.randomUUID().replaceAll("-", ""),
    )
    .run();
  return json({ id: result.meta.last_row_id, uuid }, 201);
}

async function updateUser(
  request: Request,
  env: RuntimeEnv,
  userId: number,
): Promise<Response> {
  const existing = await env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(userId)
    .first<UserRow>();
  if (!existing) return json({ message: "user not found" }, 404);
  const body = await readJsonObject(request);
  await env.DB.prepare(
    `UPDATE users
     SET email = ?, uuid = ?, speed_limit = ?, device_limit = ?, enabled = ?,
         expired_at = ?, transfer_enable = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      stringValue(body.email, existing.email),
      stringValue(body.uuid, existing.uuid),
      counter(body.speed_limit, existing.speed_limit),
      counter(body.device_limit, existing.device_limit),
      boolToInt(body.enabled, existing.enabled === 1),
      body.expired_at === undefined
        ? existing.expired_at
        : expiryValue(body.expired_at),
      counter(body.transfer_enable, existing.transfer_enable),
      now(),
      userId,
    )
    .run();
  await bumpUserNodes(env, userId);
  return getUser(env, userId);
}

async function deleteUser(env: RuntimeEnv, userId: number): Promise<Response> {
  await bumpUserNodes(env, userId);
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
  return json({ ok: true });
}

async function bumpUserNodes(env: RuntimeEnv, userId: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE nodes
     SET users_revision = users_revision + 1, updated_at = ?
     WHERE id IN (SELECT node_id FROM node_users WHERE user_id = ?)`,
  )
    .bind(now(), userId)
    .run();
}

async function listTemplates(env: RuntimeEnv): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT id, name, description, protocol, template_json, created_at, updated_at FROM config_templates ORDER BY id ASC",
  ).all();
  return json({ templates: results ?? [] });
}

async function clashSettings(env: RuntimeEnv): Promise<ClashSettings> {
  const row = await env.DB.prepare(
    "SELECT template_yaml, override_yaml FROM clash_settings WHERE id = 1",
  ).first<ClashSettings>();
  return resolveClashSettings(
    row ?? { template_yaml: DEFAULT_CLASH_TEMPLATE, override_yaml: "" },
  );
}

async function updateClashSettings(
  request: Request,
  env: RuntimeEnv,
): Promise<Response> {
  const body = await readJsonObject(request);
  if (
    typeof body.template_yaml !== "string" ||
    !body.template_yaml.trim() ||
    typeof body.override_yaml !== "string"
  )
    throw new HttpError(400, "请填写 Clash 模板和管理员覆盖项");
  const settings: ClashSettings = {
    template_yaml: body.template_yaml,
    override_yaml: body.override_yaml,
  };
  try {
    renderClashTemplate(settings, []);
  } catch (error) {
    throw new HttpError(400, errorToString(error));
  }
  await env.DB.prepare(
    `INSERT INTO clash_settings (id, template_yaml, override_yaml, updated_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET template_yaml=excluded.template_yaml,
       override_yaml=excluded.override_yaml, updated_at=excluded.updated_at`,
  )
    .bind(settings.template_yaml, settings.override_yaml, now())
    .run();
  return json(settings);
}

async function getTemplate(
  env: RuntimeEnv,
  templateId: number,
): Promise<Response> {
  const template = await env.DB.prepare(
    "SELECT * FROM config_templates WHERE id = ?",
  )
    .bind(templateId)
    .first<TemplateRow>();
  if (!template) return json({ message: "template not found" }, 404);
  return json({ template });
}

async function createTemplate(
  request: Request,
  env: RuntimeEnv,
): Promise<Response> {
  const body = await readJsonObject(request);
  const templateJson = templateJsonValue(
    body.template ?? body.template_json,
    stringValue(body.protocol, "vless"),
  );
  const result = await env.DB.prepare(
    `INSERT INTO config_templates (name, description, protocol, template_json)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(
      requiredString(body.name, "name"),
      stringValue(body.description, ""),
      protocolValue(body.protocol),
      templateJson,
    )
    .run();
  return json({ id: result.meta.last_row_id }, 201);
}

async function updateTemplate(
  request: Request,
  env: RuntimeEnv,
  templateId: number,
): Promise<Response> {
  const existing = await env.DB.prepare(
    "SELECT * FROM config_templates WHERE id = ?",
  )
    .bind(templateId)
    .first<TemplateRow>();
  if (!existing) return json({ message: "template not found" }, 404);
  const body = await readJsonObject(request);
  const templateJson =
    body.template === undefined && body.template_json === undefined
      ? existing.template_json
      : templateJsonValue(
          body.template ?? body.template_json,
          existing.protocol,
        );
  await env.DB.prepare(
    `UPDATE config_templates
     SET name = ?, description = ?, protocol = ?, template_json = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      stringValue(body.name, existing.name),
      stringValue(body.description, existing.description),
      protocolValue(body.protocol ?? existing.protocol),
      templateJson,
      now(),
      templateId,
    )
    .run();
  return getTemplate(env, templateId);
}

async function deleteTemplate(
  env: RuntimeEnv,
  templateId: number,
): Promise<Response> {
  await env.DB.prepare("DELETE FROM config_templates WHERE id = ?")
    .bind(templateId)
    .run();
  return json({ ok: true });
}

async function listReports(env: RuntimeEnv, url: URL): Promise<Response> {
  const nodeId = numberValue(url.searchParams.get("node_id"), 0);
  const limit = Math.min(
    Math.max(numberValue(url.searchParams.get("limit"), 50), 1),
    200,
  );
  const stmt =
    nodeId > 0
      ? env.DB.prepare(
          "SELECT * FROM node_reports WHERE node_id = ? ORDER BY id DESC LIMIT ?",
        ).bind(nodeId, limit)
      : env.DB.prepare(
          "SELECT * FROM node_reports ORDER BY id DESC LIMIT ?",
        ).bind(limit);
  const { results } = await stmt.all();
  return json({ reports: results ?? [] });
}

async function persistReport(
  env: RuntimeEnv,
  nodeId: number,
  event: string,
  payload: unknown,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO node_reports (node_id, event, payload_json) VALUES (?, ?, ?)",
  )
    .bind(nodeId, event, JSON.stringify(payload ?? null))
    .run();
}

async function persistTraffic(
  env: RuntimeEnv,
  nodeId: number,
  traffic: Map<number, [number, number]>,
): Promise<void> {
  if (traffic.size === 0) return;
  const payload = JSON.stringify(Object.fromEntries(traffic));
  // Two statements regardless of user count, atomically accounting and recording.
  // A per-user batch would exceed the Free plan's 50-query invocation limit.
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET
         upload = upload + json_extract(t.value, '$[0]'),
         download = download + json_extract(t.value, '$[1]'),
         updated_at = ?
       FROM json_each(?) AS t
       WHERE users.id = CAST(t.key AS INTEGER)
         AND EXISTS (SELECT 1 FROM node_users nu
                     WHERE nu.node_id = ? AND nu.user_id = users.id)`,
    ).bind(now(), payload, nodeId),
    env.DB.prepare(
      "INSERT INTO node_reports (node_id, event, payload_json) VALUES (?, ?, ?)",
    ).bind(nodeId, "report.traffic", payload),
  ]);
}

function normalizeTrafficPayload(
  input: unknown,
): Map<number, [number, number]> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new HttpError(400, "invalid traffic payload");
  const traffic = objectValue(input);
  const out = new Map<number, [number, number]>();
  for (const [key, value] of Object.entries(traffic)) {
    const userId = Number(key);
    if (
      !Number.isSafeInteger(userId) ||
      userId <= 0 ||
      String(userId) !== key ||
      !Array.isArray(value) ||
      value.length !== 2 ||
      !value.every((bytes) => Number.isSafeInteger(bytes) && bytes >= 0)
    ) {
      throw new HttpError(
        400,
        "traffic must map positive user IDs to [upload, download] byte increments",
      );
    }
    if (value[0] !== 0 || value[1] !== 0) out.set(userId, [value[0], value[1]]);
  }
  return out;
}

function renderTemplate(
  templateJson: string,
  vars: Record<string, unknown>,
): string {
  const render = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(render);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, render(v)]),
      );
    if (typeof value !== "string") return value;
    const get = (key: string) => {
      if (vars[key] === undefined || vars[key] === null)
        throw new HttpError(400, `缺少模板变量 ${key}`);
      return vars[key];
    };
    const whole = /^\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}$/.exec(value);
    return whole
      ? get(whole[1])
      : value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) =>
          String(get(key)),
        );
  };
  return JSON.stringify(render(JSON.parse(templateJson)));
}

async function resolveCreateNodeConfig(
  env: RuntimeEnv,
  body: Record<string, unknown>,
  templateId: number | null,
  nodeType: string,
): Promise<Record<string, unknown>> {
  if (body.config !== undefined) {
    return parseConfigInput(body.config, nodeType);
  }
  if (templateId !== null) {
    const template = await env.DB.prepare(
      "SELECT template_json FROM config_templates WHERE id = ?",
    )
      .bind(templateId)
      .first<{ template_json: string }>();
    if (template) return parseConfigInput(template.template_json, nodeType);
  }
  return parseConfigInput(undefined, nodeType);
}

function parseConfigInput(
  input: unknown,
  protocol: string,
): Record<string, unknown> {
  if (input !== undefined)
    assertJsonObject(
      typeof input === "string" ? input : JSON.stringify(input),
      "节点配置",
    );
  const config =
    typeof input === "string" ? parseObject(input) : objectValue(input);
  if (Object.keys(config).length === 0) {
    return {
      protocol,
      listen_ip: "0.0.0.0",
      server_port: 443,
      network: "tcp",
      networkSettings: { network: "tcp" },
      network_settings: { network: "tcp" },
      routes: [],
    };
  }
  return config;
}

function templateJsonValue(input: unknown, protocol: string): string {
  if (typeof input === "string") {
    assertJsonObject(input, "模板");
    return input;
  }
  return JSON.stringify(parseConfigInput(input, protocol));
}

function assertJsonObject(json: string, label: string): void {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
  } catch {
    throw new HttpError(400, `${label} must render to valid JSON`);
  }
}

async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  if (!hasBody(request)) return {};
  const value = await readJsonValue(request);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "JSON 必须为对象");
  return value as Record<string, unknown>;
}

async function readJsonValue(request: Request): Promise<unknown> {
  if (!hasBody(request)) return {};
  const reader = request.body?.getReader();
  if (!reader) return {};
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 131072) {
      await reader.cancel();
      throw new HttpError(413, "请求内容过大");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "无效的 JSON");
  }
}

function hasBody(request: Request): boolean {
  return request.method !== "GET" && request.method !== "HEAD";
}

function parseObject(json: string): Record<string, unknown> {
  try {
    return objectValue(JSON.parse(json) as unknown);
  } catch {
    return {};
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function requiredString(value: unknown, field: string): string {
  const out = stringValue(value, "");
  if (!out) throw new HttpError(400, `${field} is required`);
  return out;
}

function requiredNumber(value: unknown, field: string): number {
  const out = numberValue(value, Number.NaN);
  if (!Number.isFinite(out)) throw new HttpError(400, `${field} is required`);
  return out;
}

function stringValue(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return fallback;
}

function numberValue(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = numberValue(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolToInt(value: unknown, fallback: boolean): number {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value === 0 ? 0 : 1;
  if (typeof value === "string")
    return ["1", "true", "yes", "on"].includes(value.toLowerCase()) ? 1 : 0;
  return fallback ? 1 : 0;
}

function publicNode(node: NodeRow): Record<string, unknown> {
  return {
    id: node.id,
    name: node.name,
    node_type: node.node_type,
    enabled: node.enabled === 1,
    config_template_id: node.config_template_id,
    config_revision: node.config_revision,
    users_revision: node.users_revision,
  };
}

async function timingSafeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function json(
  data: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  };
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function counter(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new HttpError(400, "额度和限制必须为非负整数");
  return n;
}
function protocolValue(value: unknown): string {
  const p = String(value).toLowerCase();
  if (!["vless", "vmess", "trojan", "shadowsocks"].includes(p))
    throw new HttpError(400, "不支持的协议");
  return p;
}
function parseClient(value: unknown, protocol: string): string {
  try {
    const c = clientConfig(value, true);
    if (
      protocol === "shadowsocks" &&
      (c.network !== "tcp" || c.security !== "none")
    )
      throw new Error("Shadowsocks 使用 TCP / 无 TLS");
    if (protocol === "vmess" && c.security === "reality")
      throw new Error("VMess 不支持 REALITY");
    return JSON.stringify(c);
  } catch (error) {
    throw new HttpError(400, errorToString(error));
  }
}
async function handleMe(
  request: Request,
  env: RuntimeEnv,
  url: URL,
): Promise<Response> {
  const actor = await identity(request, env);
  if (url.pathname === "/api/me/rotate") {
    if (request.method !== "POST")
      return json({ message: "method not allowed" }, 405);
    await env.DB.prepare(
      "UPDATE users SET subscription_token = ?, updated_at = ? WHERE auth0_sub = ?",
    )
      .bind(crypto.randomUUID().replaceAll("-", ""), now(), actor.sub)
      .run();
  } else if (request.method !== "GET")
    return json({ message: "method not allowed" }, 405);
  let user = await env.DB.prepare("SELECT * FROM users WHERE auth0_sub = ?")
    .bind(actor.sub)
    .first<UserRow>();
  if (!user) {
    await env.DB.prepare(
      "INSERT INTO users (email,uuid,auth0_sub,subscription_token,enabled) VALUES (?,?,?,?,0) ON CONFLICT(auth0_sub) DO NOTHING",
    )
      .bind(
        actor.email,
        crypto.randomUUID(),
        actor.sub,
        crypto.randomUUID().replaceAll("-", ""),
      )
      .run();
    user = await env.DB.prepare("SELECT * FROM users WHERE auth0_sub = ?")
      .bind(actor.sub)
      .first<UserRow>();
  }
  if (!user) throw new HttpError(500, "无法创建账户");
  const { results } = await env.DB.prepare(
    "SELECT n.id,n.name,n.node_type,n.client_json FROM nodes n JOIN node_users nu ON nu.node_id=n.id WHERE nu.user_id=? AND nu.enabled=1 AND n.enabled=1 ORDER BY n.id",
  )
    .bind(user.id)
    .all<{
      id: number;
      name: string;
      node_type: string;
      client_json: string;
    }>();
  const nodes = (results ?? [])
    .filter((n) => {
      try {
        return !!clientConfig(JSON.parse(n.client_json)).server;
      } catch {
        return false;
      }
    })
    .map((n) => ({ id: n.id, name: n.name, node_type: n.node_type }));
  const eligible =
    user.enabled === 1 &&
    (!user.expired_at || user.expired_at > now()) &&
    (!user.transfer_enable ||
      user.upload + user.download < user.transfer_enable);
  const { subscription_token, uuid: _uuid, ...account } = user;
  return json({
    admin: actor.admin,
    user: account,
    nodes: eligible ? nodes : [],
    subscription_url:
      eligible && nodes.length
        ? `${subscriptionOrigin(url)}/sub/${subscription_token}`
        : null,
  });
}
async function handleSubscription(
  request: Request,
  env: RuntimeEnv,
  url: URL,
): Promise<Response> {
  if (request.method !== "GET")
    return json({ message: "method not allowed" }, 405);
  const token = url.pathname.slice("/sub/".length);
  if (!/^[a-f0-9]{32}$/.test(token))
    return json({ message: "订阅不可用" }, 404);
  const user = await env.DB.prepare(
    "SELECT * FROM users WHERE subscription_token = ? AND auth0_sub IS NOT NULL AND enabled=1 AND (expired_at IS NULL OR expired_at>?) AND (transfer_enable=0 OR upload+download<transfer_enable)",
  )
    .bind(token, now())
    .first<UserRow>();
  if (!user) return json({ message: "订阅不可用" }, 404);
  const { results } = await env.DB.prepare(
    "SELECT n.id,n.name,n.node_type,n.client_json FROM nodes n JOIN node_users nu ON nu.node_id=n.id WHERE nu.user_id=? AND nu.enabled=1 AND n.enabled=1 ORDER BY n.id",
  )
    .bind(user.id)
    .all<{
      id: number;
      name: string;
      node_type: string;
      client_json: string;
    }>();
  const nodes = (results ?? []).filter((n) => {
    try {
      return !!clientConfig(JSON.parse(n.client_json)).server;
    } catch {
      return false;
    }
  });
  const format = url.searchParams.get("format") ?? "base64";
  if (!["base64", "uri", "clash"].includes(format))
    throw new HttpError(400, "不支持的订阅格式");
  if (!nodes.length) return json({ message: "暂无可用节点" }, 404);
  const settings = format === "clash" ? await clashSettings(env) : undefined;
  return new Response(subscription(nodes, user.uuid, format, settings), {
    headers: {
      "Content-Type":
        format === "clash"
          ? "application/yaml; charset=utf-8"
          : "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "subscription-userinfo": `upload=${user.upload}; download=${user.download}; total=${user.transfer_enable}; expire=${user.expired_at ?? 0}`,
    },
  });
}
export { normalizeTrafficPayload, renderTemplate, configForNode };

function expiryValue(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  return counter(value, 0);
}

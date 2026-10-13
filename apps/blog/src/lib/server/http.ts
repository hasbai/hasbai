import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { contentRoutes } from "./content-routes";
import { imageRoutes } from "./images";
import { handleMcp } from "./mcp";

export type BlogBindings = { platform?: App.Platform };

export const blogHttp = new Hono<{ Bindings: BlogBindings }>();
blogHttp.onError((error, c) => {
  if (error instanceof HTTPException)
    return c.json({ message: error.message }, error.status);
  return c.json({ message: "服务暂时不可用" }, 503);
});
blogHttp.get("/api/version", (c) =>
  c.json({
    id: c.env.platform?.env.VERSION.id ?? "local",
    tag: c.env.platform?.env.VERSION.tag ?? "",
  }),
);
blogHttp.use(
  "/api/mcp",
  cors({
    origin: "*",
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "MCP-Protocol-Version",
      "MCP-Session-Id",
      "Authorization",
    ],
    exposeHeaders: ["MCP-Protocol-Version"],
  }),
);
blogHttp.use("/api/mcp", bodyLimit({ maxSize: 8 * 1024 * 1024 }));
blogHttp.post("/api/mcp", (c) => handleMcp(c.req.raw, c.env.platform?.env));
blogHttp.all("/api/mcp", (c) =>
  c.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message: "Method not allowed" },
    },
    405,
    { Allow: "POST, OPTIONS" },
  ),
);
blogHttp.route("/", imageRoutes);
blogHttp.route("/", contentRoutes);
blogHttp.all("/api/version", (c) =>
  c.json({ message: "Method not allowed" }, 405, { Allow: "GET, HEAD" }),
);
blogHttp.all("/api/images", (c) =>
  c.json({ message: "Method not allowed" }, 405, { Allow: "POST" }),
);
blogHttp.all("/images/:id", (c) =>
  c.json({ message: "Method not allowed" }, 405, { Allow: "GET, HEAD" }),
);

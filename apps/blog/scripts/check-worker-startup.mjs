import { createRequire } from "node:module";
import { createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Boot the exact production Worker locally. Node/Vite preview cannot detect
// module initialization failures in workerd, including Node-only dependencies.
const directory = await mkdtemp(join(tmpdir(), "blog-worker-startup-"));
const runtime = createRequire(import.meta.url)("workerd");
const fixture=join(directory,"public-snapshot.json");
await writeFile(fixture,JSON.stringify({content:[],tags:[],refreshedAt:Date.now(),schedule:[],revision:"startup-fixture"}));
const seed=spawnSync("pnpm",["exec","wrangler","r2","object","put","hasbai-blog-public-cache/public/v1.json","--local","--persist-to",directory,"--file",fixture],{stdio:"pipe",env:{...process.env,WRANGLER_SEND_METRICS:"false",MINIFLARE_WORKERD_PATH:runtime.default}});
if(seed.status!==0){await rm(directory,{recursive:true,force:true});throw new Error("Unable to seed isolated local R2 fixture");}
const reservation = createServer();
await new Promise((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
const port = reservation.address().port;
await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
const child = spawn("pnpm", ["exec", "wrangler", "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0", "--persist-to", directory, "--log-level", "error", "--show-interactive-dev-session=false"], {
  detached: process.platform !== "win32",
  stdio: ["ignore", "ignore", "pipe"],
  env: { ...process.env, WRANGLER_SEND_METRICS: "false", MINIFLARE_WORKERD_PATH: runtime.default },
});
let stderr = "";
child.stderr.on("data", data => { stderr = (stderr + data).slice(-16000); });
let exited = false;
child.on("exit", () => { exited = true; });
child.on("error", () => { exited = true; });
try {
  let ready = false;
  for (let attempt = 0; attempt < 80 && !exited; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/version`, { signal: AbortSignal.timeout(1000) });
      const version = await response.json();
      if (response.ok && typeof version.id === "string") { ready = true; break; }
    } catch { /* The local Worker is still starting. */ }
    await delay(250);
  }
  if (!ready) {
    // Emit only known startup diagnostics; never dump Wrangler configuration or credentials.
    const error = stderr.split("\n").filter(line => /Uncaught|createRequire|file URL|ERROR|failed to start/i.test(line)).slice(0,8).join("\n");
    throw new Error("Production Worker failed to initialize in workerd" + (error ? "\n" + error : ""));
  }
  for(const [op,args,expected] of [["articles",[{}],[]],["pageBySlug",["scanner-missing"],null]]) {
    const url=new URL(`http://127.0.0.1:${port}/api/public`);
    url.search=new URLSearchParams({op,args:JSON.stringify(args)}).toString();
    const response=await fetch(url,{signal:AbortSignal.timeout(5000)});
    if(response.status!==200 || response.headers.get("X-Blog-Source")!=="r2" || JSON.stringify((await response.json()).data)!==JSON.stringify(expected))throw new Error("Production public reader failed isolated R2 validation");
  }
  const ssr=await fetch(`http://127.0.0.1:${port}/articles`,{signal:AbortSignal.timeout(5000)});
  if(ssr.status!==200 || !(await ssr.text()).includes("北极小站"))throw new Error("Production SSR failed isolated R2 validation");
  const rpc = async (method, params, id = 1) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/mcp`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params }),
      signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, body: response.status === 202 ? null : await response.json() };
  };
  const initialized = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "worker-startup", version: "1" } });
  if (initialized.status !== 200 || initialized.body.result?.serverInfo.name !== "北极小站")
    throw new Error("Production MCP failed to initialize in workerd");
  const listed = await rpc("tools/list");
  if (listed.status !== 200 || listed.body.result?.tools.map(tool => tool.name).join(",") !== "list_content,get_content,list_tags,create_content,update_content,delete_content,create_tag,update_tag,delete_tag")
    throw new Error("Production MCP failed tool discovery in workerd");
  const invalid = await rpc("tools/call", { name: "get_content", arguments: { kind: "article", id: "invalid" } });
  if (invalid.status !== 200 || !invalid.body.result?.isError)
    throw new Error("Production MCP failed input validation in workerd");
  const notification = await rpc("notifications/initialized", undefined, null);
  if (notification.status !== 202) throw new Error("Production MCP failed notification handling in workerd");
  for (const method of ["GET", "DELETE"]) {
    const response = await fetch(`http://127.0.0.1:${port}/api/mcp`, { method, signal: AbortSignal.timeout(5000) });
    if (response.status !== 405) throw new Error("Production MCP unexpectedly enabled session transport");
  }
  console.log("Production Worker initialized in workerd; version, public R2 reads/unknown slug/SSR, MCP initialize/discovery/validation/notifications/methods passed.");
} finally {
  if (child.pid) {
    if (process.platform === "win32") child.kill("SIGTERM");
    else { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
    await delay(250);
    if (process.platform === "win32") child.kill("SIGKILL");
    else { try { process.kill(-child.pid, "SIGKILL"); } catch {} }
  }
  await rm(directory, { recursive: true, force: true });
}

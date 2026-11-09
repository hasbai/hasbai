"""Provision the Worker resource and its Git-integrated production build.

Reads a Cloudflare user-scoped API token from stdin; never deploys a Worker version.
"""
import json
import sys
import urllib.error
import urllib.request

ACCOUNT = "5cecc63c78acf8f5473f8745f4244448"
BASE = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/"
REPO_CONNECTION = "15057c45-fe8f-4114-865e-e91e948ef5c6"
BUILD_TOKEN = "dc39310a-c07e-4c39-87de-94ee4c73764d"
TRIGGER_NAME = "WeChat production"

token = sys.stdin.read().strip()
if not token:
    raise SystemExit("Cloudflare API token required on stdin")


def api(method, path, data=None):
    body = json.dumps(data).encode() if data is not None else None
    headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
    request = urllib.request.Request(BASE + path, method=method, data=body, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            value = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Cloudflare {method} {path}: HTTP {error.code}") from None
    if not value.get("success"):
        raise RuntimeError("Cloudflare API rejected " + path)
    return value["result"]


worker = next((w for w in api("GET", "workers/scripts") if w["id"] == "wechat"), None)
if worker:
    worker_id = worker["tag"]
else:
    observability = {"enabled": True, "head_sampling_rate": 1, "traces": {"enabled": False, "head_sampling_rate": 0}}
    worker_id = api("POST", "workers/workers", {"name": "wechat", "observability": observability})["id"]

triggers = api("GET", f"builds/workers/{worker_id}/triggers")
existing = next((t for t in triggers if t.get("branch_includes") == ["main"]), None)
config = {
    "external_script_id": worker_id,
    "repo_connection_uuid": REPO_CONNECTION,
    "build_token_uuid": BUILD_TOKEN,
    "trigger_name": TRIGGER_NAME,
    "build_command": "pnpm --filter wechat build",
    "deploy_command": "pnpm --filter wechat exec wrangler deploy",
    "root_directory": "/",
    "branch_includes": ["main"],
    "branch_excludes": [],
    "path_includes": ["apps/wechat/**", "packages/**", "pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json"],
    "path_excludes": [],
    "build_caching_enabled": False,
}
if existing:
    api("PATCH", f"builds/triggers/{existing['trigger_uuid']}", config)
else:
    api("POST", "builds/triggers", config)

verified = api("GET", f"builds/workers/{worker_id}/triggers")
match = next(t for t in verified if t.get("trigger_name") == TRIGGER_NAME)
if match["build_command"] != config["build_command"] or match["branch_includes"] != ["main"]:
    raise RuntimeError("Build trigger verification failed")
print(json.dumps({"worker": "wechat", "workerTag": worker_id, "triggerId": match["trigger_uuid"], "paths": match["path_includes"]}))

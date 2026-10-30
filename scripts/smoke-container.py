#!/usr/bin/env python3
"""Disposable Linux image/Compose smoke; never a deployment or public HTTPS test.

Run: python3 scripts/smoke-container.py --allow-disposable-cleanup
Config only (no daemon): python3 scripts/smoke-container.py --validate-only
Cleanup targets only a freshly generated tastip-smoke-* project, image and temp data.
No provider keys, third-party calls, real accounts or serving volumes are used.
"""

import argparse
import html
import http.cookies
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "https://smoke.example"
BASE = "http://127.0.0.1:3301"
PHASE = "configuration"
SENSITIVE_VALUES = set()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


class CommandFailure(RuntimeError):
    def __init__(self, phase, code, output):
        super().__init__(f"Command failed during {phase} (exit {code})")
        self.output = output


def run(args, env, timeout=120):
    result = subprocess.run(args, cwd=ROOT, env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, timeout=timeout)
    if result.returncode:
        # Output is private unless explicitly sanitized by disposable diagnostics.
        raise CommandFailure(PHASE, result.returncode, result.stdout)
    return result.stdout


def diagnostic(label, output, limit=4000):
    """Bound output and omit credential/account/environment lines, including synthetic ones."""
    text = str(output)
    for value in sorted(SENSITIVE_VALUES, key=len, reverse=True):
        if value:
            text = text.replace(value, "[redacted]")
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text)
    lines = []
    for line in text.splitlines():
        if (re.search(r"cookie|authorization|password|secret|credential|token|session|account|username|environment|"
                      r"api.?key|access.?key|private.?key", line, re.I) or
                re.search(r"(?:^|[\s{,\"'])[A-Z_][A-Z0-9_]+[\"']?\s*[:=]", line)):
            line = "[sensitive line omitted]"
        line = re.sub(r"[A-Za-z0-9_-]{40,}", "[redacted token]", line)
        lines.append("".join(character for character in line if character == "\t" or ord(character) >= 32))
    text = "\n".join(lines)
    clipped = text[:limit]
    if len(text) > limit:
        clipped += "\n[truncated]"
    # Prefix each line so service output cannot become a GitHub workflow command.
    for line in (clipped or "[no output]").splitlines():
        print(f"[{label}] {line}", file=sys.stderr)


def startup_diagnostics(compose, env, failure):
    """Inspect only selected state fields; never inspect Config/Env or HTTP bodies."""
    diagnostic("Compose startup", getattr(failure, "output", "No command output available."))
    for service in ("web", "proxy"):
        try:
            ids = run(compose + ["ps", "--all", "--quiet", service], env, 15).split()
            if not ids:
                diagnostic(service + " state", "Container was not created.")
            for container in ids[:1]:
                state = json.loads(run(["docker", "inspect", "--format", "{{json .State}}", container], env, 15))
                health = state.get("Health", {})
                diagnostic(service + " state", json.dumps({
                    "status": state.get("Status"), "exitCode": state.get("ExitCode"),
                    "error": state.get("Error"), "health": health.get("Status"),
                    "failingStreak": health.get("FailingStreak"),
                }))
                for entry in health.get("Log", [])[-2:]:
                    diagnostic(service + " health", f"exit {entry.get('ExitCode')}: {entry.get('Output', '')}", 1000)
        except (RuntimeError, OSError, subprocess.TimeoutExpired, ValueError, TypeError, AttributeError):
            diagnostic(service + " state", "State diagnostics unavailable.")
        try:
            logs = run(compose + ["logs", "--no-color", "--no-log-prefix", "--tail", "40", service], env, 15)
            diagnostic(service + " logs", logs, 6000)
        except (RuntimeError, OSError, subprocess.TimeoutExpired):
            diagnostic(service + " logs", "Service logs unavailable.")


def expect(condition, message):
    if not condition:
        raise RuntimeError(message)


def request(path, body=None, account=None, origin=ORIGIN, owner=None):
    headers = {"Host": "smoke.example", "Origin": origin,
               "Referer": ORIGIN + "/", "Sec-Fetch-Site": "same-origin"}
    if account:
        # Only synthetic cookies are sent manually over this private HTTP test hop.
        # Production Secure-cookie enforcement still belongs to the real HTTPS edge.
        headers.update({"Cookie": account["cookie"],
                        "X-Tastip-Account": owner or account["id"]})
    data = None if body is None else json.dumps(body).encode()
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=data, headers=headers)
    try:
        response = HTTP.open(req, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read(5_000_001)
        expect(len(raw) <= 5_000_000, "Unexpected oversized HTTP response")
        value = json.loads(raw) if "application/json" in response.headers.get("Content-Type", "") else raw
        return response.status, value, response.headers


def session(action, username, password):
    SENSITIVE_VALUES.update((username, password))
    status, body, headers = request("/api/account", {"action": action, "username": username, "password": password})
    expect(status == 200 and isinstance(body.get("account"), dict), "Synthetic account operation failed")
    cookies = http.cookies.SimpleCookie()
    cookies.load(headers.get("Set-Cookie", ""))
    cookie = cookies.get("tastip_session")
    expect(cookie is not None and cookie["secure"] and cookie["httponly"] and
           cookie["samesite"].lower() == "lax", "Production session cookie attributes missing")
    SENSITIVE_VALUES.update((body["account"]["id"], cookie.value))
    return {"id": body["account"]["id"], "cookie": "tastip_session=" + cookie.value}


def api_checks(compose, env):
    global PHASE
    PHASE = "HTTP/authentication/static smoke"
    status, health, _ = request("/api/health")
    expect(status == 200 and health["requiresSignIn"] is True and
           health["providers"] == {"openai": False, "qloo": False}, "Guest hosted health/origin guard failed")
    status, page, _ = request("/")
    expect(status == 200 and isinstance(page, bytes), "Standalone page did not load")
    assets = {html.unescape(value) for value in re.findall(r'(?:src|href)="([^" ]+)"', page.decode())
              if value.startswith("/_next/static/")}
    for extension in (".js", ".css"):
        asset = next((value for value in assets if value.split("?")[0].endswith(extension)), None)
        expect(asset is not None, "Standalone HTML is missing JS/CSS asset references")
        status, content, _ = request(asset)
        expect(status == 200 and bool(content), "Standalone static asset failed")
    for private_path in ("/.env", "/data/tastip.sqlite", "/tastip.sqlite"):
        expect(request(private_path)[0] == 404, "A private runtime path was exposed")
    suffix, password = secrets.token_hex(4), "Synthetic-container-" + secrets.token_hex(16)
    username = "smoke-alice-" + suffix
    alice = session("register", username, password)
    bob = session("register", "smoke-bob-" + suffix, password)
    status, health, _ = request("/api/health", account=alice)
    expect(status == 200 and health["requiresSignIn"] is False and
           not any(health["providers"].values()), "Authenticated internal-origin/empty-key health failed")
    destination = {"id": "lisbon", "name": "Lisbon", "country": "Portugal", "lat": 38.72,
                   "lng": -9.13, "timeZone": "Europe/Lisbon"}
    place = {"id": "qloo:synthetic-container", "destinationId": "lisbon", "name": "Synthetic container fixture",
             "description": "Synthetic fixture, not a real venue.", "source": "qloo", "category": "culture",
             "lat": 38.72, "lng": -9.13, "taste": {"queryId": "synthetic-container-query", "rank": 7},
             "practical": {"hours": "unknown", "cost": "unknown"}}
    workspace = {"places": [{"place": place, "destination": destination}], "collections": [{
        "id": "00000000-0000-4000-8000-000000000049", "name": "Synthetic private collection",
        "placeIds": [place["id"]], "placeNotes": {place["id"]: "Synthetic private persistence note"}}]}
    payload = {"action": "save", "workspace": workspace, "expectedRevision": 0}
    status, saved, headers = request("/api/saved", payload, alice)
    expect(status == 200 and saved["revision"] == 1 and saved["workspace"] == workspace and
           headers.get("Cache-Control") == "no-store", "Saved write/evidence/private note failed")
    expect(request("/api/saved", payload, alice)[0] == 409, "Saved compare-and-swap did not reject stale write")
    status, foreign, _ = request("/api/saved", account=bob)
    expect(status == 200 and foreign["workspace"] is None and foreign["revision"] == 0, "Owner isolation failed")
    expect(request("/api/saved", account=alice, owner=bob["id"])[0] == 409, "Changed owner was accepted")
    expect(request("/api/saved")[0] == 401, "Anonymous private data read was accepted")
    expect(request("/api/saved", {**payload, "expectedRevision": 1}, alice,
                   origin="https://foreign.example")[0] == 403, "Foreign-origin write was accepted")
    query = {"entityIds": ["00000000-0000-4000-8000-000000000067"], "destinationId": "lisbon"}
    expect(request("/api/taste", query)[0] == 403, "Anonymous paid route was accepted")
    expect(request("/api/taste", query, alice, owner=bob["id"])[0] == 409, "Wrong-owner paid route was accepted")
    expect(request("/api/taste", query, alice, origin="https://foreign.example")[0] == 403,
           "Foreign-origin paid route was accepted")
    status, unavailable, _ = request("/api/taste", query, alice)
    expect(status == 503 and unavailable.get("error", {}).get("code") == "PROVIDER_NOT_CONFIGURED",
           "Matching-owner paid request did not reach the empty-key provider boundary")
    PHASE = "web container recreation/persistence"
    before = run(compose + ["ps", "-q", "web"], env).strip()
    run(compose + ["up", "-d", "--no-build", "--force-recreate", "--wait", "--wait-timeout", "120", "web"], env, 150)
    expect(run(compose + ["ps", "-q", "web"], env).strip() != before, "Web container was not recreated")
    expect(request("/api/account", account=alice)[1].get("account", {}).get("id") == alice["id"],
           "Existing session did not survive container recreation")
    signed_in = session("login", username, password)
    expect(signed_in["id"] == alice["id"], "Login identity did not survive container recreation")
    status, restored, _ = request("/api/saved", account=signed_in)
    expect(status == 200 and restored["revision"] == 1 and restored["workspace"] == workspace,
           "Saved collection/evidence/private note did not survive container recreation")
    expect(request("/api/saved", account=bob)[1]["workspace"] is None, "Recreation broke owner isolation")


def main():
    global PHASE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--allow-disposable-cleanup", action="store_true")
    args = parser.parse_args()
    expect(args.validate_only or args.allow_disposable_cleanup, "Explicit --allow-disposable-cleanup is required")
    expect(args.validate_only or sys.platform.startswith("linux"), "Runtime smoke requires a Linux Docker host")
    os.umask(0o077)
    project = "tastip-smoke-" + secrets.token_hex(6)
    expect(re.fullmatch(r"tastip-smoke-[a-f0-9]{12}", project), "Unsafe disposable project name")
    compose = ["docker", "compose", "-p", project, "-f", str(ROOT / "deploy/compose.yaml")]
    with tempfile.TemporaryDirectory(prefix=project + "-") as temporary:
        directory = Path(temporary)
        data = directory / "data"
        data.mkdir(mode=0o700)
        runtime = directory / "runtime.env"
        runtime.write_text("TASTIP_APP_ORIGIN=" + ORIGIN + "\nTASTIP_ENABLE_HOSTED_PROVIDERS=1\nOPENAI_API_KEY=\nQLOO_API_KEY=\n")
        env = {**os.environ, "TASTIP_RUNTIME_ENV_FILE": str(runtime), "TASTIP_DATA_HOST_DIR": str(data),
               "TASTIP_IMAGE": project + ":local", "TASTIP_PROXY_IMAGE": project + "-proxy:local",
               "TASTIP_BIND_PORT": "3301", "TASTIP_FORWARDED_PROTO": "https"}
        run(compose + ["config", "--quiet"], env)
        config = json.loads(run(compose + ["config", "--format", "json"], env))
        web, proxy = config["services"]["web"], config["services"]["proxy"]
        expect(web["user"] == "1000:1000" and web["read_only"] and proxy["read_only"], "Read-only/UID deployment contract changed")
        expect(proxy["user"] == "1000:1000" and proxy["cap_drop"] == ["ALL"] and
               "no-new-privileges:true" in proxy["security_opt"] and
               proxy["image"] == env["TASTIP_PROXY_IMAGE"], "Proxy capability/image contract changed")
        expect(web["environment"]["TASTIP_INTERNAL_ORIGIN"] == "https://0.0.0.0:3000" and
               proxy["ports"][0]["host_ip"] == "127.0.0.1", "Private bind/internal-origin contract changed")
        expect(not web["environment"].get("OPENAI_API_KEY") and not web["environment"].get("QLOO_API_KEY"), "Smoke must not have provider keys")
        if args.validate_only:
            print("Disposable Compose configuration validated; no image/container execution performed.")
            return
        initialized, built_images = False, []
        try:
            PHASE = "Linux image build"
            expect(not run(compose + ["ps", "-aq"], env).strip(), "Disposable project unexpectedly exists")
            for service, image in [("proxy", env["TASTIP_PROXY_IMAGE"]), ("web", env["TASTIP_IMAGE"])]:
                run(compose + ["build", "--pull", service], env, 1200)
                built_images.append(image)
            # Root is restricted to this fresh empty scratch bind, with no network/env file.
            initializer = ["docker", "run", "--rm", "--network", "none", "--read-only", "--user", "0:0",
                           "--cap-drop", "ALL", "--cap-add", "CHOWN", "--cap-add", "FOWNER", "--cap-add", "DAC_OVERRIDE",
                           "--security-opt", "no-new-privileges:true", "--mount", f"type=bind,src={data},dst=/data",
                           "--entrypoint", "sh", env["TASTIP_IMAGE"], "-ec"]
            run(initializer + ['test -z "$(ls -A /data)"; chmod 700 /data; chown 1000:1000 /data'], env)
            initialized = True
            PHASE = "private Compose startup"
            with socket.socket() as port:
                port.bind(("127.0.0.1", 3301))
            run(compose + ["up", "-d", "--no-build", "--wait", "--wait-timeout", "120"], env, 180)
            PHASE = "runtime UID/native SQLite/filesystem smoke"
            checks = """
const assert=require('node:assert/strict'),fs=require('node:fs');
assert.equal(process.getuid(),1000);assert.equal(process.getgid(),1000);
const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(':memory:');assert.equal(db.prepare('SELECT 1 AS value').get().value,1);db.close();
for(const p of ['/app/apps/web/server.js','/app/apps/web/.next/static','/app/apps/web/public'])fs.accessSync(p);
assert.equal(fs.statSync('/data').uid,1000);assert.equal(fs.statSync('/data').mode&511,448);
assert.throws(()=>fs.writeFileSync('/app/readonly-smoke','x'),e=>['EROFS','EACCES'].includes(e.code));
for(const p of ['/tmp/smoke','/app/apps/web/.next/cache/smoke']){fs.writeFileSync(p,'synthetic');fs.unlinkSync(p);}
assert.ok(!process.env.OPENAI_API_KEY&&!process.env.QLOO_API_KEY);assert.equal(process.env.TASTIP_INTERNAL_ORIGIN,'https://0.0.0.0:3000');
"""
            run(compose + ["exec", "-T", "web", "node", "-e", checks], env)
            run(compose + ["exec", "-T", "proxy", "sh", "-ec",
                           'test "$(id -u)" = 1000; test -z "$(getcap /usr/bin/caddy)"; '
                           'for field in CapEff CapBnd; do grep -Eq "^${field}:[[:space:]]*0+$" /proc/1/status; done; '
                           'grep -Eq "^NoNewPrivs:[[:space:]]*1$" /proc/1/status'], env)
            api_checks(compose, env)
            PHASE = "durable SQLite permissions"
            run(compose + ["exec", "-T", "web", "node", "-e",
                           "const a=require('node:assert/strict'),s=require('node:fs').statSync('/data/tastip.sqlite');a.equal(s.uid,1000);a.equal(s.mode&511,384)"], env)
            print("Linux container smoke passed: image/static/native SQLite, private filesystem, auth/origin/isolation/CAS and recreate persistence. No public TLS or live-provider claim.")
        except (RuntimeError, OSError, subprocess.TimeoutExpired, ValueError) as error:
            if PHASE == "private Compose startup":
                startup_diagnostics(compose, env, error)
            raise
        finally:
            failure_phase = PHASE
            failing = sys.exc_info()[0] is not None
            PHASE = "disposable cleanup"
            cleanup = [(compose + ["down", "--volumes", "--remove-orphans", "--timeout", "10"], 90)]
            if initialized:
                cleanup.append((initializer + [f"chown -R {os.getuid()}:{os.getgid()} /data; chmod 700 /data"], 120))
            # Unique images only; never prune shared daemon images, caches or volumes.
            for image in built_images:
                cleanup.append((["docker", "image", "rm", image], 120))
            cleanup_failed = False
            for command, timeout in cleanup:
                try:
                    run(command, env, timeout)
                except (RuntimeError, OSError, subprocess.TimeoutExpired):
                    cleanup_failed = True
            if cleanup_failed:
                print("Disposable cleanup incomplete; inspect only the generated " + project + " resources.", file=sys.stderr)
                if not failing:
                    raise RuntimeError("Disposable cleanup failed")
            if failing:
                PHASE = failure_phase


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, subprocess.TimeoutExpired, ValueError) as error:
        print(f"Container smoke failed during {PHASE}: {error}", file=sys.stderr)
        sys.exit(1)

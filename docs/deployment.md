# Single-server deployment

Run one Tastip web replica on a persistent host. The SQLite `/data` directory must survive container replacement. Browser-only media and guest drafts remain on their owning device. See [AWS deployment](aws-deployment.md) for the optional private-origin topology.

## Files and runtime

- `Dockerfile` builds the monorepo with Bun 1.4.0 and the official Node 24.22.2 Debian image, then copies Next's standalone server, static files and optional public assets into a Node-only runtime. Image versions and multi-platform manifest digests are pinned.
- `deploy/compose.yaml` runs the app as UID/GID 1000, mounts the bind-backed `tastip_private_data` volume at `/data`, and gives only the app its runtime environment file. The filesystem is read-only except the data volume and bounded temporary/cache mounts. No application port is published directly.
- `deploy/proxy.Dockerfile` derives from the pinned official Caddy image and removes its `NET_BIND_SERVICE` file capability, which otherwise prevents execution with all container capabilities dropped. Caddy still runs as UID/GID 1000 on port 8080 with `no-new-privileges`. Its only host binding is `127.0.0.1:${TASTIP_BIND_PORT:-3000}`. It has no database or provider-key mount. HTTP is intentional here: an existing trusted outer HTTPS proxy owns the public URL and TLS.
- Startup sets a private umask and requires a dedicated writable `/data` mount with mode 700; it refuses to start against an unmounted container directory. The app already restricts the SQLite file to mode 600. The volume points explicitly to `TASTIP_DATA_HOST_DIR` on the known persistent EBS/home filesystem, rather than assuming Docker's own data-root is durable. Prepare that new private directory for UID/GID 1000 before startup.

Standalone output needs a monorepo tracing root and a separate copy of `.next/static`; the Dockerfile retains the generated `apps/web/server.js` path. See the installed Next documentation and [Next standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output). Build inside Linux Docker rather than copying a Mac's `node_modules` or build output.

## Private runtime configuration

Use Docker Engine with Compose 2.30 or newer (`env_file.format: raw` is required). Replace `/absolute/private/tastip-deployment` below with a writable private directory outside the checkout. From the checkout root, prepare a private file outside the checkout and Docker build context:

```sh
umask 077
mkdir -p /absolute/private/tastip-deployment
chmod 700 /absolute/private/tastip-deployment
cp deploy/runtime.env.example /absolute/private/tastip-deployment/runtime.env
chmod 600 /absolute/private/tastip-deployment/runtime.env
export TASTIP_RUNTIME_ENV_FILE=/absolute/private/tastip-deployment/runtime.env
export TASTIP_DATA_HOST_DIR=/absolute/private/tastip-deployment/data
mkdir -p "$TASTIP_DATA_HOST_DIR"
chmod 700 "$TASTIP_DATA_HOST_DIR"
export TASTIP_IMAGE=tastip:reviewed-release
export TASTIP_PROXY_IMAGE=tastip-proxy:reviewed-release
export TASTIP_BIND_PORT=3000
```

Confirm Docker's daemon sees that same persistent host path; a directory visible only to a remote Docker client is insufficient. The data directory must belong to the container's UID/GID 1000. When the host user has that identity, the commands above already create matching ownership. Otherwise, initialize **only the new empty private data directory** with the pinned official runtime image:

```sh
docker run --rm --user 0:0 \
  --mount "type=bind,src=${TASTIP_DATA_HOST_DIR},dst=/data" \
  --entrypoint sh \
  node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c \
  -ec 'test -z "$(ls -A /data)"; chown 1000:1000 /data; chmod 700 /data'
```

This one-off initialization has no environment file or provider keys. Do not recursively chown an existing project, home, deployment or populated database directory. The database and runtime env file remain outside the source checkout and image build context.

Edit that file locally on the server. Set `TASTIP_APP_ORIGIN` to the exact public HTTPS origin, with no trailing slash or path. Production cookies are Secure; account sign-in must be tested through that HTTPS origin rather than through the loopback HTTP inspection URL.

Provider keys belong only in the private runtime file. Leave `TASTIP_ENABLE_HOSTED_PROVIDERS=0` and keys empty for the initial sample-mode smoke test. Authenticated hosted access, request identities and quotas are a separate application release gate. Supplying keys to an image build does not establish that gate. Never use `NEXT_PUBLIC_` for secrets, Docker build arguments for keys, shell tracing, or unredacted `docker compose config` output. `config --quiet` validates without printing resolved runtime values. Runtime environments are visible to host/Docker administrators; protect host access too.

Next evaluates server runtime environment values without requiring secrets in the client bundle; [Next self-hosting](https://nextjs.org/docs/app/guides/self-hosting) describes that boundary. Compose's [runtime env file](https://docs.docker.com/reference/compose-file/services/#env_file) is separate from image construction. `.dockerignore` excludes environment files, private stores, certificates, caches and captures.

## Outer HTTPS proxy

For a trusted outer HTTPS reverse proxy that forwards to this host's loopback listener:

```sh
export TASTIP_FORWARDED_PROTO=https
```

Set this only when the trusted outer edge actually terminates public HTTPS and preserves the public `Host`. Caddy writes that configured scheme upstream rather than trusting an arbitrary incoming `X-Forwarded-Proto`. The default is `http` for private inspection. Keep the Docker host port bound to loopback; changing that binding or adding public TLS is a separate deployment decision. The outer proxy must also pass streaming responses without buffering.

Compose sets `TASTIP_INTERNAL_ORIGIN` to `${TASTIP_FORWARDED_PROTO:-http}://0.0.0.0:3000`, matching Next's normalized request origin from its bind hostname, port and Caddy's trusted forwarded protocol. If those settings change, the explicit internal origin must match exactly. This internal origin does not replace the public HTTPS `TASTIP_APP_ORIGIN`, authenticated owner checks or request limits.

Caddy bounds request bodies to 5 MiB, matching the largest existing JSON import boundary; individual app routes retain smaller limits. Header/body read timeouts bound incomplete requests. `flush_interval 10ms` keeps a short streaming delay without enabling Caddy's negative-interval behavior that keeps upstream requests alive after a client disconnect. Abort at the provider remains best effort. See [Caddy request-body limits](https://caddyserver.com/docs/caddyfile/directives/request_body) and [stream flushing](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#streaming).

No access log or file server is enabled. Operational logs are bounded by Docker's local log driver; do not enable credential/body debug logging. Caddy's admin API and automatic HTTPS are off. Its temporary `/data` is unrelated to the app's persistent volume and contains no application DB. A future direct-TLS setup must provide its own durable Caddy certificate storage.

## Build and validate on the target host

Run the repository checks in local/CI validation with the pinned Bun runtime before release:

```sh
bun install --frozen-lockfile
bun run check
bun run build
```

The target host needs Docker/Compose, not a host Bun installation. The image builder supplies Bun and Node, uses a frozen dependency install and takes no runtime keys:

```sh
docker compose -f deploy/compose.yaml config --quiet
docker compose -f deploy/compose.yaml build --pull web proxy
docker compose -f deploy/compose.yaml run --rm --no-deps proxy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose -f deploy/compose.yaml up -d --no-build
docker compose -f deploy/compose.yaml ps
curl --fail --silent "http://127.0.0.1:${TASTIP_BIND_PORT:-3000}/api/health"
```

A registry-tag lookup or local standalone build is not a successful Docker build. Retain both tested app/proxy release images and their previous tags for rollback. The disposable Linux smoke checks the proxy binary has no file capability and its running container has zero effective/bounding capabilities with `no-new-privileges` enabled.

The health check verifies HTTP liveness and app access to `/data`; it does not prove provider credentials, database capacity, account isolation, backups or the public HTTPS chain. Before considering the release ready:

1. Confirm the app UID and volume permissions:

   ```sh
   docker compose -f deploy/compose.yaml exec web id -u
   docker compose -f deploy/compose.yaml exec web stat -c '%a %u %g' /data
   docker compose -f deploy/compose.yaml exec web node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(":memory:");db.exec("SELECT 1");db.close()'
   ```

2. Inspect container mounts and confirm `/data` is the bind-backed volume targeting the intended persistent host directory, with no environment file in the image. Do not print container environment values into shared logs.
3. Through the actual public HTTPS origin, verify sign-in, account isolation, Save/reload, and persistence after `docker compose restart web`. Confirm static JS/CSS and the globe load.
4. With the scoped provider configuration enabled, test one authenticated Qloo discovery and one streamed reply/Stop action through the full proxy chain. Confirm unauthorized provider calls remain blocked. Do not substitute `/api/health` for this verification.
5. Check the existing primary globe → islands → selected-day schedule flow and return from chat. Verify available memory/disk and a restorable private backup.

Caddy depends on a healthy app at startup. Docker records unhealthy status but does not automatically restart an alive unhealthy process; monitor it and investigate storage/HTTP failures. Restart policies cover process/container exits. Do not scale `web` or mount this SQLite volume into parallel app instances.

## Backup, upgrade and rollback

Before replacing an image, stop writers and copy the complete `/data` directory to a protected backup location, including any WAL/SHM sidecars. Do not copy only `tastip.sqlite` while the app is writing. An EBS volume/snapshot helps host durability but does not replace a tested application backup.

```sh
umask 077
mkdir -p /absolute/private/tastip-deployment/backups
chmod 700 /absolute/private/tastip-deployment/backups
docker compose -f deploy/compose.yaml stop proxy web
docker compose -f deploy/compose.yaml cp web:/data /absolute/private/tastip-deployment/backups/before-release
docker compose -f deploy/compose.yaml start web proxy
```

Use a fresh backup destination per release and test restoring a copy separately. Backups contain private account/session/trip data and must stay outside the checkout and public web roots. Never run `docker compose down --volumes` on the serving instance: it removes the durable store.

For an upgrade, keep the same Compose project name (`tastip`), external runtime file, `TASTIP_DATA_HOST_DIR` and bind-backed volume, build a new immutable release tag, then `up -d --no-build`. A brief restart is expected. For rollback, select the previously tested image and use the same command only after checking database/schema compatibility; otherwise restore the verified pre-upgrade data copy into a separate private recovery volume first. Do not silently launch a fresh empty database or overwrite the serving copy.

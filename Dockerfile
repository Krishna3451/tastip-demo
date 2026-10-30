# syntax=docker/dockerfile:1
# Version + multi-platform manifest digests verified against the official registries.
FROM oven/bun:1.4.0@sha256:5ff609364c049b54eb0ff560ec96319729a972078ef2c755d758f0c6ef89c2d6 AS bun
FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS build
WORKDIR /app
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
ENV NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1
# The context excludes environment files, private databases, caches and captures.
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build
# This workspace currently uses src/app assets; retain a future public directory too.
RUN mkdir -p apps/web/public

FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 PORT=3000 KEEP_ALIVE_TIMEOUT=65000 TASTIP_DATA_DIR=/data
RUN mkdir -p /data /app/apps/web/.next/cache \
    && chown -R node:node /data /app \
    && chmod 700 /data
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
COPY --chmod=0555 deploy/entrypoint.sh /usr/local/bin/tastip-entrypoint
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e 'require("node:fs").accessSync("/data",require("node:fs").constants.W_OK);fetch("http://127.0.0.1:3000/api/health",{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'
ENTRYPOINT ["/usr/local/bin/tastip-entrypoint"]
CMD ["node", "apps/web/server.js"]

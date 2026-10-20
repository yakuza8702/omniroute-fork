# syntax=docker/dockerfile:1
#
# omniroute-fork runtime image
# Assembled from the PREBUILT `omniroute` npm package, pinned; no source compilation. amd64-only.
#
# Why: upstream OmniRoute compiles its image inside Docker (dependency install + Next
# standalone build from a source checkout) and the GitHub release v3.8.52 ships no server
# binary / npm tarball asset,
# only Electron desktop images + source archives. The only prebuilt server channel is the
# npm registry package `omniroute`, so we install exactly that pinned version. No compiler,
# no build toolchain, no source tree in the build context.
#
# Usage:
#   docker build --build-arg VERSION=3.8.52 -t omniroute:3.8.52 .
#
# Runtime contract mirrored from upstream:
#   PORT=20128, HOSTNAME=0.0.0.0, NODE_ENV=production, DATA_DIR=/app/data,
#   OMNIROUTE_MIGRATIONS_DIR=/app/migrations, non-root `node` user, healthcheck, EXPOSE 20128.

FROM node:26-trixie-slim

# Pinned EXACT version — no `^`, no `~`. Required: fail the build early if absent.
ARG VERSION
RUN set -eux; \
    if [ -z "${VERSION}" ]; then \
        echo "ERROR: build-arg VERSION is required (e.g. --build-arg VERSION=3.8.52)" >&2; \
        exit 1; \
    fi

# Upstream ENV contract (no memory/turbopack knobs here: nothing is compiled at build time).
ENV NPM_CONFIG_LEGACY_PEER_DEPS=true \
    NODE_ENV=production \
    PORT=20128 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/app/data \
    OMNIROUTE_MIGRATIONS_DIR=/app/migrations

# Global bin path resolved by the workflow preflight from the package `bin` field
# (npm links unscoped bins at /usr/local/bin/<key>). Default matches the usual link
# location so a plain `docker build` without the arg still works.
ARG OMNIROUTE_BIN=/usr/local/bin/omniroute
ENV OMNIROUTE_BIN=${OMNIROUTE_BIN}

# Install the prebuilt server package from the public npm registry.
# `--omit=dev` is best-effort: global installs normally resolve prod deps only anyway.
RUN set -eux; \
    npm install --global --omit=dev "omniroute@${VERSION}"; \
    npm cache clean --force; \
    rm -rf /root/.npm /tmp/*

# The runtime user must own its own package tree: the CLI (and anything it writes back into
# the install prefix, e.g. caches or self-heal paths) runs as `node`, not root.
RUN set -eux; \
    chown -R node:node /usr/local/lib/node_modules/omniroute

# Runtime data dirs owned by the unprivileged `node` user (uid/gid 1000 in the official image).
# NOTE (ASSUMPTION): /app/migrations is only created so OMNIROUTE_MIGRATIONS_DIR resolves; the
# npm package is expected to bring its own migration files or to receive them via a mounted
# volume at runtime. Nothing is copied or symlinked here because the package layout is not
# verifiable from this repo without compiling/inspecting upstream sources.
RUN set -eux; \
    mkdir -p /app/data /app/migrations; \
    chown -R node:node /app

# The global bin name is discovered at build time (preflight reads the npm `bin` field) and
# exported as OMNIROUTE_BIN; Docker cannot expand variables inside ENTRYPOINT JSON form, so a
# tiny exec wrapper resolves it at runtime and forwards every extra arg unchanged.
RUN set -eux; \
    printf '%s\n' \
        '#!/bin/sh' \
        'set -eu' \
        'exec "${OMNIROUTE_BIN:-/usr/local/bin/omniroute}" "$@"' \
        > /usr/local/bin/docker-entrypoint.sh; \
    chmod 0755 /usr/local/bin/docker-entrypoint.sh; \
    test -x /usr/local/bin/docker-entrypoint.sh

WORKDIR /app
USER node

EXPOSE 20128

# Port-level healthcheck only: the upstream healthcheck.mjs ships inside the compiled image,
# not inside the npm tarball, and no public health route is documented, so we probe a TCP
# connect on the service port (same 20128 the app binds) instead of inventing an HTTP path.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD ["node","-e","const net=require('net');const s=net.connect(Number(process.env.PORT||20128),'127.0.0.1');s.setTimeout(4000);s.on('connect',()=>{s.end();process.exit(0)});s.on('timeout',()=>{s.destroy();process.exit(1)});s.on('error',()=>process.exit(1));"]

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# CMD MUST stay cleared: the base image ships CMD ["node"], which would be appended to the
# ENTRYPOINT and run `omniroute node` ("too many arguments for 'serve'"). An empty CMD lets
# the CLI default-dispatch to `serve`, while `docker run IMAGE <args>` still overrides cleanly.
CMD []

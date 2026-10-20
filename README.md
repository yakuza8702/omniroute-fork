# omniroute-fork — prebuilt Docker images

Assembled from the **prebuilt `omniroute` npm package** (pinned exact version). No compilation
from source. **amd64 only** by design.

## Trigger

Manual only: **Actions → docker-image → Run workflow**. Nothing runs on push, tag or schedule.

| Input | Type | Default | Meaning |
| --- | --- | --- | --- |
| `version` | string | `3.8.52` | npm version; leading `v` stripped (`v3.8.52` → `3.8.52`), validated against `^[0-9A-Za-z][0-9A-Za-z._-]*$` |
| `promote_latest` | boolean | `false` | additionally tag/push `:latest` |

Preflight runs `npm view omniroute@<version> version` (public registry, no auth) and fails if
unpublished, then resolves the package `bin` field into `OMNIROUTE_BIN`.

## Flow — build, gate, then publish

1. Build `linux/amd64` with `push: false` + `load: true` (staged tags in `GH_TAGS`, gha cache).
2. Smoke test the loaded image (poll port 20128 up to ~60s, dump logs on failure).
3. Only after the smoke test passes: `docker push` the staged tags, then write a job summary.

```
ghcr.io/yakuza8702/omniroute-fork:<version>
ghcr.io/yakuza8702/omniroute-fork:latest      # only when promote_latest = true
docker.io/yakuza8702/omniroute:<version>      # optional mirror, only when DH secrets are set
```

GHCR auth uses the built-in `GITHUB_TOKEN`; `:latest` can only become public via `promote_latest`.
**Optional Docker Hub mirror:** add secrets `DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN`; if either is
missing the Docker Hub steps are skipped with a notice and the job still succeeds.

## Runtime contract (mirrors upstream)

`PORT=20128`, `HOSTNAME=0.0.0.0`, `NODE_ENV=production`, `DATA_DIR=/app/data`,
`OMNIROUTE_MIGRATIONS_DIR=/app/migrations`, non-root `node`. Entrypoint `docker-entrypoint.sh`
execs `$OMNIROUTE_BIN` (default `/usr/local/bin/omniroute`) and forwards extra args.

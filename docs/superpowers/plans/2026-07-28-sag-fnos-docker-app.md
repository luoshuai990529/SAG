# SAG fnOS Docker App Implementation Plan

**Goal:** Deliver the x86-only `1.4.0-fnos.1` candidate as a single-port fnOS Docker application.

## Global Constraints

- Branch from `origin/main@06f29b2ae571dfcedecc85577ee6910ed87a810a`.
- Candidate version is `1.4.0-fnos.1`.
- `platform=x86`, `os_min_version=1.2.0302`, and the only host port is `3080`.
- `NEXT_PUBLIC_API_BASE=/` means same-origin access.
- API and Web images publish under `ghcr.io/luoshuai990529/` and release packaging must use immutable digests.
- Active data is the complete `/data` tree; backups must never cover only SQLite.
- No secrets, model credentials, or weak development keys may be committed.

### Task 1: Same-origin Web and single-entry Compose

- Use TDD for Web behavior: add a focused test proving `NEXT_PUBLIC_API_BASE=/` resolves to an empty base so `/api/...` remains same-origin, while the existing local/LAN fallback behavior remains unchanged.
- Refactor only as needed to make URL resolution testable; do not change REST, SSE, or MCP wire formats.
- Add `compose.fnos.yaml`, `.env.fnos.example`, and `deploy/fnos/nginx.conf`.
- Compose must define `api`, `web`, and `gateway`; only gateway maps `3080:80`. API and Web must have health checks and no host ports.
- Gateway must route `/` to Web and `/api/` plus `/mcp/` to API, preserve Host and forwarding headers, use HTTP/1.1, disable buffering for streamed API traffic, allow 25 MB uploads, and use 600-second proxy timeouts.
- Production API values: prod environment, debug false, required strong secret, empty CORS list, registration false, `/data` persistence, job concurrency 1, extraction concurrency 2, cache 4, warmup 1.
- Run the focused red/green Web test, all Web checks, and `docker compose -f compose.fnos.yaml config` with safe test environment values.
- Commit the task.

### Task 2: GHCR image release and immutable validation

- Add a GitHub Actions workflow manually dispatched with candidate version `1.4.0-fnos.1`.
- Build API and Web for `linux/amd64,linux/arm64` using Buildx and push to `ghcr.io/luoshuai990529/sag-api` and `sag-web` with candidate and commit-SHA tags.
- Build the Web image with `NEXT_PUBLIC_API_BASE=/`.
- Add amd64 runtime smoke checks for API readiness and Web root; inspect the published multi-architecture manifests.
- Add an executable validation script and behavior tests. It must reject `latest`, `build:`, weak development secrets, API/Web host ports, and non-digest image references in release package Compose.
- Run tests and workflow syntax/static validation; commit the task.

### Task 3: fnOS Docker package and lifecycle

- Create `packages/fnos/sag/` from the official Docker shape with manifest, resources, privileges, UI entry, icons, Compose, Nginx config, lifecycle scripts, and uninstall wizard.
- Manifest values are `appname=sag`, `version=1.4.0-fnos.1`, `platform=x86`, `os_min_version=1.2.0302`, `service_port=3080`, `checkport=true`, and `ctl_stop=true`.
- Package Compose uses digest-only API, Web, and Nginx image references, exposes only `${TRIM_SERVICE_PORT}:80`, reads `${TRIM_PKGETC}/sag.env`, and mounts `${TRIM_PKGVAR}/data` to `/data`.
- Install callback idempotently creates config/data/backup directories and a mode-0600 64-hex-character secret without overwriting an existing secret.
- Status returns running only when gateway is running/healthy and API reports healthy. User-visible errors go to `TRIM_TEMP_LOGFILE`.
- Upgrade creates an atomic full-data cold backup after checking free space; insufficient space aborts before modifying data.
- Uninstall defaults to retaining data and deletes it only after explicit wizard selection. Add deterministic retained-data fallback documentation because final fnOS cleanup semantics require device verification.
- Add executable lifecycle behavior tests using temporary fake TRIM paths and fake docker commands, then run `fnpack build`.
- Commit the task.

### Task 4: Documentation, acceptance matrix, and final verification

- Add Mac preparation, Windows VMware port-forwarding, fnOS installation/upgrade/backup/recovery/troubleshooting, and an evidence-oriented acceptance matrix under `docs/fnos/`.
- Record actual Mac versions and fnpack SHA-256. State that `appcenter-cli` runs on fnOS, not macOS.
- Record current test addresses separately from configurable examples.
- State candidate boundaries: x86 VMware only; public GHCR and internet required; real x86 and ARM64 devices plus App Center publication are future gates.
- Run API Ruff/pytest, all Web checks/build, package validation, Compose config, shell syntax checks, `fnpack build`, and SHA-256 generation.
- Review the full diff against every global constraint and commit the task.

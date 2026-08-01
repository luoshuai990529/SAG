# SAG fnOS No-Auth Single-User Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver `1.4.0-fnos.4` as a no-authentication single-user fnOS application where username is collected only for an empty database.

**Architecture:** Add a dedicated backend `single_user` mode that resolves every request to the singleton user without credentials. The Web uses a session/bootstrap endpoint only to distinguish an empty database from an initialized one; fnOS packaging removes bootstrap credentials while retaining an invisible random session secret for compatibility.

**Tech Stack:** FastAPI, SQLAlchemy async, Next.js 15, TypeScript, Docker Compose, Nginx, fnpack, Node test runner, pytest.

## Global Constraints

- Work only on `feat/fnos-docker-app`; never merge this branch back to `main`.
- Version every package artifact as `1.4.0-fnos.4`.
- Expose only host port `3080`.
- Preserve existing `/data` and the first existing User record.
- Never require or emit a user-facing password, bootstrap token, or login token.
- Keep API/Web/Nginx images pinned by immutable public digest in the FPK.

---

### Task 1: Backend singleton session contract

**Files:**
- Modify: `apps/api/sag_api/core/config.py`
- Modify: `apps/api/sag_api/schemas/auth.py`
- Modify: `apps/api/sag_api/services/auth_service.py`
- Modify: `apps/api/sag_api/api/v1/auth.py`
- Modify: `apps/api/sag_api/core/deps.py`
- Test: `apps/api/tests/test_single_user_no_auth.py`

**Interfaces:**
- Produces: `GET /api/v1/auth/session`, `POST /api/v1/auth/session`, and credential-free `get_current_user` behavior when `SAG_AUTH_MODE=single_user`.

- [ ] Write API tests proving an empty database reports setup required, a username creates one user, an existing database returns that user without input, and protected APIs accept no or invalid Bearer credentials.
- [ ] Run the focused pytest file and confirm failures are caused by the missing `single_user` mode and session routes.
- [ ] Add `single_user` to the auth mode setting, implement singleton read/create with the existing unique constraint, and implement session response schemas/routes.
- [ ] Make `get_current_user` resolve the singleton directly in `single_user` mode while preserving existing behavior in `legacy` and `password` modes.
- [ ] Run focused and full auth tests, then commit the backend behavior.

### Task 2: Web first-use setup without login

**Files:**
- Modify: `apps/web/middleware.ts`
- Modify: `apps/web/app/(auth)/login/page.tsx`
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/lib/auth.ts`
- Modify: `apps/web/messages/zh-CN.json`
- Modify: `apps/web/messages/en-US.json`
- Test: `apps/web/lib/login.test.ts`
- Test: `apps/web/lib/auth.test.ts`

**Interfaces:**
- Consumes: session GET/POST routes from Task 1.
- Produces: first-use name setup and direct entry for every initialized browser without token storage.

- [ ] Write Web tests proving requests do not require a stored token and session payloads contain only the optional display name.
- [ ] Run focused Web tests and confirm they fail against the token/login implementation.
- [ ] Remove cookie route guarding and 401 token redirects, add session API methods, and change the login page into an automatic first-use setup page.
- [ ] Remove password/bootstrap copy and fields; retain localized “怎么称呼你” first-use copy.
- [ ] Run Web unit tests, typecheck, lint, and production build, then commit the Web behavior.

### Task 3: fnOS lifecycle and package configuration

**Files:**
- Modify: `packages/fnos/sag/app/docker/docker-compose.yaml`
- Modify: `compose.fnos.yaml`
- Modify: `packages/fnos/sag/cmd/prepare_compose_env`
- Delete: `packages/fnos/sag/cmd/auth_reset`
- Modify: `packages/fnos/sag/manifest`
- Modify: `.env.fnos.example`
- Test: `scripts/tests/fnos-lifecycle.test.mjs`
- Test: `scripts/tests/fnos-package.test.mjs`
- Test: `scripts/tests/fnos-auth-boundary.test.mjs`

**Interfaces:**
- Produces: `SAG_AUTH_MODE=single_user`, a one-line `sag.env` containing only `SAG_SECRET_KEY`, and version `1.4.0-fnos.4`.

- [ ] Change package tests to require `single_user`, reject bootstrap/password configuration, preserve an existing one-line session secret, and require version `1.4.0-fnos.4`.
- [ ] Run focused Node tests and confirm failures describe the old password/bootstrap package behavior.
- [ ] Simplify environment generation to one random `SAG_SECRET_KEY`, remove auth reset packaging, update Compose and Manifest.
- [ ] Run fnOS lifecycle, package, auth-boundary, release validation, shell, JSON, and Compose checks.
- [ ] Commit the fnOS package changes.

### Task 4: Release images and FPK

**Files:**
- Create: `docs/fnos/releases/1.4.0-fnos.4.md`
- Create: `docs/fnos/evidence/2026-08-02/1.4.0-fnos.4/summary.md`
- Generate: `dist/fnos/sag-1.4.0-fnos.4.fpk`
- Generate: `dist/fnos/sag-1.4.0-fnos.4.fpk.sha256`

**Interfaces:**
- Consumes: verified source commits and public API/Web image digests.
- Produces: an installable x86 fnOS FPK and its user-facing change summary.

- [ ] Run full API and Web verification plus all fnOS Node tests.
- [ ] Commit and push the verified source, create the exact fnOS candidate tag, and run the GHCR candidate workflow.
- [ ] Verify anonymous API/Web digest pulls and amd64 runtime health.
- [ ] Build the FPK with the published digests and the reviewed Nginx digest; run official fnpack tests.
- [ ] Compute SHA-256, record exact commits/digests/tests/known limitations, and provide the package with upgrade and experience instructions.

# SAG fnOS Restore Launch Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the main-branch “退出到启动页” experience in the fnOS single-user package without deleting SAG knowledge data.

**Architecture:** Keep main’s two immediate, no-confirmation UI entry points: the sidebar identity menu and local-identity settings. In `single_user` mode their shared logout handler calls a new session-reset endpoint, which clears only the singleton record’s display name; the next route load sees `setup_required` and shows the existing launch page. Retaining the record preserves every foreign-key relationship to knowledge data.

**Tech Stack:** FastAPI, SQLAlchemy async, Next.js 15, TypeScript, Vitest, pytest, fnpack.

## Global Constraints

- Work on `feat/fnos-restore-launch-page`, based on `fork/feat/fnos-docker-app`.
- Produce exactly one final commit, intended for later merge into `feat/fnos-docker-app`.
- Deliver the upgrade package as `1.4.0-fnos.5`.
- Do not modify `main` or the original fnOS worktree.
- Preserve all non-`users` `/data` records: knowledge sources, documents, uploads, index data, threads, and settings.
- Preserve the main branch’s UI wording, destructive styling, and no-confirmation interaction.
- The reset API must be inert outside `SAG_AUTH_MODE=single_user`.

---

### Task 1: Single-user reset API

**Files:**
- Modify: `apps/api/sag_api/services/auth_service.py`
- Modify: `apps/api/sag_api/api/v1/auth.py`
- Test: `apps/api/tests/test_single_user_no_auth.py`

**Interfaces:**
- Produces `DELETE /api/v1/auth/session` returning HTTP 204 in `single_user` mode.
- Produces a subsequent `GET /api/v1/auth/session` result of `{ "setup_required": true, "user": null }` while retaining the original User row and ID.

- [x] **Step 1: Write a failing API test.**

```python
reset = await client.delete("/api/v1/auth/session")
after_reset = await client.get("/api/v1/auth/session")

assert reset.status_code == 204
assert after_reset.json() == {"setup_required": True, "user": None}
assert await client.get("/protected") == 401
assert (await client.post("/api/v1/auth/session", json={"name": "Grace"})).json()["user"]["id"] == created_user["id"]
```

- [x] **Step 2: Run the focused test and verify it fails because DELETE is not implemented.**

Run: `uv run pytest apps/api/tests/test_single_user_no_auth.py -q`

- [x] **Step 3: Add the smallest service and route implementation.**

```python
async def reset_single_user(session: AsyncSession) -> None:
    user = await _first_user(session)
    if user is None:
        return
    user.name = ""
    await session.commit()
```

The route rejects non-`single_user` mode and returns `Response(status_code=204)` on success.

- [x] **Step 4: Re-run the focused API test.**

Run: `uv run pytest apps/api/tests/test_single_user_no_auth.py -q`

### Task 2: Reintroduce main’s UI interaction and hook it to the reset API

**Files:**
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/components/features/app-shell.tsx`
- Modify: `apps/web/components/features/app-sidebar.tsx`
- Modify: `apps/web/components/features/account-settings.tsx`
- Test: `apps/web/lib/api-base.test.ts`

**Interfaces:**
- Produces `api.resetSingleUser(): Promise<void>` using `DELETE /api/v1/auth/session`.
- Produces `logout(): Promise<void>` in `AppContext`, redirecting to `/login` only after API reset succeeds.

- [x] **Step 1: Write a failing API-client test proving the reset uses DELETE on the session endpoint.**

```ts
await api.resetSingleUser();
expect(fetch).toHaveBeenCalledWith(
  expect.stringContaining("/api/v1/auth/session"),
  expect.objectContaining({ method: "DELETE" }),
);
```

- [x] **Step 2: Run the focused Web test and verify it fails because `resetSingleUser` is missing.**

Run: `npm run test:unit -- lib/api-base.test.ts`

- [x] **Step 3: Add the API-client method and restore main’s two buttons.**

Use `LogOut`, `SettingsRow`, and `Button` in `AccountSettings`; use a destructive `DropdownMenuItem` in `NavUser`; make both invoke the shared context logout callback.

- [x] **Step 4: Change the fnOS logout callback to call `api.resetSingleUser()` and then `router.replace("/login")`.**

The callback must leave the user in place if the request fails.

- [x] **Step 5: Re-run unit tests, then typecheck and lint.**

Run: `npm run test:unit -- lib/api-base.test.ts && npm run typecheck && npm run lint`

### Task 3: Verify package version and produce one mergeable commit

**Files:**
- Modify: `docs/superpowers/plans/2026-08-03-fnos-restore-launch-page.md`
- Generate: fnOS FPK artifact after source verification.

- [x] **Step 1: Run API and Web verification.**

Run: `uv run pytest apps/api/tests/test_single_user_no_auth.py -q && npm run test:unit && npm run typecheck && npm run lint && npm run build`

- [ ] **Step 2: Build the existing fnOS package using its documented packaging command after the one source commit is merged into `feat/fnos-docker-app` and its GHCR candidate images are published.**

Record the exact artifact path and SHA-256 in the final handoff.

- [ ] **Step 3: Create one commit containing source, regression tests, and this plan.**

Run: `git add -- apps/api apps/web docs/superpowers/plans/2026-08-03-fnos-restore-launch-page.md && git commit -m "feat(fnos): restore launch-page exit"`

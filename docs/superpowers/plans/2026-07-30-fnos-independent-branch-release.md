# fnOS Independent Branch Candidate Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish SAG `1.4.0-fnos.1` from the permanent `feat/fnos-docker-app` branch as public multi-platform GHCR images, build a digest-pinned `.fpk`, and validate it on the x86-64 fnOS VM without changing `main`.

**Architecture:** Normal pushes run CI directly on the permanent fnOS branch. An immutable Tag formed as `fnos-candidate-${version}-${revision:0:12}` and pointing at the exact remote branch HEAD triggers the only package-writing workflow; that workflow validates the Tag before registry writes, publishes staging indexes, smokes captured digests, promotes immutable candidate references, makes both packages public, and proves anonymous access. The Mac then builds the `.fpk` from the captured API/Web digests and the reviewed Nginx digest before device lifecycle validation.

**Tech Stack:** GitHub Actions, Node.js `node:test`, Docker Buildx, GHCR, fnpack 1.2.3, fnOS Docker Compose application packaging.

## Global Constraints

- The long-lived release branch is exactly `feat/fnos-docker-app` and must never merge into `main`.
- The candidate version is exactly `1.4.0-fnos.1`.
- Candidate Tags use `fnos-candidate-1.4.0-fnos.1-${revision:0:12}`, where `revision` is the lowercase 40-character candidate commit.
- A candidate Tag must resolve to the exact remote `feat/fnos-docker-app` HEAD before any job receives `packages: write`.
- The fnOS application exposes only port `3080`; API port `8000` and Web port `3000` remain internal.
- Final Compose images use manifest-list digests; `latest`, mutable image references, and `build:` are forbidden.
- API and Web publish `linux/amd64,linux/arm64`; the candidate `.fpk` declares only `platform=x86`.
- Normal CI has no package-write permission; only staging, promotion, and package-visibility jobs may request the minimum package-write permission.
- Model credentials, GHCR credentials, and user data must not enter Git, Actions artifacts, logs, or `.fpk` content.
- `origin/main` must remain at its observed baseline unless changed externally; this work must not push or merge it.

---

### Task 1: Make the release trigger and branch gate executable

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/fnos-image-release.yml`
- Modify: `scripts/tests/fnos-release-workflow.test.mjs`

**Interfaces:**
- Consumes: `packages/fnos/sag/manifest` keys `appname` and `version`.
- Produces: candidate job outputs `version`, `revision`, and `staging_tag`; all later release jobs consume those exact outputs.

- [ ] **Step 1: Write failing workflow policy tests**

Add assertions proving:

```js
assert.match(ci, /branches:\s*\[main, dev, feat\/fnos-docker-app\]/);
assert.match(workflow, /tags:\s*\n\s*- "fnos-candidate-\*"/);
assert.doesNotMatch(workflow, /workflow_dispatch|refs\/heads\/main|\binputs\./);
assert.match(workflow, /group: fnos-candidate-\$\{\{ github\.repository \}\}/);
assert.match(candidate, /git ls-remote --heads origin feat\/fnos-docker-app/);
assert.match(candidate, /expected_tag="fnos-candidate-\$\{version\}-\$\{GITHUB_SHA:0:12\}"/);
assert.match(candidate, /test "\$GITHUB_REF_NAME" = "\$expected_tag"/);
assert.match(candidate, /revision: \$\{\{ steps\.metadata\.outputs\.revision \}\}/);
```

Also assert that `candidate` has no `packages` permission, package-writing jobs depend directly or transitively on `candidate`, and all checkout/build labels/commit tags use `needs.candidate.outputs.revision` rather than an unvalidated ref.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
node --test scripts/tests/fnos-release-workflow.test.mjs
```

Expected: failure because the workflow still uses `workflow_dispatch`, `refs/heads/main`, and CI does not listen to the dedicated branch.

- [ ] **Step 3: Implement the immutable Tag gate**

Change CI push branches to:

```yaml
branches: [main, dev, feat/fnos-docker-app]
```

Change the release trigger and concurrency to:

```yaml
on:
  push:
    tags:
      - "fnos-candidate-*"

concurrency:
  group: fnos-candidate-${{ github.repository }}
  cancel-in-progress: false
```

Make `candidate` the first job. Its checkout uses `${{ github.sha }}` with full history, fetches the remote dedicated branch, verifies the manifest, verifies annotated or lightweight Tag resolution equals checkout HEAD, verifies the remote branch HEAD equals checkout HEAD, constructs the exact expected Tag, and emits:

```text
version=1.4.0-fnos.1
revision=${GITHUB_SHA}
staging_tag=staging-fnos-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${GITHUB_SHA:0:12}
```

Make reusable `quality` depend on `candidate`, and update every release job to check out and label `needs.candidate.outputs.revision`.

- [ ] **Step 4: Run the focused test and verify pass**

Run:

```bash
node --test scripts/tests/fnos-release-workflow.test.mjs
```

Expected: all workflow policy tests pass.

- [ ] **Step 5: Commit the trigger and branch gate**

```bash
git add .github/workflows/ci.yml .github/workflows/fnos-image-release.yml scripts/tests/fnos-release-workflow.test.mjs
git commit -m "ci: release fnOS candidates from dedicated branch"
```

### Task 2: Publish packages publicly and prove anonymous digest access

**Files:**
- Modify: `.github/workflows/fnos-image-release.yml`
- Modify: `scripts/fnos-release-registry.mjs`
- Modify: `scripts/tests/fnos-release-workflow.test.mjs`
- Modify: `scripts/tests/fnos-release-registry.test.mjs`

**Interfaces:**
- Consumes: `candidate.version`, `candidate.revision`, `inspect-staging.api_digest`, and `inspect-staging.web_digest`.
- Produces: an anonymous postcheck that validates candidate tags and exact API/Web digest indexes without `docker/login-action`.

- [ ] **Step 1: Write failing public-access tests**

Add workflow assertions proving:

```js
assert.match(job(workflow, "publicize"), /packages: write/);
assert.match(job(workflow, "anonymous-postcheck"), /needs: \[candidate, inspect-staging, publicize\]/);
assert.doesNotMatch(job(workflow, "anonymous-postcheck"), /docker\/login-action|GITHUB_TOKEN/);
assert.match(job(workflow, "anonymous-postcheck"), /fnos-release-registry\.mjs verify-public/);
```

Add registry helper tests whose fake Docker proves `verify-public`:

- resolves both `image:1.4.0-fnos.1` tags;
- requires their digests to equal the captured digests;
- inspects both `image@digest` references as indexes containing `linux/amd64` and `linux/arm64`;
- fails on unauthorized, missing, digest mismatch, or missing platform.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
node --test scripts/tests/fnos-release-workflow.test.mjs scripts/tests/fnos-release-registry.test.mjs
```

Expected: failure because `publicize`, `anonymous-postcheck`, and `verify-public` do not exist.

- [ ] **Step 3: Implement public visibility and anonymous verification**

Add `verify-public` to `scripts/fnos-release-registry.mjs` with required arguments:

```text
--docker
--api-image
--web-image
--candidate-version
--api-digest
--web-digest
```

It must reuse exact digest parsing and multi-platform index validation, inspect the candidate tags before exact digests, and fail closed for every registry error.

Add a `publicize` job after `promote` that uses the GitHub REST API with `GITHUB_TOKEN` to set both user-owned container packages to Public:

```bash
gh api --method PATCH /user/packages/container/sag-api -f visibility=public
gh api --method PATCH /user/packages/container/sag-web -f visibility=public
```

Add `anonymous-postcheck` after `publicize`; do not log in to GHCR and call `verify-public` with the captured digests.

- [ ] **Step 4: Run focused tests and verify pass**

Run:

```bash
node --test scripts/tests/fnos-release-workflow.test.mjs scripts/tests/fnos-release-registry.test.mjs
```

Expected: all workflow and registry state-machine tests pass.

- [ ] **Step 5: Commit public package verification**

```bash
git add .github/workflows/fnos-image-release.yml scripts/fnos-release-registry.mjs scripts/tests/fnos-release-workflow.test.mjs scripts/tests/fnos-release-registry.test.mjs
git commit -m "ci: verify public fnOS candidate images"
```

### Task 3: Align operator documentation and acceptance evidence

**Files:**
- Modify: `docs/fnos/install-and-network.md`
- Modify: `docs/fnos/README.md`
- Modify: `docs/fnos/acceptance-matrix.md`
- Modify: `docs/SAG-fnOS-Docker应用改造说明-2026-07-30-1048.md`
- Modify: `docs/fnos/evidence/2026-07-30/ci-02/summary.md`
- Modify: `scripts/tests/fnos-docs.test.mjs`

**Interfaces:**
- Consumes: the exact Tag format and workflow job order implemented in Tasks 1–2.
- Produces: operator commands for branch CI, candidate Tag creation, GHCR verification, and FPK build evidence.

- [ ] **Step 1: Write failing documentation boundary tests**

Add assertions that operational documents mention:

```text
feat/fnos-docker-app
fnos-candidate-1.4.0-fnos.1-${revision:0:12}
关闭 PR #1，不合并
匿名
verified-digests
```

Also reject instructions that say the candidate workflow is manually dispatched from `main`.

- [ ] **Step 2: Run the documentation test and verify failure**

Run:

```bash
node --test scripts/tests/fnos-docs.test.mjs
```

Expected: failure because installation and acceptance documents still describe the old `main`/manual-dispatch process.

- [ ] **Step 3: Update the operational handoff**

Document this exact operator sequence:

```bash
git push origin feat/fnos-docker-app
git tag "fnos-candidate-1.4.0-fnos.1-$(git rev-parse --short=12 HEAD)"
git push origin "fnos-candidate-1.4.0-fnos.1-$(git rev-parse --short=12 HEAD)"
```

Explain that the Tag is created only after remote dedicated-branch CI succeeds, PR #1 is closed without merge, `main` remains untouched, package visibility is automated, anonymous checks are mandatory, and the `verified-digests` artifact feeds the FPK builder. Mark GHCR/FPK/device rows as pending until real external evidence exists.

- [ ] **Step 4: Run documentation and release-safety tests**

Run:

```bash
node --test scripts/tests/fnos-docs.test.mjs scripts/tests/fnos-release-workflow.test.mjs scripts/tests/fnos-release-registry.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit the dedicated-branch handoff**

```bash
git add docs scripts/tests/fnos-docs.test.mjs
git commit -m "docs: hand off dedicated fnOS candidate releases"
```

### Task 4: Validate, publish the dedicated branch, and trigger the candidate

**Files:**
- Create after the run: `docs/fnos/evidence/2026-07-30/ci-03/summary.md`
- Modify after the run: `docs/fnos/acceptance-matrix.md`

**Interfaces:**
- Consumes: committed workflow and documentation from Tasks 1–3.
- Produces: a green dedicated-branch CI run, a closed unmerged PR #1, an immutable candidate Tag, a successful candidate-image run, and captured API/Web digests.

- [ ] **Step 1: Run the complete local release-safety suite**

Run:

```bash
SAG_FNPACK_TESTS=0 node --test scripts/tests/*.test.mjs
```

Expected: all non-fnpack tests pass with only the explicitly gated official-fnpack test skipped.

- [ ] **Step 2: Run API and Web regression gates**

Run:

```bash
cd apps/api && ruff check sag_api/ sag_agent/ tests/ && python -m pytest -q
cd apps/web && npm run test:unit && npx tsc --noEmit && npm run lint && npm run build
```

Expected: Ruff, all API tests, Web unit tests, TypeScript, ESLint, and production build pass.

- [ ] **Step 3: Verify branch isolation and push**

Record:

```bash
git fetch origin
git rev-parse origin/main
git status --short
git push origin feat/fnos-docker-app
```

Expected: `origin/main` remains unchanged by this work, the worktree is clean, and the dedicated branch push succeeds.

- [ ] **Step 4: Wait for dedicated-branch CI and close PR #1**

Use GitHub Actions to confirm all jobs for the pushed dedicated-branch SHA succeed. Close PR #1 without merging, then verify the remote branch remains and `origin/main` has not changed because of this operation.

- [ ] **Step 5: Create and push the exact candidate Tag**

After verifying remote branch HEAD equals local HEAD:

```bash
revision="$(git rev-parse HEAD)"
test "$revision" = "$(git rev-parse origin/feat/fnos-docker-app)"
candidate_tag="fnos-candidate-1.4.0-fnos.1-${revision:0:12}"
git tag "$candidate_tag" "$revision"
git push origin "$candidate_tag"
```

Expected: one candidate workflow run starts from that exact Tag.

- [ ] **Step 6: Wait for candidate images and capture evidence**

Confirm every job succeeds, download `fnos-verified-digests-*`, verify the API/Web digest format, and anonymously run:

```bash
docker buildx imagetools inspect ghcr.io/luoshuai990529/sag-api:1.4.0-fnos.1
docker buildx imagetools inspect ghcr.io/luoshuai990529/sag-web:1.4.0-fnos.1
```

Record the run URL, revision, Tag, digests, platform list, and redacted log summary in `ci-03/summary.md`.

- [ ] **Step 7: Commit external CI and GHCR evidence**

```bash
git add docs/fnos/evidence/2026-07-30/ci-03/summary.md docs/fnos/acceptance-matrix.md
git commit -m "docs: record dedicated fnOS image release"
git push origin feat/fnos-docker-app
```

### Task 5: Build the digest-pinned FPK and validate the fnOS VM

**Files:**
- Create: `dist/fnos/sag-1.4.0-fnos.1.fpk`
- Create: `dist/fnos/sag-1.4.0-fnos.1.fpk.sha256`
- Create: `docs/fnos/evidence/2026-07-30/fpk-01/summary.md`
- Create during device work: evidence summaries under `docs/fnos/evidence/2026-07-30/`
- Modify: `docs/fnos/acceptance-matrix.md`

**Interfaces:**
- Consumes: public exact API/Web digests from Task 4 and the reviewed Nginx manifest-list digest.
- Produces: a SHA-256-verified x86 fnOS package plus lifecycle evidence for FPK, BIZ, DATA, UPG, UN, PERF, and network rows.

- [ ] **Step 1: Build the official package**

Download the `verified-digests.json` artifact into the repository root, then run:

```bash
api_digest="$(node -p "require('./verified-digests.json').api_digest")"
web_digest="$(node -p "require('./verified-digests.json').web_digest")"
node scripts/build-fnos-package.mjs \
  --api-image "ghcr.io/luoshuai990529/sag-api@${api_digest}" \
  --web-image "ghcr.io/luoshuai990529/sag-web@${web_digest}" \
  --nginx-image "docker.io/library/nginx:1.30.4-alpine@sha256:97d490f73c2f3bdf3cbb4f4f08f0f9e7f464c45b48ebf4c65942694c2ec5b31b" \
  --output dist/fnos/sag-1.4.0-fnos.1.fpk
```

The command must use verified `fnpack 1.2.3`; substitute only the actual captured digest strings, never a tag.

- [ ] **Step 2: Verify package checksum and structure**

Run:

```bash
shasum -a 256 dist/fnos/sag-1.4.0-fnos.1.fpk
shasum -a 256 -c dist/fnos/sag-1.4.0-fnos.1.fpk.sha256
SAG_FNPACK_TESTS=1 node --test scripts/tests/fnos-package.test.mjs
```

Expected: checksum verification succeeds, all official-fnpack package tests pass, and rendered Compose contains only three digest-pinned images with gateway host port `3080`.

- [ ] **Step 3: Configure and verify the network path**

Configure Windows VMware NAT `3080 -> 192.168.252.10:3080` and a firewall rule limited to `192.168.50.0/24`. From the Mac, confirm `http://192.168.50.178:3080` is inaccessible before installation and becomes reachable only after SAG starts.

- [ ] **Step 4: Validate installation and normal operation**

In fnOS App Center, install the `.fpk`, open the desktop entry, initialize the first password user without model credentials, then privately add model/embedding credentials. Validate Markdown/PDF upload, indexing, retrieval, SSE answers, citation opening, MCP URL, and forwarded headers.

- [ ] **Step 5: Validate lifecycle and data guarantees**

Verify application stop/start, container recreation, fnOS reboot, complete stopped cold backup and restore, `1.4.0-fnos.0 -> 1.4.0-fnos.1`, simulated failed upgrade rollback, default-retain uninstall/reinstall recovery, explicit-delete uninstall, and no OOMKilled in the 4 GB profile.

- [ ] **Step 6: Record device evidence and commit**

For every acceptance row, record execution date, fnOS version, package checksum, test result, redacted log summary, and screenshot path. Do not mark a row complete without real device evidence.

```bash
git add docs/fnos/evidence docs/fnos/acceptance-matrix.md
git commit -m "docs: record fnOS candidate lifecycle acceptance"
git push origin feat/fnos-docker-app
```

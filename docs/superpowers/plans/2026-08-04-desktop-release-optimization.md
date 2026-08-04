# Desktop Release Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make desktop-release phase timing and binary-download cache behavior measurable while preserving existing release safety.

**Architecture:** Retain every release step and add only platform-scoped disposable caches for Electron downloads plus phase timing summaries. A Node contract test reads the workflow before it is dispatched.

**Tech Stack:** GitHub Actions YAML, `actions/cache`, Node.js test runner, Bash, PowerShell.

## Global Constraints

- Preserve `npm ci`, `uv sync --frozen --extra desktop`, native builds, signing, notarization, installer verification, update metadata, checksums, and immutable-release creation.
- Cache only Electron/electron-builder download directories; never cache `node_modules`, `.venv`, PyInstaller paths, release artifacts, certificates, or notarization output.
- Cache keys include platform, architecture, Node major version, and desktop lockfile hash.
- Cache misses and cache-service errors retain the existing installation/build path.
- Timing writes to `GITHUB_STEP_SUMMARY` must not mask a failed build command.
- Do not claim improved timing before two successful GitHub Actions runs provide cold- and warm-cache data.
- Fork E2E is permitted only for `workflow_dispatch` with `vars.DESKTOP_RELEASE_E2E == 'true'`; fork tag pushes and the upstream-only `publish` job remain blocked.

---

### Task 1: Add a failing workflow-contract test

**Files:**

- Create: `scripts/tests/desktop-release-workflow.test.mjs`
- Modify: `.github/workflows/desktop-release.yml`

**Interfaces:**

- Consumes: `.github/workflows/desktop-release.yml` as UTF-8 text.
- Produces: `node --test scripts/tests/desktop-release-workflow.test.mjs`.

- [ ] **Step 1: Write the failing test**

```js
test('uses platform-scoped Electron caches without caching build outputs', () => {
  assert.match(workflow, /name: Cache Electron build downloads/);
  assert.match(workflow, /runner\\.os.*runner\\.arch.*node-22/);
  assert.doesNotMatch(workflow, /apps\\/desktop\\/node_modules/);
  assert.doesNotMatch(workflow, /apps\\/api\\/\\.venv/);
  assert.doesNotMatch(workflow, /apps\\/api\\/build\\/pyinstaller/);
});

test('allows an explicitly enabled fork E2E without allowing fork publication', () => {
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'.*vars\.DESKTOP_RELEASE_E2E == 'true'/);
  assert.match(workflow, /if: github\.repository == 'Zleap-AI\/SAG' && github\.event_name == 'push'/);
});
```

- [ ] **Step 2: Verify the test fails for the intended reason**

Run: `node --test scripts/tests/desktop-release-workflow.test.mjs`

Expected: FAIL because the cache step is absent.

- [ ] **Step 3: Add the smallest workflow cache and observability implementation**

Add platform-aware cache steps before dependency installation, grouped timing around existing commands, and final job summaries. Keep original commands and checks intact.

- [ ] **Step 4: Verify the contract test passes**

Run: `node --test scripts/tests/desktop-release-workflow.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/desktop-release.yml scripts/tests/desktop-release-workflow.test.mjs
git commit -m "ci: measure and cache desktop release builds"
```

### Task 2: Validate workflow syntax and release safety

**Files:**

- Modify: `.github/workflows/desktop-release.yml` only if validation finds a concrete defect.
- Test: `scripts/tests/desktop-release-workflow.test.mjs`, `scripts/tests/release-public.test.mjs`.

**Interfaces:**

- Consumes: final workflow YAML and existing release-boundary tests.
- Produces: a locally validated workflow diff ready for manual Actions execution.

- [ ] **Step 1: Run Action workflow linter**

Run: `command -v actionlint || npx --yes actionlint@latest .github/workflows/desktop-release.yml`

Expected: zero syntax/schema errors; if unavailable, report that limitation.

- [ ] **Step 2: Run workflow contract test**

Run: `node --test scripts/tests/desktop-release-workflow.test.mjs`

Expected: PASS.

- [ ] **Step 3: Run existing release boundary test**

Run: `node --test scripts/tests/release-public.test.mjs`

Expected: PASS.

- [ ] **Step 4: Inspect final diff for removed release guards**

Run: `git diff v1.5.0...HEAD -- .github/workflows/desktop-release.yml`

Expected: timing/cache additions only; no removed signing, notarization, installer validation, artifact, checksum, or publish checks.

### Task 3: Produce comparable GitHub Actions evidence

**Files:**

- Modify: none locally.
- Evidence: two `workflow_dispatch` runs from the fork branch and their job summaries.

**Interfaces:**

- Consumes: pushed fork branch and valid fork secrets/environment access.
- Produces: cold- and warm-cache evidence with exact phase durations.

- [ ] **Step 1: Push the branch to the fork**

Run: `git push -u fork agent/desktop-release-optimization`

Expected: branch is visible in the fork.

- [ ] **Step 2: Configure the fork E2E environment and run desktop-release once**

Configure the fork's `desktop-release` Environment with `APPLE_CERTIFICATE_BASE64`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`; set repository variable `DESKTOP_RELEASE_E2E=true`; then manually dispatch the workflow from `agent/desktop-release-optimization`.

Expected: all CI, macOS signing/notarization, Windows installer, and artifact checks pass; retain its summaries as cold-cache evidence.

- [ ] **Step 3: Run desktop-release a second time from the identical commit**

Expected: the same checks pass; retain its summaries as warm-cache evidence.

- [ ] **Step 4: Compare measured results**

Use the fixed baseline: macOS 18m08s, Windows 11m30s, quality gate 1m50s, publish 37s. Report duration and percentage change for each platform and the critical path.

- [ ] **Step 5: Advance only with evidence**

Create a separate PyInstaller-reduction design only if measured macOS Electron Builder/code-signing is the dominant controllable phase. Otherwise stop after reporting cache results.

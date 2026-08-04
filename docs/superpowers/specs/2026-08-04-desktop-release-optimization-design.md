# Desktop Release Optimization Design

## Objective

Reduce the GitHub Actions release critical path without weakening release safety. The observed `v1.5.0` baseline is 18m08s for macOS, 11m30s for Windows, and 37s for publication, following a longest quality gate of 1m50s. The end-to-end critical path is therefore approximately 20m35s.

## Scope and non-goals

This work applies only to `.github/workflows/desktop-release.yml` and release-observability helpers. It preserves the existing quality gate, native platform builds, macOS signing/notarization, Windows unsigned-installer assertion, update metadata, checksums, and immutable release creation. It does not reuse web or Python artifacts across operating systems, disable notarization, change installer targets, or alter release permissions.

## Approach

### 1. Deterministic observability

Each platform job records elapsed time and output size for dependency installation, release preparation, Electron packaging, and artifact upload. The macOS job additionally records its builder subprocess timeline so code signing and notarization can be distinguished before any high-risk packaging change. A final summary reports cache status, platform duration, phase durations, and release asset sizes.

Timing output is additive: a failure to create a summary must not mask the original build failure. Step commands and their working directories remain unchanged.

### 2. Safe binary-download caches

Keep the existing npm and uv caches. Add an `actions/cache` step before dependency installation for Electron and electron-builder download directories, separately for macOS arm64 and Windows x64. Cache keys include runner OS, architecture, Node version and the desktop lockfile hash. Cache misses are valid and execute the existing download/build path; cache saves happen only after a successful job.

No `node_modules`, virtual environment, PyInstaller work directory, signed artifacts, or notarization output is cached. This avoids stale native binaries, credentials, and false-success releases.

### 3. Evidence-gated macOS optimization

No PyInstaller collection reduction is included in the first pull request. After two measured cache-enabled runs, use the macOS phase data to choose the next change:

- If Electron Builder signing dominates, inventory the packaged sidecar and introduce a narrowly scoped PyInstaller collection reduction with a regression smoke test.
- If Apple notarization wait dominates, improve its diagnostics and retry behavior before considering workflow restructuring.
- If dependency download dominates, retain the cache-only change and measure warm-cache benefit before doing deeper work.

## Data and failure behavior

All cache content is disposable. A cache corruption, cache miss, or unavailable cache service must continue with a clean installation. Existing `npm ci`, `uv sync --frozen --extra desktop`, verification commands, and artifact checks remain authoritative.

The workflow must publish only after both platform jobs pass their existing installer, signature, notarization, metadata, and artifact validations. A manual `workflow_dispatch` continues to build but not create a release.

## Validation

Local validation checks YAML structure, cache-key determinism, and shell/PowerShell syntax where possible. GitHub-hosted validation uses a manual workflow run from the branch, followed by two comparable runs to capture cold- and warm-cache results. Release E2E requires both platform jobs, all reusable CI jobs, artifact validation, and—on a controlled tag/release candidate—the final publish checks.

## Success criteria

1. The release workflow has phase-level timing and cache-hit visibility.
2. A cache miss retains the prior functional build behavior.
3. Two successful Actions runs provide an auditable before/after timing table.
4. macOS signing and notarization remain enabled and validated.
5. No release-specific asset or integrity check is removed.

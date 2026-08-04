# SAG fnOS Production Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 SAG 的 fnOS 候选包升级为可在 GitHub Release 正式分发、可在网络受限环境中受支持部署、可验证升级回滚的稳定交付体系。

**Architecture:** 保持已有候选镜像工作流作为不可变 OCI 产物的唯一来源；新增一个本地可复现的发布编排器和一个人工触发的稳定发布工作流。稳定发布只消费已验证 digest，输出 FPK、校验文件、release manifest 和验收证据；镜像分发采用“GHCR 直连 + 中国可达镜像仓库”的双通道，不把普通 Docker Hub 加速器误当作 GHCR 的保障。

**Tech Stack:** Node.js 20 ESM scripts、GitHub Actions、GHCR、OCI registry、Docker Buildx、fnpack 1.2.3、fnOS Docker application template、GitHub Release。

## Global Constraints

- 永久在 `feat/fnos-docker-app` 分支工作，绝不合回仓库 `main`。
- 首个稳定 FPK 只支持 x86 fnOS，最低系统版本保持 `1.2.0302`，唯一宿主端口保持 `3080`。
- 保持 single-user、无登录、无初始化密钥：用户名只是工作区资料，不是身份认证。
- API `8000`、Web `3000` 不得暴露到宿主机；`sag-gateway` 是唯一入口。
- FPK Compose 只允许 API、Web、Gateway 三个精确 OCI digest；禁止 `latest`、可变 tag 与 `build:`。
- `/data` 是 SQLite、LanceDB、上传原文和索引的完整兼容边界；升级、回滚和备份不得只处理数据库文件。
- 模型和 Embedding 凭据只在用户的 fnOS 应用配置中填写，不进入 Git、日志、FPK 或 GitHub Release。
- `sag-1.4.0-fnos.6.fpk` 保持 RC/内测包定位；首个稳定版使用新的版本号。
- GitHub Release 是首个正式分发渠道；飞牛应用中心上架不阻塞首个稳定版，但必须保留后续接入路径。

---

## Delivery Phases and Release Decision

| 阶段 | 交付物 | 完成判定 | 是否可给普通用户 |
| --- | --- | --- | --- |
| A. 发布基础 | 本地编排命令、稳定工作流、release manifest、测试 | dry-run 可重复产出完整资产 | 否 |
| B. 网络交付 | GHCR 与中国可达镜像仓库策略、诊断与文档 | 两条通道均通过拉取/安装验证 | 否 |
| C. RC 验收 | 新版本 `.fpk`、SHA-256、验收矩阵与证据 | fnOS VM 完整验收通过 | 仅内测 |
| D. 稳定发布 | GitHub Release、发布说明、回滚包说明 | 所有自动和人工门禁通过 | 是 |
| E. 应用中心 | 上架物料与审核版本 | 飞牛审核要求满足 | 是，后续渠道 |

### 网络结论与策略

当前 FPK 在安装/启用时由 fnOS Docker 拉取 Compose 中的 API、Web、Nginx 镜像；若 fnOS 不能访问 `ghcr.io` 或 `docker.io`，镜像无法拉取，应用将安装后无法正常启动，或在安装阶段失败。GitHub Release 也同样无法作为该网络中的下载来源。

飞牛社区资料显示 fnOS Docker 界面存在镜像仓库／加速源配置，但这类加速设置通常服务于 Docker Hub；它不构成对 GHCR 的正式可用性保证。计划不得宣传“配置任意加速器即可安装 SAG”。生产方案必须实际验证镜像仓库是否可代理或镜像 `ghcr.io/luoshuai990529/sag-api`、`sag-web` 和 Docker Hub 的 Nginx，并保留完整 manifest-list digest 证据。

正式分发采用以下优先级：

1. **标准通道：** 直连公共 GHCR 和 Docker Hub，适用于可访问境外 registry 的网络。
2. **中国可达通道：** 由 SAG 维护的镜像镜像仓库（企业 Harbor、云厂商容器镜像服务或可审计代理仓库）；稳定 FPK 按渠道引用镜像仓库中的不可变 digest，并以独立 Release 资产标明 `global` 或 `cn`。
3. **完全离线通道：** 在独立可行性验证成功前不承诺。若官方 Docker 应用规范允许安全预置/导入 OCI 镜像，则提供受校验离线介质；若不允许，则支持由管理员先导入签名镜像包并使用离线专用 FPK。该通道不可用“在 FPK 中塞入大镜像”替代验证。

## Planned File Structure

| 路径 | 责任 |
| --- | --- |
| `scripts/release-fnos.mjs` | `prepare`、`package`、`verify` 三个可复现的本地发布子命令；不直接推送或创建 Release。 |
| `scripts/fnos-release-manifest.mjs` | 读写和严格校验 `release-manifest.json`；绑定版本、commit、通道、三项 image digest、FPK SHA-256 与候选工作流证据。 |
| `scripts/fnos-registry-channel.mjs` | 验证 global/cn registry 的 digest、平台与匿名拉取可用性。 |
| `scripts/tests/fnos-production-release.test.mjs` | 发布编排参数、版本/tag、不可变 digest、拒绝脏工作树等单元测试。 |
| `scripts/tests/fnos-release-manifest.test.mjs` | manifest 格式、哈希、渠道与 digest 一致性测试。 |
| `scripts/tests/fnos-registry-channel.test.mjs` | global/cn 镜像引用和拒绝非允许 registry 的测试。 |
| `.github/workflows/fnos-package-release.yml` | 手动触发 stable dry-run/发布；构建资产并创建 GitHub Release。 |
| `.github/workflows/fnos-image-release.yml` | 扩展候选镜像工作流，产出可被稳定工作流消费的候选证据 artifact。 |
| `packages/fnos/sag/app/docker/docker-compose.yaml` | 保持模板 token；必要时按渠道支持受控的镜像引用，绝不写可变 tag。 |
| `docs/fnos/release-runbook.md` | 发布负责人操作手册、失败处理和稳定发布清单。 |
| `docs/fnos/installation.md` | 用户安装、网络前置条件、模型配置、校验和故障排查。 |
| `docs/fnos/acceptance-matrix.md` | RC/稳定版本的真实 fnOS 验收记录模板。 |
| `docs/fnos/rollback-and-recovery.md` | 升级前备份、失败恢复、降级与数据保留说明。 |

### Task 1: Establish release contracts and failing tests

**Files:**
- Create: `scripts/tests/fnos-release-manifest.test.mjs`
- Create: `scripts/tests/fnos-production-release.test.mjs`
- Create: `scripts/tests/fnos-registry-channel.test.mjs`
- Modify: `scripts/tests/fnos-release-workflow.test.mjs`

**Interfaces:**
- Consumes: `packages/fnos/sag/manifest`, existing `scripts/build-fnos-package.mjs`, `scripts/fnos-release-registry.mjs`.
- Produces: executable contract for `release-manifest.json`, release channel values `global|cn`, and `release-fnos.mjs` command contract.

- [ ] **Step 1: Add a release manifest fixture and failing validator tests.**

```js
const validManifest = {
  schema_version: 1,
  appname: "sag",
  version: "1.4.0-fnos.7",
  channel: "global",
  revision: "a".repeat(40),
  candidate_tag: "fnos-candidate-1.4.0-fnos.7-aaaaaaaaaaaa",
  images: {
    api: "ghcr.io/luoshuai990529/sag-api@sha256:" + "b".repeat(64),
    web: "ghcr.io/luoshuai990529/sag-web@sha256:" + "c".repeat(64),
    gateway: "docker.io/library/nginx:1.30.4-alpine@sha256:" + "d".repeat(64),
  },
  candidate_workflow: { run_id: "30798626087", url: "https://github.com/luoshuai990529/SAG/actions/runs/30798626087" },
  fpk: { filename: "sag-1.4.0-fnos.7.fpk", sha256: "e".repeat(64) },
};
```

Assert rejection of a movable image tag, mismatched version/file name, non-40-character revision, non-SHA-256 digest, `channel: "cn"` using a GHCR host, and altered FPK checksum.

- [ ] **Step 2: Add failing release command contract tests.**

Use `spawnSync(process.execPath, [script, "prepare", ...])` to require: exact `feat/fnos-docker-app` HEAD, clean tracked worktree, manifest version/tag alignment, no existing stable tag, and explicit `--channel global|cn`. Require `package` to consume a manifest file rather than accepting three ad-hoc image values.

- [ ] **Step 3: Run the new test files and record failure.**

Run: `node --test scripts/tests/fnos-release-manifest.test.mjs scripts/tests/fnos-production-release.test.mjs scripts/tests/fnos-registry-channel.test.mjs`

Expected: failure because release manifest, channel validator and release orchestrator do not yet exist.

- [ ] **Step 4: Commit the contract-only change.**

```bash
git add scripts/tests/fnos-release-manifest.test.mjs scripts/tests/fnos-production-release.test.mjs scripts/tests/fnos-registry-channel.test.mjs scripts/tests/fnos-release-workflow.test.mjs
git commit -m "test(fnos): define stable release contracts"
```

### Task 2: Implement manifest and local release orchestrator

**Files:**
- Create: `scripts/fnos-release-manifest.mjs`
- Create: `scripts/release-fnos.mjs`
- Modify: `scripts/build-fnos-package.mjs`
- Test: `scripts/tests/fnos-release-manifest.test.mjs`, `scripts/tests/fnos-production-release.test.mjs`

**Interfaces:**
- Consumes: manifest JSON, repository state, exact image digest references, `fnpack`, `build-fnos-package.mjs`.
- Produces: `dist/fnos/<version>/sag-<version>.fpk`, `.sha256`, and `release-manifest.json` without publishing externally.

- [ ] **Step 1: Implement `fnos-release-manifest.mjs validate --input <file>`.**

The validator must emit normalized JSON to stdout only after checking schema version, app name `sag`, version/file-name match, immutable lowercase digest references, 40-character commit, channel-specific allowlist, candidate tag pattern, workflow URL, and 64-character lower-case FPK SHA-256.

- [ ] **Step 2: Implement `release-fnos.mjs prepare`.**

Command form:

```bash
node scripts/release-fnos.mjs prepare \
  --version 1.4.0-fnos.7 \
  --channel global \
  --candidate-run-id 30798626087 \
  --output dist/fnos/1.4.0-fnos.7/release-input.json
```

It must read the checked-out `packages/fnos/sag/manifest`, resolve `git rev-parse HEAD`, require branch `feat/fnos-docker-app`, reject tracked changes, derive the exact candidate tag, and write no FPK. It may allow pre-existing untracked `dist/fnos/` artifacts only when they are outside the requested version directory; it must reject an existing requested output directory.

- [ ] **Step 3: Implement `release-fnos.mjs package` and `verify`.**

`package --input <release-input.json> --candidate-evidence <verified-digests.json>` validates matching version/revision, calls `build-fnos-package.mjs` with exact references, computes `shasum -a 256`, then writes `release-manifest.json`. `verify --manifest <file>` verifies hash, tar structure, rendered Compose, image policy and exact manifest content without network mutation.

- [ ] **Step 4: Run focused tests until passing.**

Run: `node --test scripts/tests/fnos-release-manifest.test.mjs scripts/tests/fnos-production-release.test.mjs`

Expected: all assertions pass; neither test contacts a registry or creates a GitHub Release.

- [ ] **Step 5: Run a structural package rehearsal.**

Run: `node scripts/build-fnos-package.mjs --structural-test --api-image test.invalid/sag-api@sha256:$(printf 'a%.0s' {1..64}) --web-image test.invalid/sag-web@sha256:$(printf 'b%.0s' {1..64}) --nginx-image docker.io/library/nginx:1.30.4-alpine@sha256:$(printf 'c%.0s' {1..64}) --output /tmp/sag-structural.fpk`

Expected: package policy validation succeeds; the command must use a test-only output path. If shell portability makes the repeated-character expression unsuitable, use a literal 64-character fixture in the test script rather than altering production validation.

- [ ] **Step 6: Commit implementation and tests.**

```bash
git add scripts/fnos-release-manifest.mjs scripts/release-fnos.mjs scripts/build-fnos-package.mjs scripts/tests/fnos-release-manifest.test.mjs scripts/tests/fnos-production-release.test.mjs
git commit -m "feat(fnos): add reproducible package release commands"
```

### Task 3: Add registry-channel verification and prove network behavior

**Files:**
- Create: `scripts/fnos-registry-channel.mjs`
- Modify: `scripts/fnos-release-manifest.mjs`
- Modify: `scripts/build-fnos-package.mjs`
- Test: `scripts/tests/fnos-registry-channel.test.mjs`, `scripts/tests/fnos-package.test.mjs`

**Interfaces:**
- Consumes: release channel and registry allowlist supplied via repository configuration.
- Produces: exact global/cn image references accepted only after OCI index, platform and digest checks.

- [ ] **Step 1: Add failing tests for channel mapping.**

Require `global` to resolve only the current GHCR API/Web hosts and pinned Docker Hub Gateway host. Require `cn` to resolve only a repository-owned, configured mirror hostname; reject generic accelerator URLs, arbitrary public mirrors and host-only tag references.

- [ ] **Step 2: Implement a reviewed registry channel configuration.**

Store the explicit `global` and `cn` registry repository prefixes in a small JSON/config module checked into the branch. Do not add a China hostname until the project owns it or has a written operational agreement. The initial configuration must support `global` only and make `cn` fail with an actionable “mirror is not provisioned” message.

- [ ] **Step 3: Implement `verify-channel`.**

Command form:

```bash
node scripts/fnos-registry-channel.mjs verify-channel \
  --channel global \
  --api-image ghcr.io/luoshuai990529/sag-api@sha256:<digest> \
  --web-image ghcr.io/luoshuai990529/sag-web@sha256:<digest> \
  --gateway-image docker.io/library/nginx:1.30.4-alpine@sha256:<digest>
```

It uses `docker buildx imagetools inspect --raw` to confirm an OCI index, requires API/Web `linux/amd64` and `linux/arm64`, and performs an anonymous exact-digest pull for linux/amd64. It emits a machine-readable report for later inclusion in the release manifest.

- [ ] **Step 4: Validate the current global channel and a deliberately unavailable channel.**

Run the global check against the current candidate digests. Then run `--channel cn` before a mirror exists and assert failure is explicit and does not fall back silently to GHCR.

- [ ] **Step 5: Provision and verify the China channel before declaring it supported.**

After selecting the organization-owned registry, mirror API, Web and Gateway OCI indexes by digest; compare raw manifests/platforms, validate anonymous/authorized pull from a mainland-like test network, and add its exact approved prefixes to configuration. A standard Docker Hub accelerator alone does not satisfy this task because SAG API/Web originate from GHCR.

- [ ] **Step 6: Commit registry-channel support.**

```bash
git add scripts/fnos-registry-channel.mjs scripts/fnos-release-manifest.mjs scripts/build-fnos-package.mjs scripts/tests/fnos-registry-channel.test.mjs scripts/tests/fnos-package.test.mjs
git commit -m "feat(fnos): verify registry delivery channels"
```

### Task 4: Publish candidate evidence suitable for stable packaging

**Files:**
- Modify: `.github/workflows/fnos-image-release.yml`
- Modify: `scripts/fnos-release-registry.mjs`
- Modify: `scripts/tests/fnos-release-workflow.test.mjs`
- Modify: `scripts/tests/fnos-release-registry.test.mjs`

**Interfaces:**
- Consumes: candidate tag, exact staging digest evidence, gateway policy.
- Produces: `fnos-candidate-evidence.json` artifact containing version, commit, candidate tag, API/Web/Gateway digest, scan summary location and workflow run URL.

- [ ] **Step 1: Add a failing workflow test that requires a single candidate-evidence artifact.**

Assert that the candidate workflow emits the artifact after anonymous post-check, contains immutable references only, and retains it for at least 90 days. Assert stable release workflow may consume only this named artifact.

- [ ] **Step 2: Implement canonical evidence generation.**

Extend `fnos-release-registry.mjs` with a command that writes deterministic JSON in a stable key order. The JSON must include candidate version, full revision, candidate tag, workflow run ID/URL, API/Web digest references, exact Gateway policy reference and scan artifact identity.

- [ ] **Step 3: Upload the canonical evidence after anonymous post-check.**

The workflow must upload it only when registry publication verified; on failure it must still retain diagnostic scan evidence but must not label the candidate releasable.

- [ ] **Step 4: Run workflow and registry unit tests.**

Run: `node --test scripts/tests/fnos-release-workflow.test.mjs scripts/tests/fnos-release-registry.test.mjs`

Expected: candidate evidence is required and the existing candidate workflow protections remain intact.

- [ ] **Step 5: Commit the candidate evidence contract.**

```bash
git add .github/workflows/fnos-image-release.yml scripts/fnos-release-registry.mjs scripts/tests/fnos-release-workflow.test.mjs scripts/tests/fnos-release-registry.test.mjs
git commit -m "ci(fnos): publish immutable candidate evidence"
```

### Task 5: Create the stable FPK GitHub Release workflow

**Files:**
- Create: `.github/workflows/fnos-package-release.yml`
- Modify: `scripts/tests/fnos-release-workflow.test.mjs`
- Test: `scripts/tests/fnos-release-workflow.test.mjs`

**Interfaces:**
- Consumes: `workflow_dispatch` inputs `version`, `candidate_run_id`, `channel`, `mode=dry-run|publish`, and checked-in acceptance evidence path.
- Produces: workflow artifact in dry-run; GitHub Release plus four immutable assets in publish mode.

- [ ] **Step 1: Add failing tests for workflow permissions and gates.**

Require `contents: write` only in the final publish job, `packages: read` for image verification, explicit protected branch/HEAD validation, and no `latest` or arbitrary image input. Require artifact names `sag-<version>.fpk`, `.sha256`, `release-manifest.json`, and `acceptance-matrix.md`.

- [ ] **Step 2: Implement the `preflight` job.**

It checks out the supplied stable tag/commit, verifies it equals `origin/feat/fnos-docker-app`, downloads candidate evidence from the selected run, validates channel/image references, invokes `release-fnos.mjs prepare`, and verifies that the acceptance matrix is marked complete.

- [ ] **Step 3: Implement the `package-and-verify` job.**

Install pinned fnpack, run `release-fnos.mjs package` and `verify`, execute the fnOS script test suite, and upload all four assets as a 90-day artifact. This job must run for dry-run and publish modes.

- [ ] **Step 4: Implement the guarded `publish` job.**

Only `mode=publish` creates tag `fnos-v<version>` if absent and points it to the verified commit, then creates a non-draft GitHub Release. It uploads exactly the four verified assets. Retry behavior must verify existing tag/Release assets hash-match before reporting success; mismatch must fail closed.

- [ ] **Step 5: Run workflow static tests.**

Run: `node --test scripts/tests/fnos-release-workflow.test.mjs`

Expected: the workflow is rejected by tests until it has all stable gates and no broad write permission.

- [ ] **Step 6: Commit workflow and tests.**

```bash
git add .github/workflows/fnos-package-release.yml scripts/tests/fnos-release-workflow.test.mjs
git commit -m "ci(fnos): add stable FPK release workflow"
```

### Task 6: Add user-facing operational documentation and acceptance records

**Files:**
- Create: `docs/fnos/release-runbook.md`
- Create: `docs/fnos/installation.md`
- Create: `docs/fnos/acceptance-matrix.md`
- Create: `docs/fnos/rollback-and-recovery.md`
- Modify: `docs/fnos/main-functional-sync-2026-08-03.md`

**Interfaces:**
- Consumes: release manifest, GitHub Release assets, fnOS application lifecycle and global/cn channel report.
- Produces: maintainers’ release checklist and users’ verifiable installation/recovery instructions.

- [ ] **Step 1: Document channel selection before installation.**

State plainly that global FPK requires fnOS access to GHCR and Docker Hub; China-channel FPK requires the named mirror; a user who can reach neither cannot complete image-based installation. Include the exact Docker app location for checking registry settings but do not instruct users to use an unverified public mirror.

- [ ] **Step 2: Document checksum verification and model configuration.**

Include macOS, Windows and Linux checksum commands; describe manual FPK upload, only-user-profile first entry, model/Embedding configuration, and why no SAG password/init key appears. Never show or request a real credential.

- [ ] **Step 3: Create acceptance matrix with immutable evidence fields.**

Make every manual gate a row with fields: version, FPK SHA-256, channel, fnOS version, host architecture, date, executor, result, log path/screenshot path, and defect link. Include clean install, app open, no-auth profile, upload/index/query, SSE/MCP, restart, upgrade, rollback, uninstall retention, delete-data uninstall, 4 GB profile, and network failure cases.

- [ ] **Step 4: Document recovery boundary and release withdrawal.**

Specify full `/data` cold-backup, data retention on default uninstall, explicit delete behavior, reinstall/rollback sequence, and how maintainers retract a recommendation without deleting a historical Release.

- [ ] **Step 5: Commit documentation.**

```bash
git add docs/fnos/release-runbook.md docs/fnos/installation.md docs/fnos/acceptance-matrix.md docs/fnos/rollback-and-recovery.md docs/fnos/main-functional-sync-2026-08-03.md
git commit -m "docs(fnos): add stable release and recovery runbooks"
```

### Task 7: Run an end-to-end dry run and deliver the next RC package

**Files:**
- Modify: `packages/fnos/sag/manifest`
- Create: `docs/fnos/evidence/<version>-rc.md`
- Generate, do not commit: `dist/fnos/<version>/sag-<version>.fpk`, `.sha256`, `release-manifest.json`

**Interfaces:**
- Consumes: complete branch, candidate evidence, global channel, stable workflow in `dry-run` mode.
- Produces: next RC FPK and evidence pack for user installation on fnOS.

- [ ] **Step 1: Choose and commit the next version.**

Update `packages/fnos/sag/manifest` once to the selected new RC version (for example `1.4.0-fnos.7`); add the matching changelog/evidence skeleton and commit it before candidate tagging.

- [ ] **Step 2: Create candidate tag and wait for the candidate workflow.**

Create exactly `fnos-candidate-<version>-<commit12>`. Confirm API/Web multi-arch image, amd64 smoke, Gateway scan, digest capture, promote and anonymous post-check all succeed. Save the run link and its candidate evidence artifact into `docs/fnos/evidence/<version>-rc.md`.

- [ ] **Step 3: Run stable workflow in `dry-run`.**

Provide the candidate run ID, `channel=global`, the exact acceptance evidence path and `mode=dry-run`. Download the four generated assets and independently check that FPK SHA-256 equals the release manifest.

- [ ] **Step 4: Hand the RC package to the user with a concise delta.**

State the exact version, SHA-256, channel prerequisite and what changed from `.6`. Do not call it stable or instruct users to replace a stable production installation without backup.

- [ ] **Step 5: Commit only source evidence.**

```bash
git add packages/fnos/sag/manifest docs/fnos/evidence/<version>-rc.md
git commit -m "build(fnos): prepare <version> release candidate"
```

### Task 8: Complete fnOS device acceptance and release decision

**Files:**
- Modify: `docs/fnos/acceptance-matrix.md`
- Modify: `docs/fnos/evidence/<version>-rc.md`
- Create: `docs/fnos/evidence/<version>-release-notes.md`

**Interfaces:**
- Consumes: RC FPK, channel report, device/log/screenshot evidence.
- Produces: completed acceptance matrix that the publish workflow validates.

- [ ] **Step 1: Clean-install verification.**

On x86 fnOS VM, upload RC FPK, install, enable and open. Verify only port 3080 is reachable, the launch profile asks for a username only, and no password/init key field remains. Record `docker compose ps`, app status and browser screenshot locations.

- [ ] **Step 2: Product-loop verification.**

With private model/Embedding configuration, upload one Markdown and one PDF, wait for indexing, verify retrieval, streaming answer, citations and MCP URL. Record only pass/fail and redacted logs; never record keys.

- [ ] **Step 3: Lifecycle and data verification.**

Stop/start, restart fnOS, rebuild containers, upgrade from the preceding stable/RC baseline, simulate an interrupted upgrade, restore complete data, default-uninstall/reinstall, and explicit-delete uninstall. Verify old knowledge remains searchable at the appropriate checkpoints.

- [ ] **Step 4: Network matrix verification.**

Test global channel from a network with GHCR/Docker Hub access; test unreachable GHCR behavior and check that the error/runbook is actionable. When the cn mirror is provisioned, repeat install and enable from a China-restricted network. Do not mark China support complete based solely on a configured Docker Hub accelerator.

- [ ] **Step 5: Release decision.**

Mark acceptance as passed only when every blocking row has evidence. Any functional, data-loss, security, or network-channel ambiguity returns work to Tasks 1–7 and creates a new RC version; never overwrite RC assets.

### Task 9: Create the first stable GitHub Release and operate it

**Files:**
- Modify: `docs/fnos/acceptance-matrix.md`
- Create: `docs/fnos/evidence/<version>-stable.md`

**Interfaces:**
- Consumes: completed RC evidence and stable workflow `mode=publish`.
- Produces: immutable `fnos-v<version>` tag and GitHub Release assets.

- [ ] **Step 1: Re-run required automated validation on the release commit.**

Run API Ruff/pytest, Web unit/lint/typecheck/build, and all fnOS script tests. Confirm no tracked changes and that the candidate and desired stable commit are identical.

- [ ] **Step 2: Trigger stable workflow with `mode=publish`.**

Use exact candidate run ID and channel. Confirm its GitHub Release contains FPK, SHA-256, release manifest and completed acceptance matrix; download the assets independently and verify their hashes.

- [ ] **Step 3: Perform post-release clean install.**

Install the downloaded GitHub Release FPK on a fresh fnOS VM rather than reusing the RC package. Record install/enable/open status, image digest resolution and product launch result in `<version>-stable.md`.

- [ ] **Step 4: Publish support status.**

Mark the version as stable only after the post-release install succeeds. Publish supported fnOS/x86 scope, channel availability, known limits, model configuration requirement, no-auth LAN boundary and rollback link.

- [ ] **Step 5: Commit only immutable evidence references.**

```bash
git add docs/fnos/acceptance-matrix.md docs/fnos/evidence/<version>-stable.md
git commit -m "docs(fnos): record <version> stable release evidence"
```

### Task 10: Prepare fnOS App Center as a separate release channel

**Files:**
- Create: `docs/fnos/app-center-submission.md`
- Create: `packages/fnos/sag/release/app-center-metadata.json`
- Test: `scripts/tests/fnos-release-workflow.test.mjs`

**Interfaces:**
- Consumes: a stable GitHub Release and its immutable release manifest.
- Produces: submission metadata and a checklist without changing the stable package’s runtime behavior.

- [ ] **Step 1: Capture the official current submission requirements.**

Before implementation, review the current official fnOS developer documentation for required manifest fields, icon/screenshots, privacy statement, update policy and reviewer access; date and link each requirement in the submission document.

- [ ] **Step 2: Create metadata from stable release facts.**

Populate app name, version, x86 support, min fnOS version, 3080 service port, developer/publisher, screenshots, installation instructions, no-auth LAN warning, network prerequisite and support link. Values must derive from the stable manifest, not be maintained separately.

- [ ] **Step 3: Submit only a previously stable FPK.**

The review package must match an existing GitHub Release SHA-256; candidate-only FPKs are ineligible. Record reviewer feedback as a new issue/version, not an untracked manual edit to a shipped artifact.

- [ ] **Step 4: Commit App Center preparation separately.**

```bash
git add docs/fnos/app-center-submission.md packages/fnos/sag/release/app-center-metadata.json
git commit -m "docs(fnos): prepare app center submission metadata"
```

## Full Verification Commands

Run these at the end of Tasks 2–6 and before Task 9. Use the repository’s dependency setup first; do not substitute a passing subset for the full suite.

```bash
cd apps/api && uv run ruff check sag_api tests && uv run pytest tests -q
cd apps/web && npm run test:unit && npm run lint && npm run typecheck && npm run build
cd ../.. && node --test scripts/tests/fnos-auth-boundary.test.mjs scripts/tests/fnos-gateway-policy.test.mjs scripts/tests/fnos-gateway-scan-summary.test.mjs scripts/tests/fnos-gateway-trivy-report.test.mjs scripts/tests/fnos-lifecycle.test.mjs scripts/tests/fnos-package.test.mjs scripts/tests/fnos-release-registry.test.mjs scripts/tests/fnos-release-smoke.test.mjs scripts/tests/fnos-release-workflow.test.mjs scripts/tests/release-public.test.mjs scripts/tests/validate-fnos-release.test.mjs scripts/tests/fnos-release-manifest.test.mjs scripts/tests/fnos-production-release.test.mjs scripts/tests/fnos-registry-channel.test.mjs
```

## Self-Review Checklist

- [ ] Every published FPK is bound to commit, three immutable image references, FPK SHA-256 and candidate evidence.
- [ ] Candidate workflow and stable GitHub Release are distinct; a candidate tag never itself denotes stable support.
- [ ] China support is not marked complete without a registry that actually serves SAG’s GHCR-origin images and Nginx by digest.
- [ ] All no-auth, data retention, model credential and port boundaries are retained.
- [ ] Every stable release has clean-install, data lifecycle, upgrade/rollback and network evidence.
- [ ] App Center submission is staged after, not instead of, stable GitHub Release delivery.

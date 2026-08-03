# fnOS 主线功能同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 将官方 upstream/main 的九项 API、Dify 和 Web 能力安全前向移植到永久独立的 feat/fnos-docker-app，并交付新 FPK 体验包。

**Architecture:** 从实施时最新的 origin/feat/fnos-docker-app 创建同步分支和独立 worktree；按依赖顺序语义移植提交。每批次先运行对应测试，再验证 fnOS 无登录、同源单入口、三容器、持久化和发布门禁；全量通过才快进合回永久 fnOS 分支。

**Tech Stack:** Git worktree/cherry-pick、FastAPI/pytest/Ruff、Next.js/TypeScript/Vitest、Docker Compose、fnpack、fnOS FPK。

## Global Constraints

- 永久维护分支是 feat/fnos-docker-app；禁止向 main 合并、rebase 或提交面向 main 的 PR。
- 来源固定为 upstream/main；开始时重新 fetch 并记录 SHA。
- 所有移植、冲突处理、构建和测试均在 sync/fnos-main-functional-20260803 worktree 中进行。
- 只同步 31bda7a、dc96502、5530c6b、f4c48b8、948e3e3、029c92b、8018cac、7d756d6、87d8b16 的目标功能。
- 排除 Desktop、CLI/Skill/README、社区素材、Dify 部署文档、主线 Compose、通用 CI 和纯发布提交。
- 保留 SAG_AUTH_MODE=single_user；不得要求密码、初始化密钥或重复输入用户名。
- 保留 NEXT_PUBLIC_API_BASE=/ 同源行为；仅 gateway 暴露 3080，不得发布 API 8000 或 Web 3000。
- 保留 sag-api、sag-web、sag-gateway 三容器，以及 \${TRIM_PKGVAR}/data:/data。
- FPK 禁止 latest、build:、目录级 ours/theirs 覆盖；不触碰既有未跟踪候选包。
- 每个移植提交需 git cherry-pick -x，或正文写明 Source: upstream/<SHA>。

## File Structure

| 路径 | 责任 | 处理 |
| --- | --- | --- |
| apps/api/sag_api/api/v1/{__init__,dify,knowledge}.py | API 路由 | 注册 Dify 与知识 REST API。 |
| apps/api/sag_api/schemas/{dify,chunk}.py | 新 API 返回模型 | 新增。 |
| apps/api/sag_api/{core/config.py,core/litellm_policy.py,sag/engine_manager.py} | 配置、策略、引擎 | 语义合并 Dify、PostgreSQL、DeepSeek V4。 |
| apps/api/sag_api/jobs/{inproc,tasks}.py | 文档任务状态 | 同步重试、进度、失败反馈。 |
| apps/web/components/features/* | 来源 ID、文档处理、聊天输入 | 同步指定体验，不恢复登录。 |
| apps/web/lib/{api,types,document-activity,upload-guidance,composer-keyboard}.ts | API base、类型和交互 helper | 保留 / 表示空 API base。 |
| packages/fnos/sag/app/docker/docker-compose.yaml | FPK 运行时 | 仅必要时最小改动。 |
| scripts/tests/*fnos*.test.mjs | 发布门禁 | 只补缺失的无登录/单入口断言。 |
| docs/fnos/*.md | 映射和交付 | 新增同步账本与体验说明。 |

## Task 1: 创建隔离同步 worktree 和提交映射账本

**Files:**
- Create: /Users/buu99y/workspace/github/agents/SAG/.worktrees/sync-fnos-main-functional-20260803/
- Create: docs/fnos/main-functional-sync-2026-08-03.md
- Test: worktree、分支及 SHA 一致性。

**Interfaces:**
- Consumes: origin/feat/fnos-docker-app、upstream/main。
- Produces: sync/fnos-main-functional-20260803 和来源提交状态表。

- [ ] **Step 1: 确认永久分支状态**

~~~bash
git -C /Users/buu99y/workspace/github/agents/SAG/.worktrees/feat-fnos-docker-app status --short --branch
git -C /Users/buu99y/workspace/github/agents/SAG/.worktrees/feat-fnos-docker-app log -1 --oneline origin/feat/fnos-docker-app
~~~

Expected: 分支已推送；若有已跟踪修改或未推送提交，停止。已有无关未跟踪 FPK/计划文件不得移动、删除或暂存。

- [ ] **Step 2: 获取来源并创建新 worktree**

~~~bash
git -C /Users/buu99y/workspace/github/agents/SAG/.worktrees/feat-fnos-docker-app fetch --prune origin feat/fnos-docker-app
git -C /Users/buu99y/workspace/github/agents/SAG/.worktrees/feat-fnos-docker-app fetch --prune upstream main
git -C /Users/buu99y/workspace/github/agents/SAG worktree add -b sync/fnos-main-functional-20260803 /Users/buu99y/workspace/github/agents/SAG/.worktrees/sync-fnos-main-functional-20260803 origin/feat/fnos-docker-app
git -C /Users/buu99y/workspace/github/agents/SAG worktree list
~~~

Expected: 新路径仅检出同步分支，永久 worktree 不变。

- [ ] **Step 3: 建立账本并提交**

Create docs/fnos/main-functional-sync-2026-08-03.md:

~~~markdown
| 上游 SHA | 能力 | 状态 | fnOS 处理 | 验证 |
| --- | --- | --- | --- | --- |
| 31bda7a | Dify API | 待同步 | 排除 Compose/部署文档 | 待执行 |
| dc96502 | 来源 ID 复制 | 待同步 | 保留同源 API | 待执行 |
| 5530c6b | PostgreSQL schema | 待同步 | 排除通用 CI | 待执行 |
| f4c48b8 | 文档处理反馈 | 待同步 | 保留轻量资源档 | 待执行 |
| 948e3e3 | DeepSeek V4 | 待同步 | API 运行时 | 待执行 |
| 029c92b | IME Enter | 待同步 | Web 交互 | 待执行 |
| 8018cac、7d756d6 | Dify 向量策略 | 待同步 | 排除 Dify 文档 | 待执行 |
| 87d8b16 | 知识 REST API | 待同步 | API v1 路由 | 待执行 |
~~~

~~~bash
git add docs/fnos/main-functional-sync-2026-08-03.md
git commit -m "docs(fnos): start main functional sync ledger"
~~~

Expected: 临时分支拥有可独立审查的同步起点。

## Task 2: 移植 Dify API 与向量检索策略

**Files:**
- Create: apps/api/sag_api/api/v1/dify.py、apps/api/sag_api/schemas/dify.py。
- Create: apps/api/tests/test_dify_setup.py、test_dify_retrieval.py、test_search_strategy.py。
- Modify: apps/api/sag_api/api/v1/__init__.py、core/config.py、sag/engine_manager.py。
- Modify: docs/fnos/main-functional-sync-2026-08-03.md。
- Exclude: .env.example、Makefile、README、compose.yaml、compose.dify.yaml、docs/dify-integration*.md、scripts/setup_dify.py。

**Interfaces:**
- Consumes: api_router、EngineManager.search_many(...)、当前 fnOS 环境。
- Produces: Dify 外部知识库 API 和默认 vector 检索；普通 fnOS 用户无需 Dify。

- [ ] **Step 1: 应用最小 Dify 差异，先不提交**

~~~bash
git cherry-pick -n 31bda7a
git restore --staged --worktree .env.example Makefile README.md README-CN.md compose.yaml compose.dify.yaml docs/dify-integration.md scripts/setup_dify.py
~~~

Expected: 仅 API、schema、运行时配置和测试保留。config/router/engine 冲突逐段合并，禁止整文件覆盖。

- [ ] **Step 2: 先写路由失败测试并注册路由**

In test_dify_setup.py, use the actual setup/health endpoint exported by dify.py:

~~~python
def test_dify_router_is_registered_in_single_user_mode(client):
    response = client.get("/api/v1/dify/health")
    assert response.status_code != 404
~~~

If upstream endpoint differs, replace the path and name the endpoint in the test. Run:

~~~bash
uv run pytest apps/api/tests/test_dify_setup.py -q
~~~

Expected: 未注册时 404；将 dify.router 加入 api/v1/__init__.py 后通过，且没有 bootstrap credential。

- [ ] **Step 3: 语义合并配置和引擎策略**

Add only fields read by dify.py. Do not alter these Compose-owned values:

~~~yaml
SAG_AUTH_MODE: single_user
SAG_JOB_CONCURRENCY: "1"
SAG_DOCUMENT_EXTRACT_CONCURRENCY: "2"
SAG_ENGINE_CACHE_SIZE: "4"
SAG_ENGINE_WARMUP_COUNT: "1"
~~~

Merge Dify selection into engine_manager.py without replacing SQLite/LanceDB provisioning.

- [ ] **Step 4: 应用策略后续并验证**

~~~bash
git cherry-pick -n 8018cac
git restore --staged --worktree .env.example compose.yaml docs/dify-integration.md docs/dify-integration.en.md
git cherry-pick -n 7d756d6
uv run pytest apps/api/tests/test_dify_setup.py apps/api/tests/test_dify_retrieval.py apps/api/tests/test_search_strategy.py apps/api/tests/test_hardening.py -q
~~~

Expected: 默认 vector 策略通过；认证失败代表无登录被破坏，先修复再继续。

- [ ] **Step 5: 更新账本并提交**

~~~bash
git add apps/api docs/fnos/main-functional-sync-2026-08-03.md
git commit -m "feat(fnos): forward-port Dify external knowledge APIs"
~~~

Expected: 正文含 Source: upstream/31bda7a, upstream/8018cac, upstream/7d756d6。

## Task 3: 移植 PostgreSQL、DeepSeek V4 和知识 REST API

**Files:**
- Create: apps/api/sag_api/api/v1/knowledge.py、apps/api/sag_api/schemas/chunk.py、apps/api/tests/test_postgres_schema_e2e.py。
- Modify: apps/api/sag_api/api/v1/__init__.py、sag/engine_manager.py、core/litellm_policy.py。
- Modify: apps/api/tests/test_hardening.py、test_units.py、docs/fnos/main-functional-sync-2026-08-03.md。
- Exclude: .github/workflows/ci.yml。

**Interfaces:** Produces PostgreSQL schema bootstrap、DeepSeek V4 tool routing 与：

~~~text
GET /api/v1/sources/{id}/outline
GET /api/v1/sources/{id}/grep
GET /api/v1/sources/{id}/documents/{doc_id}/read
GET /api/v1/sources/{id}/entities/{name}/context
~~~

- [ ] **Step 1: 先移植 PostgreSQL 测试，再实施最小 bootstrap**

Port test_postgres_schema_e2e.py from 5530c6b; exclude CI. Run:

~~~bash
uv run pytest apps/api/tests/test_postgres_schema_e2e.py -q
~~~

Expected: 先失败或明确因本机 PostgreSQL 不可用而阻塞；随后只合入 engine_manager.py 的 schema 初始化 hunk，重跑该测试和 test_hardening.py。SQLite/LanceDB 路径不得改变。

- [ ] **Step 2: 先跑 DeepSeek V4 断言，再合并 policy hunk**

Port 948e3e3 test into test_units.py:

~~~bash
uv run pytest apps/api/tests/test_units.py -k deepseek -q
~~~

Merge only DeepSeek V4 tool-routing logic into core/litellm_policy.py; keep provider defaults/retries. Expected: test passes.

- [ ] **Step 3: 注册 knowledge router 并补齐合同测试**

Port 87d8b16. Add a route test:

~~~python
def test_source_outline_route_is_available(client, source_id):
    response = client.get(f"/api/v1/sources/{source_id}/outline")
    assert response.status_code in {200, 404}
    assert response.status_code != 405
~~~

Add equivalent tests for grep, read, entity context; valid fixtures assert fields from schemas/chunk.py. Run:

~~~bash
uv run pytest apps/api/tests -k "outline or grep or entity_context or deepseek or postgres_schema" -q
~~~

Expected: PASS, except only documented PostgreSQL environment block.

- [ ] **Step 4: 更新账本并提交**

~~~bash
git add apps/api docs/fnos/main-functional-sync-2026-08-03.md
git commit -m "feat(fnos): forward-port API reliability and knowledge routes"
~~~

Expected: 正文含 Source: upstream/5530c6b, upstream/948e3e3, upstream/87d8b16。

## Task 4: 移植文档处理进度、重试和失败反馈

**Files:**
- Create: apps/api/tests/test_document_job_retry.py、apps/web/lib/document-activity.ts、document-activity.test.ts、upload-guidance.ts、upload-guidance.test.ts。
- Modify: apps/api/sag_api/core/config.py、jobs/inproc.py、jobs/tasks.py、services/settings_service.py。
- Modify: apps/api tests document_parsing、quick_model_setup、settings。
- Modify: apps/web knowledge page、document-list、knowledge-config-form、knowledge-source-workspace、pet、status-badge、upload-zone、use-source-content。
- Modify: apps/web/lib/api.ts、app-initialization.ts、types.ts、messages/en-US.json、messages/zh-CN.json。
- Exclude: compose.yaml。

**Interfaces:** Consumes existing document jobs/status API and fixed fnOS resource limits; produces retry/failure state, progress display and upload guidance.

- [ ] **Step 1: 应用上游差异并剔除主线 Compose**

~~~bash
git cherry-pick -n f4c48b8
git restore --staged --worktree compose.yaml
uv run pytest apps/api/tests/test_document_job_retry.py apps/api/tests/test_document_parsing.py -q
~~~

Expected: 状态逻辑未合并前给出可解释失败；不可提高 fnOS 并发来通过测试。

- [ ] **Step 2: 合并任务状态并保护资源默认值**

Merge upstream transitions into jobs/inproc.py and jobs/tasks.py. Adjust settings tests so API 持久化设置不覆盖 Task 2 列出的 Compose 资源默认值。

- [ ] **Step 3: 添加同源 API 回归并合并 UI**

If needed extract a pure helper from resolveApiBase without changing exported API_BASE:

~~~ts
it("uses same-origin requests when NEXT_PUBLIC_API_BASE is slash", () => {
  expect(resolveApiBaseForTest("/", "http:", "192.168.252.10")).toBe("");
});
~~~

Port document-activity/upload-guidance tests and UI. Do not reintroduce login redirects, bootstrap forms or password prompts.

- [ ] **Step 4: 验证并提交**

~~~bash
uv run pytest apps/api/tests/test_document_job_retry.py apps/api/tests/test_document_parsing.py apps/api/tests/test_quick_model_setup.py apps/api/tests/test_settings.py -q
npm --prefix apps/web test -- --run apps/web/lib/document-activity.test.ts apps/web/lib/upload-guidance.test.ts apps/web/lib/api-base.test.ts
npm --prefix apps/web run typecheck
git add apps/api apps/web docs/fnos/main-functional-sync-2026-08-03.md
git commit -m "feat(fnos): forward-port document processing feedback"
~~~

Expected: PASS; 正文含 Source: upstream/f4c48b8。

## Task 5: 移植来源 ID 复制和中文输入法交互修复

**Files:**
- Create: source-id-copy.tsx/test、source-card.test、knowledge-workspace.test、knowledge page test、composer-keyboard.ts/test。
- Modify: source-card.tsx、knowledge-workspace.tsx、chat/conversation-panel.tsx、knowledge page、messages、vitest config。
- Exclude: docs/dify-integration.md。

**Interfaces:** Consumes source id、clipboard API、React keyboard event；produces ID copy and composition-safe Enter logic.

- [ ] **Step 1: 应用来源 ID 差异**

~~~bash
git cherry-pick -n dc96502
git restore --staged --worktree docs/dify-integration.md
npm --prefix apps/web test -- --run apps/web/components/features/source-id-copy.test.tsx apps/web/components/features/source-card.test.tsx apps/web/components/features/knowledge-workspace.test.tsx
~~~

Expected: 测试通过后，当前 fnOS 知识页无登录入口/凭据提示。

- [ ] **Step 2: 先写 IME 失败测试，再接入 helper**

~~~ts
expect(shouldSubmitComposer({ key: "Enter", isComposing: true, shiftKey: false })).toBe(false);
expect(shouldSubmitComposer({ key: "Enter", isComposing: false, shiftKey: false })).toBe(true);
~~~

~~~bash
npm --prefix apps/web test -- --run apps/web/lib/composer-keyboard.test.ts
~~~

Port 029c92b so conversation-panel delegates to the pure helper. Preserve newline, streaming and token behavior.

- [ ] **Step 3: 验证并提交**

~~~bash
npm --prefix apps/web test -- --run apps/web/components/features/source-id-copy.test.tsx apps/web/components/features/source-card.test.tsx apps/web/components/features/knowledge-workspace.test.tsx apps/web/lib/composer-keyboard.test.ts
npm --prefix apps/web run lint
npm --prefix apps/web run typecheck
git add apps/web docs/fnos/main-functional-sync-2026-08-03.md
git commit -m "feat(fnos): forward-port source copy and IME safeguards"
~~~

Expected: 正文含 Source: upstream/dc96502, upstream/029c92b。

## Task 6: fnOS 专项回归门禁和候选镜像验证

**Files:**
- Modify: packages/fnos/sag/app/docker/docker-compose.yaml only if imported runtime config requires it.
- Modify: scripts/tests/*fnos*.test.mjs only for missing regression assertions.
- Modify: docs/fnos/main-functional-sync-2026-08-03.md.

**Interfaces:** Consumes FPK Compose, published image digests, gateway health/API readiness; produces evidence of single-entry, no-login, immutable-image and persistence safety.

- [ ] **Step 1: 静态扫描不变量**

~~~bash
rg -n "NEXT_PUBLIC_API_BASE|SAG_AUTH_MODE|SAG_AUTH_BOOTSTRAP_TOKEN|ports:|build:|latest|TRIM_PKGVAR|SAG_JOB_CONCURRENCY|SAG_DOCUMENT_EXTRACT_CONCURRENCY" packages/fnos/sag deploy/fnos scripts/validate-fnos-release.mjs scripts/tests
node --test scripts/tests/fnos-auth-boundary.test.mjs scripts/tests/validate-fnos-release.test.mjs scripts/tests/fnos-release-smoke.test.mjs scripts/tests/fnos-release-workflow.test.mjs
~~~

Expected: NEXT_PUBLIC_API_BASE=/、SAG_AUTH_MODE=single_user、only 3080、no build/latest and no bootstrap token; tests pass.

- [ ] **Step 2: 生成固定路径的结构化渲染包并校验**

First derive the three candidate digest references from the release workflow handoff. Store them in API_IMAGE, WEB_IMAGE and NGINX_IMAGE; each value must include @sha256: plus 64 hexadecimal characters. Run:

~~~bash
node scripts/build-fnos-package.mjs --structural-test --api-image "$API_IMAGE" --web-image "$WEB_IMAGE" --nginx-image "$NGINX_IMAGE" --render-output /private/tmp/sag-fnos-render-main-sync
node scripts/validate-fnos-release.mjs /private/tmp/sag-fnos-render-main-sync/app/docker/docker-compose.yaml
docker compose -f /private/tmp/sag-fnos-render-main-sync/app/docker/docker-compose.yaml config --quiet
~~~

Expected: three services, API env_file, data mount, only gateway host port 3080, exact digest references. Do not reuse this path if it already exists; create a new fresh temporary render path instead.

- [ ] **Step 3: amd64 smoke and evidence**

Run scripts/smoke-fnos-release-images.mjs with the exact API/Web candidate digests and a unique lowercase scope. Verify Web root, /api/v1/system/ready, /api/v1/auth/session as no-login single-user response, and one /_next/static asset all return expected status.

Update ledger with commands/results. Only if a missing fnOS regression test is genuinely needed:

~~~bash
git add packages/fnos/sag scripts docs/fnos/main-functional-sync-2026-08-03.md
git commit -m "test(fnos): guard main functional sync invariants"
~~~

## Task 7: 全量验证、构建 1.4.0-fnos.5 FPK 并交付体验包

**Files:**
- Modify: packages/fnos/sag/manifest and only version-coupled metadata.
- Create: dist/fnos/sag-1.4.0-fnos.5.fpk、dist/fnos/sag-1.4.0-fnos.5.fpk.sha256。
- Create: docs/fnos/fnos-main-functional-sync-1.4.0-fnos.5-release-notes.md。
- Modify: docs/fnos/main-functional-sync-2026-08-03.md。

**Interfaces:** Consumes synchronized source and candidate digests; produces immutable candidate FPK/checksum/release notes.

- [ ] **Step 1: Run full quality gates**

~~~bash
uv run ruff check apps/api
uv run pytest apps/api/tests -q
npm --prefix apps/web test -- --run
npm --prefix apps/web run lint
npm --prefix apps/web run typecheck
npm --prefix apps/web run build
~~~

Expected: PASS. Pre-existing failure must be demonstrated unchanged before being declared non-blocking.

- [ ] **Step 2: 先测试版本对应关系，再更新 manifest**

Extend existing package validation to assert:

~~~text
manifest version == output FPK filename version == release notes version
~~~

Run it against a mismatched fixture and confirm failure. Update manifest version from 1.4.0-fnos.4 to 1.4.0-fnos.5 and update only coupled metadata. Re-run test; expected PASS.

- [ ] **Step 3: 构建包、校验和体验说明**

Use scripts/build-fnos-package.mjs with immutable release digests and:

~~~bash
node scripts/build-fnos-package.mjs --api-image "$API_IMAGE" --web-image "$WEB_IMAGE" --nginx-image "$NGINX_IMAGE" --output dist/fnos/sag-1.4.0-fnos.5.fpk
shasum -a 256 dist/fnos/sag-1.4.0-fnos.5.fpk > dist/fnos/sag-1.4.0-fnos.5.fpk.sha256
fnpack verify dist/fnos/sag-1.4.0-fnos.5.fpk
~~~

Release notes must state: Dify API/vector strategy, PostgreSQL bootstrap, DeepSeek V4, document feedback, source-ID copy, IME Enter, four knowledge REST APIs; and unchanged no-login, 3080-only, /data retention.

- [ ] **Step 4: Commit and push temporary branch**

~~~bash
git add packages/fnos/sag scripts docs/fnos dist/fnos
git commit -m "build(fnos): release main sync candidate 1.4.0-fnos.5"
git push -u origin sync/fnos-main-functional-20260803
~~~

Expected: temporary branch is reviewable and permanent fnOS branch remains unchanged.

## Task 8: 合回永久 fnOS 分支并飞牛 OS 验收

**Files:**
- Modify: feat/fnos-docker-app only by reviewed fast-forward.
- Test: fnOS VM install/start/open/business/data retention.

- [ ] **Step 1: 合回前确认永久分支没有前进**

~~~bash
git fetch origin feat/fnos-docker-app sync/fnos-main-functional-20260803
git rev-list --left-right --count origin/feat/fnos-docker-app...origin/sync/fnos-main-functional-20260803
~~~

Expected: permanent branch only lags the sync branch. If permanent branch advanced, first merge it into the sync worktree and repeat Task 6-7.

- [ ] **Step 2: 快进合回并推送永久分支**

~~~bash
git -C /Users/buu99y/workspace/github/agents/SAG/.worktrees/feat-fnos-docker-app merge --ff-only origin/sync/fnos-main-functional-20260803
git -C /Users/buu99y/workspace/github/agents/SAG/.worktrees/feat-fnos-docker-app push origin feat/fnos-docker-app
~~~

Expected: no main merge, no force push.

- [ ] **Step 3: fnOS VM 验收并发布摘要**

Record all of the following:

~~~text
1. 手动安装 1.4.0-fnos.5，启用、打开且没有密码/初始化密钥。
2. Windows/Mac 均从 http://<fnOS-IP>:3080 访问。
3. Markdown/PDF 上传、处理反馈、检索、流式问答、引用。
4. 来源 ID 复制；中文输入法组词 Enter 不提交聊天。
5. 可选：私下 Dify/模型凭据下的 Dify API 和四类知识 REST API。
6. 停止/启动、fnOS 重启、容器重建后，既有 /data 数据继续可用。
~~~

Update release notes with date, FPK SHA-256, image digests, test summary, screenshots and known limits. Deliver absolute paths to the FPK and release notes.

## Plan Self-Review

- 九个来源提交在 Task 2-5 具名映射；无登录、同源、单端口、三容器、持久化由全局约束、Task 4 API-base regression、Task 6 门禁覆盖。
- Desktop、CLI/Skill、文档/素材、主线 Compose、通用 CI 均显式排除。
- 每批记录来源 SHA、排除项和测试结果；仅在临时分支全量验证后快进合回永久 fnOS 分支。
- Dify 只移植 API/必要运行时设置；PostgreSQL e2e 若无本机服务，必须记录环境阻塞，不能伪造通过。

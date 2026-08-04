# fnOS 1ms 镜像与桌面标题修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成通过 `ghcr.1ms.run` 拉取镜像、桌面显示“SAG知识库”的 `1.4.0-fnos.8` 候选 FPK。

**Architecture:** Compose 内的三个固定 SHA-256 镜像引用仅替换 Registry 主机名；桌面条目直接使用最终中文标题，避免依赖未展开的 manifest 变量。构建前以匿名 Registry 请求验证加速域名，构建后检查 FPK 内嵌 manifest 与 Compose。

**Tech Stack:** fnpack、Docker Registry v2、Node.js 测试、tar。

## Global Constraints

- 三个镜像必须为 `ghcr.1ms.run/luoshuai990529/*@sha256:...`，不得使用 `latest`。
- `platform = all`，且每个引用必须保持 amd64、arm64 清单。
- 桌面标题精确为 `SAG知识库`，不得出现 `{display_name}`。
- 版本精确为 `1.4.0-fnos.8`。

---

### Task 1: 镜像通道与桌面标题

**Files:**
- Modify: `packages/fnos/sag/manifest`
- Modify: `packages/fnos/sag/app/ui/config`
- Modify: `packages/fnos/gateway-policy.json`
- Modify: `scripts/build-fnos-package.mjs`
- Modify: `scripts/fnos-registry-channel.mjs`
- Modify: `scripts/fnos-gateway-policy.mjs`
- Test: `scripts/tests/fnos-package.test.mjs`

- [ ] 将版本更新为 `1.4.0-fnos.8`，将 manifest `display_name` 和桌面 `title` 固定为 `SAG知识库`。
- [ ] 将发布和策略中的 GHCR 主机替换为 `ghcr.1ms.run`，保留仓库路径与各镜像 SHA-256 摘要。
- [ ] 更新测试，使其拒绝旧 `ghcr.io`，并验证打包后的 manifest 和 UI 配置没有 `{display_name}`。

### Task 2: 匿名加速验证与构建

**Files:**
- Create: `dist/fnos/sag-1.4.0-fnos.8.fpk`
- Create: `dist/fnos/sag-1.4.0-fnos.8.fpk.sha256`

- [ ] 为 API、Web、Gateway 请求 `ghcr.1ms.run` 的匿名 pull token，并读取其固定摘要的 OCI 索引。
- [ ] 执行 fnOS 发布测试集。
- [ ] 调用 `scripts/build-fnos-package.mjs` 构建 `.8`，生成 SHA-256，并从内嵌归档验证中文桌面标题、版本、平台和三项镜像引用。

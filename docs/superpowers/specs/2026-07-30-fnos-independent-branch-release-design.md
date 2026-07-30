# fnOS 独立分支镜像与 FPK 发布设计

## 目标与不可变约束

SAG 的 fnOS Docker 应用适配长期保留在 `feat/fnos-docker-app`，不合并到
`main`，也不要求 `main` 携带 fnOS 的源码、包模板或发布工作流。

候选版本仍为 `1.4.0-fnos.1`，fnOS 对外只暴露 `3080`；API、Web 和生命周期
helper 仅在 Compose 内部使用。正式 `.fpk` 必须固定公开 GHCR API/Web 镜像与
官方 Nginx 镜像的 manifest-list digest。

## 方案选择

采用候选 Tag 触发 GitHub Actions：

- 长期开发分支：`feat/fnos-docker-app`；
- 候选 Tag：`fnos-candidate-<manifest version>-<12 位 commit 前缀>`，例如
  `fnos-candidate-1.4.0-fnos.1-dfd306d1c0e8`；
- Tag 必须指向远端专用分支的精确 HEAD；
- 工作流从 Tag 所指提交读取代码、测试、构建和发布。

不采用以下方案：

1. 专用分支每次 push 自动发布：普通开发提交会产生误发布和无意义 registry 写入；
2. Mac 使用 PAT 本地推送：扩大长期凭据、shell 历史和本机状态的风险，且弱化
   GitHub Actions 的可审计证据；
3. 将 dispatcher 或 fnOS 工作流合入 `main`：违反 fnOS 改造与主线彻底隔离的约束。

## 分支与 CI

`.github/workflows/ci.yml` 直接监听 `feat/fnos-docker-app` 的 push，因此关闭
面向 `main` 的 Draft PR 后，专用分支仍会持续运行：

- API Ruff 与完整 pytest；
- Web 类型检查、Lint、单元测试和生产构建；
- fnOS 发布 Compose、生命周期、认证、镜像状态机与真实包树渲染测试。

PR #1 关闭但不删除分支，不创建面向 `main` 的替代 PR。后续开发提交直接进入
该专用分支，并以分支 CI 作为提交门禁。

## 候选 Tag 门禁

镜像发布工作流只监听 `fnos-candidate-*` Tag，并在任何 registry 写入前验证：

1. 仓库必须是 `luoshuai990529/SAG`；
2. Manifest 的 `appname` 必须为 `sag`；
3. Manifest 版本必须为 `1.4.0-fnos.1`；
4. Tag 必须精确等于 `fnos-candidate-1.4.0-fnos.1-<HEAD 前 12 位>`；
5. Tag 解引用后的 commit 必须等于 checkout HEAD；
6. checkout HEAD 必须等于远端 `feat/fnos-docker-app` 的精确 HEAD；
7. 全部 fnOS 候选发布采用同一个 GitHub Actions concurrency 组串行化，不能取消
   正在发布的运行。

以上任一条件失败时，不授予或使用 registry 写入路径，也不创建候选标签。

## GHCR 发布数据流

工作流按以下顺序执行：

1. 在 Tag commit 上重新运行完整 CI；
2. 校验并扫描固定 Nginx digest；
3. 本地构建 API/Web `linux/amd64` 镜像，验证 readiness、密码首次初始化、日常登录
   和 Web 页面；
4. 使用唯一 staging Tag 构建并推送 API/Web 的 `linux/amd64,linux/arm64`
   manifest list；
5. 检查 staging 镜像的平台、OCI version 和源码 revision；
6. 捕获 API/Web manifest-list digest，并保存为 Actions artifact；
7. 使用捕获的精确 `image@digest` 在独立 job 中再次运行 amd64 认证和 Web 冒烟；
8. 以对账方式创建或确认 `1.4.0-fnos.1` 与 `sha-<commit>` 标签，若同名标签指向
   不同 digest 则失败；
9. 首次发布后，由维护者在 GitHub Package Settings 中一次性将 `sag-api`、
   `sag-web` 设为 Public；GitHub 官方 Packages REST API 不提供修改个人账户 Package
   可见性的接口，因此不得调用未公开接口自动修改；
10. 在不登录 GHCR 的 job 中匿名检查候选标签与精确 digest，私有或不一致均失败；
    首次运行因 Package 尚为 Private 而失败时，完成上述一次性页面操作后重新运行失败
    job，后续候选版本不再需要重复修改可见性。

Tag 只负责触发发布；`.fpk` 永远使用 digest，不依赖 Tag 的长期可变性。

## FPK 构建与交付

镜像工作流成功后，从 artifact 和匿名 registry 检查中取得：

- `ghcr.io/luoshuai990529/sag-api@sha256:<api index digest>`；
- `ghcr.io/luoshuai990529/sag-web@sha256:<web index digest>`；
- 已评审的官方 Nginx index digest。

Mac 使用官方 `fnpack 1.2.3` 和 `scripts/build-fnos-package.mjs` 构建：

- `dist/fnos/sag-1.4.0-fnos.1.fpk`；
- `dist/fnos/sag-1.4.0-fnos.1.fpk.sha256`。

构建器必须重新匿名检查候选 Tag 与所给 digest 的绑定、API/Web 多架构平台、Nginx
安全策略、真实渲染 Compose 和正式 `fnpack build`。输出包不得包含模型凭据、用户
数据或 registry 凭据。

## fnOS VM 验收顺序

1. 配置 Windows VMware `3080 -> 192.168.252.10:3080` NAT 和 `/24` 防火墙；
2. 在 fnOS 登录会话中完成 hello-docker 安装、打开、启停、卸载基线；
3. 上传正式 SAG `.fpk`，验证匿名拉取、桌面打开、无模型密钥启动和首次身份初始化；
4. 私下录入模型凭据，完成 Markdown/PDF、索引、检索、SSE、引用和 MCP；
5. 验证停止/启动、容器重建、fnOS 重启和完整冷备恢复；
6. 验证 `1.4.0-fnos.0 -> 1.4.0-fnos.1`、模拟失败回滚；
7. 验证默认保留卸载、重装恢复和显式删除；
8. 在 4 GB 配置下确认无 OOMKilled，并补齐脱敏日志、截图和验收矩阵。

## 失败处理与可恢复性

- 发布前失败：没有候选最终标签；瞬时失败可重跑原 Actions run，代码修复后使用新
  commit 前缀创建新的不可变候选 Tag；
- staging 后失败：保留唯一 staging Tag 作为审计证据，不提升候选标签；
- 部分最终标签已创建：重跑只补齐缺失且 digest 一致的标签；
- 同名最终标签 digest 冲突：失败闭锁，禁止覆盖；
- Package 无法通过 GitHub 页面公开或匿名拉取：不得构建或安装正式 `.fpk`；
- fnOS 安装失败：保留 `.fpk`、digest、SHA-256 和脱敏设备日志，不把本地结构包冒充
  设备验收结果。

## 验证要求

实现完成必须证明：

- 工作流不再包含 `refs/heads/main` 或 `workflow_dispatch` 前提；
- 错误 Tag、非专用分支 HEAD、旧 commit 和不同版本均在 registry 写入前失败；
- 专用分支 push CI 可以在 PR 关闭后运行；
- 普通 CI 不拥有 `packages: write`；
- 只有 staging/promotion job 拥有最小 `packages: write`；
- 两个 GHCR Package 可匿名检查；
- `.fpk` Compose 中三个镜像均为审查过的精确 digest；
- `main` 引用和内容保持不变。

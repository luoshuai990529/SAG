# fnOS 分支主线功能同步设计

## 背景与目标

`feat/fnos-docker-app` 是 SAG 面向飞牛 OS Docker 应用的永久独立维护分支，不会合回 `main`。当前 fnOS 分支已经完成无登录、同源单入口、三容器编排、数据持久化和 FPK 生命周期适配，但落后于 SAG 官方 `upstream/main` 的部分 API 修复、API 能力和 Web 交互优化。

本次同步只吸收会影响 fnOS 运行体验的功能代码，不追求让两条分支的全部文件或提交历史一致。完成后，fnOS 既应获得所选主线能力，也必须继续保持现有飞牛部署和无鉴权产品约定。

## 已确认的远程与历史关系

- 功能来源以 SAG 官方 `upstream/main` 为准，而不是个人 fork 的 `origin/main`。
- 审计时 `upstream/main` 为 `c4141a2`，`origin/main` 为 `4b41056`；官方主线比个人 fork 多 15 个提交，个人 fork 另有 1 个未进入官方主线的提交。
- fnOS 分支与官方主线的 v1.4 快照存在内容等价但 SHA 不同的重写历史；直接 merge 会重复纳入旧快照。
- Git 合并预演发现 14 个显式冲突，涉及 CI、文档、API 启动、模型策略、Web API 基址和 Compose 等关键位置。

因此，本次采用按功能提交进行前向移植，不直接 merge 整个 `upstream/main`，也不 rebase 已发布的 fnOS 历史。

## 隔离工作区

所有同步、冲突处理和测试必须在新 worktree 中完成，不得直接修改现有 fnOS worktree。

- 基线分支：`feat/fnos-docker-app`
- 基线提交：实施开始时远程 `origin/feat/fnos-docker-app` 的最新提交，不硬编码为本设计审计时的 `4642ed9`
- 临时分支：`sync/fnos-main-functional-20260803`
- worktree：`/Users/buu99y/workspace/github/agents/SAG/.worktrees/sync-fnos-main-functional-20260803`

创建 worktree 前必须确认永久分支已推送、现有 worktree 没有待提交的相关修改，并重新获取 `origin` 与 `upstream`。现有三个无关未跟踪文件不得移动、删除或纳入提交。

同步和验证完成后，将临时同步分支合回 `feat/fnos-docker-app`。合回动作只改变 fnOS 永久分支，不创建任何面向 `main` 的合并或 PR。

## 同步范围

### 纳入

按主线依赖顺序同步以下功能：

1. `31bda7a`：Dify 外部知识库 API；仅同步运行时代码、必要配置和测试，不把 Dify 专用 Compose 与部署文档放入 FPK。
2. `dc96502`：Web 来源 ID 复制入口及相关测试和多语言文本。
3. `5530c6b`：PostgreSQL 引擎 schema 初始化修复及测试；不移植与 fnOS 无关的通用 CI 改动。
4. `f4c48b8`：知识文档处理进度、重试、失败反馈和上传提示优化。
5. `948e3e3`：DeepSeek V4 Agent 工具路由修复。
6. `029c92b`：中文输入法组合输入期间按 Enter 不误提交聊天消息。
7. `8018cac`：Dify 外部知识库默认使用向量检索策略及必要配置。
8. `7d756d6`：与 Dify 向量策略相关的统计断言测试。
9. `87d8b16`：为 outline、grep、read 和 entity context 增加 REST API。

### 排除

- Desktop 客户端及其构建、签名和发布流程。
- SAG CLI、Skill、README、Dify 部署教程和英文文档迁移。
- 社区二维码、Discord 素材、CHANGELOG 和纯发布提交。
- 主线 `compose.yaml`、`compose.dify.yaml` 和通用部署方式。
- 与 fnOS 候选镜像或 FPK 无关的 CI 工作流修改。

如果某个排除文件是测试运行所必需的配置，则只吸收最小必要片段，并在同步提交中明确说明原因。

## 同步方法与提交结构

无冲突且没有夹带排除内容的提交使用 `git cherry-pick -x`，以便保留主线来源。包含冲突或无关文件的提交采用语义移植：以原提交 diff 为需求依据，只移植目标功能，并在新提交信息中记录来源 SHA。

建议形成以下独立批次：

1. Dify API 基础能力。
2. PostgreSQL 和模型兼容修复。
3. 文档处理体验改进。
4. Web 来源复制和输入法修复。
5. Dify 向量策略与 REST 知识 API。
6. fnOS 集成修正、测试与候选包版本更新。

每个批次必须可单独审查；不得用一个大提交掩盖冲突解决，也不得使用 `ours` 或 `theirs` 对整棵目录做机械覆盖。

## fnOS 不变量

冲突解决必须保留以下行为：

- SAG 不执行登录校验，不要求密码、初始化密钥或重复输入用户名。
- 用户名仅是 SAG 使用过程中的资料字段，不是认证凭证。
- `NEXT_PUBLIC_API_BASE=/` 继续表示浏览器同源访问。
- 对外只暴露 gateway 的 `3080`，API `8000` 和 Web `3000` 仅在 Compose 网络内可见。
- fnOS 使用 `sag-api`、`sag-web`、`sag-gateway` 三容器结构。
- `${TRIM_PKGVAR}/data` 对应 API `/data`，数据、备份、升级和卸载保留语义不变。
- FPK 使用固定镜像版本或 digest，不使用 `latest`，不引入 `build:`。
- fnOS 轻量资源参数和无模型密钥可启动能力不退化。

主线功能如果依赖认证状态、主线双端口或主线 Compose，必须改写为适配上述不变量的实现，而不是直接照搬。

## 验证与失败处理

每批同步后运行其直接相关测试，尽早定位语义冲突。全部同步后至少执行：

- API Ruff、相关 pytest 与完整可行的 API 测试集。
- Web 单测、类型检查、Lint 和生产构建。
- 同源 REST、SSE、MCP、上传以及新增 REST 知识 API 验证。
- fnOS 静态门禁：单端口、固定镜像、无弱密钥、无 `build:`、持久化路径和生命周期脚本。
- amd64 三容器启动及 gateway/API health 检查。
- 无登录首次打开、文档上传处理、来源 ID 复制、中文输入法聊天和现有知识库检索回归。

若某个主线功能无法在不破坏 fnOS 不变量的情况下移植，则停止该批次，保留已通过验证的前序批次，并记录未同步原因；不得为了追求提交数量强行合入。

## 合回与体验包

临时同步分支通过测试后，先输出提交映射、冲突处理摘要、排除项和测试证据，再合回 `feat/fnos-docker-app`。合回前再次确认目标分支没有出现新的远程提交；若已前进，先在临时 worktree 中同步并重测。

合回后构建一个新版本 FPK 和 SHA-256 文件交付体验。版本号在实施计划中根据当前 manifest 和已发布候选包确定，不覆盖已有 `1.4.0-fnos.4` 包。交付说明必须逐项列出本轮新增能力、修复、已知限制和建议验证步骤。

## 完成标准

- 选定的九个主线功能提交均有“已移植、部分移植或明确排除”的可追溯结论。
- fnOS 无鉴权、单入口、容器拓扑、数据持久化和 FPK 生命周期行为保持不变。
- 相关 API、Web、容器和 FPK 验证通过，失败项有明确原因且不被掩盖。
- 同步工作只发生在专用 worktree，最终只合入 `feat/fnos-docker-app`。
- 生成新的可安装 FPK，并提供变更说明和验收清单。

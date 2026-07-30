# SAG `1.4.0-fnos.1` 验收矩阵

执行日期：2026-07-29 至 2026-07-30（Asia/Shanghai）

基线：`origin/main@06f29b2ae571dfcedecc85577ee6910ed87a810a`

候选分支（被测代码）：`feat/fnos-docker-app@81abb9fe968d42d583ff55cadf9a1efa26ce4503`

设备基线：fnOS 1.2.0302，x86-64 VMware，2 vCPU / 4 GB

当前管理入口：`http://192.168.50.178:15666`

计划 SAG 入口：`http://192.168.50.178:3080`

状态含义：

- **通过**：本轮有可重复命令和结果；
- **待证据**：前序交接记录称已执行，但本仓库尚无可复核的脱敏日志或截图，不能计为通过；
- **待执行**：需要 GHCR、Windows 或 fnOS 设备外部状态；
- **阻塞**：当前外部门禁不满足，不能产出正式发布物；
- **不适用**：明确不在本候选版支持边界内。

## 开发机与静态验收

| ID | 验收项 | 状态 | 版本/日志摘要 | 日志或截图位置 |
| --- | --- | --- | --- | --- |
| MAC-01 | Docker daemon、Buildx、Compose、hello-world | 通过 | Engine 29.6.2；Buildx 0.35.0；Compose 5.3.1；hello-world 使用 arm64v8 | 本文档摘要；无 UI 截图 |
| MAC-02 | `fnpack` 安装与校验 | 通过 | 1.2.3；SHA-256 `d40cb00896cb2a5d211357d255750ed0cbe7f2d141df671c2b717afb4e74bf77` | [Mac 准备](./mac-preparation.md) |
| MAC-03 | 官方 hello-docker 本地 `fnpack build` | 通过 | 临时 `.fpk` SHA-256 `39c0090f2ca037c70af42c1197c1940329959722ceca2a914cdb291e90f61b87` | [Mac 准备](./mac-preparation.md) |
| CODE-01 | API Ruff | 通过 | `uv run ruff check sag_api/ sag_agent/ tests/`：All checks passed | 命令摘要；截图不适用 |
| CODE-02 | API pytest | 通过 | 最终 macOS ARM64、本地 Linux amd64 与 GitHub Linux x86-64 均为 216 passed；早期锁修复提交的 Backend 初跑及两次主动重跑均成功；无 SQLite 锁冲突 | [CI-02 证据](./evidence/2026-07-30/ci-02/summary.md) |
| CODE-03 | Web 单测 | 通过 | `npm run test:unit`：49 files、358 tests passed | 命令摘要；截图不适用 |
| CODE-04 | Web 类型/Lint/生产构建 | 通过 | `tsc --noEmit`、ESLint 0 warning、Next.js 15.5.20 production build 均通过 | 命令摘要；截图不适用 |
| CODE-05 | GitHub CI 与独立复审 | 通过 | PR #1 最终被测提交 `81abb9f` 的后端、前端、fnOS 发布安全回归均成功；独立复审无 Critical/Important/Minor。fnOS 改造按产品决策永久保留在 `feat/fnos-docker-app`，关闭 PR #1，不合并 | [CI-02 证据](./evidence/2026-07-30/ci-02/summary.md) |
| PKG-01 | 发布 Compose 拒绝可变镜像、弱密钥和额外端口 | 通过 | CI 运行发布 Compose、包、生命周期与文档行为测试；以 CI 日志的具体测试清单为准，不维护易过期的合计数字 | 命令摘要；截图不适用 |
| PKG-02 | 生命周期脚本与完整数据冷备行为 | 通过 | 包含空间/命令失败、冷备原子发布、失败后服务恢复和卸载选择回归 | 命令摘要；截图不适用 |
| PKG-03 | Shell/JSON/Compose 静态检查 | 通过 | 10 个 Bash 脚本、4 个 JSON、源码与包模板 Compose config 均通过 | 命令摘要；截图不适用 |
| PKG-04 | 临时结构包 `fnpack build` 和 SHA-256 | 通过 | API/Web 使用 `test.invalid` digest、gateway 使用受评审正式 digest，仅在临时目录构建；SHA-256 `3cd3fc69ff43a55ccdf256f4bb3473c6f27bd47c4bd258f80d96dc72a40213fc`；不可分发 | 命令摘要；截图不适用 |
| PKG-05 | 正式 `sag-1.4.0-fnos.1.fpk` 和 SHA-256 | 阻塞 | API/Web 公共 manifest-list digest 尚未发布，构建脚本会拒绝不存在的引用 | `docs/fnos/evidence/2026-07-29/pkg-05/summary.md`（待生成） |
| SEC-01 | 固定 Nginx gateway OCI metadata 与漏洞门禁 | 通过 | `docker.io/library/nginx:1.30.4-alpine@sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46`；amd64/arm64 子 manifest 的上游 revision 均为 `ccdab6c99ae2e2fc53a144dc68d6b8f44163adf2`；Trivy 0.70.0 对 linux/amd64 的可修复 Critical/High 为 0；`reviewedAt=2026-07-29T08:33:41Z`，`expiresAt=2026-08-28T08:33:41Z`（边界排除） | [SEC-01 证据](./evidence/2026-07-29/gateway-security/summary.md) |

## 网络和 fnOS 生命周期验收

| ID | 验收项 | 状态 | 预期/日志摘要 | 截图位置 |
| --- | --- | --- | --- | --- |
| NET-01 | Mac 打开 fnOS 管理入口 | 通过 | 2026-07-30 实测管理入口 HTTP 200，Chrome 显示 fnOS 登录页；此项不代表已登录或 `3080` 可用 | [NET-01 证据](./evidence/2026-07-30/net-01/summary.md) |
| NET-02 | Windows `3080` NAT 与 `/24` 防火墙限制 | 待执行 | 需在 Windows VMware/防火墙配置后从 Mac 验证 | `docs/fnos/evidence/<date>/net-02/` |
| FPK-01 | hello-docker 安装、打开、启停、卸载 | 待执行 | fnOS 管理会话需要用户登录 | `docs/fnos/evidence/<date>/fpk-01/` |
| FPK-02 | SAG 全新安装、桌面打开、无模型密钥启动 | 阻塞 | 依赖 PKG-05、NET-02 和 fnOS 登录 | `docs/fnos/evidence/<date>/fpk-02/` |
| FPK-03 | 密码模式首次初始化与日常登录 | 待执行 | 一次性私有 bootstrap + ≥12 位且 UTF-8 ≤72 字节的密码创建首个用户；缺失/错误密码、仅名字、不同名字和改名均以相同错误拒绝；正确名字+密码成功；初始化后 bootstrap 重放及第二次公开注册被拒绝。证据不得包含 bootstrap、密码或 `sag.env` 内容 | `docs/fnos/evidence/<date>/fpk-03/` |
| FPK-04 | 本地管理员认证恢复 | 待执行 | 两次枚举并检查全部项目容器，仅 `created`/`exited` 可继续；先原子发布 `0600` 新 bootstrap，依次 fsync 文件/目录，再调用数据库 reset。检查竞态、发布失败、两个 fsync 失败均在 DB 前闭锁；DB helper 客户端失败按提交状态未知处理，保持停服重跑并发布又一个新值。证据只含退出状态、脱敏顺序、文件模式及旧 JWT 拒绝，不含凭据。成功后只有原名字+新密码+新 bootstrap 可初始化一次，错误名字/停用用户拒绝 | `docs/fnos/evidence/<date>/fpk-04/` |
| NET-03 | HTTP/TLS 信任边界 | 待执行 | `:3080` 仅在可信隔离 LAN/受控 VPN 使用；公共/共享 Wi-Fi 禁止输入任何凭据。任何不可信访问以外部 HTTPS 反向代理验收为前置门禁；HTTPS 下 Cookie 有 Secure，当前 Bearer 架构不支持 HttpOnly | `docs/fnos/evidence/<date>/net-03/` |
| BIZ-01 | Markdown/PDF 上传、抽取、索引、检索 | 待执行 | 凭据私下录入且不进入证据 | `docs/fnos/evidence/<date>/biz-01/` |
| BIZ-02 | SSE 流式问答和引用打开 | 待执行 | 浏览器请求保持 `:3080` 同源，无 CORS/SSE 中断 | `docs/fnos/evidence/<date>/biz-02/` |
| BIZ-03 | MCP URL 和转发头 | 待执行 | `/mcp/` 同源，Host/X-Forwarded-* 正确 | `docs/fnos/evidence/<date>/biz-03/` |
| DATA-01 | 停止/启动、容器重建、fnOS 重启数据保留 | 待执行 | 用户、SQLite、LanceDB、上传原文和索引均保留 | `docs/fnos/evidence/<date>/data-01/` |
| DATA-02 | 完整冷备恢复到新实例 | 待执行 | 恢复完整 `/data`，旧文档可检索和打开 | `docs/fnos/evidence/<date>/data-02/` |
| PATH-01 | 生命周期 callback 路径信任链与最终 bind source | 待执行 | 在 UPG-01、UN-02 前记录 callback EUID/EGID；逐级记录所有能替换 `${TRIM_PKGVAR}`、`data`、`backup` 的祖先目录所有者及组/其他用户写权限；记录 `docker compose config` 解析结果和实际容器最终 bind source。脱敏证据必须保留为 `summary.md` 和 `command.log` | `docs/fnos/evidence/<date>/path-01/` |
| UPG-01 | `1.4.0-fnos.0 -> 1.4.0-fnos.1` | 待执行 | 前置 PATH-01 通过；备份空间门禁、冷备；原 JWT secret 不轮换、独立一次性 bootstrap 原子补齐；缺少认证版本的旧 JWT 被拒绝；旧用户只可用原名字+bootstrap+新密码初始化，名字/历史隐式密码不能登录；旧知识库可检索 | `docs/fnos/evidence/<date>/upg-01/` |
| UPG-02 | 模拟失败与回滚 | 待执行 | 活动数据不损坏，完整数据与匹配镜像一起回滚 | `docs/fnos/evidence/<date>/upg-02/` |
| UN-01 | 默认保留卸载并重装恢复 | 待执行 | 先确认 fnOS 是否清理私有运行目录；必要时使用外部保留副本 | `docs/fnos/evidence/<date>/un-01/` |
| UN-02 | 明确删除数据卸载 | 待执行 | 前置 PATH-01 通过；仅显式选择后删除；执行前二次确认外部备份 | `docs/fnos/evidence/<date>/un-02/` |
| PERF-01 | 4 GB 轻量档无 OOM | 待执行 | 并发 1/2、缓存 4、预热 1；完整业务流程无 OOMKilled | `docs/fnos/evidence/<date>/perf-01/` |

## 正式发布门禁

| ID | 门禁 | 当前结论 |
| --- | --- | --- |
| REL-01 | GHCR API/Web 公开多架构镜像 | 阻塞：先确认 `feat/fnos-docker-app` 远端 HEAD 的普通 CI 全绿，再推送精确的 `fnos-candidate-1.4.0-fnos.1-${revision:0:12}` Tag；Tag 门禁在 registry 写入前拒绝错误版本、旧提交和非独立分支 HEAD。工作流完成 amd64 本地 smoke、唯一 staging index、元数据检查、捕获 digest 的密码认证/Web 冒烟和对账式提升。首次发布后在两个 Package Settings 中一次性设为 Public，再重新运行无登录的匿名 postcheck；`fnos-verified-digests-*` artifact 和四个最终引用作为证据。当前尚未发布，包不可匿名检查。 |
| REL-02 | x86-64 fnOS 实机 | 待执行：VM 结果不能替代实机认证 |
| REL-03 | ARM64 fnOS 实机 | 不适用：本候选包声明 x86；正式声明 ARM64 支持前必须新增实机认证 |
| REL-04 | 飞牛应用中心上架 | 待执行：发布材料、审核和平台反馈属于候选版之后的门禁 |
| REL-05 | Nginx gateway 安全复核有效 | 当前有效，严格早于 `2026-08-28T08:33:41Z`（Asia/Shanghai `2026-08-28T16:33:41+08:00`）：staging 依赖只读 gateway-security job；它复核官方 OCI index，并用 checksum 固定的 Trivy 0.70.0 阻断非零退出、不完整证据及可修复 Critical/High。镜像、scanner/DB 或 policy 变化及到期时必须重新复核，不能只延长时间。 |

只有 PKG-05、NET-02、FPK/BIZ/DATA/UPG/UN/PERF 设备用例以及 REL-02 完成后，才能把 `1.4.0-fnos.1` 标记为 x86 正式候选交付物。构建出临时结构包不等于设备验收。

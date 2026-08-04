# SAG fnOS 双架构离线应用中心交付计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Each checkbox is an independently verifiable delivery step.

**Goal:** 以一个用户可见的 SAG 应用中心条目，交付 x86 与 ARM64 两种可离线安装的 fnOS FPK，使国内网络无法访问 GitHub、GHCR 或 Docker Hub 的用户仍可完成安装、打开和使用。

**Architecture:** 每个版本从同一 `feat/fnos-docker-app` commit 构建 API/Web/Gateway 的 x86 与 arm64 OCI 镜像；随后导出各架构所需镜像 archive，并分别封装为离线 FPK。安装脚本在不联网时校验并导入本机架构镜像，Compose 只使用已导入的精确镜像；应用中心将两个技术包关联到同一个 SAG 应用条目，由 fnOS 按设备架构匹配。

**Supersedes:** [2026-08-04-fnos-production-release.md](2026-08-04-fnos-production-release.md) 中“GHCR/GitHub Release 为首要用户安装通道”的部分；其中版本、验收、回滚和不可变产物原则继续保留。

## 不变约束

- 分支永久为 `feat/fnos-docker-app`，不合回 `main`。
- SAG 对用户仍是一个应用，不上架为 “SAG x86” 与 “SAG ARM64” 两个条目。
- x86 与 ARM64 包使用同一用户版本号、同一 `appname=sag`、同一数据格式、同一 3080 端口和无登录体验。
- 每个包只携带其目标架构镜像；x86 包不含 arm64，ARM64 包不含 x86。
- 用户安装主路径不依赖 GHCR、Docker Hub、GitHub 或外部镜像加速器；这些仅用于开发构建与可选在线恢复。
- `/data` 始终是完整知识库兼容边界；升级、卸载和恢复规则在两种架构一致。

## 阶段 0：先向飞牛确认平台能力（需要你介入）

在提交应用中心申请表后，请向飞牛官方确认以下问题，并把书面答复或工单编号交给我：

1. 同一个 `appname/version` 是否支持分别提交 `platform=x86` 与 `platform=arm64` 两个 FPK，并在应用中心合并为一个用户可见条目？
2. FPK 是否允许随包携带 OCI/Docker image archive；安装/升级脚本是否允许安全调用 Docker 镜像导入能力？
3. 单个 FPK 的上传、审核、分发和更新包体大小上限分别是多少？
4. 离线镜像包是否有额外病毒扫描、签名、许可证或 SBOM 要求？
5. 应用中心是否会在安装时强制 `docker compose pull`，以及如何标识“本地预置镜像优先、无网络不拉取”？
6. ARM fnOS 的最低受支持系统版本、可用测试渠道和审核设备要求是什么？

**门禁：** 未收到第 1、2、3、5 项确认前，不承诺离线 FPK 可上架；仅继续做不依赖官方结论的本地镜像导入 PoC。

## 阶段 1：离线镜像最小 PoC

**代码工作：**

- 为 `packages/fnos/sag/` 增加 `images/<arch>/` 资产目录及 manifest；每项记录原始 OCI digest、archive SHA-256、目标平台和许可证信息。
- 新增安装前校验：拒绝 archive 哈希错误、架构不匹配、镜像 tag/digest 与 Compose 不一致、空间不足或 Docker 导入失败。
- 新增安装/升级生命周期：先导入镜像，再启动 Compose；卸载默认保留 `/data`，但可清理该应用导入的镜像层。
- Compose 改为引用本地已导入的不可变版本标识，且任何正常离线安装路径都不得触发远端 pull。

**测试：**

1. 写失败测试：没有 archive、哈希错误、arm64 archive 装入 x86、x86 archive 装入 ARM64、导入中断均拒绝且不启动服务。
2. 在 x86 fnOS VM 断开外网后，全新安装最小镜像 PoC，启用并打开应用。
3. 删除本地远端镜像缓存后重复测试，证明成功不来自已缓存的 GHCR 镜像。

**需要你准备：** 无；现有 x86 fnOS VM 足够。

## 阶段 2：构建双架构离线技术包

**代码工作：**

- GitHub Actions 继续构建 API/Web 的 `linux/amd64` 与 `linux/arm64`，但新增逐架构导出任务：`docker save`/OCI archive 后压缩、计算 SHA-256、生成 SBOM 与镜像清单。
- Gateway 也必须导出其审核过的对应平台 image，而不是在用户设备上拉取 Docker Hub Nginx。
- 新增 `release-fnos.mjs offline-package --arch x86|arm64`：只接收经过验证的 archive manifest，生成各自 FPK、SHA-256、SBOM、release manifest。
- 在 manifest 中分别声明 `platform=x86`、`platform=arm64`；不得把 `all` 作为未验证的兼容性承诺。

**测试：**

1. 单元测试验证 x86 FPK 中没有 arm64 layer，ARM64 FPK 中没有 x86 layer。
2. 解包后校验三个服务的本地镜像 digest、archive SHA-256、版本与 source commit 完全一致。
3. 断网构建回放：从 archive 导入后执行 Compose，不发生 DNS 查询或 registry HTTP 请求。

**需要你准备：** ARM64 fnOS 真机或官方 ARM 测试设备。没有它时，ARM64 包可以构建但不能宣布支持或提交应用中心。

## 阶段 3：双架构真实 fnOS 验收

每个架构独立执行并记录：

1. 断网全新安装、启用、桌面打开；
2. 首次仅输入工作区用户名，不出现密码或初始化密钥；
3. Markdown/PDF 上传、索引、检索、流式问答、引用与 MCP；
4. 停止/启动、容器重建、fnOS 重启后的数据保留；
5. 升级前完整冷备、升级成功、模拟升级失败恢复、旧知识库检索；
6. 默认卸载后重装恢复、明确删除数据卸载；
7. 4 GB 资源档基本流程无 OOM；
8. 在无 GitHub/GHCR/Docker Hub/DNS 外网条件下重复安装，证明用户主路径完全离线。

**需要你准备：**

- x86：现有 Windows/VMware fnOS VM；
- ARM64：一台可安装当前 fnOS ARM 的设备、局域网访问方式与至少 4 GB 可用内存；
- 私下提供测试模型与 Embedding 凭据，且不写入日志、截图或仓库。

## 阶段 4：应用中心双架构提交与灰度

**提交物：** 同版本的 x86 FPK、ARM64 FPK、各自 SHA-256、SBOM、镜像清单、测试矩阵、截图、隐私说明、开源许可证清单、支持与恢复文档。

**流程：**

1. 使用飞牛确认的后台/`appcenter-cli` 流程创建一个 SAG 应用条目；
2. 先上传 x86 技术包，在 x86 测试设备确认应用中心可见、安装和更新；
3. 上传相同版本的 ARM64 技术包，在 ARM64 测试设备确认平台自动匹配；
4. 若官方要求分别建立架构发布记录，仍保持同一展示条目和版本说明；
5. 先小范围灰度，收集安装、导入耗时、磁盘占用、升级及失败日志；
6. 灰度门禁全部通过才转正式公开。

**需要你准备：**

- 飞牛应用中心上架申请与官方答复；
- 发布主体资料：开发者/公司名称、联系人、邮箱、官网或 GitHub、支持渠道；
- 应用介绍、中文截图、图标、隐私政策链接与许可证归属确认；
- 如飞牛要求，营业主体或其他资质材料由你提供，不能由代码替代。

## 阶段 5：稳定更新与用户支持

- 每次更新同时发布 x86 与 ARM64 离线包；任何一侧未通过验收则该版本不标记为双架构稳定版。
- 应用中心更新包必须包含新增镜像 archive；不依赖用户本地缓存或外网拉取。
- 发布说明列出包体积、安装所需空闲空间、更新前备份要求、已验证 fnOS 版本和架构。
- 发现镜像安全漏洞时，重新构建并发布新离线 FPK；不得依赖远端自动拉取热修复。
- 保留最近两个稳定版本的离线包和完整恢复说明，支持可追溯回滚。

## 当前优先级与下一次反馈点

1. 先完成阶段 0 的官方确认；这是离线 FPK 是否能以官方方式上架的关键外部依赖。
2. 同时实施阶段 1 的 x86 断网 PoC；完成后给你一个只用于体验的离线 x86 FPK，并说明包体积、导入耗时和变更。
3. 在你提供 ARM64 测试设备后，实施阶段 2–3 的 ARM64 FPK 与真机验收。
4. 两种架构均通过后，进入应用中心灰度上架。

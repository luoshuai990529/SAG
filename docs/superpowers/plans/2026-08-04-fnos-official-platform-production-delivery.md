# SAG fnOS 官方平台生产交付全链路计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Each stage produces a testable artifact and an explicit release decision.

**Goal:** 在飞牛应用中心以一个 SAG 条目交付轻量、国内可安装、自动兼容 x86 与 ARM64 的 Docker 应用；用户不需要理解镜像仓库、CPU 架构或 Docker Compose。

**Official-platform baseline:** 按飞牛 Docker 应用案例，Docker 应用包主要携带 Compose 和应用资源；当包内没有平台相关本地二进制时使用 `platform=all`，由支持多架构的镜像在目标 fnOS 上匹配设备架构。案例要求验证“目标设备可以拉取镜像”，因此不把未获官方确认的“镜像内嵌 FPK”作为首个应用中心发布方案。[官方 Docker 应用案例](https://developer.fnnas.com/docs/examples/docker/)

## 目标产品形态

用户在飞牛应用中心只看到一个「SAG」：

- 点击安装后，fnOS 从 SAG 维护的国内可达镜像仓库拉取匹配本机架构的 API、Web、Gateway 镜像；
- x86 用户自动获取 `linux/amd64`，ARM64 用户自动获取 `linux/arm64`；
- FPK 保持轻量，只包含应用描述、Compose、入口、生命周期脚本、图标和文档；
- 首次进入只填写工作区用户名，不要求 SAG 密码或初始化密钥；
- 仅暴露 `3080`，数据保存在 `/data`，停止、升级、卸载与恢复行为在两种架构一致。

“国内可安装”指用户无需访问 GitHub、GHCR 或 Docker Hub；它不代表模型服务无需网络。用户仍需自行选择可访问的 LLM/Embedding 服务并配置其凭据。

## 发布架构

```text
feat/fnos-docker-app commit
        │
        ├─ API/Web: amd64 + arm64 OCI manifest lists
        ├─ Gateway: amd64 + arm64 reviewed manifest list
        │
        ├─ SAG 受控的国内可达 OCI registry
        │       └─ 相同不可变 digest / 多架构 manifest list
        │
        └─ 一个 platform=all SAG FPK
                └─ fnOS 自动拉取目标架构镜像 → 3080 → SAG
```

镜像 registry 是用户体验核心：它必须由 SAG 控制或有书面运维协议，支持匿名拉取、TLS、稳定域名、按 digest 拉取、amd64/arm64 manifest list 和镜像留存。普通 Docker Hub 加速器不能作为 SAG API/Web 的正式保障，因为它们来自独立 registry。

## 阶段 0：飞牛平台与发布主体确认（需要你介入）

你提交飞牛应用中心上架申请后，请确认并反馈：

1. `platform=all` 的 Docker FPK 是否可在应用中心同时面向当前 x86 与 ARM fnOS 分发；
2. 应用中心对第三方 OCI registry 的允许范围、镜像域名要求、匿名拉取及镜像审核要求；
3. 上架 FPK、截图、隐私政策、SBOM、许可证、开发者主体和审核测试账号的材料清单；
4. ARM fnOS 的最低版本、正式支持范围、测试或审核设备要求；
5. 应用中心是否提供官方镜像镜像/代理服务；若提供，其对 GHCR 和 Docker Hub 的支持边界；
6. 更新、下架、灰度、回滚以及同一条目多架构镜像的后台操作方式。

**你需要准备：** 发布主体名称、联系人邮箱、官网/GitHub、支持渠道、应用图标与中文截图、隐私政策链接、许可证归属说明。若飞牛要求企业资质或审核设备，由你提供。

**门禁：** 未确认 registry 规则前，不提交应用中心；研发可继续进行镜像瘦身、多架构构建和本地/VM 验证。

## 阶段 1：镜像瘦身与运行能力拆分

当前 API x86 镜像约 1.99 GB，其中 Python 依赖层约 1.04 GB、构建工具层约 336 MB；在未优化前不得把它作为用户下载体积基线。

实施内容：

1. 将 API Dockerfile 改为多阶段构建：编译工具只存在于 wheel/build 阶段，运行镜像仅保留运行时库与已构建 wheel；
2. 生成依赖体积清单，识别 Torch、文档解析、数据库驱动等重依赖；
3. 保留“上传、SQLite/LanceDB、索引、检索、流式问答、MCP”所需能力，不能仅为减重移除核心功能；
4. 可选解析器或非核心 provider 只有在不影响默认体验时才拆为受控扩展镜像；
5. 重新构建 amd64/arm64，记录压缩传输体积、冷启动时间、内存和完整产品回归。

**验收：** 两种架构均通过 API/Web 测试、镜像健康检查和完整知识库闭环；发布说明使用实测下载量而非未压缩层大小。

**需要你准备：** 无。若需决定是否将某个重型解析能力变为可选功能，我会在该决策点说明影响并请你确认。

## 阶段 2：多架构镜像与国内网络交付

实施内容：

1. GitHub Actions 构建 API/Web `linux/amd64,linux/arm64` manifest list，Gateway 继续使用审核过的多架构 digest；
2. 将三个镜像按精确 digest 镜像到 SAG 受控的国内可达 registry；保留 commit、SBOM、扫描结果和原始/镜像后 digest 证据；
3. FPK Compose 只引用该 registry 的精确多架构 digest，不引用 `latest`、GitHub/GHCR 或不受控加速源；
4. 增加 registry 连通性检查：DNS、TLS、匿名 manifest 拉取、amd64/arm64 manifest 可用性和指定架构 pull；
5. 当国内 registry 不可用时，fnOS 界面/日志输出可操作错误：检查网络或联系支持；不得静默回退到境外镜像站造成长时间卡顿。

**验收：** 在无法访问 GitHub、GHCR、Docker Hub 的网络中，fnOS 仍能从该国内 registry 完成首次安装、启用和重启后的容器重建。

**需要你准备：** 一个组织可控制的 OCI registry 资源（企业 Harbor、云厂商容器镜像服务或域名/账户），或飞牛官方确认的镜像服务。涉及云账户、域名、费用、地域与运维责任时由你决定；我会提供镜像命名、权限与验证要求。

## 阶段 3：轻量 `platform=all` FPK 与生命周期

实施内容：

1. 将 manifest 设为 `platform=all`，保持 `service_port=3080`、`checkport=true`、`ctl_stop=true`；
2. Compose 保持 API/Web/Gateway 三服务、唯一 3080 宿主端口，镜像引用为阶段 2 的不可变多架构引用；
3. 保持无认证 single-user 行为；用户名只用于工作区资料；
4. 保持升级前完整 `/data` 冷备、默认卸载保留数据、明确删除才清理数据；
5. 新增安装前 registry 可达性诊断与启动失败提示，不在 FPK 中塞入多 GB 镜像 archive；
6. 生成 FPK、SHA-256、release manifest、SBOM 与安装/恢复文档。

**验收：** FPK 保持轻量；新装只下载目标 CPU 的镜像，不下载另一架构层；`cmd/main status` 同时反映 gateway 和 API readiness。

## 阶段 4：x86 与 ARM64 双设备验收

每种架构必须独立执行：

1. 全新安装、启用、桌面打开、停止/启动；
2. 首次用户名体验，无密码/初始化密钥；
3. Markdown/PDF 上传、索引、检索、流式问答、引用、MCP；
4. 容器重建、fnOS 重启、升级、失败恢复、默认卸载重装、明确删除数据卸载；
5. 国内受限网络安装：禁止 GitHub/GHCR/Docker Hub，允许国内 registry；
6. 4 GB 资源档完成基本流程，无 OOM。

**你需要准备：**

- x86：现有 fnOS VM 可继续使用；
- ARM64：一台运行飞牛当前支持版本的 ARM64 fnOS 设备，至少 4 GB 可用内存，并提供局域网测试访问；
- 私下模型与 Embedding 测试凭据；不写入仓库、日志和截图。

**门禁：** 未经 ARM64 真机验收，不对外宣称 ARM64 支持；此时应用中心发布范围应按飞牛允许的架构范围收窄。

## 阶段 5：应用中心灰度与正式发布

1. 用阶段 0 确认的流程创建一个 SAG 条目，提交轻量 FPK、描述、图标、截图、隐私/许可证/SBOM、支持与恢复文档；
2. 在飞牛测试/灰度渠道验证 x86 与 ARM64 设备都看见同一 SAG 条目且拉取各自架构镜像；
3. 记录首次安装成功率、下载耗时、镜像拉取失败原因、3080 打开成功率、升级/回滚结果；
4. 灰度期间保留上一稳定镜像 digest 和 FPK，出现缺陷时先停止推荐，再发布新版本，绝不覆盖可追溯版本；
5. 所有门禁通过后转正式公开，并发布已支持架构、fnOS 版本、国内网络前置条件、模型配置和数据恢复说明。

## 异常网络的用户兜底

- 首选：国内 registry 稳定可达，用户无需任何额外配置；
- 次选：应用提示 registry 网络诊断和官方/产品支持入口；
- 特殊企业内网：后续在飞牛书面确认后提供管理员离线镜像导入包，不将其作为首个应用中心通用包；
- 绝不把 GHCR、GitHub 或临时公共加速器作为国内用户的隐含前置条件。

## 每次迭代对你的交付

每个阶段性版本都会给你：版本号、变更摘要、FPK/镜像产物位置、SHA-256、测试通过项、未通过项、截图/日志位置，以及你下一步需要提供的资料或设备。只有通过对应阶段门禁，才进入下一阶段。

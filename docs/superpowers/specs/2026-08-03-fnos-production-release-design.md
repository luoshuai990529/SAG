# SAG fnOS Production Release Design

## Purpose

将当前可手动安装的 fnOS 候选包，演进为可重复、可审计、可回滚的稳定版交付流程。首个正式分发渠道为 GitHub Release；飞牛应用中心上架在稳定交付完成后独立推进。

## Current State and Decision

`feat/fnos-docker-app` 是永久独立的 fnOS 适配分支，不会合回仓库 `main`。当前 `sag-1.4.0-fnos.6.fpk` 是发布候选（RC）而非稳定版：它引用已验证的不可变镜像 digest，且候选镜像工作流已通过，但 FPK 是本地生成并由用户手动上传，尚未以 GitHub Release 形式发布。

现有能力分布如下：

| 能力 | 当前实现 | 缺口 |
| --- | --- | --- |
| 多架构 API/Web 镜像 | `fnos-candidate-*` 工作流构建、扫描、冒烟、推送 GHCR | 无稳定 FPK 自动产物 |
| 镜像不可变性 | `fnos-release-registry.mjs` 验证和提升精确 digest | 无稳定发布编排入口 |
| FPK 构建 | `build-fnos-package.mjs` 使用三个精确 digest 生成包 | 需人工传参、无发布记录 |
| 包内安全校验 | Compose、网关策略、生命周期和打包测试 | 无集中验收证据与版本发布门禁 |
| 用户分发 | 手动上传本地 FPK | 无 GitHub Release、校验说明和回滚指南 |

正式方案采用“两阶段自动发布”：候选阶段只验证和发布镜像；稳定阶段只消费已经验证的候选产物，并在人工 fnOS 验收确认后创建 GitHub Release。稳定阶段绝不重新构建或重新解析可变镜像标签。

## Release Model

### Version channels

| 渠道 | 标记与产物 | 用途 | 是否可面向普通用户 |
| --- | --- | --- | --- |
| Development | fnOS 分支普通提交 | 功能开发与本地验证 | 否 |
| Candidate | `fnos-candidate-<version>-<sha>`、GHCR 镜像 | 自动化测试和真机体验 | 仅内测 |
| Release candidate package | `sag-<version>.fpk`、`.sha256` | 人工上传到 fnOS 的验收包 | 仅内测 |
| Stable | GitHub Release 的 FPK、SHA-256、digest 清单和说明 | 受支持的用户安装版本 | 是 |
| App Center | 飞牛应用中心条目 | 后续官方渠道分发 | 是，独立阶段 |

`1.4.0-fnos.6` 在完成新流程前保持候选含义；不追溯改名为稳定版。首个稳定版本从下一次通过全部门禁的版本号开始，例如 `1.4.0-fnos.7`（实际版本号由发布负责人在准备阶段确定）。

### Source of truth

稳定发布记录必须同时包含：

- `feat/fnos-docker-app` 的精确 Git commit；
- API、Web、Gateway 三个 OCI manifest-list digest；
- FPK 的 SHA-256；
- GitHub Actions 候选工作流 run URL/编号；
- 真机验收矩阵与执行日期；
- 升级与回滚结论。

任何一项缺失，均不能创建稳定 GitHub Release。

## Architecture

### 1. Candidate stage: immutable image evidence

发布负责人从干净的 `feat/fnos-docker-app` HEAD 开始，更新 manifest 中的 fnOS 版本并提交。创建精确格式的 `fnos-candidate-<version>-<12-char-sha>` tag 后，既有 `fnos-image-release.yml` 完成：

- API/Web 的 `linux/amd64` 和 `linux/arm64` 构建；
- linux/amd64 API/Web 冒烟检查；
- Gateway 策略校验和漏洞扫描；
- staging digest 捕获、精确 digest 冒烟、GHCR 推广和匿名可达性检查。

该阶段的成功输出为候选版本、commit、API/Web digest、Gateway digest、工作流证据。不创建 GitHub Release。

### 2. RC package stage: reproducible device acceptance

新增统一的发布编排脚本（建议 `scripts/release-fnos.mjs`），通过明确子命令替代人工拼接现有脚本：

```text
prepare  -> 校验版本、干净工作树、分支 HEAD、候选 tag 格式
package  -> 读取已验证候选 digest，构建 FPK 与 SHA-256，生成 release-manifest.json
verify   -> 校验 FPK 内 compose、digest、版本、SHA-256 和 release manifest
publish  -> 仅在全部验收证据存在时创建 GitHub Release
```

`package` 不得使用 `latest`、普通 tag 或重新构建镜像；它只调用现有 `build-fnos-package.mjs` 并要求三项精确 digest。生成的候选 FPK 上传到 GitHub Actions artifact，供 fnOS VM/实机手动安装验证。

### 3. Stable stage: GitHub Release

新增稳定发布工作流（建议 `.github/workflows/fnos-package-release.yml`），由人工触发并输入候选版本、commit 和已记录的验收证据标识。它必须：

1. 再确认分支 HEAD、manifest 版本与候选 tag/commit 一致；
2. 下载或解析候选阶段产出的 digest 清单，并验证 GHCR 公共可达性；
3. 构建 FPK，计算 SHA-256，执行包结构测试；
4. 校验真机验收矩阵、升级/回滚记录和安全扫描证据已附齐；
5. 创建不可修改的 GitHub Release，上传 FPK、`.sha256`、`release-manifest.json` 和发布说明；
6. 失败时不创建 Release、不覆盖既有 tag，保留 artifact 供诊断。

稳定 tag 使用 `fnos-v<version>`，例如 `fnos-v1.4.0-fnos.7`；它必须指向候选验证过的同一 commit。候选 tag 与稳定 tag 都不得移动。

## Product and Operational Boundaries

- fnOS 对外只暴露 `3080`；API `8000` 和 Web `3000` 保持 Compose 内部端口。
- 保持无登录模式：首次仅填写工作区用户名，不是认证凭据；任意能访问 `3080` 的局域网客户端均可使用应用。这是产品选择，稳定发布说明必须提示用户通过 fnOS 网络、路由器或反向代理限制访问边界。
- “无需密钥”仅指不需要 SAG 登录密码和初始化密钥；实际上传、索引、对话仍可能需要用户自行配置其模型与 Embedding 服务凭据，且凭据不得进入 FPK、仓库、日志或 Release。
- `/data` 是完整数据兼容边界，包含 SQLite、LanceDB、原文与索引；备份或恢复不得只处理单个数据库文件。
- 首次安装依赖 fnOS 访问公共 GHCR。正式发布前必须明确验证目标网络的拉取能力；受限网络另行设计镜像镜像站或离线导入方案，不能静默承诺开箱即用。

## Acceptance Gates

### Automated gates

每个候选版本必须通过：

- API Ruff、完整 pytest 和 single-user/no-auth 回归；
- Web 单测、lint、typecheck、生产构建；
- fnOS 发布策略、认证边界、生命周期、打包、镜像冒烟与 Gateway 安全测试；
- API/Web 的 amd64 与 arm64 OCI index 检查，amd64 运行时冒烟；
- Gateway 高危/严重漏洞扫描门禁；
- FPK 静态检查：无 `build:`、无 `latest`、无宿主 API/Web 端口、无未固定镜像、无开发弱密钥；
- FPK SHA-256 与 release manifest 相互一致。

### fnOS manual acceptance gates

候选 FPK 必须至少在目标 x86 fnOS VM 上完成并记录截图/日志位置：

1. 全新安装、启用、桌面“打开”、停止与再次启动；
2. 只填写工作区用户名即可进入，不显示密码或初始化密钥字段；
3. 经 `http://<fnos-host>:3080` 完成同源 Web、REST、SSE、MCP URL、上传和转发头检查；
4. 使用不写入仓库的模型/Embedding 凭据，完成 Markdown 与 PDF 上传、索引、检索、流式问答和引用打开；
5. 容器重建与 fnOS 重启后数据仍可用；
6. 上一稳定版升级到候选版：自动冷备、旧知识库可检索；
7. 模拟升级失败：应用与数据可按文档恢复；
8. 默认卸载保留数据、重装恢复；明确删除数据的卸载才清理；
9. 4 GB 轻量档执行基础上传/检索/问答流程，无 OOM；
10. GHCR 拉取失败、端口占用、模型未配置三类故障能给出可操作提示。

首次稳定版建议增加一台独立 x86 fnOS 实机或至少独立 Windows/VMware 主机复验；VM 是当前最低发布门槛，不替代后续实机认证。

## Rollback and Support

- GitHub Release 不删除或覆盖已发布 FPK；发现问题时撤回“推荐”标记、发布修复版本并在说明中标明受影响范围。
- 因镜像 digest 固定，应用运行版本可追溯；回退通过安装上一个稳定 FPK，并按照其升级/恢复说明恢复完整 `/data` 冷备。
- 发现数据迁移不可逆或安全问题时，暂停稳定发布，先提供恢复步骤，再发布修复版本；不得仅靠重新打包覆盖问题。
- 每个 Release 附带安装、升级、备份恢复、卸载、网络、模型配置和故障排查说明，并保留已知限制。

## Delivery Sequence

1. 实现并测试 `release-fnos.mjs` 的 prepare/package/verify 子命令，以及 release-manifest 格式。
2. 实现稳定 FPK GitHub Actions 工作流和 GitHub Release 资产上传，先以 dry-run 验证。
3. 为稳定发布补齐文档模板、验收矩阵模板、回滚与支持流程。
4. 选择下一版本，运行候选镜像流程并生成 RC FPK。
5. 在 fnOS VM 完成完整手工验收；记录证据并处理缺陷，必要时重新进入候选阶段。
6. 通过所有门禁后创建首个稳定 GitHub Release。
7. 以稳定交付流程为基础，单独准备飞牛应用中心上架资料、审核要求、渠道版本策略和认证。

## Non-goals for the First Stable Release

- 不将 fnOS 分支合回 `main`；
- 不在本次强制提供 arm64 fnOS 支持，首个稳定 FPK 仍明确支持 x86；
- 不将 Dify 外部知识库 API 或其向量策略纳入 fnOS 版本；
- 不把用户的模型/Embedding 凭据内置为公共默认值；
- 不将飞牛应用中心审核完成设为 GitHub Release 的前置条件。

# 网络、构建与安装

## 1. 配置 Windows VMware NAT

目标链路：

```text
Mac -> WINDOWS_HOST:3080 -> VMware NAT -> FNOS_VM_IP:3080 -> sag-gateway:80
```

当前环境为：

```text
192.168.50.178:3080 -> 192.168.252.10:3080
```

候选版的 `3080` 是明文 HTTP。整条链路只允许位于可信、隔离的私有 LAN 或受控
VPN 内；不得在公共/共享 Wi-Fi 或任何不可信二层网络上输入用户密码、bootstrap、
模型密钥或 Bearer Token。若来源网络不完全可信，先在 `3080` 前部署带有效证书的
HTTPS 反向代理并限制其回源，TLS 验收未通过前不得对该网络开放 SAG。

在 Windows 上关闭 SAG 相关应用后，通过 VMware Virtual Network Editor 选择 fnOS VM 使用的 NAT 网络（当前为 VMnet8），打开 NAT Settings，新增：

| 字段 | 值 |
| --- | --- |
| Host port | `3080` |
| Type | TCP |
| Virtual machine IP | `192.168.252.10` |
| Virtual machine port | `3080` |

保存后确认没有重复或冲突的 `3080` 规则。若 fnOS VM 地址改变，应先恢复固定地址，再更新转发。

以管理员 PowerShell 增加仅允许当前可信隔离网段的入站规则：

```powershell
New-NetFirewallRule `
  -DisplayName "fnOS SAG 3080 LAN" `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 3080 `
  -RemoteAddress 192.168.50.0/24 `
  -Profile Private
```

审计所有已启用的入站 Allow 规则。端口为 `Any` 或范围包含 `3080` 的规则都可能绕过上面的 `/24` 限制；必须同时查看远端地址、协议、Profile、程序和服务作用域：

```powershell
function Test-PortIncludes3080 {
  param([object]$LocalPort)

  foreach ($entry in @($LocalPort)) {
    foreach ($token in ("$entry" -split ",")) {
      $value = $token.Trim()
      if ($value -eq "Any" -or $value -eq "3080") {
        return $true
      }
      if ($value -match "^(\d+)-(\d+)$") {
        if (3080 -ge [int]$Matches[1] -and 3080 -le [int]$Matches[2]) {
          return $true
        }
      }
    }
  }
  return $false
}

$rows = foreach ($rule in Get-NetFirewallRule `
  -Enabled True -Direction Inbound -Action Allow) {
  $portFilters = @($rule | Get-NetFirewallPortFilter)
  if (-not ($portFilters | Where-Object {
    Test-PortIncludes3080 $_.LocalPort
  })) {
    continue
  }

  $addressFilters = @($rule | Get-NetFirewallAddressFilter)
  $applicationFilters = @($rule | Get-NetFirewallApplicationFilter)
  $serviceFilters = @($rule | Get-NetFirewallServiceFilter)

  [pscustomobject]@{
    DisplayName   = $rule.DisplayName
    Enabled       = $rule.Enabled
    Direction     = $rule.Direction
    Action        = $rule.Action
    Profile       = $rule.Profile
    Protocol      = ($portFilters.Protocol -join ",")
    LocalPort     = ($portFilters.LocalPort -join ",")
    RemoteAddress = ($addressFilters.RemoteAddress -join ",")
    Program       = ($applicationFilters.Program -join ",")
    Service       = ($serviceFilters.Service -join ",")
  }
}

$rows | Sort-Object DisplayName | Format-List
```

逐条确认输出：适用于 `3080` 的通用规则必须禁用/删除，或通过 `RemoteAddress` 及程序/服务作用域证明不会扩大访问；只有当 `192.168.50.0/24` 的全部设备都受信时，目标 SAG 规则才可使用该网段，否则必须收窄为维护 Mac 或受控 VPN 地址。规则应显示 TCP、Private。不能只检查名字中含 `SAG` 的规则。

不要配置路由器公网端口映射。SAG 候选版只面向可信隔离局域网或受控 VPN。

## 2. 发布公开 GHCR 镜像

仅在受权的 `luoshuai990529/SAG` 默认分支 `main` 上手动运行
**fnOS Candidate Images**，输入：

```text
1.4.0-fnos.1
```

工作流发布：

```text
ghcr.io/luoshuai990529/sag-api
ghcr.io/luoshuai990529/sag-web
```

工作流先从已 checkout 的 `GITHUB_SHA` 校验 `packages/fnos/sag/manifest` 的
`appname=sag` 与候选版本，并完成可复用 CI 质量门禁。独立的只读
`gateway-security` job 先校验 `packages/fnos/gateway-policy.json` 尚未过期，
再对固定 Nginx index 的原始 OCI metadata 检查 amd64/arm64 子 manifest、版本标注和
上游 revision。它下载官方 Trivy `0.70.0` Linux amd64 归档并核对 SHA-256
`8b4376d5d6befe5c24d503f10ff136d9e0c49f9127a4279fd110b727929a5aa9`，对固定
`linux/amd64` gateway 执行“可修复 Critical/High 必须为零”的扫描。原始报告和
漏洞数据库不归档，只保留脱敏摘要；该 job 失败时 staging 不会发布。

随后工作流只在 runner
本地构建并加载 amd64 API/Web，实际轮询 API ready 与 Web 根路径；这一步不写
GHCR。

本地冒烟成功后，工作流才把 amd64+arm64 的 manifest index 推送到本次运行唯一
的 `staging-fnos-<run>-<attempt>-<sha>` 标签。它检查 staging 原始 index、拉取
amd64 staging 镜像并验证 OCI revision/version 元数据，最后以服务器端
`imagetools create` 把已验证的 index digest 提升为候选版本和 `sha-<commit>`
标签。已验证 digest 会作为 job output 和 artifact 保存；promotion 不再读取可变
staging tag，而是对四个最终引用逐个对账：缺失则创建，已指向同一 digest 则接受，
不同 digest 则失败，并在结束后再次确认全部引用。候选包仍只声明 x86；arm64
镜像构建成功不等于 ARM64 fnOS 已认证。

预提升失败可以重新运行：新的 run attempt 使用新的 staging 标签；部分 promotion
重试会补齐缺失且同一 release digest 的最终标签，并拒绝流程自身观察到的不同 digest。
同一候选版本的并发设置只会串行化本工作流；最小权限、创建前复查和最终 postcheck
只能缩小或发现竞争，不能阻止外部 GHCR writer 在这些检查之外改写 tag。因此发布验收
必须具备该 package 的独占写入控制，并记录实际 registry 运行的四个最终 digest；fnOS
包也必须继续固定 digest。staging 标签不会由工作流按 digest 删除，因为删除 digest
可能误删已提升内容；仅可使用能够精确删除单个 tag 的受控 GHCR 操作清理，并保留审计
记录。

可复用 CI 会运行发布 Compose、包行为、生命周期和文档测试，但不会下载未经
校验的 Linux `fnpack` 可执行文件。`fnpack build` 结构测试只在预先验证了官方
二进制及校验值的 runner 上设置 `SAG_FNPACK_TESTS=1` 后执行；不要为了让 CI
变绿而跳过校验或下载未记录校验和的文件。

发布后把两个 Packages 设为 Public，并记录 manifest-list digest。fnOS 安装期间不会配置 registry 凭据，因此必须能匿名拉取 GHCR 和 Docker Hub：

```bash
docker buildx imagetools inspect ghcr.io/luoshuai990529/sag-api:1.4.0-fnos.1
docker buildx imagetools inspect ghcr.io/luoshuai990529/sag-web:1.4.0-fnos.1
node scripts/fnos-gateway-policy.mjs verify --docker docker
```

### Nginx gateway 复核与续期

本轮复核日期为 `2026-07-29`，到期日为 `2026-08-28`。固定引用为：

```text
docker.io/library/nginx:1.30.4-alpine@sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46
```

本地实际扫描使用 Trivy `0.70.0`，命令语义与 CI 相同：

```bash
TRIVY_BIN="${TRIVY_BIN:-REPLACE_WITH_CHECKSUM_VERIFIED_TRIVY_0_70_0}"
case "$TRIVY_BIN" in
  *REPLACE_WITH_*)
    printf '%s\n' "Set TRIVY_BIN to the checksum-verified Trivy 0.70.0 executable." >&2
    exit 2
    ;;
esac

GATEWAY_IMAGE="$(
  node scripts/fnos-gateway-policy.mjs verify --docker docker
)"
"$TRIVY_BIN" image \
  --platform linux/amd64 \
  --scanners vuln \
  --severity CRITICAL,HIGH \
  --ignore-unfixed \
  --exit-code 1 \
  "$GATEWAY_IMAGE"
```

`2026-07-29T16:33:41+08:00` 的实际结果为通过：Alpine `3.24.1`、image ID
`sha256:6e01bfae6f7971512a5765fe2f52ca4267a4773c7f8b357a2d39e5300787cece`，
可修复 Critical/High 为 `0`。这个数字来自本轮真实报告，不是预设或豁免。

到期前，或 Nginx tag/digest、平台子 manifest、上游 revision、Trivy/DB 发生变化时，
必须重新执行以下完整流程：从 Nginx 官方发布与安全公告选择已修复 stable 版本；
核对 Docker Official Image 的 tag、index digest、amd64/arm64 子 manifest 和 OCI
revision；用 checksum 固定的新 Trivy 版本扫描；若存在发现则停止候选发布；通过后
在同一个受评审 commit 中更新 policy 的镜像、平台、scanner 证据、复核/到期日和本文。
不得只延长日期或保留旧扫描结果。硬编码 30 天上限会让过期策略、过宽窗口和任意
Docker Hub Nginx digest 在发布 Compose 校验、包构建及 workflow 中失败。

## 3. 构建正式 `.fpk`

只有三个 digest 均已发布且可检查时才执行：

```bash
mkdir -p dist/fnos
API_DIGEST="${API_DIGEST:-REPLACE_WITH_SAG_API_SHA256}"
WEB_DIGEST="${WEB_DIGEST:-REPLACE_WITH_SAG_WEB_SHA256}"
NGINX_IMAGE="docker.io/library/nginx:1.30.4-alpine@sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46"

case "${API_DIGEST}:${WEB_DIGEST}" in
  *REPLACE_WITH_*)
    printf '%s\n' "Set API_DIGEST and WEB_DIGEST to published sha256 digests." >&2
    exit 2
    ;;
esac

node scripts/build-fnos-package.mjs \
  --api-image "ghcr.io/luoshuai990529/sag-api@${API_DIGEST}" \
  --web-image "ghcr.io/luoshuai990529/sag-web@${WEB_DIGEST}" \
  --nginx-image "${NGINX_IMAGE}" \
  --output 'dist/fnos/sag-1.4.0-fnos.1.fpk'
(
  cd dist/fnos
  shasum -a 256 'sag-1.4.0-fnos.1.fpk' \
    > 'sag-1.4.0-fnos.1.fpk.sha256'
  shasum -a 256 -c 'sag-1.4.0-fnos.1.fpk.sha256'
)
```

构建脚本会：

1. 拒绝可变标签、错误仓库、非 digest 引用，以及不匹配当前未过期 gateway policy
   的任意 Nginx 引用；
2. 解析 `docker buildx imagetools inspect --raw` JSON，要求 API/Web index 同时
   包含 `linux/amd64` 与 `linux/arm64`；Nginx 必须精确匹配 policy 记录的
   amd64/arm64 子 manifest digest、tag 和上游 revision；
3. 确认 API/Web 提供的 digest 正是对应候选版本 tag 当前绑定的 digest；
4. 将 digest 渲染进临时包目录；
5. 运行发布 Compose 校验和 `fnpack build`；
6. 只复制最终 `.fpk` 到指定输出。

校验文件在输出目录内用 `.fpk` 的 basename 生成并立即验证；分发时必须把 `.fpk` 与 `.sha256` 一起移动，接收方进入两者所在目录后执行同一条 `shasum -a 256 -c`。

源码包中的 `__SAG_*_IMAGE__` 是构建占位符，不能直接安装。`--structural-test`
仅用于临时测试包；API/Web 使用 `test.invalid` 引用，gateway 仍使用正式受评审
digest。结构包绝不能分发或安装。

## 4. 在 fnOS 安装

推荐先通过应用中心 UI 手工安装：

1. 校验收到的 `.fpk.sha256`；
2. 上传 `sag-1.4.0-fnos.1.fpk`；
3. 确认应用请求端口 `3080`，完成安装；
4. 等待 API、Web 和 gateway 健康；
5. 从应用卡片打开 SAG；
6. 在 fnOS 私有终端确认 `${TRIM_PKGETC}/sag.env` 为 `0600`，取得
   `SAG_AUTH_BOOTSTRAP_TOKEN` 的值；不要把它写入命令参数、shell 历史、日志或截图；
7. 首次登录填写名字、至少 12 位且 UTF-8 编码不超过 72 字节的独立用户密码和该
   初始化密钥。用户密码不得与 bootstrap 凭据或 `SAG_SECRET_KEY` 相同；
8. 退出后只用同一个名字和用户密码重新登录，初始化密钥留空；确认只给名字、
   错误密码或不同名字都返回同一认证失败，且不会修改已有名字；
9. 确认不能继续公开注册；
10. 无模型密钥时确认应用仍能启动；
11. 私下录入测试模型凭据，再验证上传、索引、检索、SSE 问答和引用打开。

`sag.env` 是服务器端私有配置，不随 `.fpk` 分发。安装脚本分别随机生成 JWT
会话密钥和一次性 bootstrap 凭据，两者都为 64 位十六进制且不得相同。初始化
成功会递增用户认证版本，使初始化前 JWT 失效；同一个 bootstrap 不能再远程重置
密码。需要查看 bootstrap 值时，先从 fnOS 应用运行信息取得真实 `TRIM_PKGETC`，
再在不录屏、不采集 shell 输出的私有维护会话中读取该文件；完成页面录入后清除
终端显示和剪贴板。验收证据只记录“初始化成功/失败分支通过”，绝不记录凭据值。

### 本地管理员密码恢复

远程登录接口不会长期接受安装时的 bootstrap。遗忘密码时，在 fnOS 本机的私有
维护会话中：

1. `appcenter-cli stop sag`。恢复命令会枚举该 Compose 项目的每个容器，并且只把
   `created`、`exited` 视为安全；`running`、`paused`、`restarting`、`removing`、
   `dead`、未知状态或任何枚举/检查失败都会闭锁退出。命令会在写入凭据前再次检查，
   但仍应先由操作者确认全部服务已停止；
2. 从应用运行信息取得准确的 `TRIM_APPDEST`、`TRIM_PKGVAR`、`TRIM_PKGETC` 和
   `TRIM_TEMP_LOGFILE`，不要猜测路径；
3. 在具备 fnOS 应用维护权限且上述变量已设置的上下文运行
   `"${TRIM_APPDEST}/cmd/auth_reset" --confirm-local-reset`；
4. 命令成功后保持终端和日志脱敏，从权限 `0600` 的 `sag.env` 私下取得已轮换的
   bootstrap；该命令不会把新值打印到 stdout 或日志；
5. `appcenter-cli start sag`，使用原名字、至少 12 位且 UTF-8 不超过 72 字节的
   新密码和新 bootstrap 完成一次初始化。

恢复状态机固定为：

1. 两次确认项目全部容器处于 `created`/`exited`，第二次紧邻首次凭据写入；
2. 以 `0600` 临时文件保存新 bootstrap，并原子替换 `sag.env`，会话密钥不变；
3. 通过同一固定 API 镜像中的离线 helper，依次 `fsync` 新 `sag.env` 文件和
   `TRIM_PKGETC` 目录；任一步失败都不会启动数据库 reset；
4. 通过离线 SQLite `BEGIN IMMEDIATE` 事务把唯一用户设为待初始化并递增认证版本；
5. 事务提交后，新 bootstrap 可与原名字和新密码一起使用，所有旧 JWT 均失效。

在第 4 步调用前失败时，命令保证数据库 reset 尚未启动；若原子替换已经发生，活动
路径已指向新 bootstrap，但 fsync 失败意味着不能宣称它已持久落盘。保持应用停止并
重跑即可。

一旦第 4 步的 Docker/helper 已启动，而客户端返回失败或中途断开，数据库是否提交
是**未知状态**：新 bootstrap 可能已激活，也可能尚未激活。此时旧 bootstrap 已在
第 2–3 步从持久活动配置移除，但不得启动应用或尝试远程登录来探测状态。保持停服，
原样重跑本地 reset；重跑会安全地再次发布一个全新 bootstrap，并把数据库收敛到
待初始化状态。只有一次完整命令明确成功后才启动应用。不得把旧 bootstrap 写回
`sag.env`。

验收证据应记录 UTC 时间、命令退出码/信号、脱敏后的 `auth-fsync` 先于 `auth-reset`
命令顺序、`sag.env` 为普通文件且权限 `0600`，以及成功重跑后旧 JWT 被拒绝。不得
记录 `sag.env` 内容、bootstrap、密码、Cookie 或 Authorization。

也可以在 fnOS 设备 shell 使用官方 `appcenter-cli`：

```bash
appcenter-cli install-fpk sag-1.4.0-fnos.1.fpk
appcenter-cli list
appcenter-cli stop sag
appcenter-cli start sag
```

这些命令在 fnOS 执行，不在 Mac 执行。交互测试仍以应用中心 UI 为主。

## 5. 从 Mac 验证

```bash
curl --fail --show-error --connect-timeout 5 \
  http://192.168.50.178:3080/api/v1/system/ready
open http://192.168.50.178:3080
```

验证浏览器只访问 `3080`，Network 面板中的 REST、SSE 和 MCP 请求保持同源；不得出现对宿主机 `8000` 或 `3000` 的请求。

内置网关不终止 TLS。Web 会在浏览器实际使用 HTTPS 时为认证 Cookie 增加
`Secure`，HTTP 时不能添加该属性。当前 Bearer 架构需要浏览器 JavaScript 读取
Token，所以 Cookie 仍是 `SameSite=Lax` 且不是 `HttpOnly`；这也是必须避免不可信
网络、严格控制前端 XSS 并在外部 TLS 边界完成验收的原因。

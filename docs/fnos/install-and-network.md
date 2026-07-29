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

在 Windows 上关闭 SAG 相关应用后，通过 VMware Virtual Network Editor 选择 fnOS VM 使用的 NAT 网络（当前为 VMnet8），打开 NAT Settings，新增：

| 字段 | 值 |
| --- | --- |
| Host port | `3080` |
| Type | TCP |
| Virtual machine IP | `192.168.252.10` |
| Virtual machine port | `3080` |

保存后确认没有重复或冲突的 `3080` 规则。若 fnOS VM 地址改变，应先恢复固定地址，再更新转发。

以管理员 PowerShell 增加仅允许本地 Wi-Fi 网段的入站规则：

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

逐条确认输出：适用于 `3080` 的通用规则必须禁用/删除，或通过 `RemoteAddress` 及程序/服务作用域证明不会扩大访问；目标 SAG 规则应显示 `RemoteAddress=192.168.50.0/24`、TCP、Private。不能只检查名字中含 `SAG` 的规则。

不要配置路由器公网端口映射。SAG 候选版只面向可信局域网。

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
`appname=sag` 与候选版本，并完成可复用 CI 质量门禁。随后它只在 runner
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
docker buildx imagetools inspect nginx:1.27-alpine
```

## 3. 构建正式 `.fpk`

只有三个 digest 均已发布且可检查时才执行：

```bash
mkdir -p dist/fnos
API_DIGEST="${API_DIGEST:-REPLACE_WITH_SAG_API_SHA256}"
WEB_DIGEST="${WEB_DIGEST:-REPLACE_WITH_SAG_WEB_SHA256}"
NGINX_DIGEST="sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10"

case "${API_DIGEST}:${WEB_DIGEST}" in
  *REPLACE_WITH_*)
    printf '%s\n' "Set API_DIGEST and WEB_DIGEST to published sha256 digests." >&2
    exit 2
    ;;
esac

node scripts/build-fnos-package.mjs \
  --api-image "ghcr.io/luoshuai990529/sag-api@${API_DIGEST}" \
  --web-image "ghcr.io/luoshuai990529/sag-web@${WEB_DIGEST}" \
  --nginx-image "docker.io/library/nginx@${NGINX_DIGEST}" \
  --output 'dist/fnos/sag-1.4.0-fnos.1.fpk'
(
  cd dist/fnos
  shasum -a 256 'sag-1.4.0-fnos.1.fpk' \
    > 'sag-1.4.0-fnos.1.fpk.sha256'
  shasum -a 256 -c 'sag-1.4.0-fnos.1.fpk.sha256'
)
```

构建脚本会：

1. 拒绝标签、错误仓库和非 digest 引用；
2. 解析 `docker buildx imagetools inspect --raw` JSON，要求 API/Web index 同时
   包含 `linux/amd64` 与 `linux/arm64`，Nginx index 包含 `linux/amd64`；
3. 确认 API/Web 提供的 digest 正是对应候选版本 tag 当前绑定的 digest；
4. 将 digest 渲染进临时包目录；
5. 运行发布 Compose 校验和 `fnpack build`；
6. 只复制最终 `.fpk` 到指定输出。

校验文件在输出目录内用 `.fpk` 的 basename 生成并立即验证；分发时必须把 `.fpk` 与 `.sha256` 一起移动，接收方进入两者所在目录后执行同一条 `shasum -a 256 -c`。

源码包中的 `__SAG_*_IMAGE__` 是构建占位符，不能直接安装。`--structural-test` 仅用于临时测试包，使用 `test.invalid` 引用，绝不能分发或安装。

## 4. 在 fnOS 安装

推荐先通过应用中心 UI 手工安装：

1. 校验收到的 `.fpk.sha256`；
2. 上传 `sag-1.4.0-fnos.1.fpk`；
3. 确认应用请求端口 `3080`，完成安装；
4. 等待 API、Web 和 gateway 健康；
5. 从应用卡片打开 SAG；
6. 创建首个用户，完成后确认不能继续公开注册；
7. 无模型密钥时确认应用仍能启动；
8. 私下录入测试模型凭据，再验证上传、索引、检索、SSE 问答和引用打开。

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

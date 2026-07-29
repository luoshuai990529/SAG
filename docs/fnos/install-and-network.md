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

检查是否存在范围更大的同端口 Allow 规则；若存在，应先确认用途再收紧，不能依靠规则名称判断实际访问范围：

```powershell
Get-NetFirewallPortFilter |
  Where-Object LocalPort -eq 3080 |
  Get-NetFirewallRule |
  Format-Table DisplayName,Enabled,Direction,Action,Profile
```

不要配置路由器公网端口映射。SAG 候选版只面向可信局域网。

## 2. 发布公开 GHCR 镜像

在 GitHub 默认分支可见 `.github/workflows/fnos-image-release.yml` 后，手动运行 **fnOS Candidate Images**，输入：

```text
1.4.0-fnos.1
```

工作流发布：

```text
ghcr.io/luoshuai990529/sag-api
ghcr.io/luoshuai990529/sag-web
```

每个镜像包含 `linux/amd64` 和 `linux/arm64`，并带候选版本和 commit SHA 标签。工作流对 amd64 执行 API/Web 运行时冒烟，对 arm64 执行构建和清单检查。候选包仍只声明 x86；arm64 镜像构建成功不等于 ARM64 fnOS 已认证。

发布后把两个 Packages 设为 Public，并记录 manifest-list digest：

```bash
docker buildx imagetools inspect ghcr.io/luoshuai990529/sag-api:1.4.0-fnos.1
docker buildx imagetools inspect ghcr.io/luoshuai990529/sag-web:1.4.0-fnos.1
docker buildx imagetools inspect nginx:1.27-alpine
```

## 3. 构建正式 `.fpk`

只有三个 digest 均已发布且可检查时才执行：

```bash
mkdir -p dist/fnos
node scripts/build-fnos-package.mjs \
  --api-image 'ghcr.io/luoshuai990529/sag-api@sha256:<64-hex>' \
  --web-image 'ghcr.io/luoshuai990529/sag-web@sha256:<64-hex>' \
  --nginx-image 'docker.io/library/nginx@sha256:<64-hex>' \
  --output 'dist/fnos/sag-1.4.0-fnos.1.fpk'
shasum -a 256 'dist/fnos/sag-1.4.0-fnos.1.fpk' \
  > 'dist/fnos/sag-1.4.0-fnos.1.fpk.sha256'
```

构建脚本会：

1. 拒绝标签、错误仓库和非 digest 引用；
2. 通过 `docker buildx imagetools inspect` 确认引用存在；
3. 将 digest 渲染进临时包目录；
4. 运行发布 Compose 校验和 `fnpack build`；
5. 只复制最终 `.fpk` 到指定输出。

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

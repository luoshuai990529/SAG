# SAG fnOS 候选版运维入口

本文档集对应 SAG `1.4.0-fnos.1`，目标是把 SAG 作为飞牛 fnOS Docker `.fpk` 应用交付。应用内部运行 API、Web 和 Nginx 网关，宿主机只暴露 `3080`；SQLite、LanceDB、上传原文和索引作为完整 `/data` 树持久化。

## 当前结论

- 候选包声明 `platform=x86`、`os_min_version=1.2.0302`，当前认证目标仅为 x86-64 VMware fnOS 测试机。
- 安装时需要 fnOS 在不登录仓库的情况下匿名拉取公开 GHCR 镜像和 Docker Hub 官方 Nginx 镜像。发布包必须使用 API、Web、Nginx 的 manifest-list digest，不能使用 `latest` 或可变标签。
- API `8000` 和 Web `3000` 只在 Compose 网络内可见；用户入口为 `http://<fnOS 可达地址>:3080`。
- Mac 已完成 Docker、Buildx、Compose、`fnpack` 和 `hello-world` 本地准备。`appcenter-cli` 是 fnOS 设备上的工具，不是 Mac 必装工具。
- 源码、生命周期测试和临时结构包已经具备；公开 GHCR 镜像、正式 `.fpk`、Windows `3080` NAT、防火墙和 fnOS UI 生命周期验收仍是外部门禁。
- 正式发布前还必须补齐 x86-64 实机、ARM64 fnOS 实机和应用中心上架验证。本候选版不声明 ARM64 fnOS 支持。

## 文档导航

- [Mac 开发机准备](./mac-preparation.md)
- [网络、构建与安装](./install-and-network.md)
- [升级、冷备和恢复](./backup-upgrade-recovery.md)
- [故障排查](./troubleshooting.md)
- [验收矩阵](./acceptance-matrix.md)
- [证据目录约定](./evidence/README.md)

官方规范基线：

- [Docker 应用案例](https://developer.fnnas.com/docs/examples/docker/)
- [`fnpack`](https://developer.fnnas.com/docs/cli/fnpack/)
- [`appcenter-cli`](https://developer.fnnas.com/docs/cli/appcentercli/)

## 地址配置与当前测试环境

文档中的通用示例使用以下变量，不把某次 DHCP 地址写进脚本：

```bash
WINDOWS_HOST="192.0.2.10"  # 替换为 Windows 在 Mac 所在局域网中的地址
FNOS_VM_IP="192.0.2.20"    # 替换为 fnOS 在 VMware NAT 网段中的固定地址
FNOS_ADMIN_PORT="15666"    # 替换为 fnOS 管理端口的 Windows 转发端口
SAG_PORT="3080"
```

当前测试环境单独记录如下：

| 用途 | 当前值 | 状态 |
| --- | --- | --- |
| Windows Wi-Fi 地址 | `192.168.50.178` | 已验证，可能随 DHCP 变化 |
| fnOS VM 固定地址 | `192.168.252.10` | 已验证 |
| fnOS 管理入口 | `http://192.168.50.178:15666` | 前序交接记录已打开登录页；证据待归档 |
| SAG 计划入口 | `http://192.168.50.178:3080` | 待配置 NAT、防火墙并安装候选包后验证 |
| Windows 允许来源 | `192.168.50.0/24` | `3080` 规则待验证 |

管理入口可达只证明 Mac → Windows → fnOS 的管理网络可达，不证明 SAG 已安装或业务验收通过。

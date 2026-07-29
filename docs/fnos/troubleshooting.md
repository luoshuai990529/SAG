# 故障排查

先记录版本、时间和现象，再做只读检查。日志和截图必须遮盖 Token、模型密钥、Authorization、Cookie 和 `SAG_SECRET_KEY`。

## 入口不可达

```bash
curl -v --connect-timeout 5 http://<WINDOWS_HOST>:3080/
curl -v --connect-timeout 5 http://<WINDOWS_HOST>:3080/api/v1/system/ready
```

按顺序检查：

1. Windows 地址是否因 DHCP 改变；
2. VMware NAT 是否存在 TCP `3080 -> <FNOS_VM_IP>:3080`；
3. Windows 防火墙是否只允许预期的 `192.168.50.0/24`；
4. fnOS 上 `3080` 是否被其他应用占用；
5. `manifest.service_port`、Compose `${TRIM_SERVICE_PORT}:80` 和 UI `{port}` 是否一致；
6. `sag-gateway` 是否 running 且 healthy。

当前管理入口 `192.168.50.178:15666` 可达不代表 SAG 的 `3080` 转发已配置。

## 应用中心显示未运行

在 fnOS 上检查：

```bash
docker inspect --format '{{.State.Status}} {{.State.Health.Status}}' sag-gateway
curl -fsS --max-time 5 http://127.0.0.1:3080/api/v1/system/ready
```

`cmd/main status` 同时要求 gateway 为 `running/healthy` 且 API ready。用户可见错误会写入 fnOS 提供的 `TRIM_TEMP_LOGFILE`；通过应用中心的错误详情读取，不要假设这个临时路径固定。

## 镜像拉取失败

```bash
docker buildx imagetools inspect \
  ghcr.io/luoshuai990529/sag-api@sha256:<digest>
docker buildx imagetools inspect \
  ghcr.io/luoshuai990529/sag-web@sha256:<digest>
```

确认：

- Packages 为 Public；
- fnOS DNS、时间和 HTTPS 出站正常；
- digest 与发布记录完全一致；
- manifest list 包含 `linux/amd64`；
- 包内没有 `test.invalid`、占位符、`latest` 或 tag-only 引用。

## 容器或业务异常

```bash
docker ps -a --filter name=sag-
docker logs --tail 200 sag-gateway
docker logs --tail 200 sag-web
docker logs --tail 200 sag-api
docker inspect sag-api sag-web sag-gateway
```

不要直接把未经处理的完整日志贴到工单。先搜索并遮盖密钥、Bearer Token、Cookie、请求正文和用户文档内容。

## Web 能开，但 API/SSE/MCP 失败

浏览器 Network 面板中请求应同源访问：

```text
/api/...
/mcp/...
```

不应出现 `:8000`、`:3000`、CORS 或混合内容请求。网关对 `/api/` 和 `/mcp/` 使用 HTTP/1.1、关闭缓冲、25 MiB 上传上限和 600 秒超时。超过 25 MiB 的上传应被明确拒绝，而不是调整 API/Web 宿主端口。

## 密钥或登录异常

```bash
SECRET_FILE=<从 fnOS 应用运行时信息确认的 TRIM_PKGETC>/sag.env
stat "$SECRET_FILE"
```

文件应为普通文件、权限 `0600`，且仅含 64 位十六进制 `SAG_SECRET_KEY`。安装脚本遇到已有弱密钥会拒绝覆盖。不要手工轮换密钥作为一般排障步骤；轮换会使现有 JWT 失效。

## 升级因空间不足中止

这是保护行为。删除不需要的外部文件或扩容后重试，不要删除活动 `/data` 或仅备份 SQLite 来绕过检查。确认 `${TRIM_PKGVAR}/backup` 与活动数据所在卷的实际可用空间。

## 4 GB 测试机 OOM 或响应慢

候选版已使用轻量档：任务并发 1、抽取并发 2、缓存 4、预热 1。记录：

```bash
docker stats --no-stream sag-api sag-web sag-gateway
docker inspect --format '{{.State.OOMKilled}}' sag-api sag-web sag-gateway
```

先减少并行导入和大文档，再保留 OOM 证据。4 GB 无 OOM 仍需在当前 VM 完整业务验收后才能标记通过。

## 需要上报的最小证据

- SAG/fnOS/`.fpk` 版本和 commit；
- UTC+8 时间及操作步骤；
- 脱敏后的三容器状态、ready 响应和相关日志尾部；
- 浏览器 Network/Console 截图；
- 是否经过 Windows NAT；
- 数据是否来自全新安装、升级或恢复；
- 证据文件路径，按 [证据目录约定](./evidence/README.md) 保存。

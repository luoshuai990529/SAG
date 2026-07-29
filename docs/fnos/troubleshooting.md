# 故障排查

先记录版本、时间和现象，再做只读检查。日志和截图必须遮盖 Token、模型密钥、Authorization、Cookie、`SAG_SECRET_KEY` 和 `SAG_AUTH_BOOTSTRAP_TOKEN`。

## 入口不可达

```bash
WINDOWS_HOST="${WINDOWS_HOST:-192.0.2.10}"
if [ "$WINDOWS_HOST" = "192.0.2.10" ]; then
  printf '%s\n' "Set WINDOWS_HOST to the current Windows LAN address." >&2
  exit 2
fi
curl -v --connect-timeout 5 "http://${WINDOWS_HOST}:3080/"
curl -v --connect-timeout 5 "http://${WINDOWS_HOST}:3080/api/v1/system/ready"
```

按顺序检查：

1. Windows 地址是否因 DHCP 改变；
2. VMware NAT 是否存在 TCP `3080 -> ${FNOS_VM_IP}:3080`；
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
API_DIGEST="${API_DIGEST:-REPLACE_WITH_SAG_API_SHA256}"
WEB_DIGEST="${WEB_DIGEST:-REPLACE_WITH_SAG_WEB_SHA256}"
NGINX_IMAGE="docker.io/library/nginx:1.30.4-alpine@sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46"
case "${API_DIGEST}:${WEB_DIGEST}" in
  *REPLACE_WITH_*)
    printf '%s\n' "Set API_DIGEST and WEB_DIGEST from the release record." >&2
    exit 2
    ;;
esac

docker pull \
  "ghcr.io/luoshuai990529/sag-api@${API_DIGEST}"
docker pull \
  "ghcr.io/luoshuai990529/sag-web@${WEB_DIGEST}"
docker pull \
  "${NGINX_IMAGE}"
```

确认：

- GHCR Packages 为 Public，fnOS 不登录 GHCR 也能匿名拉取两个 digest；
- fnOS 不登录 Docker Hub 也能匿名拉取固定的 Nginx digest；
- fnOS DNS、时间和 HTTPS 出站正常；
- digest 与发布记录完全一致；
- `node scripts/fnos-gateway-policy.mjs verify --docker docker` 通过，且 policy
  当前时间严格早于 `2026-08-28T08:33:41Z`
  （Asia/Shanghai `2026-08-28T16:33:41+08:00`）；
- manifest list 包含 `linux/amd64`；
- 包内没有 `test.invalid`、占位符、`latest` 或 tag-only 引用。

## 容器或业务异常

```bash
docker ps -a --filter name=sag-
docker logs --tail 200 sag-gateway
docker logs --tail 200 sag-web
docker logs --tail 200 sag-api
docker inspect --format \
  '{{.Name}} image={{.Config.Image}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} restart={{.RestartCount}}{{range .Mounts}} mount={{.Destination}}:{{.Type}}:rw={{.RW}}{{end}}' \
  sag-api sag-web sag-gateway
```

这个格式刻意不输出 `Config.Env` 或宿主机挂载源。不要改回无格式的原始
`docker inspect`，也不要直接把未经处理的完整日志贴到工单。先搜索并遮盖密钥、
Bearer Token、Cookie、请求正文和用户文档内容。

## Web 能开，但 API/SSE/MCP 失败

浏览器 Network 面板中请求应同源访问：

```text
/api/...
/mcp/...
```

不应出现 `:8000`、`:3000`、CORS 或混合内容请求。网关对 `/api/` 和 `/mcp/` 使用 HTTP/1.1、关闭缓冲、25 MiB 上传上限和 600 秒超时。超过 25 MiB 的上传应被明确拒绝，而不是调整 API/Web 宿主端口。

## 密钥或登录异常

```bash
TRIM_PKGETC_PATH="${TRIM_PKGETC_PATH:-REPLACE_WITH_TRIM_PKGETC}"
case "$TRIM_PKGETC_PATH" in
  *REPLACE_WITH_*)
    printf '%s\n' "Set TRIM_PKGETC_PATH from fnOS application runtime info." >&2
    exit 2
    ;;
esac
SECRET_FILE="${TRIM_PKGETC_PATH}/sag.env"
stat "$SECRET_FILE"
```

文件应为非符号链接的普通文件、权限 `0600`，且恰好包含两个不同的 64 位十六进制值：

```text
SAG_SECRET_KEY=<redacted>
SAG_AUTH_BOOTSTRAP_TOKEN=<redacted>
```

不要把真实输出贴入工单。安装脚本遇到已有弱密钥、重复值、多余行或错误字段会拒绝
覆盖；从旧版升级时只保留原会话密钥并原子增加缺失的 bootstrap 值。不要手工轮换
`SAG_SECRET_KEY` 作为一般排障步骤，轮换会使现有 JWT 失效。

fnOS 登录失败统一返回“身份验证失败”，不会说明用户、密码还是 bootstrap 是否正确：

- 首次安装或旧库升级后首次登录：原名字（新安装可自定）+ 至少 12 位且 UTF-8
  不超过 72 字节的密码 + bootstrap；
- 日常登录：原名字 + 密码，bootstrap 留空；
- 初始化完成后再次提交 bootstrap：拒绝，不执行远程密码重置；
- 管理员恢复：先通过 `appcenter-cli stop sag` 停服，再在 fnOS 本地维护上下文运行
  `"${TRIM_APPDEST}/cmd/auth_reset" --confirm-local-reset`。成功后读取 `0600`
  `sag.env` 中已轮换的 bootstrap，启动应用，并用原名字和新密码完成一次初始化。

本地恢复成功会递增认证版本并使全部旧 JWT 失效；密码模式也拒绝缺少或版本不匹配
的 JWT。待初始化用户仍必须使用规范化后匹配的原名字，停用用户不能用 bootstrap
恢复。恢复命令不打印新 bootstrap，并且会两次检查项目的每个容器；只有 `created`
和 `exited` 可继续，paused/restarting/未知状态及检查失败都必须先处理。

命令先原子发布新的 `0600` bootstrap，再通过离线 helper 依次 fsync 文件和配置
目录；同步失败会在数据库 reset 前闭锁，但新文件可能已替换活动路径，应保持停服并
重跑。

一旦日志中已经出现 `SAG_LIFECYCLE_ACTION=auth-reset`，Docker/helper 客户端失败
不能证明 SQLite 事务未提交：新 bootstrap 可能已激活，也可能未激活。不要启动应用
或远程试探；直接在停服状态重跑本地 reset。重跑是安全的，会再次发布全新 bootstrap
并把数据库收敛到待初始化状态。任何失败路径都不得手工写回旧 bootstrap。

故障证据只记录 UTC 时间、退出码/信号、脱敏后的 `auth-fsync -> auth-reset` 顺序、
`sag.env` 普通文件/`0600` 状态和成功重跑后旧 JWT 被拒绝；不得记录密钥文件内容或
其凭据值。不要尝试历史隐式默认密码或通过改名绕过认证。

网关按直接 TCP 对端地址对 `/api/v1/auth/login` 和 `/api/v1/auth/register` 采用
`5 次/分钟、burst=3` 的限流，拒绝时返回 `429` 和 `Retry-After: 60`。它不信任
客户端提供的 `X-Forwarded-For`；Windows/VMware NAT 或上游代理可能让多个真实
客户端共享同一限流额度，这是刻意的保守策略。收到 429 时等待至少 60 秒，不要
并行重试。

## HTTP/TLS 边界

内置 `http://<fnOS 地址>:3080` 不提供传输加密，只能用于可信、隔离的私有 LAN
或受控 VPN。禁止在公共/共享 Wi-Fi 或其他不可信网络输入用户密码、bootstrap、
模型密钥或 Bearer Token；任何不可信访问必须先通过已验收的外部 HTTPS 反向代理，
否则保持端口不可达。浏览器在 HTTPS 下会给认证 Cookie 增加 `Secure`，但当前
Bearer 客户端仍需 JavaScript 读取 Cookie，因而不能设置 `HttpOnly`；应把 XSS
防护和 TLS 代理配置作为同一安全边界验收。

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

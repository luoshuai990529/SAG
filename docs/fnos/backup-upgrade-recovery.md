# 升级、冷备和恢复

## 数据边界

唯一可接受的备份边界是 API 的完整 `/data`：

```text
/data
├── sag.db
├── engine/       # LanceDB、索引和本地引擎数据
├── uploads/      # 上传原文与附件
└── 其他当前或未来的数据文件
```

只复制 `sag.db` 会得到不完整备份，不能用于升级回滚或迁移。`sag.db` 会明文保存页面中配置的 LLM、Embedding 和 MinerU 密钥，归档还包含用户上传原文、索引和知识库内容，因此完整备份属于**含凭据的高敏感数据**。配置文件 `${TRIM_PKGETC}/sag.env` 同时保存 JWT 会话密钥和独立的认证 bootstrap 凭据，应另行保护；任何备份、数据库或密钥都不得进入公开共享目录、验收证据、日志、截图或代码仓库。

备份目录应属于受限私有共享，目录权限/ACL 只授予维护者。写入前使用 `umask 077`，目录至少为 `0700`，归档和校验文件至少为 `0600`。复制到其他设备或云存储前，使用组织批准的工具或加密卷先加密，再验证加密副本；不得通过明文公共链接、聊天附件或证据目录传输。

## 自动升级保护

`cmd/upgrade_init` 在升级修改数据前执行：

1. 确认活动数据目录存在；
2. 通过只读、无网络的受限 helper 测量完整数据树；每个文件取逻辑大小与文件系统已分配块大小的较大值，并计入目录元数据；
3. 确认备份目录有上述保守测量值 + 10% + 1 MiB 的可用空间；
4. 停止整个 Compose 项目；
5. 将完整 `data/` 写入临时 tar.gz；
6. 原子重命名为 `${TRIM_PKGVAR}/backup/sag-data-<UTC>-<pid>.tar.gz`；
7. 保持旧项目停止，由 fnOS Docker 资源生命周期替换并启动升级后的项目。

空间测量、停止、归档或发布失败都会在修改数据前/期间终止，并通过 `TRIM_TEMP_LOGFILE` 给出错误。失败的临时归档会被清理；仅当本次 hook 发现项目原先正在运行并由本次 hook 停止（或部分停止）时，失败路径才尽力恢复旧项目。成功路径不会重启旧项目。

helper 分为只读测量、只读数据/可写备份和可写删除三个 Compose profile 服务，均复用已固定 digest 的 API 镜像，关闭网络、使用只读根文件系统、启用 `no-new-privileges`、先移除全部 capabilities，再仅加入读取/处理 API root 所有文件所需的 `DAC_OVERRIDE`。调用前脚本拒绝符号链接、非绝对或非规范化的 `${TRIM_PKGVAR}`、`data` 和 `backup` 来源；在修改已有叶目录前完成检查，并把包私有父目录设为 `0700`，防止无关普通用户替换挂载源。

这些脚本只验证包私有父目录及叶目录本身的所有者和规范路径，不验证从文件系统根到 `${TRIM_PKGVAR}` 的每一级祖先目录。路径检查与后续 `chmod`、Docker bind mount 之间也仍有 TOCTOU 窗口。因此信任边界必须包括 callback 的运行身份、同一 UID 的其他进程，以及任何能在祖先目录中重命名或替换路径组件的主体，而不只是特权 root。目标设备必须先通过验收矩阵的 PATH-01：确认 callback EUID/EGID，逐级检查所有可替换 `${TRIM_PKGVAR}`、`data`、`backup` 的祖先目录所有者及组/其他用户写权限，并复核 Compose 解析结果和容器最终 bind source。脱敏结果按证据目录约定保留在 `docs/fnos/evidence/<date>/path-01/summary.md` 和同目录 `command.log`；如果这条祖先信任链不能成立，不应执行自动升级备份或明确删除。

升级前仍应把最近一次冷备复制到应用私有运行目录之外。fnOS 卸载时是否自动清理 `${TRIM_PKGVAR}` 需要在目标设备实测，不能把同目录备份当作唯一副本。

## 手工冷备

在 fnOS 上执行。先从容器挂载解析实际数据目录，避免猜测宿主机路径：

```bash
set -euo pipefail
DATA_DIR="$(docker inspect sag-api \
  --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}')"
test -n "$DATA_DIR"
test -d "$DATA_DIR"
```

在应用中心停止 SAG，或在 fnOS shell 执行：

```bash
appcenter-cli stop sag
```

确认 `sag-api`、`sag-web`、`sag-gateway` 均已停止后，将整个目录归档到用户创建的外部共享目录：

```bash
set -euo pipefail
DATA_DIR="$(docker inspect sag-api \
  --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}')"
test -n "$DATA_DIR"
test -d "$DATA_DIR"
BACKUP_ROOT="${BACKUP_ROOT:-/vol1/REPLACE_WITH_PRIVATE_SHARE/sag-backups}"
case "$BACKUP_ROOT" in
  *REPLACE_WITH_*)
    printf '%s\n' "Set BACKUP_ROOT to a restricted private fnOS share." >&2
    exit 2
    ;;
esac

umask 077
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE_NAME="sag-data-$STAMP.tar.gz"
mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"
tar -C "$(dirname "$DATA_DIR")" -czf \
  "$BACKUP_ROOT/$ARCHIVE_NAME.tmp" \
  "$(basename "$DATA_DIR")"
mv "$BACKUP_ROOT/$ARCHIVE_NAME.tmp" "$BACKUP_ROOT/$ARCHIVE_NAME"
chmod 600 "$BACKUP_ROOT/$ARCHIVE_NAME"
(
  cd "$BACKUP_ROOT"
  sha256sum "$ARCHIVE_NAME" > "$ARCHIVE_NAME.sha256"
  chmod 600 "$ARCHIVE_NAME.sha256"
  sha256sum -c "$ARCHIVE_NAME.sha256"
  tar -tzf "$ARCHIVE_NAME" >/dev/null
)
```

必须把 `BACKUP_ROOT` 替换成 fnOS 上实际的受限私有共享目录，并复核 ACL。校验文件只写归档 basename，归档与 `.sha256` 一起移动后仍可在新目录验证。完成后重新启动并检查 ready：

```bash
appcenter-cli start sag
curl -fsS http://127.0.0.1:3080/api/v1/system/ready
```

## 恢复

恢复会替换活动数据，必须明确选择目标实例和备份。操作前再为现有活动数据做一份冷备。

```bash
set -euo pipefail
ARCHIVE_DIR="${ARCHIVE_DIR:-/vol1/REPLACE_WITH_PRIVATE_SHARE/sag-backups}"
ARCHIVE_NAME="${ARCHIVE_NAME:-REPLACE_WITH_ARCHIVE_BASENAME.tar.gz}"
case "${ARCHIVE_DIR}:${ARCHIVE_NAME}" in
  *REPLACE_WITH_*)
    printf '%s\n' "Set ARCHIVE_DIR and ARCHIVE_NAME to the verified backup." >&2
    exit 2
    ;;
esac

(
  cd "$ARCHIVE_DIR"
  sha256sum -c "$ARCHIVE_NAME.sha256"
  tar -tzf "$ARCHIVE_NAME"
)
ARCHIVE="$ARCHIVE_DIR/$ARCHIVE_NAME"
appcenter-cli stop sag
```

检查归档顶层只有预期的数据目录且没有绝对路径或 `..` 路径。先在同文件系统的临时目录完整展开并校验，再切换活动数据：

```bash
set -euo pipefail
DATA_DIR="$(docker inspect sag-api \
  --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}')"
DATA_PARENT="$(dirname "$DATA_DIR")"
DATA_NAME="$(basename "$DATA_DIR")"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RESTORE_DIR="$DATA_PARENT/.sag-restore-$STAMP"

mkdir "$RESTORE_DIR"
tar -C "$RESTORE_DIR" -xzf "$ARCHIVE"
test -d "$RESTORE_DIR/$DATA_NAME"
mv "$DATA_DIR" "${DATA_DIR}.before-restore-$STAMP"
mv "$RESTORE_DIR/$DATA_NAME" "$DATA_DIR"
test -d "$DATA_DIR"
appcenter-cli start sag
curl -fsS http://127.0.0.1:3080/api/v1/system/ready
```

若归档顶层目录名与 `DATA_NAME` 不同，命令会在移动活动数据前停止。应在离线临时目录核对来源并调整目录名，不要用覆盖式 `cp` 合并两个数据树。

恢复完成后验证：

- 首次/既有用户身份；
- 信源和文档数量；
- Markdown 与 PDF 原文可打开；
- 旧文档能检索并返回引用；
- LanceDB/索引状态正常；
- 新文档可以上传、抽取和索引。

验证完成前保留 `${DATA_DIR}.before-restore-*` 和剩余的临时恢复目录。若失败，停止应用，移走失败数据并把保护目录原子移回。

## 升级、回滚和卸载

- 正常升级：外部冷备 → 安装新版 `.fpk` → ready → 旧知识库检索 → 新上传/索引。
- 从 `1.4.0-fnos.0` 升级：升级 callback 保留原 `SAG_SECRET_KEY`，并以原子替换方式
  为旧 `sag.env` 增加独立 bootstrap 凭据。旧 `users` 行迁移为“密码尚未初始化”；
  已签发会话不会因会话密钥轮换而失效，但下一次登录必须使用原名字、至少 12 位新密码
  和 bootstrap 凭据完成一次安全初始化。只给名字、历史隐式密码 `admin` 或错误
  bootstrap 都必须失败。初始化后只使用名字和新密码。
- 管理员密码重置使用相同的原名字、新密码和私有 bootstrap 凭据；此操作会替换密码
  哈希但不修改用户名字。bootstrap 是长期恢复凭据，重置后仍须按 `0600` 保护。
- 失败回滚：停止新版 → 恢复升级前完整 `/data` → 安装与该数据格式匹配的旧 `.fpk` → 完整验收。不能只回退镜像。
- 默认卸载：在向导选择 **Retain data (recommended)**，并提前把冷备复制到应用目录之外。
- 明确删除：只有用户主动选择 **Permanently delete active data** 时，卸载脚本才删除活动数据。删除属于不可恢复操作，外部备份不在脚本清理范围内。
- 重装恢复：若 fnOS 实测保留私有运行目录，确认新安装自动看到数据；若系统清理目录，从最新外部完整冷备恢复。

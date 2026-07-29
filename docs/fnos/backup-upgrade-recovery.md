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

只复制 `sag.db` 会得到不完整备份，不能用于升级回滚或迁移。配置密钥位于 `${TRIM_PKGETC}/sag.env`，应独立保护；不要把密钥提交到仓库或放入验收截图。

## 自动升级保护

`cmd/upgrade_init` 在升级修改数据前执行：

1. 确认活动数据目录存在；
2. 测量完整数据树；
3. 确认备份目录有数据量 + 10% + 1 MiB 的可用空间；
4. 停止整个 Compose 项目；
5. 将完整 `data/` 写入临时 tar.gz；
6. 原子重命名为 `${TRIM_PKGVAR}/backup/sag-data-<UTC>-<pid>.tar.gz`；
7. 重新启动项目。

空间测量、停止、归档或发布失败都会在修改数据前/期间终止，并通过 `TRIM_TEMP_LOGFILE` 给出错误。失败的临时归档会被清理，服务执行尽力恢复。

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
BACKUP_ROOT=/vol1/<用户共享目录>/sag-backups
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_ROOT"
tar -C "$(dirname "$DATA_DIR")" -czf \
  "$BACKUP_ROOT/sag-data-$STAMP.tar.gz.tmp" \
  "$(basename "$DATA_DIR")"
mv "$BACKUP_ROOT/sag-data-$STAMP.tar.gz.tmp" \
  "$BACKUP_ROOT/sag-data-$STAMP.tar.gz"
sha256sum "$BACKUP_ROOT/sag-data-$STAMP.tar.gz" \
  > "$BACKUP_ROOT/sag-data-$STAMP.tar.gz.sha256"
tar -tzf "$BACKUP_ROOT/sag-data-$STAMP.tar.gz" >/dev/null
```

`/vol1/<用户共享目录>` 只是示例，必须替换成 fnOS 上实际的外部共享目录。完成后重新启动并检查 ready：

```bash
appcenter-cli start sag
curl -fsS http://127.0.0.1:3080/api/v1/system/ready
```

## 恢复

恢复会替换活动数据，必须明确选择目标实例和备份。操作前再为现有活动数据做一份冷备。

```bash
set -euo pipefail
ARCHIVE=/vol1/<用户共享目录>/sag-backups/sag-data-<timestamp>.tar.gz
sha256sum -c "$ARCHIVE.sha256"
tar -tzf "$ARCHIVE"
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
- 失败回滚：停止新版 → 恢复升级前完整 `/data` → 安装与该数据格式匹配的旧 `.fpk` → 完整验收。不能只回退镜像。
- 默认卸载：在向导选择 **Retain data (recommended)**，并提前把冷备复制到应用目录之外。
- 明确删除：只有用户主动选择 **Permanently delete active data** 时，卸载脚本才删除活动数据。删除属于不可恢复操作，外部备份不在脚本清理范围内。
- 重装恢复：若 fnOS 实测保留私有运行目录，确认新安装自动看到数据；若系统清理目录，从最新外部完整冷备恢复。

# Mac 开发机准备

执行日期：2026-07-29（Asia/Shanghai）

## 已核验工具

| 项目 | 已核验值 |
| --- | --- |
| Mac | macOS 26.2（25C56），Apple Silicon `arm64` |
| Docker Engine / Client | 29.6.2 / 29.6.2 |
| Docker Desktop | 4.83.0 |
| Buildx | 0.35.0-desktop.2 |
| Docker Compose | 5.3.1 |
| `fnpack` | 1.2.3，`/opt/homebrew/bin/fnpack` |
| `fnpack` SHA-256 | `d40cb00896cb2a5d211357d255750ed0cbe7f2d141df671c2b717afb4e74bf77` |
| Node.js / npm | 24.13.0 / 11.6.2 |
| uv | 0.10.8 |

`fnpack` 文件名为 `fnpack-1.2.3-darwin-arm64`。从[官方 fnpack 页面](https://developer.fnnas.com/docs/cli/fnpack/)下载与 Mac 架构匹配的文件后，可按以下方式安装：

```bash
chmod +x fnpack-1.2.3-darwin-arm64
sudo install -m 0755 fnpack-1.2.3-darwin-arm64 /opt/homebrew/bin/fnpack
fnpack --help
shasum -a 256 /opt/homebrew/bin/fnpack
```

下载后应先记录来源、版本和 SHA-256，再替换已有二进制。不要仅凭文件名判断来源。

> `appcenter-cli` 运行在 fnOS 设备上，用于安装和管理 `.fpk`。Mac 只需要 Docker、Buildx/Compose、`fnpack` 和访问镜像仓库的凭据；不要按旧评估文档在 Mac 安装 `appcenter-cli`。

## 每次开始开发前

```bash
docker version
docker buildx version
docker compose version
docker run --rm hello-world
fnpack --help
shasum -a 256 /opt/homebrew/bin/fnpack
```

若 Docker 命令提示无法连接 daemon，先启动 Docker Desktop，等待状态变为 Running，再重试。当前 Mac 已通过 `hello-world`，输出确认拉取并运行了 `arm64v8` 镜像。

## 仓库与隔离工作区

候选版工作区和基线为：

```text
/Users/buu99y/workspace/github/agents/SAG/.worktrees/feat-fnos-docker-app
branch: feat/fnos-docker-app
base: origin/main@06f29b2ae571dfcedecc85577ee6910ed87a810a
```

依赖安装和测试均在该 worktree 执行。不要从主工作区复制未提交配置、模型密钥或 `.env`。

## 官方 hello-docker 冒烟

`fnpack create` 以当前目录为输出根；`fnpack build` 可以在包目录运行，或使用 `--directory`：

```bash
WORK_DIR="$(mktemp -d)"
cd "$WORK_DIR"
fnpack create hello-docker --template docker
cd hello-docker
fnpack build
shasum -a 256 hello-docker.fpk
```

2026-07-29 的本地构建已成功，临时产物 SHA-256 为：

```text
39c0090f2ca037c70af42c1197c1940329959722ceca2a914cdb291e90f61b87
```

该哈希只对应当次临时冒烟包，不是 SAG 发布物。将它安装到 fnOS 后，还需在应用中心验证安装、打开、停止、启动和卸载；当前因 fnOS 管理会话需要登录，这组设备侧检查尚未完成。

## 凭据规则

- GHCR 发布使用 GitHub Actions 的 `GITHUB_TOKEN` 和 `packages: write`；不得把 PAT 写进仓库或 shell 历史。
- 模型、Embedding、MinerU 测试凭据只在私下提供后录入 SAG 页面，不进入 `.env` 样例、日志、截图或 `.fpk`。
- 本地 Compose 的 `SAG_SECRET_KEY` 与 `SAG_AUTH_BOOTSTRAP_TOKEN` 必须分别生成，
  不得相同；fnOS 安装脚本会在设备私有 `sag.env` 中完成同样操作。两者都不得进入
  仓库、构建参数、日志、截图或验收证据。
- 正式 `.fpk` 构建只接收已发布、可检查的 digest 引用。

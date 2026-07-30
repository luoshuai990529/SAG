# CI-02：SAG 数据库池生命周期修复

- 执行时间：2026-07-30 10:37–10:39 CST（Asia/Shanghai）
- 仓库：`luoshuai990529/SAG`
- PR：[ #1 `feat/fnos-docker-app -> main`](https://github.com/luoshuai990529/SAG/pull/1)
- 提交：`99010cdba2970a73f61ce0100fd8775c1eba76b4`
- Actions 运行：[30508962750](https://github.com/luoshuai990529/SAG/actions/runs/30508962750)

## 结论

通过。以下三个 GitHub Actions job 均以 `SUCCESS` 结束：

1. `发布流程 · 安全回归`；
2. `后端 · ruff + pytest`；
3. `前端 · tsc + next build`。

后端结果为 `213 passed in 59.35s`，日志中没有 `warnings summary`、
`MissingGreenlet`、`database is locked`、`Event loop is closed` 或
`PytestUnhandledThreadExceptionWarning`。

本轮修复为每次 zleap-sag 共享 SQLite runtime reset 增加异步关闭，并在每个
DataEngine 的 owner Context 中逐个处置其实际拥有的 SQLAlchemy bind。两项新增回归
分别证明：

1. 启动第二个信源引擎不会再通过同步 reset 关闭 aiosqlite；
2. EngineManager 关闭后，曾被 reset 的旧引擎连接池不会残留连接。

同一提交已在 macOS ARM64 和本地 Linux ARM64 容器完成 `213 passed`，GitHub
Linux x86-64 Runner 再次完成 `213 passed`。此结果证明候选分支的引擎停止与数据库
连接释放门禁已通过，不等同于 GHCR 镜像发布、正式 FPK 构建或 fnOS VM 生命周期验收。


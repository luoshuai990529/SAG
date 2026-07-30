# CI-02：SAG 数据库与任务队列停机稳定性修复

- 执行时间：2026-07-30 10:37–12:00 CST（Asia/Shanghai）
- 仓库：`luoshuai990529/SAG`
- PR：[ #1 `feat/fnos-docker-app -> main`](https://github.com/luoshuai990529/SAG/pull/1)
- 最终被测提交：`0616d3fd9ba7d26177aa435b77dbf56f073c303e`
- 最终 Actions 运行：[30512305495](https://github.com/luoshuai990529/SAG/actions/runs/30512305495)

## 结论

通过。最终提交的以下三个 GitHub Actions job 均以 `SUCCESS` 结束：

1. `发布流程 · 安全回归`；
2. `后端 · ruff + pytest`；
3. `前端 · tsc + next build`。

Backend job 在同一 run 下初跑并主动重跑两次，三个独立 attempt 均成功：

1. [attempt 1 / job 90774778741](https://github.com/luoshuai990529/SAG/actions/runs/30512305495/job/90774778741)；
2. [attempt 2 / job 90775073610](https://github.com/luoshuai990529/SAG/actions/runs/30512305495/job/90775073610)；
3. [attempt 3 / job 90775550479](https://github.com/luoshuai990529/SAG/actions/runs/30512305495/job/90775550479)。

最终 attempt 的日志结果为 Ruff `All checks passed!`、pytest
`214 passed in 63.21s`，没有出现 `database is locked`。

## 问题与修复

此前 `99010cd` 虽曾完整通过，但后续 CI 复跑在测试生命周期结束时偶发
`sqlite3.OperationalError: database is locked`，因此旧结果不足以证明稳定性。

连接池事件追踪确认：API lifespan 退出时直接取消 `sag-worker-0`，会使正在执行
SQLite 操作的 aiosqlite 连接进入 invalidate/force-close 路径；SQLAlchemy 已没有
普通 checkout 泄漏，但底层关闭尚未完成，下一次写操作仍可能遇到文件锁。

`0616d3f` 将队列停机调整为：

1. 停止接收并执行新的排队任务，数据库中的 `QUEUED` 记录留待下次启动恢复；
2. 给予已经在执行的任务 5 秒有界窗口，使其在安全边界完成提交和连接归还；
3. 只在超时后取消仍未结束的 worker，并保留停机不会无限等待的兜底；
4. 增加回归测试，证明在途任务完成为 `SUCCEEDED`，尚未开始的任务保持 `QUEUED`；
5. 删除仅用于根因定位的全局连接池追踪夹具。

## 本地连续验证

- macOS ARM64：Ruff 通过，完整 pytest `214 passed in 36.81s`；
- Linux amd64 容器：锁冲突精简组合在清理诊断钩子前后各连续 5 轮通过，每轮
  `13 passed`；
- Linux amd64 容器：完整 pytest 连续 3 轮通过，分别为
  `214 passed in 54.03s`、`48.97s`、`49.62s`。

以上结果证明候选分支的 API 数据库连接、在途任务和队列停止门禁已恢复稳定，不等同于
GHCR 镜像发布、正式 FPK 构建或 fnOS VM 全生命周期验收。

# fnOS 验收证据目录

仓库只保存脱敏、可公开的验收证据。模型密钥、Authorization、Cookie、用户密码、
`SAG_SECRET_KEY`、`SAG_AUTH_BOOTSTRAP_TOKEN`、用户文档正文、`sag.env`、`sag.db`、
完整 `/data`、备份归档及其下载链接不得进入本目录。备份即使已加密也不属于验收证据。

建议结构：

```text
docs/fnos/evidence/
└── YYYY-MM-DD/
    └── <case-id>/
        ├── summary.md
        ├── command.log
        └── screenshot-01.png
```

`summary.md` 至少记录 SAG/`.fpk`/fnOS 版本、commit、执行时间、设备架构、测试地址（可脱敏）、前置数据状态、结论和日志摘要。`command.log` 保存脱敏后的相关命令及关键输出，不保存整份无关日志。

设备侧截图尚未产生的用例，在验收矩阵中填写计划路径并标记“待执行”。只有前序记录声称完成、但当前缺少可复核证据的项目才标记“待证据”；“待证据”不能计入通过。不能用空白截图或 Mac 本地结构包冒充 fnOS 实机证据。

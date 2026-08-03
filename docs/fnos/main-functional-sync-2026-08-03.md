# fnOS 主线功能同步账本

基线：`064d08271cf719a6526c41c723971502dfdfd808`（包含远程 fnOS 启动页修复 `44d7415`）。

来源：实施开始时的 `upstream/main`；只同步运行时 API 和 Web 交互，排除 Desktop、CLI/Skill 文档、社区素材、主线 Compose、通用 CI 与 Dify 外部知识库代码。

| 上游 SHA | 能力 | 状态 | fnOS 处理 | 验证 |
| --- | --- | --- | --- | --- |
| `31bda7a` | Dify 外部知识库 API | 本轮排除 | 该 API 需要 Dify API Key，与 fnOS 无密钥产品边界冲突 | 不执行 |
| `dc96502` | 来源 ID 复制 | 待同步 | 保留同源 API | 待执行 |
| `5530c6b` | PostgreSQL schema | 已同步 | 首次引擎启动后、创建 `SourceConfig` 前初始化 schema；E2E 测试适配 fnOS single-user | 临时 pgvector PostgreSQL：修复前缺少 `source_config` 失败，修复后 1 通过 |
| `f4c48b8` | 文档处理反馈 | 已同步 | 重试期间保留断点并展示实时处理活动；fnOS Docker 固定抽取并发仍为 2，不采用上游默认 30 | API Ruff 与 36 项回归通过；Web 32 项单测、lint、typecheck、生产构建通过 |
| `948e3e3` | DeepSeek V4 | 已同步 | 工具调用时关闭 thinking，不影响其他模型 | `uv run pytest tests/test_units.py -k deepseek -q`（2 通过） |
| `029c92b` | IME Enter | 待同步 | Web 交互 | 待执行 |
| `8018cac`、`7d756d6` | Dify 向量策略 | 本轮排除 | 依赖已排除的 Dify 外部知识库 API | 不执行 |
| `87d8b16` | 知识 REST API | 已同步 | 新增大纲、全文检索、文档读取与实体上下文四组同源 API 路由 | Ruff 通过；路由 OpenAPI 与 single-user 回归测试 2 项通过 |

## 基线验证

- API：`uv run pytest tests/test_single_user_no_auth.py tests/test_hardening.py -q`。
- Web：`npm run test:unit -- lib/api-base.test.ts lib/auth.test.ts`（6 项通过）。
- fnOS：无登录边界、发布 Compose、镜像 smoke、发布工作流门禁测试通过。

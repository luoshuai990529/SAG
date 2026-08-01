# SAG fnOS 无认证单用户模式设计

## 目标

将 fnOS 版 SAG 恢复为真正的无认证单用户应用：用户名只在空数据库首次使用时设置，后续任何浏览器和设备都直接进入同一个用户空间，不要求用户名、密码、初始化密钥或登录令牌。

## 行为

- 空数据库首次打开时显示“怎么称呼你”，提交后创建唯一用户并进入主界面。
- 数据库已有用户时，根路径、新浏览器和新设备都直接进入主界面。
- 用户名只用于显示和数据归属，不作为认证凭据。
- 从 `1.4.0-fnos.3` 升级时复用最早创建的用户及其知识库、会话和配置。
- fnOS 不显示登录、密码、初始化密钥、注册、退出登录或认证恢复入口。
- API 在 fnOS 无认证模式下把请求映射到唯一用户，不校验 Bearer Token。
- 后端继续自动生成用户不可见的 `SAG_SECRET_KEY`，供仍依赖 JWT 的兼容接口使用，但 Web 使用不依赖它。

## 实现边界

- 新增显式认证模式 `single_user`，不复用含隐式密码行为的 `legacy` 名称。
- `GET /api/v1/auth/session` 返回现有唯一用户；空库返回明确的 `setup_required` 状态。
- `POST /api/v1/auth/session` 仅在空库接受用户名并创建唯一用户；已有用户时直接返回该用户。
- `get_current_user` 在 `single_user` 模式忽略 Authorization 并读取唯一用户。
- Web 中间件不再根据 `sag_token` 保护路由。
- 首次设置页自动查询 session；已有用户立即进入 `/chat`，空库才显示用户名表单。
- fnOS Compose 使用 `SAG_AUTH_MODE=single_user`，不再设置 `SAG_AUTH_BOOTSTRAP_TOKEN`。
- fnOS 安装环境只保存随机 `SAG_SECRET_KEY`。
- Manifest、候选标签和 FPK 版本更新为 `1.4.0-fnos.4`。

## 兼容与安全边界

- 不删除 User 表、密码哈希或历史认证字段，避免破坏旧数据结构。
- 不删除通用部署的 `password` 和 `legacy` 模式，只让 fnOS 选择 `single_user`。
- 无认证是明确产品选择：任何能访问 `3080` 的客户端都拥有同一 SAG 用户的全部权限。
- FPK 仍只暴露 `3080`，数据仍整体保存在 `/data`。

## 完成条件

- 空库只能创建一个用户，并发初始化不会产生多个用户。
- 已有库无需任何输入即可访问 API 和 Web。
- 无 Token、错误 Token 和旧 Token 在 `single_user` 模式下行为一致。
- 密码和初始化密钥不出现在 fnOS Web 或 FPK 环境文件中。
- `1.4.0-fnos.3` 数据可原地升级。
- API、Web、fnOS 静态测试、生命周期测试、镜像冒烟和 fnpack 构建通过。
- 交付 `sag-1.4.0-fnos.4.fpk`、SHA-256 和变更说明。

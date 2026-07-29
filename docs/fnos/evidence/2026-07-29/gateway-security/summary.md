# SEC-01 Nginx gateway 安全复核

- 执行时间：`2026-07-29T16:33:41+08:00`
- 固定引用：`docker.io/library/nginx:1.30.4-alpine@sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46`
- Docker Official Image 上游 revision：`ccdab6c99ae2e2fc53a144dc68d6b8f44163adf2`
- amd64 manifest：`sha256:8a4f4b94275ff59d809477799cbbaf1a7ab65ed1871403d05e31fd66bdb8db82`
- arm64 manifest：`sha256:d64d001f60e9a65d45980907e9070fc46d418980f311052e73c0df2eccc3cc30`
- Scanner：Aqua Trivy `0.70.0`
- 本机 macOS ARM64 scanner 归档 SHA-256：`68e543c51dcc96e1c344053a4fde9660cf602c25565d9f09dc17dd41e13b838a`
- CI Linux amd64 scanner 归档 SHA-256：`8b4376d5d6befe5c24d503f10ff136d9e0c49f9127a4279fd110b727929a5aa9`
- 扫描策略：`linux/amd64`、vulnerability scanner、`CRITICAL,HIGH`、`--ignore-unfixed`、发现时 exit `1`
- 结果：通过；可修复 Critical/High `0`
- 扫描目标 OS：Alpine `3.24.1`
- 扫描目标 image ID：`sha256:6e01bfae6f7971512a5765fe2f52ca4267a4773c7f8b357a2d39e5300787cece`
- 临时原始 JSON SHA-256：`9fa13bd965a961408daea1d761d7a52f7ed246dc845211c1d3b51873a5b217a9`
- policy 复核日期：`2026-07-29`
- policy 到期日期：`2026-08-28`

实际扫描命令：

```text
trivy image --platform linux/amd64 --scanners vuln --severity HIGH,CRITICAL \
  --ignore-unfixed --exit-code 1 --format json --output <temporary-report> \
  docker.io/library/nginx:1.30.4-alpine@sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46
```

命令退出 `0`。原始报告只用于验证结果和生成上述摘要，没有提交；Trivy 漏洞数据库、
镜像层和完整 JSON 均未进入仓库。`0` 来自实际报告，不是预设值或漏洞豁免。

随后以同一固定引用启动 `linux/amd64` 官方容器，并把
`packages/fnos/sag/app/docker/nginx.conf` 只读挂载到默认配置位置运行 `nginx -t`。
输出为：

```text
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

续期步骤见 [网络、构建与安装](../../../install-and-network.md#nginx-gateway-复核与续期)。
镜像或 scanner/DB 变化、官方新安全公告出现、或到期前必须重新核验并用同一受评审
commit 更新策略和证据；存在发现时停止发布。

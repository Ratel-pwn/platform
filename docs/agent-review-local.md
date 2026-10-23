# 群聊 Agent 本地测试操作说明

2026-10-13 当前进度：用户已明确授权由代理执行必要的前后端构建及本地容器更新，最终前端打包和隔离镜像构建均已通过。19 个隔离服务、测试工作区、两个人工账号、三个机器人和 Agent 进程已准备完成。已修复真实提及搜索、页面内命名、异步提交保留草稿、需求栏位置、线程空间及恢复草稿附件重复保存。首条真实技术评估已生成 MD/DOCX 并进入待人工确认；取消命名、需求/普通聊天草稿切换、刷新恢复及普通需求回复已联调通过。SDK/HTTP 文件下载及 DOCX 文本一致性通过；浏览器自动化下载超时，实际点击下载与 DOCX 排版待人工确认。以下命令供复现，已完成步骤无需重复执行。

本地访问：`http://huly-review.local:18087`，工作区 URL 为 `agent`。账号邮箱和随机密码保存在 `dev/agent-review/test-accounts.local.json`（已忽略提交），以 `accounts.owner` 登录进行人工验收，`accounts.member` 用于第二成员测试。配置位于 `services/agent-review/runtime.config.local.json`；模型 API 文件未改动。

当前 Huly 的真实人员提及依赖全文搜索，因此测试栈包括隔离的 Elasticsearch 和本地源码构建的 fulltext。MinIO 官方镜像地址不可用，改用官方固定发行版二进制，经 SHA-256 验证后封装本地镜像。首次构建前执行 `powershell -ExecutionPolicy Bypass -File dev/agent-review/prepare-minio.ps1` 下载并校验；不在宿主机执行该 Linux 二进制。

## 1. 安装依赖并验证 Pi

打开 PowerShell，逐条执行：

```powershell
Set-Location D:\CodeRepository\Huly
node services/agent-review/scripts/preflight.cjs --api-only
node common/scripts/install-run-rush.js update
node common/scripts/install-run-rush.js bundle --to @hcengineering/agent-review
node services/agent-review/bundle/check.js --model
```

预期：配置检查输出 `PASS`；最后输出 `PASS：Pi 使用本地 API 配置返回了有效文字。`。最后一步只产生一条短模型请求，不读取内部参考资料，不登录或发布 Huly 消息。已验证 HTTP API 可用后，仍需这一步确认本服务使用的 Pi SDK 能调用同一接口。

`apiType` 为 `openai-compatible` 时按 OpenAI Chat Completions 接入，也可明确填写 `openai-completions`。其他协议需使用 Pi 对应的 API 类型，例如 `openai-responses`。可选 `contextWindow` 表示模型的上下文限制，按供应商文档填写；未填写时本服务使用 32768 作为运行配置值，不代表已核实模型能力。

依赖安装、打包失败时，不要继续群聊测试，也不要删除现有 API 配置。保留失败步骤与错误信息；分享信息时遮盖密钥、密码和令牌。

## 2. 构建修改后的 Huly

先手动打开 Docker Desktop，确认使用 Linux 容器。初次构建需要下载基础镜像及依赖，不能把旧版公共前端镜像用于验收新界面。

本地测试配置位于 `dev/agent-review/huly.compose.local.json`。它由当前源码的 `dev/docker-compose.yaml` 派生，使用独立项目、端口、网络和数据卷，只启动聊天测试所需的服务。每个 Huly 应用镜像都从本地源码构建并使用同一测试版本标记；保留 `huly-source.local.json` 记录。基础设施镜像版本沿用仓库开发配置，正式验收时还应保存实际镜像 ID。

源码变更后重新生成配置：

```powershell
Set-Location D:\CodeRepository\Huly
docker compose -f dev/docker-compose.yaml config --no-interpolate --format json | Set-Content -Encoding utf8 dev/agent-review/huly-base.local.json
git rev-parse HEAD | Set-Content -Encoding ascii dev/agent-review/huly-revision.local.txt
node dev/agent-review/prepare-huly.cjs
docker compose -f dev/agent-review/huly.compose.local.json config --quiet
```

这几条命令只生成和检查配置，不启动容器。生成器使用测试环境内部的数据库和队列地址，不导入 `dev/.env` 中的连接信息。

接着依次准备前端及服务文件：

```powershell
node common/scripts/install-run-rush.js package --to @hcengineering/prod
node common/scripts/install-run-rush.js bundle --to @hcengineering/pod-front --to @hcengineering/pod-server --to @hcengineering/pod-account --to @hcengineering/pod-workspace --to @hcengineering/pod-collaborator --to @hcengineering/pod-stats --to @hcengineering/pod-datalake --to @hcengineering/pod-process --to @hcengineering/pod-events-processor --to @hcengineering/pod-worker --to @hcengineering/pod-rating
node dev/agent-review/prepare-huly.cjs --copy-front
node common/scripts/install-run-rush.js bundle --to @hcengineering/pod-fulltext
docker compose -f dev/agent-review/huly.compose.local.json build
```

仓库部分打包脚本使用 Unix 工具。若 Windows 提示找不到 `rm`、`cp`、`rushx` 或 shell，先停止并反馈具体错误，按错误配置构建环境；不要用其他版本的镜像绕过。`--copy-front` 使用 Windows 可运行的文件复制方式准备前端静态文件。

为浏览器提供测试域名解析：以管理员权限编辑 `C:\Windows\System32\drivers\etc\hosts`，新增以下一行并保存：

```text
127.0.0.1 huly-review.local
```

启动与检查：

```powershell
docker compose -f dev/agent-review/huly.compose.local.json up -d
docker compose -f dev/agent-review/huly.compose.local.json ps
```

浏览器打开 `http://huly-review.local:18087`。创建专用测试工作区，进入“聊天 → 频道”。本次验收要求看到“当前需求”栏；如果登录成功但没有该栏，先核对新前端构建和当前频道入口。

若启动失败，查看指定服务的日志，例如：

```powershell
docker compose -f dev/agent-review/huly.compose.local.json logs --tail 80 front account workspace_cockroach transactor_cockroach
```

停止这个测试环境时使用同一个配置文件执行 `stop`，保留数据卷供后续测试使用。

## 3. 准备测试频道和机器人

准备一个专用测试频道，例如“Agent 文档评审测试”，加入两名人工成员，以及三个独立账号：技术评估Agent、方案Agent、合同Agent。

三个账号都要先登录一次，加入同一测试工作区和频道，并能在该频道发送消息、上传和下载文件。显示名称使用以上完整名称；服务会将账号绑定到实际人员身份，服务端不接受同名人员冒充机器人。

先使用 Windows 直接运行 Agent，便于区分模型问题、Huly 问题与容器网络问题。安全复制本机路径配置，已有配置时不覆盖：

```powershell
Set-Location D:\CodeRepository\Huly
if (-not (Test-Path services/agent-review/runtime.config.local.json)) {
  Copy-Item services/agent-review/runtime.config.example.json services/agent-review/runtime.config.local.json
}
```

手动编辑 `runtime.config.local.json`：

| 字段 | 填写方式 |
|---|---|
| `huly.url` | `http://huly-review.local:18087` |
| `huly.workspace` | 浏览器地址中 `workbench/` 后的工作区 URL 名称；不是工作区显示标题 |
| `bots` | 三个机器人各自的邮箱和密码 |
| `references` | 确认三个阶段的文件存在，使用本机路径 |
| `dataDir` | 建议使用 `D:/CodeRepository/Huly/services/agent-review/data` |
| `maxConcurrency` | 首轮设为 `1`，基础流程通过后再测试 `2` |

`enabledChannels` 的频道 ID 可通过以下只读查询获得；查询不发布消息：

```powershell
node services/agent-review/bundle/check.js --channels
```

从输出中找到测试频道，把对应 `id` 填入 JSON，例如 `"enabledChannels": ["实际频道ID"]`。然后检查账号、成员关系和本机配置：

```powershell
node services/agent-review/scripts/preflight.cjs
node services/agent-review/bundle/check.js --huly
```

预期：配置检查全部 `PASS`，三个机器人分别显示身份匹配且已加入启用频道。这个检查不验证下载/上传附件，附件链路在下一步验证。

## 4. 第一条群聊闭环

打开一个独立 PowerShell 窗口保持 Agent 服务运行：

```powershell
Set-Location D:\CodeRepository\Huly\services\agent-review
node bundle/bundle.js
```

看到 `agent-review started` 后，回到测试频道，用人工账号操作：

1. 退出当前需求，确认发送目标为普通频道。
2. 上传 `dev/agent-review/fixtures/客户A-需求.md`。
3. 输入 `@`，从 Huly 的人员选择列表选中“技术评估Agent”，再输入“请评估附件需求”。纯文本打出 `@名称` 不会触发。
4. 点击发送，在命名框填“客户 A”。确认消息发出并选中客户 A。
5. 等待机器人返回；轮询间隔默认 5 秒，生成耗时受模型影响。若超过配置的 `timeoutMs` 加 30 秒仍无回复，检查服务窗口，而不是重复发送多条任务。
6. 检查主聊天区的需求名称标记，下载 `.md` 和 `.docx`，确认文件可以打开、内容对应客户 A。Markdown 是内容核对的首轮基准；DOCX 排版另行验收。

本轮通过标准：建立需求、选中需求、机器人以对应账号回复、主聊天区可见、附件可下载、内容正确。任何一项失败，都还不能继续宣布全流程通过。

## 5. 三阶段交接与隔离测试

仍在客户 A 中，人工修改技术评估文件并另存为 `技术评估定稿.md`，上传该文件，真实提及方案Agent并发送“请根据附件定稿编写方案”。方案返回后修改并上传 `方案定稿.md`，提及合同Agent并发送“请根据附件定稿起草合同”。合同修改后上传 `合同定稿.md`，提及合同Agent并发送“确认定稿”，检查完成消息。

再退出需求，上传 `fixtures/客户B-需求.md`，真实提及技术评估Agent，建立“客户 B”。交替选择 A/B 发文字与附件，检查文件、回复及内容标记互不串用；让第二名人工成员独立选中客户 A 并参与讨论。

随后按 `docs/agent-review-验收清单.md` 记录异常场景，包括无定稿交接、伪造提及、不支持文件、草稿切换、刷新、普通线程、重跑和服务重启。每项记录“通过/失败/未测”、触发消息、时间、截图及输出文件。

## 6. Agent 容器联调

Windows 直接运行闭环通过后，先用 Ctrl+C 停止该服务，避免两份服务同时扫描。备份本机运行配置，手动按 `runtime.config.docker.example.json` 改成 `/app/...` 参考路径和 `/app/data`，保留工作区、频道及账号信息；API 配置继续使用已填写的文件。

```powershell
Set-Location D:\CodeRepository\Huly
docker compose -f dev/agent-review/docker-compose.yaml build
docker compose -f dev/agent-review/docker-compose.yaml run --rm agent-review node check.js --huly
docker compose -f dev/agent-review/docker-compose.yaml up -d
docker compose -f dev/agent-review/docker-compose.yaml logs --tail 80 -f agent-review
```

容器里的模型 API 地址必须能从容器访问；如果 API 在本机，`localhost` 指向容器自身，需要按实际服务改为可访问的宿主地址。容器连接 Huly 失败时先停止在账号检查步骤，核对 `huly-review.local` 映射、Docker Desktop 网络和端口可达性。通过后用新的测试需求重复第一条闭环。

## 当前证据与剩余缺口

- 已执行：配置字段检查、Compose 格式检查、代码差异检查、前端重新打包、Docker 镜像构建及19个隔离服务启动、浏览器登录、三个机器人身份/频道检查、真实人员提及、需求创建/取消、草稿切换/刷新及普通需求回复；真实技术评估任务已完成生成，MD/DOCX 已回到原线程，SDK/HTTP 下载与正文一致性通过。
- 用户已执行并报告通过：依赖安装、agent-review bundle、真实 Pi 请求和前后端打包。
- 待执行：浏览器实际点击下载、DOCX 排版、多成员、客户 A/B 完整隔离、三阶段交接及人工验收。浏览器自动化等待下载超时，没有据此判定服务端附件失败，也没有把实际浏览器下载标为通过。
- 尚需完善：执行中任务在重启后的恢复、输出回写重试、完整输入快照、同需求串行保证、上游版本变更后的下游失效、两次交接的人工作证记录，以及 DOCX 结构/修订/渲染检查。当前代码不能视为完整计划已实现或已验收。

本地完整验收通过并由用户确认后，再安排服务器更新。

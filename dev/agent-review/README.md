# 本地群聊 Agent 测试环境

按 `../../docs/agent-review-local.md` 从 API/Pi 检查开始执行。

- `prepare-huly.cjs`：从仓库开发 Compose 的只读导出生成独立 Huly 配置；不安装、构建或启动。先导出 `huly-base.local.json` 和 `huly-revision.local.txt`。
- `huly.compose.local.json`：生成的 Huly 测试栈，前端端口 18087，独立容器、网络和数据卷；本地文件被 Git 忽略。
- `docker-compose.yaml`：单独的 Agent 容器，使用配置及参考文件的只读挂载；Huly 主环境需先就绪。
- `fixtures/`：客户 A/B 的非正式测试需求。
- `inspect-local.cjs`：读取隔离测试频道和任务状态，不输出凭据；可用 `--download` 把已生成的附件保存到服务被忽略的 `data/local-verification` 目录。
- `start-local.cmd`：一键启动隔离 Huly 和 Windows Agent，并打开测试频道。由 start-local.cjs 执行配置检查、等待 Huly 及机器人连接、记录 PID 和追加日志；仅使用已有镜像（--no-build --pull never），不自动构建。start-local.ps1 为兼容入口，可加 -ForegroundAgent 查看前台日志。

首次可按指南复现构建；本轮用户已授权代理完成构建与本地启动，已完成步骤无需重做。配置中包含机器人密码，不能提交到 Git。测试证据记录镜像 ID、源码标记、实际步骤和失败情况，不把配置检查当作运行验收。

停止本地服务时，在仓库根目录执行 `docker compose -f dev/agent-review/huly.compose.local.json stop`，并结束 `agent-process.local.json` 中记录的 Agent 进程；该命令会保留测试数据卷。

2026-10-23：启动器仅完成语法与静态检查，尚未实启验证。本次 Git 提交不启动服务或重新构建。

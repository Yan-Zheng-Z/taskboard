# Proposal

## Why

同时用 Claude Code 和 DeepSeek Harness 这类编码 Agent 推进多项工作时，任务、截止日期和每一步的进度散落在各个会话里，没有一个常驻桌面、人和 Agent 都能更新的统一视图。调研过的现成项目（Super Productivity、Backlog.md、kanban-code 等）都缺少"桌面挂件形态""每步百分比进度""多个 Agent 共同更新并留下署名"中的至少一项，因此做一个极简版本，并作为开源项目发布到 GitHub 供其他人使用。

## What Changes

- 新增本地任务数据存储：任务含名称、截止日期、步骤；每个步骤含名称、0–100 的进度百分比、最后更新人和更新时间。
- 新增 `task` 命令行工具：增删任务和步骤、更新进度、查看任务。任何能执行 shell 命令的 Agent 都通过它更新进度，并用 `--by` 标明身份。
- 新增置顶桌面小窗口：显示任务列表、截止日期紧迫程度和总进度；点开任务查看步骤并手动修改进度；数据被命令行或 Agent 修改后自动刷新。
- 新增 Agent 接入说明：让 Claude Code 和 DeepSeek Harness 知道何时、如何调用 `task` 命令。
- 以开源项目的形式发布：MIT 许可证、面向外部用户的中英文 README、从 GitHub 安装的步骤、GitHub Actions 自动测试。Agent 接入文件以可复制的模板提供，不会在别人安装时自动改动他们的 Agent 配置。
- 第一版不包含：MCP 封装、日历同步、多设备同步、到期提醒通知、读取 OpenSpec 任务清单、打包成安装程序、界面多语言（界面文字为中文）、Windows 以外平台的测试。

## Capabilities

### New Capabilities

- `task-store`: 任务与步骤的数据模型、进度计算规则、本地持久化，以及多个写入方同时修改时的数据安全。
- `task-cli`: `task` 命令的各个子命令、输入校验、输出格式和错误行为。
- `desktop-widget`: 桌面小窗口的显示内容、交互方式、自动刷新和常驻行为。
- `agent-integration`: Claude Code 与 DeepSeek Harness 通过命令行更新任务进度的约定和署名规则。

### Modified Capabilities

无。这是项目的第一个变更。

## Impact

- 全新的代码仓库，此前没有任何代码；将发布为公开的 GitHub 仓库。
- 用户数据存放在用户主目录下的 `.taskboard/tasks.json`，与代码分离，不进入仓库。
- 仓库中不得出现个人路径、个人邮箱或真实任务数据。
- 新依赖：Electron（仅小窗口使用）；开发依赖 ESLint。命令行部分不引入第三方依赖。
- 会在本机注册两个全局命令：`task` 和 `taskboard`（启动小窗口）。预检确认这两个名字目前没有被占用。
- Agent 的指令文件以模板形式放在仓库的 `integrations/` 目录，由使用者自行复制到 Claude Code 的 `CLAUDE.md` 和 DeepSeek Harness 的 skill 位置。

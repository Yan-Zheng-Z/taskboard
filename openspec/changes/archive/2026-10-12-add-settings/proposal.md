# Proposal

## Why

用户打开 taskboard 后没有任何地方可以调整它：主题只能跟随系统，开机自启藏在托盘右键菜单里，归档固定显示 7 天，接入哪个 Agent 需要照着文档手动复制文件，整理时读取哪些对话也无法在界面上控制。作为要公开发布的工具，需要一个设置入口把这些集中起来。

## What Changes

- 小窗口新增设置页，从标题栏的齿轮按钮进入和返回，修改立即生效并保存。
- 外观：主题可选跟随系统、浅色、深色。
- 窗口：始终置顶开关、开机自动启动开关、归档页显示最近 7 / 14 / 30 天。
- Agent 接入：显示 Claude Code 和 DeepSeek Harness 是否检测到、taskboard 的 skill 是否已安装或需要更新，并提供一键安装或更新。安装 taskboard 本身仍然不改动任何 Agent 配置，只有用户点了按钮才复制。
- 整理：选择读取哪些 Agent 的对话、读取最近几天。这两项同时是 `task digest` 命令不带参数时的默认值，因此对 Agent 手动整理和窗口后台整理都生效。
- 数据：显示数据文件位置，可以打开所在文件夹。
- 关于：版本号和项目地址。
- 不包含：界面语言切换、选择用哪个 Agent 做后台整理、同步、提醒、快捷键。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `desktop-widget`: 新增设置页和 Agent 接入状态两项要求；归档页的显示天数改为可设置。
- `conversation-digest`: 新增"默认值来自设置"。
- `agent-integration`: 新增"从设置页安装接入说明"。

## Impact

- `src/core/`：新增设置的读写与校验（保存在数据目录的 `widget.json` 里，命令行和窗口共用）。
- `src/widget/`：设置页、Agent 状态检测与 skill 安装、主题和置顶的应用、打开文件夹。
- `src/cli/run.js`：`task digest` 的默认值。
- README 和接入文档。
- 点击"安装"会写入用户主目录下 Agent 的 skill 目录（`~/.claude/skills/taskboard`、`~/.dsh/skills/taskboard`）。

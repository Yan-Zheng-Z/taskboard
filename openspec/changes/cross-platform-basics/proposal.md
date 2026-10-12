# Proposal

## Why

项目公开后会有 macOS 和 Linux 用户，而代码里有三处是按 Windows 写的：开机自启登记的是系统登录项加启动参数，这在 macOS 上会启动一个空的 Electron；macOS 上会多出一个 Dock 图标；从登录项启动时拿不到终端里的 PATH，后台整理找不到 Claude Code，被启动的 Agent 也找不到 `task` 命令。另外读取 DeepSeek Harness 记录所需的解压功能是 Node.js 22.15 才有的，文档写的最低版本偏低。

## What Changes

- macOS 和 Linux 上的开机自启改为写入用户主目录下的启动文件（macOS 的 LaunchAgent、Linux 的 autostart 桌面项），内容是用应用目录启动本机的 Electron。Windows 保持原来的做法。
- macOS 上不显示 Dock 图标，只留菜单栏图标。
- 查找 Claude Code 时，除了 PATH 还查看常见的安装目录；启动后台整理的 Agent 时把这些目录加进它的 PATH。
- Node.js 最低版本更正为 22.15。
- 自动测试同时在 Windows、macOS 和 Linux 上运行。
- 这些改动在 macOS 和 Linux 上只有自动测试覆盖的部分得到验证；窗口、菜单栏图标和开机自启的实际效果没有在真机上试过，README 如实说明。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `desktop-widget`: 新增在 macOS 和 Linux 上的开机自启方式，以及从登录启动时仍能找到 Agent。

## Impact

- `src/widget/autostart.js`（新增）、`src/widget/main.js`、`src/widget/organize.js`。
- `.github/workflows/test.yml`、`package.json`、README。

# Spec Delta

## ADDED Requirements

### Requirement: 各系统上的开机自启
开机自动启动 SHALL 在各系统上都启动带有应用目录的 taskboard，而不是一个空的运行程序：Windows 使用系统登录项；macOS 使用用户主目录下的 LaunchAgent 文件；Linux 使用用户主目录下的 autostart 桌面项。关闭开机自启 MUST 移除对应的登记或文件。

#### Scenario: macOS 上开启
- **WHEN** 在 macOS 上开启开机自动启动
- **THEN** 用户主目录的 LaunchAgents 下出现 taskboard 的启动文件，其中的启动命令包含本机的运行程序和应用目录

#### Scenario: Linux 上开启
- **WHEN** 在 Linux 上开启开机自动启动
- **THEN** 用户主目录的 autostart 目录下出现 taskboard 的桌面项，其中的启动命令包含本机的运行程序和应用目录

#### Scenario: 关闭
- **WHEN** 在 macOS 或 Linux 上关闭开机自动启动
- **THEN** 对应的文件被删除

### Requirement: 不从终端启动时仍能找到 Agent
小窗口不是从终端启动（例如开机自启）时，系统给它的 PATH 可能不包含命令行工具的安装目录。查找 Claude Code 时 SHALL 在 PATH 之外再查看用户主目录下常见的安装目录；启动后台整理的 Agent 时 SHALL 把这些目录加入它的 PATH，使它能找到 `task` 命令。

#### Scenario: PATH 里没有 Claude Code
- **WHEN** PATH 不包含 Claude Code 所在的目录，但它安装在用户主目录下的常见位置
- **THEN** 小窗口仍然检测到 Claude Code，后台整理可用

#### Scenario: PATH 优先
- **WHEN** PATH 里和常见目录里各有一个 Claude Code
- **THEN** 使用 PATH 里的那个

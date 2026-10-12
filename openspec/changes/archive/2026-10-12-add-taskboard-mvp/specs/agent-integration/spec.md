# Spec Delta

## Purpose

让 Claude Code 和 DeepSeek Harness 在工作过程中用同一套约定更新任务进度，使用户能在桌面小窗口里看到是哪个 Agent 在什么时候推进了哪一步。

## ADDED Requirements

### Requirement: Agent 只通过命令行修改数据
接入说明 SHALL 要求 Agent 使用 `task` 命令读取和修改任务，MUST NOT 指示 Agent 直接编辑数据文件。

#### Scenario: Agent 完成一个步骤
- **WHEN** Agent 在用户指定的任务下完成了其中一个步骤
- **THEN** Agent 运行相应的 `task` 命令更新该步骤，数据文件本身没有被 Agent 直接编辑

### Requirement: Agent 署名
接入说明 SHALL 为每个 Agent 规定固定的署名：Claude Code 使用 "claude"，DeepSeek Harness 使用 "deepseek"。

#### Scenario: 两个 Agent 更新同一任务
- **WHEN** Claude Code 更新步骤 1、DeepSeek Harness 更新步骤 2
- **THEN** 步骤 1 的最后更新人为 "claude"，步骤 2 的最后更新人为 "deepseek"

### Requirement: 更新时机
接入说明 SHALL 规定 Agent 只在用户指明当前工作对应的任务后更新进度，并且只在某个步骤确实有进展或完成时更新。Agent MUST NOT 自行创建或删除任务，除非用户要求。

#### Scenario: 用户没有指定任务
- **WHEN** 用户没有说明当前工作属于哪个任务
- **THEN** Agent 不修改任何任务进度

#### Scenario: 用户指定了任务
- **WHEN** 用户说"现在做任务 1"并且 Agent 完成了其中的步骤 2
- **THEN** Agent 把任务 1 的步骤 2 标记为完成

### Requirement: 两个 Agent 的接入说明
项目 SHALL 为 Claude Code 和 DeepSeek Harness 各提供一份接入说明模板，并附一份文档说明应复制到哪个会被该 Agent 自动读取的位置，以及如何在该 Agent 中放行 `task` 命令。安装本项目 MUST NOT 自动修改使用者的 Agent 配置。

#### Scenario: 安装不改动 Agent 配置
- **WHEN** 使用者按 README 安装本项目
- **THEN** 其 Claude Code 和 DeepSeek Harness 的指令文件没有任何变化，直到使用者自己复制模板

#### Scenario: 新开 Claude Code 会话
- **WHEN** 用户新开一个 Claude Code 会话并说"现在做任务 1，完成后更新进度"
- **THEN** Claude Code 无需额外说明就知道使用 `task` 命令并以 "claude" 署名

#### Scenario: 新开 DeepSeek Harness 会话
- **WHEN** 用户在 DeepSeek Harness 中做同样的要求
- **THEN** DeepSeek Harness 使用 `task` 命令并以 "deepseek" 署名

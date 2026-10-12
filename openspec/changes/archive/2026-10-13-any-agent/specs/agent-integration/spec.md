# Spec Delta

## ADDED Requirements

### Requirement: 适用于任意 Agent 的接入说明
项目 SHALL 提供一份不依赖特定 Agent 的接入说明，内容与内置 Agent 的模板来自同一份文字，只有署名不同。它 MUST 说明"从对话整理"只能读取 Claude Code 和 DeepSeek Harness 的对话记录，使用其他 Agent 时该 Agent 自己的历史对话不在其中。仓库里内置 Agent 的模板 MUST 与这份文字保持一致。

#### Scenario: 其他 Agent 更新任务
- **WHEN** 使用者把署名为 "codex" 的接入说明放进另一个 Agent 的指令文件，并说"现在做任务 3"
- **THEN** 该 Agent 用 `task` 命令更新任务 3，署名为 "codex"

#### Scenario: 模板保持一致
- **WHEN** 接入说明的文字被修改
- **THEN** 仓库里的内置模板如果没有随之重新生成，自动测试失败

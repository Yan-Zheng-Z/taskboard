# Spec Delta

## ADDED Requirements

### Requirement: 从对话整理任务的约定
接入说明 SHALL 规定：用户要求从对话里整理任务时，Agent 先用 `task digest` 读取摘要、用 `task list` 和 `task suggestions` 了解现有内容，再用 `task suggest` 逐条提出建议并写明来源。Agent MUST NOT 在这个流程里直接创建正式任务。

#### Scenario: 用户说"整理一下任务"
- **WHEN** 用户让 Agent 从最近的对话里整理任务
- **THEN** Agent 提出的每一项都进入建议区并带有来源说明，任务列表没有被直接改动

#### Scenario: 只提出还没做完的事
- **WHEN** 摘要里某件事在对话中已经明确完成
- **THEN** Agent 不为它提出建议

### Requirement: 按用户要求直接添加任务
接入说明 SHALL 规定：用户明确说出要添加的任务时，Agent 用 `task add` 和 `task step add` 直接创建，不经过建议区，并在回复里说明新任务的编号。

#### Scenario: 用户说"加一个任务"
- **WHEN** 用户说"加一个任务：周五前交报销单，分成填表和找发票两步"
- **THEN** Agent 创建带截止日期和两个步骤的正式任务，并告诉用户任务编号

### Requirement: 整理时的隐私说明
接入文档 SHALL 说明 `task digest` 的输出包含用户在两个 Agent 里说过的话，会进入运行它的 Agent 的上下文，并说明如何用 `--agent` 只取一个来源。

#### Scenario: 用户只想用自己的对话来源
- **WHEN** 用户按文档让 Claude Code 只整理 Claude Code 的对话
- **THEN** Agent 运行带 `--agent claude` 的摘要命令，输出里没有 DeepSeek Harness 的对话

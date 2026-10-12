# Spec Delta

## ADDED Requirements

### Requirement: 从对话整理任务的约定
接入说明 SHALL 规定：用户要求从对话里整理任务时，Agent 先用 `task digest` 读取摘要、用 `task list` 和 `task suggestions` 了解现有内容，再用 `task suggest` 逐条提出建议并写明来源。Agent MUST NOT 在这个流程里直接创建正式任务。接入说明 SHALL 规定一条建议对应一整件事（一个项目或目标）而不是单个下一步动作：名称写总体目标，步骤写主要阶段并区分已完成和待做，同一项目的多个对话合并为一条。

#### Scenario: 一个项目一条建议
- **WHEN** 摘要里有一个做了很多天、只剩最后一步的项目
- **THEN** Agent 提出一条以该项目目标命名的建议，步骤里包含已完成的阶段和剩下的那一步，而不是只把最后一步当作任务

#### Scenario: 用户说"整理一下任务"
- **WHEN** 用户让 Agent 从最近的对话里整理任务
- **THEN** Agent 提出的每一项都进入建议区并带有来源说明，任务列表没有被直接改动

#### Scenario: 整个项目都已完成
- **WHEN** 摘要里某个项目的所有阶段在对话中都已明确完成
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

### Requirement: 整理时直接更新已有任务
接入说明 SHALL 规定：整理时，对话涉及的项目如果已经是列表里的任务，Agent 直接更新该任务，把对话显示已完成的步骤标为完成、补上任务里缺少的阶段，而不是为它另提一条建议。Agent MUST 只向前推进进度，MUST NOT 删除或改名任何任务和步骤，MUST NOT 改动对话没有提到的任务。

#### Scenario: 项目已在列表里
- **WHEN** 列表里已有任务"搭建并发布 taskboard"，最近的对话显示其中一个步骤已经做完，并且出现了一个任务里没有的新阶段
- **THEN** Agent 把该步骤标为完成并署名，给该任务添加新步骤，没有为这个项目提出新的建议

#### Scenario: 对话没有提到的任务
- **WHEN** 列表里有一个最近的对话完全没有提到的任务
- **THEN** 该任务的步骤和进度保持不变

## MODIFIED Requirements

### Requirement: 更新时机
接入说明 SHALL 规定 Agent 在两种情况下更新进度：用户指明当前工作对应的任务之后，或者用户要求整理任务时。两种情况下都只在某个步骤确实有进展或完成时更新。Agent MUST NOT 自行创建或删除任务，除非用户要求。

#### Scenario: 用户没有指定任务
- **WHEN** 用户没有说明当前工作属于哪个任务，也没有要求整理
- **THEN** Agent 不修改任何任务进度

#### Scenario: 用户指定了任务
- **WHEN** 用户说"现在做任务 1"并且 Agent 完成了其中的步骤 2
- **THEN** Agent 把任务 1 的步骤 2 标记为完成

#### Scenario: 用户要求整理
- **WHEN** 用户说"整理一下任务"，而最近的对话显示任务 1 的步骤 2 已经完成
- **THEN** Agent 把任务 1 的步骤 2 标记为完成，尽管用户没有先指明任务 1

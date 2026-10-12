# agent-integration Specification

## Purpose
让 Claude Code 和 DeepSeek Harness 在工作过程中用同一套约定更新任务进度，使用户能在桌面小窗口里看到是哪个 Agent 在什么时候推进了哪一步。

## Requirements

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

### Requirement: 接入说明覆盖常见请求
接入说明 SHALL 说明以下情况的做法：用户指定的任务没有步骤时如何记录进展；署名记录在哪些操作上；如何用列表输出判断哪个任务最紧急；如何修改任务的名称和截止日期。

#### Scenario: 指定的任务没有步骤
- **WHEN** 用户说"现在做任务 2，做完一步就更新进度"，而任务 2 没有步骤
- **THEN** Agent 按说明询问用户是要为任务添加步骤还是直接记录一个百分比，而不是自行创建步骤

#### Scenario: 询问最紧急的任务
- **WHEN** 用户问"我的任务里哪个最急"
- **THEN** Agent 根据列表输出里的紧急程度回答，不需要自己计算日期

#### Scenario: 修改截止日期
- **WHEN** 用户说"任务 1 的截止日期改到下周三"
- **THEN** Agent 用说明里给出的命令修改该任务的截止日期

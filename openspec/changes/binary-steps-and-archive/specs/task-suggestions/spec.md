# Spec Delta

## MODIFIED Requirements

### Requirement: 提出建议
`task suggest <名称>` SHALL 保存一条建议，必须带至少一个步骤，可带截止日期和一句来源说明，并记录提出者和时间。每个步骤 SHALL 可以标明"已完成"或"待做"，步骤按命令中给出的顺序保存。成功时 MUST 输出建议的编号。

#### Scenario: 带已完成步骤的建议
- **WHEN** 运行 `task suggest "搭建并发布 taskboard" --done-step "调研现成项目" --done-step "实现第一版" --step "开源上传 GitHub" --by claude`
- **THEN** 新建议包含三个步骤，顺序与命令一致，前两个标为已完成，第三个为待做

#### Scenario: 带步骤和来源的建议
- **WHEN** 运行 `task suggest "写论文第二章" --due 2026-10-20 --step "收集文献" --step "写初稿" --source "10-11 论文项目的对话" --by claude`
- **THEN** 新建议被保存，包含名称、截止日期、两个步骤、来源说明和提出者 "claude"，命令输出其编号

#### Scenario: 没有步骤
- **WHEN** 运行 `task suggest "写论文第二章"`
- **THEN** 命令以非零状态退出并说明建议至少需要一个步骤

#### Scenario: 建议不是任务
- **WHEN** 提出一条建议后运行 `task list`
- **THEN** 任务列表里没有这条建议

### Requirement: 采纳建议
`task accept <编号>` SHALL 用该建议的名称、截止日期和步骤创建一个正式任务，并把该建议从待处理中移除。建议中标为已完成的步骤 MUST 创建为已完成，署名为该建议的提出者；其余步骤为未完成。早先保存的、没有步骤的建议被采纳时，任务 SHALL 得到一个与建议同名的未完成步骤。成功时 MUST 输出新任务的编号。

#### Scenario: 采纳带已完成步骤的建议
- **WHEN** 采纳一条有两个已完成步骤和一个待做步骤、由 "claude" 提出的建议
- **THEN** 新任务的总进度为 67%，两个已完成步骤的最后更新人为 "claude"

#### Scenario: 采纳
- **WHEN** 采纳一条带两个待做步骤的建议
- **THEN** 任务列表里出现一个同名任务，带有这两个未完成的步骤，待处理建议里不再有它

#### Scenario: 没有步骤的旧建议
- **WHEN** 采纳一条早先保存的、没有步骤的建议"整理读书笔记"
- **THEN** 新任务有一个名为"整理读书笔记"的未完成步骤

#### Scenario: 编号不存在
- **WHEN** 采纳一个不存在的建议编号
- **THEN** 命令以非零状态退出并说明该建议不存在

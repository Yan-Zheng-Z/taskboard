# Spec Delta

## Purpose

让 Agent 提出的任务先作为待确认的建议保存，由用户决定采纳还是忽略，避免归纳错误的任务直接进入正式列表。

## ADDED Requirements

### Requirement: 提出建议
`task suggest <名称>` SHALL 保存一条建议，可带截止日期、若干步骤和一句来源说明，并记录提出者和时间。每个步骤 SHALL 可以标明"已完成"或"待做"，步骤按命令中给出的顺序保存。成功时 MUST 输出建议的编号。

#### Scenario: 带已完成步骤的建议
- **WHEN** 运行 `task suggest "搭建并发布 taskboard" --done-step "调研现成项目" --done-step "实现第一版" --step "开源上传 GitHub" --by claude`
- **THEN** 新建议包含三个步骤，顺序与命令一致，前两个标为已完成，第三个为待做

#### Scenario: 带步骤和来源的建议
- **WHEN** 运行 `task suggest "写论文第二章" --due 2026-10-20 --step "收集文献" --step "写初稿" --source "10-11 论文项目的对话" --by claude`
- **THEN** 新建议被保存，包含名称、截止日期、两个步骤、来源说明和提出者 "claude"，命令输出其编号

#### Scenario: 建议不是任务
- **WHEN** 提出一条建议后运行 `task list`
- **THEN** 任务列表里没有这条建议

### Requirement: 查看建议
`task suggestions` SHALL 列出所有待处理的建议及其编号、名称、截止日期、步骤和来源，并支持 `--json`。

#### Scenario: 没有建议
- **WHEN** 没有待处理的建议时运行 `task suggestions`
- **THEN** 命令成功退出并说明没有建议

### Requirement: 采纳建议
`task accept <编号>` SHALL 用该建议的名称、截止日期和步骤创建一个正式任务，并把该建议从待处理中移除。建议中标为已完成的步骤 MUST 以 100% 的进度创建，署名为该建议的提出者；其余步骤进度为 0。成功时 MUST 输出新任务的编号。

#### Scenario: 采纳带已完成步骤的建议
- **WHEN** 采纳一条有两个已完成步骤和一个待做步骤、由 "claude" 提出的建议
- **THEN** 新任务的总进度为 67%，两个已完成步骤的最后更新人为 "claude"

#### Scenario: 采纳
- **WHEN** 采纳一条带两个步骤的建议
- **THEN** 任务列表里出现一个同名任务，带有这两个进度为 0 的步骤，待处理建议里不再有它

#### Scenario: 编号不存在
- **WHEN** 采纳一个不存在的建议编号
- **THEN** 命令以非零状态退出并说明该建议不存在

### Requirement: 忽略建议
`task dismiss <编号>` SHALL 把该建议从待处理中移除，并记住它已被忽略。

#### Scenario: 忽略
- **WHEN** 忽略一条建议
- **THEN** 待处理建议里不再有它，任务列表不变

### Requirement: 不重复提出
当新建议的名称与某个现有任务、某条待处理建议或某条已被忽略的建议相同（忽略首尾空白和大小写）时，`task suggest` MUST 不保存新建议，并说明跳过的原因。

#### Scenario: 已被忽略的建议不再出现
- **WHEN** 用户忽略了"整理读书笔记"后，Agent 再次提出同名建议
- **THEN** 没有新建议被保存，命令成功退出并说明该建议此前已被忽略

#### Scenario: 已是任务
- **WHEN** 列表里已有任务"写论文第二章"，Agent 提出同名建议
- **THEN** 没有新建议被保存，命令成功退出并说明已有同名任务

### Requirement: 与旧数据兼容
没有建议字段的旧数据文件 MUST 被当作"没有任何建议"正常读取，并在下一次写入时保留原有任务不变。

#### Scenario: 升级后首次读取
- **WHEN** 用升级前创建的数据文件运行 `task suggestions`
- **THEN** 命令成功退出并说明没有建议，原有任务仍可用 `task list` 看到

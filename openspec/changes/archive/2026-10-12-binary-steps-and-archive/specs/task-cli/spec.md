# Spec Delta

## MODIFIED Requirements

### Requirement: 管理任务
`task` 命令 SHALL 支持创建任务（必须用一个或多个 `--step` 给出步骤，可带截止日期）、修改任务名称和截止日期、删除任务。创建成功时 MUST 输出新任务的编号。

#### Scenario: 创建任务
- **WHEN** 运行 `task add "写论文第二章" --step "收集文献" --step "写初稿" --due 2026-10-20`
- **THEN** 命令成功退出并输出新任务的编号，任务带有这两个未完成的步骤

#### Scenario: 没有给步骤
- **WHEN** 运行 `task add "写论文第二章"`
- **THEN** 命令以非零状态退出，说明至少需要一个 `--step`，不创建任务

#### Scenario: 截止日期格式错误
- **WHEN** 运行 `task add "X" --step "a" --due 明天`
- **THEN** 命令以非零状态退出，说明可接受的日期格式，不创建任务

#### Scenario: 删除不存在的任务
- **WHEN** 对不存在的任务编号运行删除
- **THEN** 命令以非零状态退出并说明该任务不存在

### Requirement: 管理步骤
`task` 命令 SHALL 支持向任务添加步骤、重命名步骤和删除步骤，步骤用所属任务编号加步骤编号来指定。删除任务的最后一个步骤 MUST 被拒绝。

#### Scenario: 添加步骤
- **WHEN** 运行 `task step add 1 "收集文献"`
- **THEN** 命令成功退出并输出新步骤的编号

#### Scenario: 步骤不存在
- **WHEN** 对任务 1 中不存在的步骤编号执行操作
- **THEN** 命令以非零状态退出并说明该步骤不存在

#### Scenario: 删除最后一个步骤
- **WHEN** 对只有一个步骤的任务运行 `task step rm`
- **THEN** 命令以非零状态退出并说明任务至少需要一个步骤

### Requirement: 更新进度
`task` 命令 SHALL 用 `task done <任务> <步骤>` 把一个步骤标为完成，用 `task reopen <任务> <步骤>` 把它改回未完成。两者都 MUST 指定步骤。完成任务的最后一个未完成步骤时，输出 MUST 说明该任务已完成并归档。

#### Scenario: 标记完成
- **WHEN** 运行 `task done 1 2`
- **THEN** 任务 1 的步骤 2 变为已完成

#### Scenario: 改回未完成
- **WHEN** 运行 `task reopen 1 2`
- **THEN** 任务 1 的步骤 2 变为未完成

#### Scenario: 没有指定步骤
- **WHEN** 运行 `task done 1`
- **THEN** 命令以非零状态退出并说明需要步骤编号

#### Scenario: 完成最后一步
- **WHEN** 任务 1 只剩步骤 3 未完成，运行 `task done 1 3`
- **THEN** 输出说明任务 1 已完成并归档

#### Scenario: 设置百分比
- **WHEN** 运行 `task progress 1 2 60`
- **THEN** 命令以非零状态退出并说明步骤只有完成和未完成，应使用 `task done` 或 `task reopen`，步骤状态不变

#### Scenario: 百分比越界
- **WHEN** 运行 `task progress 1 2 150`
- **THEN** 命令同样以非零状态退出并给出改用 `task done` 或 `task reopen` 的说明

### Requirement: 查看任务
`task` 命令 SHALL 提供未完成任务的概览（编号、名称、截止日期、总进度）和单个任务的详情（每个步骤的编号、名称、是否完成、最后更新人和时间）。`task list --archived` SHALL 列出全部已归档的任务及其完成日期，`task list --all` SHALL 两者都列出。概览和详情 MUST 都支持 `--json` 输出机器可读的结果。

#### Scenario: 列出任务
- **WHEN** 运行 `task list`
- **THEN** 每个未完成的任务显示一行，包含编号、名称、截止日期和总进度，已归档的任务不在其中

#### Scenario: 没有任务
- **WHEN** 没有未完成的任务时运行 `task list`
- **THEN** 命令成功退出并提示当前没有待办任务

#### Scenario: 查看归档
- **WHEN** 运行 `task list --archived`
- **THEN** 列出全部已归档的任务，包括完成时间超过一周的，每行带完成日期

#### Scenario: 机器可读输出
- **WHEN** 运行 `task show 1 --json`
- **THEN** 输出为合法 JSON，包含该任务及其全部步骤的字段，每个步骤带有是否完成

### Requirement: 列表标出紧急程度
`task list` SHALL 为每个有截止日期的未完成任务标出它已过期、今天到期或还剩几天。`task list --json` 和 `task show --json` SHALL 为每个任务输出与桌面小窗口相同的状态和剩余天数，已归档的任务状态为完成。

#### Scenario: 过期任务
- **WHEN** 列表里有一个截止日期在两天前的未完成任务
- **THEN** `task list` 在该任务一行标明已过期两天，`--json` 输出里它的状态为过期

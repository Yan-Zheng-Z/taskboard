# task-cli Specification

## Purpose
提供 `task` 命令，让用户和任何能执行 shell 命令的 Agent 用同一种方式创建任务、维护步骤和更新进度，而不必直接编辑数据文件。

## Requirements

### Requirement: 管理任务
`task` 命令 SHALL 支持创建任务（可带截止日期）、修改任务名称和截止日期、删除任务。创建成功时 MUST 输出新任务的编号。

#### Scenario: 创建任务
- **WHEN** 运行 `task add "写论文第二章" --due 2026-10-20`
- **THEN** 命令成功退出并输出新任务的编号

#### Scenario: 截止日期格式错误
- **WHEN** 运行 `task add "X" --due 明天`
- **THEN** 命令以非零状态退出，说明可接受的日期格式，不创建任务

#### Scenario: 删除不存在的任务
- **WHEN** 对不存在的任务编号运行删除
- **THEN** 命令以非零状态退出并说明该任务不存在

### Requirement: 管理步骤
`task` 命令 SHALL 支持向任务添加步骤、重命名步骤和删除步骤，步骤用所属任务编号加步骤编号来指定。

#### Scenario: 添加步骤
- **WHEN** 运行 `task step add 1 "收集文献"`
- **THEN** 命令成功退出并输出新步骤的编号

#### Scenario: 步骤不存在
- **WHEN** 对任务 1 中不存在的步骤编号执行操作
- **THEN** 命令以非零状态退出并说明该步骤不存在

### Requirement: 更新进度
`task` 命令 SHALL 支持把某个步骤的进度设为 0 到 100 的整数，并提供把步骤直接标记为完成的快捷方式。对没有步骤的任务 SHALL 支持直接设置任务级进度。

#### Scenario: 设置百分比
- **WHEN** 运行 `task progress 1 2 60`
- **THEN** 任务 1 的步骤 2 进度变为 60

#### Scenario: 标记完成
- **WHEN** 运行 `task done 1 2`
- **THEN** 任务 1 的步骤 2 进度变为 100

#### Scenario: 百分比越界
- **WHEN** 运行 `task progress 1 2 150`
- **THEN** 命令以非零状态退出，进度不变

### Requirement: 标明更新人
所有修改进度的子命令 SHALL 接受 `--by <名称>` 参数。未提供时 MUST 依次使用环境变量中配置的默认身份，再回退到 "user"。

#### Scenario: 显式署名
- **WHEN** 运行 `task done 1 2 --by deepseek`
- **THEN** 该步骤的最后更新人为 "deepseek"

#### Scenario: 默认署名
- **WHEN** 不带 `--by` 且未配置默认身份时更新进度
- **THEN** 最后更新人为 "user"

### Requirement: 查看任务
`task` 命令 SHALL 提供列出全部任务的概览（编号、名称、截止日期、总进度）和单个任务的详情（每个步骤的编号、名称、进度、最后更新人和时间）。两者 MUST 都支持 `--json` 输出机器可读的结果。

#### Scenario: 列出任务
- **WHEN** 运行 `task list`
- **THEN** 每个任务显示一行，包含编号、名称、截止日期和总进度

#### Scenario: 没有任务
- **WHEN** 没有任何任务时运行 `task list`
- **THEN** 命令成功退出并提示当前没有任务

#### Scenario: 机器可读输出
- **WHEN** 运行 `task show 1 --json`
- **THEN** 输出为合法 JSON，包含该任务及其全部步骤的字段

### Requirement: 错误与帮助
`task` 命令 MUST 在成功时以状态 0 退出，在任何失败时以非零状态退出并把一句可读的原因写到标准错误。不带参数或带 `--help` 时 SHALL 显示用法。

#### Scenario: 未知子命令
- **WHEN** 运行 `task frobnicate`
- **THEN** 命令以非零状态退出并提示可用的子命令

#### Scenario: 查看帮助
- **WHEN** 运行 `task --help`
- **THEN** 输出各子命令的用法并以状态 0 退出

### Requirement: 进度命令的输出带名称
修改进度的子命令成功时，输出 SHALL 包含被修改的步骤名称（或没有步骤的任务的名称），让调用者能确认改的是不是想改的那一项。

#### Scenario: 标记步骤完成
- **WHEN** 运行 `task done 1 3` 且任务 1 的步骤 3 名为"打包"
- **THEN** 输出里包含"打包"

### Requirement: 列表标出紧急程度
`task list` SHALL 为每个有截止日期的未完成任务标出它已过期、今天到期或还剩几天，并标出已完成的任务。`task list --json` 和 `task show --json` SHALL 为每个任务输出与桌面小窗口相同的状态和剩余天数。

#### Scenario: 过期任务
- **WHEN** 列表里有一个截止日期在两天前的未完成任务
- **THEN** `task list` 在该任务一行标明已过期两天，`--json` 输出里它的状态为过期

### Requirement: 报错显示原始输入
参数不合法时，错误信息 MUST 显示用户实际输入的内容并说明合法的写法，MUST NOT 显示内部转换后的值或底层解析器的原文。

#### Scenario: 带百分号的进度
- **WHEN** 运行 `task progress 1 2 50%`
- **THEN** 错误信息里出现 `50%` 并说明要写 0 到 100 的整数

#### Scenario: 负数
- **WHEN** 运行 `task progress 1 2 -1`
- **THEN** 错误信息说明这里不能用负数，而不是一段关于未知选项的说明

#### Scenario: 不存在的时间
- **WHEN** 截止日期的格式正确但那一天没有这个时刻或没有这一天
- **THEN** 错误信息说明这个日期或时间不存在，而不是说格式不对

#### Scenario: 只有空白的身份变量
- **WHEN** 默认身份的环境变量只有空白且没有写 `--by`
- **THEN** 更新以 "user" 署名

### Requirement: 拒绝矛盾或重复的选项
同一个只接受一个值的选项出现多次，或同时给出互相矛盾的选项时，命令 MUST 以非零状态退出并说明冲突，不做任何修改。

#### Scenario: 同时设定和清除截止日期
- **WHEN** 运行 `task edit 1 --no-due --due 2026-10-30`
- **THEN** 命令失败并说明这两个选项不能同时使用，任务不变

#### Scenario: 重复的选项
- **WHEN** 运行 `task add x --due 2026-10-20 --due 2026-10-21`
- **THEN** 命令失败并说明 `--due` 只能给一次，没有创建任务

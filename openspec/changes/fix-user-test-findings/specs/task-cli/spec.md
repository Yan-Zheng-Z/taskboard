# Spec Delta

## ADDED Requirements

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

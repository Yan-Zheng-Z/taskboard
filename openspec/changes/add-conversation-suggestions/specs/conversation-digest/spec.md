# Spec Delta

## Purpose

把本机上最近的 Agent 对话记录整理成一份简短、可读的摘要，让 Agent 能据此归纳用户还有哪些事要做，而不必读取体积庞大的原始记录。

## ADDED Requirements

### Requirement: 生成最近对话的摘要
`task digest` SHALL 输出最近若干天内有活动的对话，每个对话包含来源 Agent、所在项目目录、最后活动时间和用户发过的消息。天数由 `--days` 指定，默认 7。

#### Scenario: 默认范围
- **WHEN** 运行 `task digest`
- **THEN** 输出最近 7 天内有活动的对话，最近活动的排在前面

#### Scenario: 指定天数
- **WHEN** 运行 `task digest --days 2`
- **THEN** 只输出最近 2 天内有活动的对话

#### Scenario: 没有符合条件的对话
- **WHEN** 指定范围内没有任何对话
- **THEN** 命令成功退出并说明没有找到对话

### Requirement: 只保留用户的话
摘要 MUST 只包含用户发出的消息文字，不包含 Agent 的回复、工具调用及其输出、系统提示和附件内容。

#### Scenario: 含工具输出的对话
- **WHEN** 某个对话里 Agent 运行过命令并得到了很长的输出
- **THEN** 摘要里只有该对话中用户说的话，没有命令和输出

### Requirement: 控制摘要大小
摘要 SHALL 限制每条消息的长度、每个对话的消息条数和整体大小，超出部分截断并标明被截断。消息条数超出上限的对话 MUST 同时保留开头的几条和最近的若干条，因为用户通常在开头说明目标。

#### Scenario: 很长的对话
- **WHEN** 某个对话里用户发过上百条消息
- **THEN** 摘要保留该对话最开头的几条和最近的若干条，并在两者之间标明省略了多少条

#### Scenario: 很长的一条消息
- **WHEN** 用户的一条消息有几千字
- **THEN** 摘要里只保留开头一段并标明已截断

#### Scenario: 对话总量很大
- **WHEN** 范围内对话的总量超过整体上限
- **THEN** 优先保留最近的对话，并说明有多少个较早的对话被省略

### Requirement: 选择来源
`task digest` SHALL 默认包含 Claude Code 和 DeepSeek Harness 两个来源，并支持用 `--agent` 只取其中一个。

#### Scenario: 只取一个来源
- **WHEN** 运行 `task digest --agent claude`
- **THEN** 输出里只有 Claude Code 的对话

#### Scenario: 未知来源
- **WHEN** 运行 `task digest --agent foo`
- **THEN** 命令以非零状态退出并列出可用的来源

### Requirement: 读不了时不中断
某个来源不存在、某个记录损坏或格式无法识别时，`task digest` MUST 跳过它并继续，在输出末尾说明跳过了什么。

#### Scenario: 没装其中一个 Agent
- **WHEN** 本机没有 DeepSeek Harness 的对话目录
- **THEN** 命令照常输出 Claude Code 的对话并成功退出

#### Scenario: 记录格式无法识别
- **WHEN** 某个来源的记录无法解析
- **THEN** 其余对话照常输出，末尾说明该来源有多少个记录被跳过

### Requirement: 只读且不联网
`task digest` MUST NOT 修改任何对话记录或任务数据，MUST NOT 发起任何网络请求。

#### Scenario: 运行前后文件不变
- **WHEN** 运行 `task digest`
- **THEN** 对话记录文件和任务数据文件的内容与修改时间都没有变化

### Requirement: 机器可读输出
`task digest` SHALL 支持 `--json` 输出同样内容的结构化结果。

#### Scenario: JSON 输出
- **WHEN** 运行 `task digest --json`
- **THEN** 输出为合法 JSON，包含对话列表和被跳过项的说明

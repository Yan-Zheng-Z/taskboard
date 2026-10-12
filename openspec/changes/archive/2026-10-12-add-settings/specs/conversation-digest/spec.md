# Spec Delta

## ADDED Requirements

### Requirement: 默认值来自设置
`task digest` 没有给出 `--days` 或 `--agent` 时，SHALL 使用用户在设置里选择的天数和对话来源；没有设置时为 7 天和全部来源。命令行给出的参数 MUST 优先于设置。

#### Scenario: 设置只读一个来源
- **WHEN** 设置里整理只读取 Claude Code 的对话，运行不带参数的 `task digest`
- **THEN** 输出里只有 Claude Code 的对话

#### Scenario: 参数优先
- **WHEN** 设置里整理只读取 Claude Code 的对话，运行 `task digest --agent deepseek`
- **THEN** 输出里只有 DeepSeek Harness 的对话

#### Scenario: 设置的天数
- **WHEN** 设置里整理读取最近 3 天，运行不带参数的 `task digest`
- **THEN** 只输出最近 3 天内有活动的对话

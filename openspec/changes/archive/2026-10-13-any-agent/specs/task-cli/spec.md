# Spec Delta

## ADDED Requirements

### Requirement: 打印接入说明
`task skill --by <署名>` SHALL 打印一份可直接贴进任意 Agent 指令文件的接入说明，其中所有示例命令的署名为给定的署名。没有给出署名时 MUST 以非零状态退出并说明需要 `--by`。署名 MUST 是不含空白的单行短文字。

#### Scenario: 为另一个 Agent 生成
- **WHEN** 运行 `task skill --by codex`
- **THEN** 输出的说明里示例命令都带 `--by codex`，不含其他 Agent 的署名

#### Scenario: 没有署名
- **WHEN** 运行 `task skill`
- **THEN** 命令以非零状态退出并说明需要 `--by`

#### Scenario: 署名不合法
- **WHEN** 运行 `task skill --by "my agent"`
- **THEN** 命令以非零状态退出并说明署名不能含空白

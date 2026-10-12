# Spec Delta

## ADDED Requirements

### Requirement: 为其他 Agent 复制接入说明
设置页的 Agent 接入部分 SHALL 提供"其他 Agent"：用户填写一个署名后，可以把适用于该署名的接入说明复制到剪贴板，并得到已复制以及应粘贴到哪里的提示。署名不合法时 MUST 提示原因且不复制。

#### Scenario: 复制
- **WHEN** 用户填写署名 "glm" 并点击复制
- **THEN** 剪贴板里是示例命令带 `--by glm` 的接入说明，窗口提示已复制

#### Scenario: 署名为空
- **WHEN** 用户没有填写署名就点击复制
- **THEN** 窗口提示需要署名，剪贴板内容不变

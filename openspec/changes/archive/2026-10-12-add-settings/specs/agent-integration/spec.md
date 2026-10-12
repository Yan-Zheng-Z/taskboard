# Spec Delta

## ADDED Requirements

### Requirement: 从设置页安装接入说明
除了手动复制，用户 SHALL 可以在小窗口的设置页里为每个 Agent 安装或更新接入说明。这是用户的明确操作；启动 taskboard、打开设置页或更新 taskboard MUST NOT 自动写入任何 Agent 的目录。

#### Scenario: 打开设置页不写入
- **WHEN** 用户打开设置页但没有点击安装
- **THEN** 两个 Agent 的目录都没有被写入

#### Scenario: 点击后写入
- **WHEN** 用户点击某个 Agent 的安装按钮
- **THEN** 只有这个 Agent 的目录里出现 taskboard 的接入说明

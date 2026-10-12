# Proposal

## Why

项目公开后，使用者不一定用 Claude Code 或 DeepSeek Harness。更新任务其实只需要 Agent 能执行 `task` 命令，但现有的接入说明里写死了这两个 Agent 的署名，设置页也只列出它们，其他 Agent 的使用者没有入口，只能自己读文档改模板。

## What Changes

- 新增 `task skill --by <署名>`：打印一份适用于任意 Agent 的接入说明，署名已替换好，可直接贴进该 Agent 的指令文件。
- 两个内置 Agent 的模板改为由同一份文字生成，并用测试保证仓库里的模板与它一致。
- 设置页的"Agent 接入"增加"其他 Agent"：填写署名后把接入说明复制到剪贴板。
- README 增加一张支持情况表，说明哪些功能任何 Agent 都能用、哪些只支持内置的两个。
- 新增贡献指南，说明如何为一个新的 Agent 添加完整支持（模板、对话记录读取器、设置页条目）。
- 不包含：为更多 Agent 编写对话记录读取器。这需要该 Agent 的真实记录才能写和验证，留给使用它的人贡献。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `task-cli`: 新增打印接入说明的命令。
- `desktop-widget`: 设置页新增为其他 Agent 复制接入说明。
- `agent-integration`: 新增适用于任意 Agent 的接入说明。

## Impact

- `src/core/skill-text.js`（新增，接入说明的唯一来源）、`scripts/build-skills.js`（新增）、`integrations/` 下两个模板改为生成产物。
- `src/cli/run.js`、`src/widget/window.js`、`src/widget/preload.cjs`、渲染层。
- README、`CONTRIBUTING.md`（新增）、`docs/agent-integration.md`。

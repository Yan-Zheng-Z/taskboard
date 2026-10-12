# Contributing / 参与贡献

[中文](#中文) · [English](#english)

## 中文

### 开发

```
npm install
npm test        # 全部测试
npm run lint    # ESLint
npm start       # 启动小窗口
```

提交前钩子会运行测试和 lint。GitHub 上的自动测试在 Windows、macOS、Linux 三个系统上运行。

需求和设计在 `openspec/` 下，用 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 管理：改动行为之前先写一个变更（提案、规格、任务清单），做完后归档。`openspec/specs/` 里是当前生效的规格。

代码分三层，只有 `core` 读写数据文件：

- `src/core/`：数据模型、校验、存储、对话摘要、设置、接入说明的文字。
- `src/cli/`：`task` 命令。
- `src/widget/`：Electron 小窗口。主进程调用 `core`，页面只通过预加载脚本暴露的接口与主进程通信。

### 为一个新的 Agent 添加支持

先分清两件事：

- **让 Agent 更新任务**不需要任何代码。任何能执行命令行的 Agent 都可以：运行 `task skill --by <署名>`，把输出贴进它的指令文件。
- **完整支持**指的是下面三样，只有它们需要改代码。最重要的是第 2 项，而它必须由手里有这个 Agent 真实对话记录的人来做。

#### 1. 内置的接入说明

在 `src/core/skill-text.js` 的 `BUILT_IN_SKILLS` 里加一项（目录名、署名、是否在沙箱里执行命令），然后运行 `node scripts/build-skills.js` 生成 `integrations/<目录名>/taskboard/SKILL.md`。有一个测试保证仓库里的文件与生成结果一致。

如果这个 Agent 不使用 `SKILL.md` 这种格式，请说明它从哪里读取指令。

#### 2. 对话记录读取器

"整理"功能靠 `task digest` 读取本机的对话记录。每个 Agent 一个文件，放在 `src/core/digest/` 下，参考 `claude.js` 和 `deepseek.js`。读取器导出一个函数：

```js
// home：这个 Agent 的数据目录；sinceMs：只读这个时间之后修改过的记录
export function readXxxConversations(home, sinceMs) {
  return {
    conversations: [
      { agent: 'xxx', project: '/所在目录', title: '标题或 null', messages: [{ time: 'ISO 时间或 null', text: '用户输入的原文' }] },
    ],
    skipped: 0, // 完全读不了的记录数
    lines: 0,   // 能读的记录里读不懂的行数
  };
}
```

要求：

- **只取用户输入的文字**。不要包含 Agent 的回复、工具调用和输出、系统注入的提示、子 Agent 的会话。
- **只读，不联网**，不修改任何文件。
- **读不了就跳过并计数**，不要抛出异常中断整个摘要。内容不是这个 Agent 的记录格式时算作 `skipped`，这样格式升级后用户看到的是"读不出"而不是"没有对话"。
- 大文件逐行读取，不要整个载入内存；只处理修改时间在 `sinceMs` 之后的文件。

然后在 `src/core/digest/index.js` 里登记这个读取器，在 `src/core/settings.js` 的 `DIGEST_AGENTS` 里加上它，在 `src/core/skill-text.js` 的 `DIGEST_SOURCES` 里加上它。

**测试**：在 `test/helpers/conversations.js` 里加一个生成样本记录的函数，样本必须是编造的内容，结构与真实记录一致。**不要提交真实的对话记录。** 测试至少覆盖：普通消息、需要排除的各类内容、损坏的记录、不是该格式的文件。

#### 3. 设置页里的条目

在 `src/widget/agents.js` 的 `AGENTS` 里加一项，设置页的"Agent 接入"就会显示它的检测状态和安装按钮。"整理"分区里的来源开关在 `src/widget/renderer/renderer.js` 的 `settingsPage` 里。

#### 提交时请说明

- 你用的 Agent 版本，以及它把对话记录存在哪里。
- 你在自己的真实记录上运行 `task digest --agent xxx` 的结果是否正确（不需要贴出内容）。
- 哪些没有验证。

### 在 macOS 或 Linux 上试用

小窗口、菜单栏或托盘图标、开机自启在这两个系统上没有在真机上试过。如果你试了，无论结果如何都欢迎开一个 issue 说明：系统版本、哪些正常、哪些不正常。

## English

### Development

```
npm install
npm test        # all tests
npm run lint    # ESLint
npm start       # start the window
```

The pre-commit hook runs tests and lint. CI runs the tests on Windows, macOS and Linux.

Requirements and design live in `openspec/`, managed with [OpenSpec](https://github.com/Fission-AI/OpenSpec): write a change (proposal, specs, tasks) before changing behaviour and archive it when done. `openspec/specs/` holds the specs currently in force.

The code has three layers, and only `core` touches the data file:

- `src/core/`: data model, validation, storage, conversation digest, settings, the text of the agent instructions.
- `src/cli/`: the `task` command.
- `src/widget/`: the Electron window. The main process calls `core`; the page talks to it only through the preload bridge.

### Adding support for another agent

Two different things:

- **Letting an agent update tasks** needs no code. Any agent that can run shell commands works: run `task skill --by <name>` and paste the output into its instruction file.
- **Full support** means the three items below. The second matters most, and it has to be written by someone who has that agent's real conversation records.

#### 1. Built-in instructions

Add an entry to `BUILT_IN_SKILLS` in `src/core/skill-text.js` (folder, signature, whether the agent runs commands in a sandbox), then run `node scripts/build-skills.js` to generate `integrations/<folder>/taskboard/SKILL.md`. A test keeps the files in the repository identical to the generator's output.

If the agent does not use the `SKILL.md` format, say where it reads its instructions from.

#### 2. A conversation reader

"Organize" relies on `task digest` reading local conversation records. There is one file per agent under `src/core/digest/`; see `claude.js` and `deepseek.js`. A reader exports one function:

```js
// home: the agent's data directory; sinceMs: only read records modified after this time
export function readXxxConversations(home, sinceMs) {
  return {
    conversations: [
      { agent: 'xxx', project: '/folder', title: 'title or null', messages: [{ time: 'ISO time or null', text: 'what the user typed' }] },
    ],
    skipped: 0, // records that could not be read at all
    lines: 0,   // unreadable lines inside readable records
  };
}
```

Requirements:

- **Only what the user typed.** No agent replies, tool calls or output, injected system text, or sub-agent sessions.
- **Read-only and offline.** Change no files.
- **Skip and count what cannot be read**; never throw and abort the whole digest. A file that is not in this agent's format counts as `skipped`, so that after a format change the user sees "could not read", not "no conversations".
- Read large files line by line, and only files modified after `sinceMs`.

Then register the reader in `src/core/digest/index.js`, add the agent to `DIGEST_AGENTS` in `src/core/settings.js` and to `DIGEST_SOURCES` in `src/core/skill-text.js`.

**Tests**: add a builder for sample records to `test/helpers/conversations.js`. Samples must be made-up content in the real structure. **Do not commit real conversation records.** Cover at least: ordinary messages, each kind of content that must be left out, a damaged record, and a file that is not in the format.

#### 3. The settings entry

Add an entry to `AGENTS` in `src/widget/agents.js`; the settings page then shows its detection status and an install button. The source switches under "整理" are in `settingsPage` in `src/widget/renderer/renderer.js`.

#### In your pull request, please say

- Which version of the agent you use and where it stores conversations.
- Whether `task digest --agent xxx` gave correct results on your own real records (no need to paste them).
- What you did not verify.

### Trying it on macOS or Linux

The window, the menu-bar or tray icon and start-at-login have not been tried on a real machine on these systems. If you try, an issue saying which system, what worked and what did not is welcome either way.

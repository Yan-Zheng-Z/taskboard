# taskboard

[English](#english) · [中文](#中文)

![taskboard widget](docs/screenshot.png)

## 中文

一个常驻桌面的任务小窗口，加一个 `task` 命令。你在窗口里勾选做完的步骤，Claude Code、DeepSeek Harness 这类编码 Agent 用命令勾选，大家改的是同一份数据，窗口会显示每一步最后是谁更新的。

- 每个任务由若干步骤组成，步骤只有"完成"和"未完成"；任务进度是已完成步骤占全部步骤的百分比。
- 任务带截止日期，过期和三天内到期的会用颜色和文字标出来。
- 所有步骤完成后任务自动归档，窗口里可以回看最近 7 天完成的任务。
- 数据是你电脑上的一个 JSON 文件，不联网，没有账号。
- 多个进程同时更新不会互相覆盖。

### 状态

早期版本。只在 Windows 11 上测试过；代码没有使用 Windows 专有接口，但 macOS 和 Linux 未经测试。界面文字是中文，命令行输出是英文。

### 安装

需要 [Node.js](https://nodejs.org/) 22.12 或更高版本和 Git。

```
git clone https://github.com/zyz122302-lang/taskboard.git
cd taskboard
npm install
npm link
```

`npm link` 会注册两个全局命令：`task`（命令行）和 `taskboard`（启动小窗口）。

第一次运行 `taskboard` 时会先下载 Electron 运行程序（约 100 MB），期间终端里只有一行"Downloading Electron binary..."，窗口要等下载完才出现；之后启动就很快。

### 小窗口

```
taskboard
```

- 窗口没有边框，始终在其他窗口上面；拖动顶部的标题栏移动它，位置会被记住。
- 点任务展开步骤，同一时间只展开一个任务；勾选步骤前面的方框表示做完，取消勾选表示还没做完。
- 任务前面的 `#3` 和步骤前面的数字就是命令行里用的编号。
- 点"＋"添加任务，需要填任务名称和第一个步骤，之后可以再加步骤。
- 任务的所有步骤都勾上后，它自动归档并离开列表。点标题栏的"归档"查看最近 7 天完成的任务；在那里取消勾选某一步或加一个新步骤，任务就回到列表。
- "删除任务"只用于任务取消或建错了；做完的任务不需要删除。
- 点右上角的向上箭头把窗口收成一条窄栏，只显示最近到期的任务；再点一次恢复原来的大小。
- 删除任务或步骤、忽略或采纳建议、勾完最后一步使任务归档之后，窗口底部会出现几秒钟的"撤销"。
- 点右上角的横线隐藏窗口，点系统托盘里的图标恢复。
- 右键托盘图标可以开关"开机自动启动"或退出。
- 只用键盘也能操作：Tab 移动，空格或回车展开任务，空格勾选步骤。

开机自启记录的是源码目录的位置，移动目录后需要重新开启一次。

### 命令行

```
task add "写论文第二章" --step "收集文献" --step "写初稿" --due 2026-10-20
                                             # 创建任务和它的步骤，输出编号
task step add 1 "润色"                       # 给任务 1 再加一个步骤，输出步骤编号
task done 1 1 --by claude                    # 任务 1 的步骤 1 做完了，并注明是谁做的
task reopen 1 1                              # 改回未完成
task list                                    # 未完成的任务，标出已过期、今天到期或还剩几天
task list --archived                         # 已完成的任务和完成日期（包括一周以前的）
task show 1                                  # 一个任务及其步骤
task show 1 --json                           # 机器可读输出
task edit 1 --name "新名字" --no-due         # 改名、去掉截止日期
task step rename 1 1 "新步骤名"
task step rm 1 2                             # 任务的最后一个步骤不能删
task rm 1                                    # 删除被取消或建错的任务
```

每个任务至少有一个步骤，所以 `task add` 必须带 `--step`。`task done` 和 `task reopen` 都要指定步骤编号；任务没有"整体完成"的命令，最后一步做完时它会自动归档。

截止日期写成 `YYYY-MM-DD` 或 `"YYYY-MM-DD HH:mm"`（本地时间）；只写日期表示当天结束前。

任务、步骤和建议的名称是单行文字，最多 200 个字符。

`--by` 说明更新是谁做的。不写时取环境变量 `TASKBOARD_ACTOR`，再没有就记为 `user`。在窗口里做的修改记为 `user`。

失败时命令以非零状态退出，原因写到标准错误。

### 建议：让 Agent 从对话里找任务

Agent 自己归纳出来的任务不会直接进列表，而是先成为"建议"，由你决定。一条建议是一整件事（一个项目或目标），步骤是它的主要阶段，其中已经做完的可以用 `--done-step` 标出。

```
task suggest "搭建并发布 taskboard" --done-step "调研现成项目" --done-step "实现第一版" --step "开源上传 GitHub" --source "10-12 的对话" --by claude
task suggestions              # 待处理的建议
task accept 1                 # 采纳：变成正式任务；--done-step 的步骤直接是已完成
task dismiss 2                # 忽略：以后同名的建议不会再出现
```

小窗口里有对应的"建议"区，每条可以点"采纳"或"忽略"。

```
task digest                   # 最近 7 天你对 Claude Code 和 DeepSeek Harness 说过的话
task digest --days 3 --agent claude
```

`task digest` 是给 Agent 读的材料：它只读取本机的对话记录，只保留你输入的文字（不含 Agent 的回复和命令输出），不联网，不修改任何文件。装好 skill 后，对 Agent 说"整理一下任务"，它会读这份摘要：列表里已有的任务直接更新（把对话显示已完成的步骤标为完成、补上缺少的步骤，不删除也不改名），列表里没有的项目才作为建议提出。

第一次启动小窗口且列表为空时，会出现一张卡片，点"开始整理"后由本机的 Claude Code 在后台做一次同样的事。这张卡片只自动出现一次；之后随时可以点标题栏的"整理"按钮再整理一遍，确认后才会运行。

**隐私**：摘要里是你在对话中说过的话。Agent 读取它时，这些内容会发送给该 Agent 背后的模型服务商；默认两个来源都读，所以一家服务商会看到你和另一个 Agent 的对话摘要。用 `--agent` 可以只读一个来源。你在对话里粘贴过的敏感内容也可能出现在摘要里。

两个 Agent 的对话记录格式都不是公开接口，它们升级后可能读不出来；读不出的记录会被跳过并在输出末尾说明。

### 让 Agent 更新任务

安装 taskboard 不会改动你的任何 Agent 配置。接入方法见 [docs/agent-integration.md](docs/agent-integration.md)，模板在 [integrations/](integrations/)。

**不要把 taskboard 的安装目录选作 DeepSeek Harness 的工作区。** 它的沙箱会修改工作区文件夹的访问权限，导致目录里的 Electron 无法启动，小窗口打不开。恢复方法见接入文档。

### 数据

数据在用户主目录下的 `.taskboard/tasks.json`（Windows 上是 `C:\Users\<你>\.taskboard\`）。设置环境变量 `TASKBOARD_HOME` 可以换位置。同一目录下的 `widget.json` 只记录窗口自己的状态。

归档的任务一直保存在这个文件里，窗口只显示最近 7 天的，更早的用 `task list --archived` 查看。一个任务大约占 1 KB。

从使用百分比进度的旧版本升级时，数据会自动转换：进度 100% 的步骤算完成，其余算未完成；没有步骤的任务得到一个同名步骤。第一次保存前，旧文件会备份为同目录下的 `tasks.v1.backup.json`。

请不要在 taskboard 运行时手动编辑 `tasks.json`。如果文件损坏或字段不合法，命令和窗口都会拒绝写入并告诉你文件路径和原因，原文件不会被动。

### 已知限制

- 每一步只记录最后一次更新的人和时间，没有完整的修改历史。
- Agent 是否更新取决于它是否遵守接入说明，这是软约束。
- 没有到期提醒通知，没有多设备同步。
- 没有安装包，需要从源码运行。

### 开发

```
npm test        # 全部测试
npm run lint    # ESLint
npm start       # 启动小窗口
```

需求和设计在 `openspec/` 下，用 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 管理。提交前钩子会运行测试和 lint。

## English

A small always-on-top desktop window plus a `task` command. You tick off finished steps in the window; coding agents such as Claude Code and DeepSeek Harness tick them off from the command line. Everyone edits the same data, and the window shows who last updated each step.

- A task is a list of steps, each either done or not done. Task progress is the share of finished steps.
- Tasks have due dates. Overdue tasks and tasks due within three days are marked with colour and text.
- A task whose steps are all done is archived by itself; the window lets you look back over the last 7 days.
- The data is one JSON file on your machine. No network, no account.
- Several processes can update at once without overwriting each other.

### Status

Early release. Tested on Windows 11 only. The code avoids Windows-only APIs, but macOS and Linux are untested. The window's text is in Chinese; command-line output is in English.

### Install

Requires [Node.js](https://nodejs.org/) 22.12 or later and Git.

```
git clone https://github.com/zyz122302-lang/taskboard.git
cd taskboard
npm install
npm link
```

`npm link` registers two global commands: `task` (the CLI) and `taskboard` (starts the window).

The first time you run `taskboard` it downloads the Electron runtime (about 100 MB). The terminal shows only "Downloading Electron binary..." and the window appears when the download is done; later starts are quick.

### The window

```
taskboard
```

- Frameless and always on top. Drag the title bar to move it; the position is remembered.
- Click a task to see its steps; only one task is open at a time. Tick the box in front of a step when it is finished; untick it if it was not.
- The `#3` in front of a task and the number in front of each step are the ids the command line uses.
- "＋" adds a task. It asks for a name and a first step; more steps can be added afterwards.
- When every step is ticked, the task is archived and leaves the list. "归档" (archive) in the title bar shows the tasks finished in the last 7 days; unticking a step there, or adding one, sends the task back to the list.
- "删除任务" (delete task) is for tasks that were cancelled or added by mistake. Finished tasks do not need deleting.
- The up arrow collapses the window to a strip showing only the next task; click it again to restore the previous size.
- After you delete a task or step, dismiss or accept a suggestion, or tick the last step so that a task is archived, an "撤销" (undo) bar appears at the bottom for a few seconds.
- The dash hides the window; click the tray icon to bring it back.
- Right-click the tray icon to toggle start-at-login or to quit.
- Fully usable from the keyboard: Tab to move, Space or Enter to expand a task, Space to tick a step.

Start-at-login stores the location of the source directory. Turn it on again if you move the directory.

### Command line

```
task add "Write chapter 2" --step "Collect references" --step "First draft" --due 2026-10-20
                                              # create a task with its steps, prints its id
task step add 1 "Polish"                      # add another step to task 1, prints the step id
task done 1 1 --by claude                     # step 1 of task 1 is finished; say who did it
task reopen 1 1                               # not finished after all
task list                                     # open tasks, marked overdue, due today or days left
task list --archived                          # finished tasks with completion dates, however old
task show 1                                   # one task with its steps
task show 1 --json                            # machine-readable
task edit 1 --name "New name" --no-due        # rename, clear the due date
task step rename 1 1 "New step name"
task step rm 1 2                              # a task's last step cannot be removed
task rm 1                                     # delete a cancelled or mistaken task
```

Every task has at least one step, so `task add` needs `--step`. `task done` and `task reopen` always take a step id; there is no command that completes a whole task, which is archived by itself when its last step is done.

Due dates are `YYYY-MM-DD` or `"YYYY-MM-DD HH:mm"` in local time. A date without a time means the end of that day.

Names of tasks, steps and suggestions are a single line of at most 200 characters.

`--by` records who made the update. Without it the CLI uses the `TASKBOARD_ACTOR` environment variable, then `user`. Changes made in the window are recorded as `user`.

On failure the command exits non-zero and writes the reason to standard error.

### Suggestions: letting an agent find tasks in your conversations

Tasks an agent infers on its own do not go straight into the list. They become suggestions, and you decide. A suggestion is a whole piece of work (a project or goal); its steps are the main stages, and stages that are already finished can be marked with `--done-step`.

```
task suggest "Build and release taskboard" --done-step "Survey existing tools" --done-step "First version" --step "Publish on GitHub" --source "chat on 10-12" --by claude
task suggestions              # pending suggestions
task accept 1                 # becomes a task; --done-step steps arrive done
task dismiss 2                # dropped; the same name will not be suggested again
```

The window shows a matching "建议" (suggestions) area with accept and dismiss buttons.

```
task digest                   # what you typed to Claude Code and DeepSeek Harness in the last 7 days
task digest --days 3 --agent claude
```

`task digest` is reading material for an agent. It reads local conversation records only, keeps only the text you typed (no agent replies, no command output), makes no network requests and changes no files. With the skill installed, tell your agent "organize my tasks" and it reads the digest: tasks already in the list are updated directly (steps the conversations show as finished are marked done and missing steps are added; nothing is deleted or renamed), and projects that are not in the list are filed as suggestions.

The first time the window starts with an empty list, it shows a card offering to do this once in the background with your local Claude Code. The card appears on its own only once; after that the "整理" (organize) button in the title bar brings it back whenever you want another pass, and nothing runs until you confirm.

**Privacy**: the digest contains things you said in your conversations. When an agent reads it, that text goes to the agent's model provider. Both sources are read by default, so one provider sees a digest of your conversations with the other agent; use `--agent` to read only one. Sensitive text you pasted into a conversation can appear in the digest.

Neither agent's record format is a published interface, so an update may make records unreadable. Unreadable records are skipped and reported at the end of the output.

### Letting agents update tasks

Installing taskboard does not change any agent configuration. See [docs/agent-integration.md](docs/agent-integration.md); the templates are in [integrations/](integrations/).

**Do not pick the taskboard install directory as a DeepSeek Harness workspace.** Its sandbox changes the access permissions of the workspace folder, which stops the Electron runtime inside it from starting, so the window will not open. The integration doc explains how to recover.

### Data

Data lives in `.taskboard/tasks.json` in your home directory. Set `TASKBOARD_HOME` to use another location. `widget.json` next to it only stores the window's own state.

Archived tasks stay in that file. The window shows the last 7 days; `task list --archived` shows all of them. A task takes about 1 KB.

When upgrading from the earlier version that used percentages, the data is converted automatically: steps at 100% become done and all others not done, and a task without steps gets one step named after it. Before the first save, the old file is copied to `tasks.v1.backup.json` in the same directory.

Do not edit `tasks.json` by hand while taskboard is running. If the file is damaged or a field is invalid, both the CLI and the window refuse to write, tell you the path and the reason, and leave the file untouched.

### Known limitations

- Each step records only its last update (who and when), not a full history.
- Whether an agent updates tasks depends on it following the integration notes.
- No due-date notifications and no sync between devices.
- No installer; it runs from source.

### Development

```
npm test        # all tests
npm run lint    # ESLint
npm start       # start the window
```

Requirements and design live in `openspec/`, managed with [OpenSpec](https://github.com/Fission-AI/OpenSpec). The pre-commit hook runs tests and lint.

## License

[MIT](LICENSE)

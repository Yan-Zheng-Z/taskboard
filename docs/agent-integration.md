# 让 Agent 更新任务进度 / Agent integration

[English summary](#english-summary)

taskboard 不给 Agent 写插件。Agent 通过执行 `task` 命令来更新进度，所以任何能运行 shell 命令的 Agent 都能接入。这里提供 Claude Code 和 DeepSeek Harness 的现成模板，两者都是一个 skill 文件，告诉 Agent 什么时候、怎么调用 `task`。

安装 taskboard 本身不会改动任何 Agent 的配置。下面的复制命令需要你自己执行。

## 约定

| | Claude Code | DeepSeek Harness | 你自己 |
|---|---|---|---|
| 署名 | `claude` | `deepseek` | `user` |

- Agent 只用 `task` 命令，不直接编辑数据文件。
- 只有在你说明"现在做的是哪个任务"之后，Agent 才更新进度。
- Agent 不会自行创建、改名或删除任务和步骤，除非你要求。

- Agent 自己从对话里归纳出的新任务只能作为"建议"提出，由你在小窗口里采纳或忽略。
- 整理时，Agent 可以直接更新已有任务：把对话显示已完成的步骤标为完成、补上缺少的步骤。它只向前推进进度，不删除也不改名，每次更新都有署名。

在会话里可以这样说：

| 你说 | Agent 做什么 |
|---|---|
| "现在做任务 3，做完一步就更新进度" | 干活的同时更新任务 3 的步骤进度 |
| "加一个任务：周五前交报销单，分成填表和找发票两步" | 直接创建任务和步骤 |
| "整理一下任务" | 读取最近的对话摘要：已有的任务直接更新步骤和进度，新的项目列为建议 |

### 整理任务时的隐私

"整理一下任务"会让 Agent 运行 `task digest`。它的输出是你最近 7 天对 Claude Code 和 DeepSeek Harness 输入过的文字（不含 Agent 的回复和命令输出），会进入该 Agent 的上下文，也就是发送给它背后的模型服务商。默认两个来源都读，所以一家服务商会看到你和另一个 Agent 的对话摘要。

如果不想这样，就明确告诉 Agent 只读它自己的对话，例如"整理一下任务，只看 Claude Code 的对话"，它会改用 `task digest --agent claude`。DeepSeek Harness 对应 `--agent deepseek`。

## 不要把 taskboard 的安装目录选作 DeepSeek Harness 的工作区

DeepSeek Harness 的沙箱会修改工作区文件夹的访问权限，其中包括把里面的文件标为"低完整性级别"。taskboard 的 Electron 运行程序就在安装目录里，被这样标记后一启动就崩溃，小窗口打不开，`taskboard` 命令没有任何反应。

如果已经发生，在 taskboard 仓库目录下运行这条命令恢复（Windows）：

```
icacls node_modules\electron\dist /setintegritylevel "(OI)(CI)M" /T
```

然后重新运行 `taskboard`。之后换一个文件夹作为 DeepSeek Harness 的工作区；任务和工作区没有绑定关系，选实际要干活的那个项目文件夹即可。

## Claude Code

模板：`integrations/claude/taskboard/SKILL.md`。复制到 Claude Code 的用户级 skill 目录，对所有项目生效。在 taskboard 仓库目录下执行：

Git Bash、macOS、Linux：

```
mkdir -p ~/.claude/skills && cp -r integrations/claude/taskboard ~/.claude/skills/
```

PowerShell：

```
New-Item -ItemType Directory -Force "$HOME\.claude\skills" | Out-Null; Copy-Item -Recurse -Force integrations\claude\taskboard "$HOME\.claude\skills\"
```

新开的会话会自动加载它。

放行命令：Claude Code 第一次运行 `task` 时会询问是否允许，选择"始终允许"即可。也可以在 `~/.claude/settings.json` 的 `permissions.allow` 里加上 `"Bash(task:*)"`。

只想对某一个项目生效的话，把文件夹复制到该项目的 `.claude/skills/` 下。

## DeepSeek Harness

模板：`integrations/dsh/taskboard/SKILL.md`。DeepSeek Harness 会扫描这些 skill 目录（见它的 `dsh-skill-filesystem` 包文档）：

| 范围 | 位置 |
|---|---|
| 单个项目 | `<项目根目录>/.dsh/skills` 或 `<项目根目录>/.agents/skills` |
| 所有项目 | `~/.dsh/skills` |

对所有项目生效，在 taskboard 仓库目录下执行：

Git Bash、macOS、Linux：

```
mkdir -p ~/.dsh/skills && cp -r integrations/dsh/taskboard ~/.dsh/skills/
```

PowerShell：

```
New-Item -ItemType Directory -Force "$HOME\.dsh\skills" | Out-Null; Copy-Item -Recurse -Force integrations\dsh\taskboard "$HOME\.dsh\skills\"
```

它会监视这些目录，不需要重启。

放行命令：DeepSeek Harness 在默认的 `workspace-write` 权限下把命令限制在工作区内，而 taskboard 的数据在用户主目录下。因此修改数据的 `task` 命令第一次可能被沙箱拒绝，Agent 会申请更宽的权限并弹出批准提示，批准即可。模板里已经告诉 Agent 这样处理。

这一段是根据 DeepSeek Harness 的包文档写的，批准提示的具体表现没有实测过。它还在开发者预览期，行为可能变化。

另一种做法：把模板正文追加到 `~/.dsh/AGENTS.md`，它会在每个会话开头读取这个文件。skill 只在相关时才加载，一般更合适。

## 其他 Agent

把任一模板的正文放进该 Agent 的指令文件（如 `AGENTS.md`），并把 `--by` 后面的名字换成你想显示的署名。也可以设置环境变量 `TASKBOARD_ACTOR`，这样不写 `--by` 时就用它。

## English summary

Agents update taskboard by running the `task` command, so any agent that can run shell commands works. Templates are provided as one skill file per agent. Installing taskboard never changes agent configuration; copy the templates yourself.

- **Claude Code**: copy `integrations/claude/taskboard` into `~/.claude/skills/` (or a project's `.claude/skills/`). Allow the `task` command when asked, or add `"Bash(task:*)"` to `permissions.allow`. Updates are signed `claude`.
- **DeepSeek Harness**: copy `integrations/dsh/taskboard` into `~/.dsh/skills/` (or a project's `.dsh/skills/`). Under the default `workspace-write` permissions, commands that change data may be denied by the sandbox the first time because the data lives in your home directory; approve the escalation prompt. This is based on the DeepSeek Harness package docs and has not been tested end to end. Updates are signed `deepseek`.
- **Other agents**: put the template body into the agent's instruction file and change the name after `--by`, or set `TASKBOARD_ACTOR`.

Conventions: agents use the `task` command only, update progress only after you say which task the work belongs to, and do not create, rename or delete tasks or steps unless asked. New tasks an agent infers from your conversations are filed as suggestions for you to accept or dismiss. When organizing, an agent may update tasks that already exist: mark steps finished and add missing steps, forward only, signed, never deleting or renaming.

What to say: "this is for task 3, update progress as you go"; "add a task: expense form by Friday, two steps"; "organize my tasks" (the agent runs `task digest`, which sends a digest of what you typed to both agents in the last 7 days to that agent's model provider; say "only look at Claude Code conversations" to limit it).

**Do not use the taskboard install directory as a DeepSeek Harness workspace.** Its sandbox relabels the folder's files as low integrity, and the Electron runtime inside then crashes on start. To recover on Windows, run `icacls node_modules\electron\dist /setintegritylevel "(OI)(CI)M" /T` in the repository and start `taskboard` again.

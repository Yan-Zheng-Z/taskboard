# Design

## Context

动机见 proposal.md。影响设计的现状和约束：

- 运行环境是 Windows 11，已装 Node 24、npm 11、Git、Python 3.13；没有 Rust。
- 两个写入 Agent（Claude Code、DeepSeek Harness）都能执行 shell 命令，DeepSeek Harness 还处于预览期，接口会变。
- 用户的 `!` 命令和 Agent 的 shell 用的是 Git Bash，所以命令必须在 bash 和 PowerShell 下都能直接调用。
- 开发流程约定：需求和计划以 `openspec/` 为准；实现阶段使用 Superpowers 的测试先行、系统化调试和完成前验证，跳过它的需求澄清和写计划环节；小窗口完成后用 `review-frontend-production` 做快速体检。

## Goals / Non-Goals

**Goals:**

- 命令行和小窗口共用同一份核心逻辑，行为不可能出现两套。
- 数据层可以脱离界面独立测试，包括并发写入。
- 不需要安装 Node 以外的运行环境。

**Non-Goals:**

- 不打包成安装程序或单个 exe，第一版从源码目录运行。
- 不做数据格式迁移工具，只在数据里留版本号。
- 不保存完整的修改历史，只保存每个步骤的最后更新人和时间。

## Decisions

### 1. 全部用 Node，小窗口用 Electron

三层结构：`src/core`（数据模型、校验、读写）、`src/cli`（`task` 命令）、`src/widget`（Electron 小窗口）。CLI 和小窗口都只调用 `core`。

- 备选 Tauri：体积小，但需要 Rust 工具链，本机没有。
- 备选 Python + tkinter：零依赖，但做出可拖滑块、可展开列表的界面费力且难看。
- 备选本地网页 + 浏览器：做不到无边框置顶常驻。

Electron 的代价是下载约 100 多 MB、常驻内存较高，对一台开发机可以接受。

### 2. 数据放在 `~/.taskboard/tasks.json`，用环境变量 `TASKBOARD_HOME` 覆盖

与代码仓库分离，重装或改代码不会碰到用户数据；测试把 `TASKBOARD_HOME` 指向临时目录。文件顶层带 `version: 1`、`nextTaskId` 和 `tasks` 数组；每个任务带自己的 `nextStepId`，以保证编号不复用。

- 备选 SQLite：并发更省心，但需要原生依赖，而且用户和 Agent 无法直接看懂数据文件。数据量是几十个任务，JSON 足够。

### 3. 写入用"锁文件 + 临时文件 + 原子替换"

每次修改的流程：以独占方式创建 `tasks.json.lock` → 读取 → 修改 → 写到同目录的临时文件 → 重命名覆盖 `tasks.json` → 删除锁文件。拿不到锁时短暂等待后重试，总等待上限约 5 秒；锁文件超过 10 秒未更新视为残留并接管。

- 只做原子替换而不加锁：两个进程会各自基于旧内容写入，后写的覆盖先写的，丢失更新。这正是两个 Agent 同时工作时会发生的情况，所以锁是必需的。
- Windows 上重命名覆盖偶尔会因为另一个进程正在读而失败，写入端对这种失败做有限次重试。

### 4. 编号用自增整数，步骤编号在任务内唯一

命令形如 `task progress 1 2 60`，Agent 和人都容易输入和复述。

- 备选随机短 ID：不会冲突，但难记难念，对话里指代任务不方便。
- 备选按位置序号：删除步骤后序号会变，Agent 可能更新到错误的步骤。

### 5. 截止日期用本地时间，接受 `YYYY-MM-DD` 和 `YYYY-MM-DD HH:mm`

只写日期时视为当天结束。紧迫程度分三档：已过期、三天内、其他。不处理时区，因为数据只在这一台机器上使用。

### 6. 小窗口的安全边界

渲染进程关闭 Node 集成、开启上下文隔离，只通过预加载脚本暴露的少量接口（读取、各类修改、窗口控制）与主进程通信；所有文件读写都在主进程里经由 `core` 完成。界面不加载任何远程内容。任务名称等用户文本一律按纯文本渲染，不拼接成 HTML。

### 7. 自动刷新靠监听数据目录

主进程监听 `~/.taskboard` 目录的变化，做 200 毫秒防抖后重新读取并推送给界面。监听目录而不是文件本身，是因为原子替换会让针对文件的监听失效。另加一个 5 秒一次的低频兜底轮询，只比较文件修改时间。

### 8. 界面用原生 HTML/CSS/JS，不引入前端框架

界面只有一个列表和展开的步骤，没有路由和复杂状态。不用框架就没有构建步骤，Electron 直接加载文件。

### 9. 命令行零依赖，自己解析参数

子命令数量少，Node 自带的 `util.parseArgs` 足够。`task` 和 `taskboard` 通过 `package.json` 的 `bin` 字段加 `npm link` 注册为全局命令，在 bash 和 PowerShell 下都可用。

### 10. 硬性检查

- 测试用 Node 自带的 `node:test`，覆盖 `core` 的全部规则和 CLI 的各个子命令；并发测试用多个子进程同时写入。
- 代码规范用 ESLint。
- Git 提交前钩子运行测试和 ESLint，失败则不允许提交。
- 小窗口的验证方式：`core` 和主进程逻辑走自动测试；界面行为通过实际启动应用并截图确认，再用 `review-frontend-production` 快速体检。

### 11. Agent 接入用"说明文字 + 命令行"，不写插件

Claude Code 一侧是一段写入 `CLAUDE.md` 的说明文字。DeepSeek Harness 一侧以 skill 的形式提供：OpenSpec 初始化时已确认它会读取项目内的 `.dsh/skills/`。两者都作为模板放在仓库里，见决定 12。

- 备选为 DeepSeek Harness 写 Cordis 插件或接 MCP：功能更强，但它还在预览期并明确会有破坏性改动，"执行一条 shell 命令"最不容易被改坏。

### 12. 开源发布

- 许可证用 MIT：最宽松、最常见，Electron 和 ESLint 的许可证都与它兼容。
- 安装方式是克隆仓库后 `npm install` 加 `npm link`，README 同时给出 `npm install -g github:<用户>/taskboard` 的一行写法。暂不发布到 npm，等有人实际使用再说。
- 代码不写死任何个人路径，数据位置一律由用户主目录和 `TASKBOARD_HOME` 推导。只在 Windows 11 上测试；代码避免使用 Windows 专有接口，但 README 明确写明 macOS 和 Linux 未经测试。
- GitHub Actions 在 `windows-latest` 上运行测试和 lint。
- Agent 接入不做自动安装：模板放在 `integrations/claude/` 和 `integrations/dsh/`，文档说明复制到哪里。自动改别人的全局 Agent 指令既有风险，也会被 Claude Code 的安全检查拦截。
- 提交使用 GitHub 提供的 no-reply 邮箱，避免个人邮箱出现在公开的提交记录里。
- `.claude/`、`.dsh/` 中由 OpenSpec 生成的文件和 `openspec/` 目录一并提交，让贡献者能沿用同一套流程。

## Risks / Trade-offs

- [全局指令文件的写入可能被 Claude Code 的安全检查拦截] → 模板放在仓库的 `integrations/` 目录，由用户用文档里的复制命令自己执行。
- [项目目录位于 OneDrive 同步的桌面时，`node_modules` 的大量文件和 `.git` 可能被同步进程锁住或拖慢] → 见与用户确认的存放位置方案。
- [公开仓库泄露个人信息] → 发布前检查全部文件和提交记录中没有个人路径、邮箱和真实任务数据。
- [DeepSeek Harness 每次执行 `task` 都可能弹出批准提示，打断工作] → 在文档中写明如何在它的权限设置里放行该命令；这一项需要用户在它的界面里操作和验证。
- [Agent 可能忘记更新进度，因为说明文字只是软约束] → 用户随时可以在小窗口手动修正；这是已接受的限制，第一版不做强制机制。
- [Electron 无边框置顶窗口在多显示器或缩放比例变化时可能跑到屏幕外] → 启动时检查保存的位置是否仍在可见区域内，不在则回到主屏幕默认位置。
- [锁文件因进程崩溃而残留] → 超过 10 秒视为残留并接管。
- [没有打包，开机自启依赖源码目录位置不变] → 文档中说明；移动目录后需要重新开启一次自启。

## Open Questions

- DeepSeek Harness 是否有全局（不限于单个项目）的 skill 或指令位置。这不影响规格和任务拆分：如果没有，就把 skill 放在需要用到它的各个项目的 `.dsh/skills/` 里，并在文档中说明。

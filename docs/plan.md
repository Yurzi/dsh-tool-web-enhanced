# 开发计划与路线图

本文记录里程碑状态、接下来的工作、候选事项与扩展原则。项目按纵向切片推进，每个里程碑都端到端可用；当前能力以 [功能设计](design.md) 与 [架构](architecture.md) 为准。

## 里程碑

| 里程碑 | 状态 | 交付的能力 |
| --- | --- | --- |
| **M0 基础** | 已完成 | monorepo、构建与检查工具链；profile 组合（写 `web` 行两个字段、停用 `web-search-deepseek`、插入两个插件行与菜单行）；两个插件各一个与原生等价的后端；空的 ui 包；单元、组合与 e2e 测试 |
| **M1 search 切片** | 已完成 | search 的会话选择、模型记忆、每步计划、关闭与隐藏工具、Remote、`/setup-search` 与行设置页；ui 的浏览器面（`webConnections`、共用输入框菜单、首次启用提示、bundle 概览与升级预检）；两个 native 连接与六个远程 adapter |
| **M2 fetch 对齐** | 已完成 | 选择范式抽进 core，两侧共用；统一的配置文档（版本识别、空迁移表、不读 0.1.x、Reset）；fetch 的 `local`（白名单与系统提示）与 DeepSeek Fetch API、会话选择、`/setup-fetch`、设置页与菜单分区 |
| **M3 fetch 远程后端** | 已完成 | MCP 客户端与 adapter 执行骨架进 core；fetch 的远程服务 Exa、Firecrawl、Tavily、Tinyfish 与结果映射，自定义连接；完全由目录驱动的设置页（凭据名称、端点信任、附加编辑器）；ui 行停用时两个插件照常可用 |
| **M4 服务协议进 core 与 model 后端** | 已完成 | 每个远程服务在 core 只有一个模块、按能力命名导出 wire，两侧产物各自只含本侧解析；search 的 `model` 后端：跟随会话模型（DeepSeek 官方路由集中处理）与固定模型连接，三种协议；错误附带上游的不可信说明，本次请求的凭据被扣下或替换为 `[redacted]` |
| **M5 增强工具与远程服务缺省停用** | 已完成 | 两个插件各注册本侧的[增强工具](design.md#增强工具)：带必填 `provider` 参数的 `web_search_enhanced` / `web_fetch_enhanced`，与列出本对话 provider 的 `list_web_search_providers` / `list_web_fetch_providers`；行设置的“增强工具”开关（带同意说明）与确认的 `web` 路由决定是否注册，可见性控制器按 Agent 遮罩，成对注册可回滚；每个新建的顶层对话快照一份 provider 列表（子对话继承，开关关闭时写空记录、不补建）；显式入口走同一执行层、不写会话状态，拒绝与后端失败有固定措辞与换 provider 提示；[远程服务缺省停用](design.md#远程服务缺省停用)（服务列表说明、菜单只列启用的连接并在底部提示、首次启用提示）；设置页写入串行；凭据解析的依赖异常一律固定化；单元与组合测试和 e2e 覆盖真实 preset、base profile、回环模型驱动的调用与截图 |
| **M5.5 子 Agent 会话可改选择** | 已完成 | [子 Agent 的会话](design.md#子-agent-的会话)（spawn 与 subagent_fork）无论 Agent 是否在运行都可在菜单里读写选择，不写模型记忆，用户 fork 不变；core 的会话来源 `sessionOrigin` 与以会话为目标（`SessionTarget`）的读写；Remote 的 `get` / `set` 共用一种取法，不在运行的子会话直接读写记录、不恢复 Agent；单元、嵌套 fiber 的组合测试与 e2e 覆盖 |
| **M6 dsh-tui** | 已完成 | [`/setup-search`、`/setup-fetch`](design.md#setup-search-与-setup-fetch) 改为两个插件各自注册的 Host 命令，Web GUI 与 dsh-TUI 都能用：不带参数显示当前选择与来源、路由状态与启用的连接，`off`、连接 id 与 search 的实时性按 Remote `set` 的同一套写入（core `writeSelection`）；浏览器以 `commandUi.decorate` 保留原来的选择框，带参数的一行交给 Host 命令，执行后重读该会话；dsh-TUI 里命令参数有补全（core `terminal.ts`，本地结构类型、独立的注入作用域）；ui 包不参与 TUI，profile 补丁不变；真实 `CommandRuntime` 上的 Host 组合测试、真实 `CommandUiRuntime` 上的浏览器测试，e2e 覆盖真实 Host、Web GUI 与经真实 PTY 驱动的 dsh-TUI |

## 接下来

没有排定的里程碑；下一步从[候选与待定](#候选与待定)中选。

## 候选与待定

| 事项 | 现状与原因 | 何时考虑 |
| --- | --- | --- |
| fetch 侧的 `model` 后端 | DeepSeek 没有独立的服务端抓取工具（只有 Responses `web_search` 在 v4-pro 上的打开页面动作） | 有可用的服务端抓取工具时再设计 |
| 请 DSH 提供不带正文摘录的结构化解析错误 | DSH 原生 provider 解析失败时，错误第一段带 Node 的正文摘录，短于 8 字符的凭据片段检测不到（[已知限制](design.md#已知限制)） | 向 DSH 提出；DSH 提供后改 core `restateNative` |
| 产物 tree-shaking 检查纳入 `scripts` | 两侧 Host 产物各自只含本侧解析，目前靠改动时人工核对（[开发流程 · 产物的 tree-shaking](development.md#产物的-tree-shaking)） | 做成 `verify:package` 的一步，进入 `check` |
| 停用的 `web-search-deepseek` 行的覆盖迁移提示 | Settings 只为运行中的行投影命名空间，浏览器读不到停用行的 `baseURL` 等覆盖 | DSH 能投影停用行时 |
| 拆分 core 设置骨架 | fetch 的浏览器产物带着它用不到的 model 表单与 list 字段；拆开要把 model 编辑器改成插件注入，收益不抵 | 浏览器产物体积成为问题时 |
| 远程服务未核实的行为 | 部分服务对目标错误的状态、keyless 的错误体形状等没有真实样本，目前按 provider 错误处理 | 有真实样本时调整 adapter |
| 增强工具的 web 卡片 | GUI 只按名字为 `web_search` / `web_fetch` 画 web 卡片，增强工具是通用工具行；本项目可在浏览器面注册 keyed `tool.call.toolview`，但 DSH 的行组件与 web 卡片模型没有导出，外观要自己拼、随 DSH 升级可能走样，还要加 `dsh-client-ui-tool` 的 devDependency。工具已照原生写 `presentationMeta`，历史记录可以直接渲染 | 用户要求，或 DSH 导出行组件时 |
| 增强工具跟随 preset 里 tool-web 的配置 | 增强工具用 tool-web 的导出常量（查询数、结果数、抓取输出上限），preset 编辑器里的修改不跟随（[已知限制](design.md#已知限制)）；读 preset 的配置等于嗅探私有形状 | 有用户需要调整时，给插件行加同名设置 |
| 菜单底部提示直达服务列表 | DSH 的插件设置入口没有锚点或初始滚动位置，提示只能打开设置页顶部（[已知限制](design.md#已知限制)） | DSH 的设置入口支持锚点时，给服务列表加锚点 |
| 移除 0.1.x 兼容代码 | 按“只对上一个已发布版本提供升级兼容”，0.1.x 的升级预检（ui 概览与首次启用提示）、退役字段诊断（两侧 `settings/retired.ts` 与设置页的 Reset 提示）以及 design“从 0.1.x 升级”一节都应移除；升级 e2e 已删，其余仍保留 | 单独安排 |
| TUI 的行设置区块 | dsh-TUI 的 `tuiSettingsSections` 只有 text / number / boolean / select 与只写密钥，字典与数组没有编辑器；它直接写路径操作，不经本插件写入前的整份校验，只适合默认连接、增强工具、服务启用与 API key 这类字段。现在 TUI 里行设置只读，要改需手编 profile 补丁或在 Web 设置页改（两边各一份） | 终端用户需要在 TUI 内改设置时 |
| TUI 底栏显示当前连接 | `tuiStatus.setField` 是全局字段；要知道 TUI 正在显示哪个会话需订阅 `tui/session-switched`，这要求 `dsh-plugin.json` 声明 DecisionEvents 契约 | 有需要时 |
| TUI“网页搜索”分区改写 `web` 行 | 该分区在 `web-deepseek-api` 行运行时出现，切换即把路由移出本插件；在 profile 里停用该行能让分区消失，但两种界面都会失去这一原生 provider 行（现在保留它作手工逃生口）。现在只在 `/setup-*` 的无参数输出里显示路由状态 | 决定是否在 profile 里停用 `web-deepseek-api` 时 |
| 拆出独立的 tui 包 | TUI 特有的只有命令补全的转接，代码量小，放在 core `./host` 的一个模块里。拆包可以让插件不带 TUI 的接口与类型、让运维单独停用这一行、把 dsh-tui 的 devDependency 与 `dsh-plugin.json` 声明限在一个包里，代价是多一个发布包、profile 行与一层中立的补全注册服务（照 ui 的做法：插件经可选注入登记，tui 包转接到 `tuiCommandTrees`，不依赖任何插件行） | 出现第二个 TUI 特有的功能（底栏、行设置区块，或任何需要 `dsh-plugin.json` 的功能）时 |
| 各服务条款与隐私政策的直链 | 用户已决定这不是本插件的责任：设置页只说明请求发往哪个服务，不链接条款 | 若以后要做：目录加条款与隐私链接，显示在远程服务的开关旁 |

## 扩展原则

实现新能力仍遵守[架构边界](architecture.md#包与依赖)；这里列加新能力或新模型工具时要守的原则。

- 升级兼容只对上一个已发布版本：升级路径、兼容代码与升级测试只覆盖“上一版 → 本版”，更早版本的兼容不再新增（[开发流程 · 发布与 CI](development.md#发布与-ci)）。
- 新增后端按[开发流程 · 新增后端](development.md#新增后端)；新的共享抽象进 core 后按[产物的 tree-shaking](development.md#产物的-tree-shaking)核对两侧产物。
- 模型工具由插件从 Host 行注册到全局工具层，所有 agent preset（含 minimal）与 base profile 都会带上；用新名字，不在 preset 里组合工具行，也不覆盖原生工具（理由见[架构 · 组合](architecture.md#组合profile-patch)）。
- 按路由与开关注册：只在 `web` 行确认路由到本插件、且运维打开了对应开关时注册，判断不了即不注册；会话关闭时按 Agent 遮住，不能经新工具绕开用户的关闭。
- 工具定义是静态的：可用 provider 不进 schema 或描述，由列出工具提供；否则设置一改定义就变，触发 DSH 的工具变更消息并让前缀缓存失效。
- 按对话快照授权：照 DSH 子 agent 路由授权的原则，运维的操作只影响新对话；子对话继承父对话的授权。
- 失败后由 Agent 换 provider，不做自动重试与 fallback；模型工具不写会话选择与模型记忆。
- 新增第三种能力（第三个 `ctx.web` 字段）时，先放宽 core 的 `Capability.tool`、浏览器的 `CapabilityName` 与 ui 的概览、停用判断——它们现在是 search / fetch 的闭合联合——再以现有两个插件为模板建包，在 `ids.ts` 给它定两个增强工具名；profile 仍一次写全 `web` 行的所有字段。
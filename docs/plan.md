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

## 接下来

### M5 自有增强工具

- 带参数的 `web_search_enhanced` 与 `web_fetch_enhanced`：Agent 在运维启用的连接中自己选择本次调用的后端。
- 辅助工具 `list_web_search_providers` 与 `list_web_fetch_providers`：列出当前可用的连接及其能力，参照 DSH 列出可用子 agent 路由的做法。
- 工具以 preset 行的形式由 bundle 组合（见[扩展原则](#扩展原则)）；可选范围仍受行设置与可选性规则（core `isSelectable`）约束。
- 不做自动 fallback：一次调用失败后，由 Agent 用 `web_*_enhanced` 自己选择另一个后端重试。
- 待设计：参数里如何引用连接、列出工具返回哪些字段、显式选择与会话选择（含关闭）的关系。

### M6 dsh-tui

- 支持 [dsh-tui](https://github.com/ccch1mneyyy/dsh-TUI)：在终端界面里提供与浏览器面对应的连接选择与状态。
- Host 侧的选择、Remote 与 `/setup-*` 的语义不变，只新增一个界面面。

## 候选与待定

| 事项 | 现状与原因 | 何时考虑 |
| --- | --- | --- |
| fetch 侧的 `model` 后端 | DeepSeek 没有独立的服务端抓取工具（只有 Responses `web_search` 在 v4-pro 上的打开页面动作） | 有可用的服务端抓取工具时再设计 |
| 请 DSH 提供不带正文摘录的结构化解析错误 | DSH 原生 provider 解析失败时，错误第一段带 Node 的正文摘录，短于 8 字符的凭据片段检测不到（[已知限制](design.md#已知限制)） | 向 DSH 提出；DSH 提供后改 core `restateNative` |
| 产物 tree-shaking 检查纳入 `scripts` | 两侧 Host 产物各自只含本侧解析，目前靠改动时人工核对（[开发流程 · 产物的 tree-shaking](development.md#产物的-tree-shaking)） | 做成 `verify:package` 的一步，进入 `check` |
| 停用的 `web-search-deepseek` 行的覆盖迁移提示 | Settings 只为运行中的行投影命名空间，浏览器读不到停用行的 `baseURL` 等覆盖 | DSH 能投影停用行时 |
| 拆分 core 设置骨架 | fetch 的浏览器产物带着它用不到的 model 表单与 list 字段；拆开要把 model 编辑器改成插件注入，收益不抵 | 浏览器产物体积成为问题时 |
| 远程服务未核实的行为 | 部分服务对目标错误的状态、keyless 的错误体形状等没有真实样本，目前按 provider 错误处理 | 有真实样本时调整 adapter |

## 扩展原则

实现新能力仍遵守[架构边界](architecture.md#包与依赖)；这里仅列未来工具组合需要额外决定的事项。

- 新增后端按[开发流程 · 新增后端](development.md#新增后端)；新的共享抽象进 core 后按[产物的 tree-shaking](development.md#产物的-tree-shaking)核对两侧产物。
- 加模型工具时由 bundle 在 agent preset 里组合工具行，而不是全局注册同名工具：全局同名注册在 base profile 会直接失败，在 Web profile 会被 preset 里的原生工具遮蔽。
- 新增第三种能力（第三个 `ctx.web` 字段）时，先放宽 core 的 `Capability.tool`、浏览器的 `CapabilityName` 与 ui 的概览、停用判断——它们现在是 search / fetch 的闭合联合——再以现有两个插件为模板建包；profile 仍一次写全 `web` 行的所有字段。

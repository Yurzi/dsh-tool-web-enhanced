# 代码结构

本文是当前源码、测试与产物的文件级索引。组合与分层见[架构](architecture.md)，产品行为与配置规则见[设计](design.md)，操作步骤见[开发流程](development.md)。

## 仓库布局与根配置

```text
.
├── packages/{profile,core,search-enhanced,fetch-enhanced,ui}/
├── build/                  # 共享打包代码
├── scripts/                # 工作区发现、打包校验与清理
├── e2e/{harness,fixtures}/ # 真实 DSH 测试及 *.e2e.ts
├── docs/                   # 文档集与维护者任务说明
├── .github/workflows/      # CI 与发布
└── dist/、.e2e/、.xdg/      # 本地产物与运行数据（不属于源码）
```

| 根配置 | 当前内容 |
| --- | --- |
| [package.json](<../package.json>) / [pnpm-lock.yaml](<../pnpm-lock.yaml>) | 私有 ESM 工作区，定义工具依赖与根脚本；锁文件记录依赖解析。 |
| [pnpm-workspace.yaml](<../pnpm-workspace.yaml>) | 声明 packages/*、共享 catalog、Zod override 与安装构建许可。 |
| [tsconfig.base.json](<../tsconfig.base.json>) / [tsconfig.json](<../tsconfig.json>) | 严格 TypeScript、ES2024、bundler 解析、React JSX、noEmit；纳入各包源码与测试、build、scripts、e2e 与配置文件。 |
| [vitest.config.ts](<../vitest.config.ts>) / [vitest.e2e.config.ts](<../vitest.e2e.config.ts>) | 包级单元与组合测试（装饰器、CSS Modules、primitives 测试插件）；真实 DSH 测试（全局准备、文件串行、独立超时）。 |
| [.oxlintrc.json](<../.oxlintrc.json>) | 类型感知 oxlint、React 与 import 规则及产物排除。 |
| [.editorconfig](<../.editorconfig>) / [.gitattributes](<../.gitattributes>) / [.gitignore](<../.gitignore>) | UTF-8、LF 与空白格式；排除依赖、产物、测试运行数据、缓存与环境文件。 |
| [ci.yml](<../.github/workflows/ci.yml>) / [publish.yml](<../.github/workflows/publish.yml>) | 检查与发布工作流，约定见开发流程。 |

docs/orchestration-prompt.md：维护者维护的多 agent 开发任务说明（每个阶段开始前由维护者重写）。

## 包清单

| 包目录 / manifest | npm 名称 | 版本 | exports 与 DSH 元数据 |
| --- | --- | --- | --- |
| [profile](<../packages/profile/package.json>) | dsh-tool-web-enhanced-profile | 0.1.2 | 导出 patch、locale、icon、package.json；dsh.bundle.patch 指向 patch。 |
| [core](<../packages/core/package.json>) | dsh-tool-web-enhanced-core | 0.0.0 | private；./shared、./host、./client 直接指向源码；无 dsh 字段。 |
| [search-enhanced](<../packages/search-enhanced/package.json>) | dsh-web-search-enhanced | 0.2.2 | 插件导出；dsh.client.platform = web。 |
| [fetch-enhanced](<../packages/fetch-enhanced/package.json>) | dsh-web-fetch-enhanced | 0.2.2 | 插件导出；dsh.client.platform = web。 |
| [ui](<../packages/ui/package.json>) | dsh-tool-web-enhanced-ui | 0.1.2 | 插件导出；dsh.client.platform = web。 |

三个插件共用 exports：`. → ./lib/index.js`、`./client → ./lib/client.cjs`，以及 locale JSON、icon SVG 与 package.json；均为 `sideEffects: false`，没有运行时 dependencies。profile 的 dependencies 是三个公开插件；core 只作为开发依赖参与内联。

各包依赖与 `dsh.client.inject` 以本表的 manifest 为准；peer 的 optional 元数据不等同于 Cordis 的运行时注入要求。

下面的目录树只展示目录层级，文件见各表。

### profile

没有 src、main 或构建脚本：[cordis.patch.yml](<../packages/profile/cordis.patch.yml>) 声明共享 web 路由与插件行的组合 patch，[locale/{en,zh}.json](<../packages/profile/locale/en.json>) 与 [icon.svg](<../packages/profile/icon.svg>) 提供 Plugins 页元数据与图标，[screenshots.json](<../packages/profile/screenshots.json>) 给插件市场列出截图（指向根 docs/assets 的 raw 地址，不进 npm 包），另有 package.json、README.md 与 tests/profile.spec.ts。

### core

三个入口分别导出共享文法、Host 机制与浏览器组件工厂；入口的分层理由见[架构 · core 的三个入口](architecture.md#core-的三个入口)。

```text
src/
├── shared/
├── host/
│   ├── enhanced-parts/
│   └── providers/
└── client/
    └── settings/
```

#### shared 入口

| 模块 | 职责 |
| --- | --- |
| [ids.ts](<../packages/core/src/shared/ids.ts>) | 包、row、provider 身份，每个能力的两个增强工具名（`EnhancedToolNames`、`PluginIdentity.tools`）与 Host 命令名（`PluginIdentity.command`：`setup-search` / `setup-fetch`）及 rowConfigKey。 |
| [connections.ts](<../packages/core/src/shared/connections.ts>) | 连接标识与 id 文法（`isConnectionId`、`BUILTIN_CONNECTION_ID`）、访问方式、目录描述（含 `optIn`、`use`）与参数校验。 |
| [settings.ts](<../packages/core/src/shared/settings.ts>) | 版本识别、迁移接口、文档 schema（含 `enhancedTools`）与 resolveDocument（内置连接的 `disabled` 缺省取目录 `optIn`）；标签单行化 `singleLine`。 |
| [route.ts](<../packages/core/src/shared/route.ts>) | web 路由字段、环境变量名与纯路由判断。 |
| [url.ts](<../packages/core/src/shared/url.ts>) · [search.ts](<../packages/core/src/shared/search.ts>) | 端点与来源 URL 校验；FRESHNESS 与 Freshness 类型。 |
| [selection.ts](<../packages/core/src/shared/selection.ts>) | 连接视图、会话选择、模型记忆与 Remote 契约。 |

#### host 入口

| 模块 | 职责 |
| --- | --- |
| [capability.ts](<../packages/core/src/host/capability.ts>) · [runtime.ts](<../packages/core/src/host/runtime.ts>) | 能力参数（含 `enhancedTools`、`Capability.enhanced`、可选的 `commandOptions` 与带标签的连接 `LabeledConnection`）、选项 codec 与调用上下文类型；installCapability 连接会话选择、计划、对话列表、可见性控制器、显式入口、Remote、Host 命令（`commands` 注入子作用域）、TUI 补全（独立的 `tuiCommandTrees` 注入子作用域）与 provider 注册。 |
| [sessions.ts](<../packages/core/src/host/sessions.ts>) · [plans.ts](<../packages/core/src/host/plans.ts>) | 以会话为目标（`SessionTarget`：运行中的 `live` 或冷的 `cold`；`liveSession`）的会话选择解析（fork 继承、revision、按会话来源写模型记忆、写入后同步当时运行中的 Agent）；请求步快照（Snapshots）与选择计划。 |
| [session-origin.ts](<../packages/core/src/host/session-origin.ts>) | 会话来源 `sessionOrigin`：只读会话头公开字段（`origin`、`parentSession`、`isSeeded`）得出 `top-level` / `fork` / `subagent`；`parentOf`。 |
| [selectable.ts](<../packages/core/src/host/selectable.ts>) · [restriction.ts](<../packages/core/src/host/restriction.ts>) | 连接是否存在且启用；可见性控制器 `ToolRestriction`：原生工具遮罩，增强工具的注册（可回滚的成对注册、注册世代）、按 Agent 遮罩与有序撤下，路由与开关变化后的重算。 |
| [enhanced.ts](<../packages/core/src/host/enhanced.ts>) · [explicit.ts](<../packages/core/src/host/explicit.ts>) | 增强工具的契约类型（`ExplicitCall`、`Rejection`、`ReadyProviders`、`ProviderListing`、`EnhancedAccess`、`CapabilityEnhanced` 等）；显式入口 `explicitAccess`：`run` / `list` / `ready` 的检查顺序、`withInitiator` 执行与就绪状态的异常边界。 |
| [provider-lists.ts](<../packages/core/src/host/provider-lists.ts>) | 新建对话的判断 `isNewConversation`（经 `sessionOrigin`）；`ProviderLists`：对话 provider 列表的建立、继承、读取（空记录读作没有列表）。 |
| [storage.ts](<../packages/core/src/host/storage.ts>) · [pairings.ts](<../packages/core/src/host/pairings.ts>) | 存储域（表 `selections`、`pairings`、`provider_lists`，version 1）、生命周期内存取与每会话队列；模型与连接的配对记录。 |
| [model.ts](<../packages/core/src/host/model.ts>) · [route.ts](<../packages/core/src/host/route.ts>) | 下一模型与当前请求模型身份；公开设置与环境中的 Host 路由事实。 |
| [settings-row.ts](<../packages/core/src/host/settings-row.ts>) · [remote.ts](<../packages/core/src/host/remote.ts>) | Volatile 设置行、候选文档校验与无效设置报告；连接 Remote 服务（`get` / `set` 共用的取法：运行中的 Agent → 冷的子 Agent 会话 → `resolveAgent`；`set` 经 `writeSelection`）及服务端异常隔离。 |
| [selection-write.ts](<../packages/core/src/host/selection-write.ts>) | `writeSelection`：Remote `set` 与 Host 命令共用的可选性检查与带修订号的写入，结果 `written` / `unavailable` / `conflict`。 |
| [command.ts](<../packages/core/src/host/command.ts>) | `registerCommand`：能力的 Host 命令（`/setup-search` / `/setup-fetch`）：文法、不带参数时的显示（来源、路由、启用的连接与接收方）、经 `writeSelection` 的写入、英文输出与异常边界。 |
| [terminal.ts](<../packages/core/src/host/terminal.ts>) | dsh-TUI 补全：本地结构类型（`TuiCommandTreeProvider`、`CommandCompletionNode`）、`tuiCommandTrees` 的 Context 类型增补与 `registerTerminal`（按当前设置同步列出 `off`、启用的连接、`freshness` 与三档）。 |
| [credentials.ts](<../packages/core/src/host/credentials.ts>) | API key、路由 key（无 Credentials 服务时回退启动环境）、账号 token 与就绪状态（按下一次请求的模型，未知时只看 API key）。 |
| [errors.ts](<../packages/core/src/host/errors.ts>) · [native.ts](<../packages/core/src/host/native.ts>) | 能力错误类型、取消与错误工厂；包装 DSH 原生 provider 并重述错误。 |
| [transport.ts](<../packages/core/src/host/transport.ts>) · [mcp.ts](<../packages/core/src/host/mcp.ts>) | 有界 HTTP 读写、统一期限与上游说明；一次工具调用内的 MCP 握手与 JSON / SSE 解析。 |
| [adapter.ts](<../packages/core/src/host/adapter.ts>) | AdapterWire、目标、鉴权、mapWire 与 runAdapter。 |
| [redaction.ts](<../packages/core/src/host/redaction.ts>) | 检测本次请求凭据，生成成功内容与诊断的去敏副本。 |
| [enhanced-parts.ts](<../packages/core/src/host/enhanced-parts.ts>) | 两侧增强工具共用部件的出口，重导出下面三个模块。 |
| enhanced-parts/[calls](<../packages/core/src/host/enhanced-parts/calls.ts>) · [wording](<../packages/core/src/host/enhanced-parts/wording.ts>) | 参数错误、未知字段、发起调用的 Agent、`provider` 文法与一次显式执行（`runOnProvider`）；`EnhancedVoice`、就绪子句、拒绝措辞与换 provider 提示的插入。 |
| enhanced-parts/[listing](<../packages/core/src/host/enhanced-parts/listing.ts>) | 列出工具的规范值 schema、值与文本（单行化、有界），`UNSUPPORTED_REASON_TEXT`（search 执行层共用）；`recipientText`、`oneLine`、`LABEL_MAX` 也供 Host 命令与补全使用。 |
| [providers/search.ts](<../packages/core/src/host/providers/search.ts>) · [fetch.ts](<../packages/core/src/host/providers/fetch.ts>) | SearchInput / SearchOutcome 与行解析辅助；FetchInput / PageOutcome 与目标状态映射。 |
| providers/[exa](<../packages/core/src/host/providers/exa.ts>)、[firecrawl](<../packages/core/src/host/providers/firecrawl.ts>)、[tavily](<../packages/core/src/host/providers/tavily.ts>)、[tinyfish](<../packages/core/src/host/providers/tinyfish.ts>) | 各导出 `<service>Search` 与 `<service>Fetch` wire。 |
| providers/[openalex](<../packages/core/src/host/providers/openalex.ts>)、[semanticscholar](<../packages/core/src/host/providers/semanticscholar.ts>) | 只有搜索 wire：学术摘要字段与论文来源映射。 |
| [providers/tool-rows.ts](<../packages/core/src/host/providers/tool-rows.ts>) | MCP 搜索工具共用的结构化与文本行格式解析。 |

#### client 入口

| 模块 | 职责 |
| --- | --- |
| [section.ts](<../packages/core/src/client/section.ts>) | ConnectionSection（含 `remoteServicesOff`）、路由源、选择 store 与 WebConnectionsService 接口。 |
| [remote-services.ts](<../packages/core/src/client/remote-services.ts>) | 菜单底部提示的事实 `remoteServicesOff` 与按设置快照缓存的 `remoteServicesOffSource`。 |
| [selection.ts](<../packages/core/src/client/selection.ts>) · [command.ts](<../packages/core/src/client/command.ts>) | ConnectionSelectionStore：共享缓存、revision 写入与失效重读（全部或单个会话 `invalidateSession`）；能力无关的 `selectionCommand`（挂在 Host 命令上的 decoration：无参数时的选择框）与 `followHostCommand`（`command/executed` 监听）。 |
| [route.ts](<../packages/core/src/client/route.ts>) · [pairings.ts](<../packages/core/src/client/pairings.ts>) · [credentials.ts](<../packages/core/src/client/credentials.ts>) | 状态观察器：合并浏览器 web 设置与 Host provider 事实；按观察生命周期加载模型记忆；凭据配置状态（不读值）。 |
| [use-observable.ts](<../packages/core/src/client/use-observable.ts>) | 经 useSyncExternalStore 订阅稳定的 observable。 |
| settings/[model.ts](<../packages/core/src/client/settings/model.ts>) · [fields.ts](<../packages/core/src/client/settings/fields.ts>) · [connection-form.ts](<../packages/core/src/client/settings/connection-form.ts>) | 从目录推导连接名、凭据引用、参数字段与协议分组；编辑文本转换与标量 / 列表 / 互斥校验；自定义 adapter / model 连接草稿。 |
| settings/[document.ts](<../packages/core/src/client/settings/document.ts>) · [sparse.ts](<../packages/core/src/client/settings/sparse.ts>) | 可编辑文档视图、写入候选验证、迁移写回与页面内串行的写入队列（`SettingsChange` 在当下的快照上计算）；相对继承层的稀疏写入与 Reset 操作。 |
| settings/[secret-diagnostics.ts](<../packages/core/src/client/settings/secret-diagnostics.ts>) · [injected.ts](<../packages/core/src/client/settings/injected.ts>) | 把公开 secret-presence 诊断加入设置快照；设置页注入的表单、状态、`readSettings` 与写入接口。 |
| settings/[parts.tsx](<../packages/core/src/client/settings/parts.tsx>) | 设置区块、输入部件、写入状态基础组件与写入的两种形状（`WriteSettings`、`SettingsChange`）。 |
| settings/[ServicesSection](<../packages/core/src/client/settings/ServicesSection.tsx>) · [ServiceFields](<../packages/core/src/client/settings/ServiceFields.tsx>) | 按目录生成内置服务列表（顶部的缺省停用说明、按 `optIn` 显示的启用开关与“未启用”标签）并挂载能力自有编辑器；内置连接的 credentialRef、端点与信任控件。 |
| settings/[CustomConnections](<../packages/core/src/client/settings/CustomConnections.tsx>) · [ConnectionEditor](<../packages/core/src/client/settings/ConnectionEditor.tsx>) | 自定义连接列表与增删改；连接格式、端点、信任与参数表单。 |
| settings/[CredentialEditor](<../packages/core/src/client/settings/CredentialEditor.tsx>) · [OptionsEditor](<../packages/core/src/client/settings/OptionsEditor.tsx>) · [DefaultsSection](<../packages/core/src/client/settings/DefaultsSection.tsx>) | 写入 DSH Credentials 的凭据编辑器；参数字段及其自保存表单；默认连接与能力自有默认控件。 |
| settings/[EnhancedToolsSection](<../packages/core/src/client/settings/EnhancedToolsSection.tsx>) | “增强工具”一节：开关、说明与同意语句（一个可访问的组），按继承层稀疏写入 `enhancedTools`。 |
| settings/[PairingsSection](<../packages/core/src/client/settings/PairingsSection.tsx>) · [ResetSection](<../packages/core/src/client/settings/ResetSection.tsx>) · [RouteNotice](<../packages/core/src/client/settings/RouteNotice.tsx>) | 模型记忆列表与忘记；重置确认；路由状态提示。 |

### search-enhanced

保留搜索目录、结果转换、原生后端、model 后端、能力绑定与增强工具。Host 入口导出 `name`、`inject`、`Config`、`apply`、`resolveSettings` 及 `SearchSettings` / `ResolvedSettings` 等类型；browser 入口导出 `inject`、`apply`。

```text
src/
├── backends/
├── host/
├── model/
├── search/
│   └── adapters/
├── settings/
├── tools/
└── client/
    └── settings/
```

| 模块 | 职责 |
| --- | --- |
| [index.ts](<../packages/search-enhanced/src/index.ts>) · [seat.ts](<../packages/search-enhanced/src/seat.ts>) | 插件入口与设置行，安装搜索能力；交给 ctx.web 的搜索 provider 适配座。 |
| [catalog.ts](<../packages/search-enhanced/src/catalog.ts>) · [contract.ts](<../packages/search-enhanced/src/contract.ts>) | 搜索目录、参数规则与 MODEL_PROTOCOLS；searchConnections Remote 与搜索选项 schema。 |
| settings/[resolve](<../packages/search-enhanced/src/settings/resolve.ts>) · [types](<../packages/search-enhanced/src/settings/types.ts>) · [retired](<../packages/search-enhanced/src/settings/retired.ts>) · [version](<../packages/search-enhanced/src/settings/version.ts>) | 把共享文法结果转为搜索连接类型；设置文档与别名；只供诊断与 Reset 的退役字段；重导出共享版本常量。 |
| [host/runtime.ts](<../packages/search-enhanced/src/host/runtime.ts>) | searchCapability（含 `enhanced` 与实时性的 `commandOptions`）、执行目标解析与 installSearch。 |
| host/[connections](<../packages/search-enhanced/src/host/connections.ts>) · [options](<../packages/search-enhanced/src/host/options.ts>) · [remote](<../packages/search-enhanced/src/host/remote.ts>) | 浏览器可显示的连接就绪事实；搜索会话选项 codec；Remote 服务类型与 Context 扩展。 |
| [host/listing.ts](<../packages/search-enhanced/src/host/listing.ts>) | 列出工具的能力事实 `searchListing`：目录用途、接收方（运维端点取主机名）、是否应用实时性。 |
| tools/[index](<../packages/search-enhanced/src/tools/index.ts>) · [definitions](<../packages/search-enhanced/src/tools/definitions.ts>) | `searchEnhanced`（能力的 `enhanced`）；`web_search_enhanced` 与 `list_web_search_providers` 的静态定义、参数校验、输出与超时。 |
| [tools/queries.ts](<../packages/search-enhanced/src/tools/queries.ts>) | 复制自 tool-web 的查询校验、多查询并发与合并、`projectSource`，以及 dsh-web 的 `capSources`。 |
| backends/[native](<../packages/search-enhanced/src/backends/native.ts>) · [common](<../packages/search-enhanced/src/backends/common.ts>) | 按目录键创建原生后端；原生鉴权、结果标准化与错误措辞。 |
| backends/[deepseek-messages](<../packages/search-enhanced/src/backends/deepseek-messages.ts>) · [deepseek-search-api](<../packages/search-enhanced/src/backends/deepseek-search-api.ts>) | 实例化 DSH 的 Messages 搜索 provider；实例化 Search API provider 并提供当前用户问题。 |
| search/adapters/[index](<../packages/search-enhanced/src/search/adapters/index.ts>) · [types](<../packages/search-enhanced/src/search/adapters/types.ts>) | 把 core 服务 wire 与 searchSources 绑定成 ADAPTER_WIRES；按目录约束 adapter 与 keyless wire 类型。 |
| search/[adapter-result](<../packages/search-enhanced/src/search/adapter-result.ts>) · [sources](<../packages/search-enhanced/src/search/sources.ts>) | 服务 outcome 转搜索来源或搜索错误；来源与日期的验证、去重与标准化。 |
| search/[execute](<../packages/search-enhanced/src/search/execute.ts>) · [http](<../packages/search-enhanced/src/search/http.ts>) · [errors](<../packages/search-enhanced/src/search/errors.ts>) | 调度 adapter / model 执行并组装结果；HTTP / MCP 传输参数与消息；搜索错误与凭据提示。 |
| model/[types](<../packages/search-enhanced/src/model/types.ts>) · [bounds](<../packages/search-enhanced/src/model/bounds.ts>) | 模型路由、鉴权与支持状态类型；跨命名空间读取的路由字段约束。 |
| model/[route](<../packages/search-enhanced/src/model/route.ts>) · [deepseek](<../packages/search-enhanced/src/model/deepseek.ts>) | 从固定连接或 Session 公共路由重建执行目标；集中推导 DeepSeek 路由与 Messages 方言。 |
| model/[protocols](<../packages/search-enhanced/src/model/protocols.ts>) · [execute](<../packages/search-enhanced/src/model/execute.ts>) | 协议请求生成与回答、来源解析；解析本次鉴权并执行有界请求。 |
| client/[index.tsx](<../packages/search-enhanced/src/client/index.tsx>) · [section](<../packages/search-enhanced/src/client/section.ts>) · [command](<../packages/search-enhanced/src/client/command.ts>) | 安装浏览器面、设置注入、`/setup-search` 的 decoration 与 Host 命令执行后的重读、可选 UI section；搜索选择与 freshness 的菜单 section；/setup-search 选择框的选项（含 freshness）。 |
| client/[connections](<../packages/search-enhanced/src/client/connections.ts>) · [credentials](<../packages/search-enhanced/src/client/credentials.ts>) · [locales](<../packages/search-enhanced/src/client/locales.ts>) | 连接、状态、来源与写入结果文案；凭据引用与共享状态观察器；中英文词典。 |
| client/[selection](<../packages/search-enhanced/src/client/selection.ts>) · [route](<../packages/search-enhanced/src/client/route.ts>) · [pairings](<../packages/search-enhanced/src/client/pairings.ts>) · [injected](<../packages/search-enhanced/src/client/injected.ts>) | 把 core 的选择 store、路由状态、模型记忆绑定到搜索 Remote 与字段；设置页注入类型。 |
| client/settings/[SettingsPage](<../packages/search-enhanced/src/client/settings/SettingsPage.tsx>) · [model](<../packages/search-enhanced/src/client/settings/model.ts>) | 组合设置页、文档诊断与 Reset；把目录与 model 协议转为设置页事实和文案。 |

其余设置模块是 core 工厂的搜索绑定：[CredentialEditor](<../packages/search-enhanced/src/client/settings/CredentialEditor.tsx>)、[CustomConnections](<../packages/search-enhanced/src/client/settings/CustomConnections.tsx>)、[DefaultsSection](<../packages/search-enhanced/src/client/settings/DefaultsSection.tsx>)、[EnhancedToolsSection](<../packages/search-enhanced/src/client/settings/EnhancedToolsSection.tsx>)、[OptionsEditor](<../packages/search-enhanced/src/client/settings/OptionsEditor.tsx>)、[PairingsSection](<../packages/search-enhanced/src/client/settings/PairingsSection.tsx>)、[ServicesSection](<../packages/search-enhanced/src/client/settings/ServicesSection.tsx>)、[parts](<../packages/search-enhanced/src/client/settings/parts.tsx>)、[sparse](<../packages/search-enhanced/src/client/settings/sparse.ts>)；CSS Modules 与声明文件提供局部样式和导入类型。

### fetch-enhanced

保留本地地址策略、远程页结果转换、抓取能力绑定与增强工具。入口导出与搜索同形，设置类型为 `FetchSettings` / `ResolvedSettings`。

```text
src/
├── backends/
├── host/
├── local/
├── remote/
│   └── adapters/
├── settings/
├── tools/
└── client/
    └── settings/
```

| 模块 | 职责 |
| --- | --- |
| [index.ts](<../packages/fetch-enhanced/src/index.ts>) · [prompt.ts](<../packages/fetch-enhanced/src/prompt.ts>) | 插件入口与设置行，安装抓取能力与提示；生成并注册当前请求步的本地 allowlist 提示（`allowlistNotice` 的主语参数：系统提示用 `web_fetch`，列出工具用 `this provider`）。 |
| [catalog.ts](<../packages/fetch-enhanced/src/catalog.ts>) · [contract.ts](<../packages/fetch-enhanced/src/contract.ts>) | 抓取目录、本地默认值与参数规则；fetchConnections Remote 与空会话选项 schema。 |
| settings/[resolve](<../packages/fetch-enhanced/src/settings/resolve.ts>) · [types](<../packages/fetch-enhanced/src/settings/types.ts>) · [retired](<../packages/fetch-enhanced/src/settings/retired.ts>) · [version](<../packages/fetch-enhanced/src/settings/version.ts>) | 解析抓取连接并校验 allowlist；本地、原生、adapter 连接与设置类型；退役字段；重导出版本常量。 |
| [host/runtime.ts](<../packages/fetch-enhanced/src/host/runtime.ts>) | fetchCapability（含 `enhanced`）、目标构建与 installFetch。 |
| host/[connections](<../packages/fetch-enhanced/src/host/connections.ts>) · [options](<../packages/fetch-enhanced/src/host/options.ts>) · [remote](<../packages/fetch-enhanced/src/host/remote.ts>) | 本地与远程连接的显示事实；无会话参数的选项 codec；Remote 服务类型与 Context 扩展。 |
| [host/listing.ts](<../packages/fetch-enhanced/src/host/listing.ts>) | 列出工具的能力事实 `fetchListing`：接收方（运维端点取主机名）与 `local` 的白名单说明。 |
| tools/[index](<../packages/fetch-enhanced/src/tools/index.ts>) · [definitions](<../packages/fetch-enhanced/src/tools/definitions.ts>) | `fetchEnhanced`（能力的 `enhanced`）；`web_fetch_enhanced` 与 `list_web_fetch_providers` 的静态定义、参数校验（tool-web 的 `parseFetchArgs`）、输出与超时。 |
| local/[rules](<../packages/fetch-enhanced/src/local/rules.ts>) · [address-policy](<../packages/fetch-enhanced/src/local/address-policy.ts>) | CIDR、hostname 规则的解析、规范化与逐条诊断；地址是否公共可达或满足操作员例外。 |
| local/[resolver](<../packages/fetch-enhanced/src/local/resolver.ts>) · [backend](<../packages/fetch-enhanced/src/local/backend.ts>) | 完整验证 DNS 答案集与 NAT64 目标；向 DSH HttpFetchProvider 注入当前策略与 resolver。 |
| backends/[native](<../packages/fetch-enhanced/src/backends/native.ts>) · [common](<../packages/fetch-enhanced/src/backends/common.ts>) · [deepseek-fetch-api](<../packages/fetch-enhanced/src/backends/deepseek-fetch-api.ts>) | 创建原生抓取后端；原生鉴权、错误改写与 Host 诊断；实例化 DSH DeepSeek Fetch API provider。 |
| remote/[adapters/index](<../packages/fetch-enhanced/src/remote/adapters/index.ts>) · [types](<../packages/fetch-enhanced/src/remote/types.ts>) | 把 core 抓取 wire 绑定到目录；按目录约束 keyless 类型。 |
| remote/[execute](<../packages/fetch-enhanced/src/remote/execute.ts>) · [http](<../packages/fetch-enhanced/src/remote/http.ts>) · [errors](<../packages/fetch-enhanced/src/remote/errors.ts>) | 构建 adapter 后端并执行；HTTP / MCP 传输参数与消息；抓取能力错误工厂。 |
| [remote/page.ts](<../packages/fetch-enhanced/src/remote/page.ts>) | Page / PageFailure 转 WebFetchResult / WebError。 |
| client/[index.tsx](<../packages/fetch-enhanced/src/client/index.tsx>) · [section](<../packages/fetch-enhanced/src/client/section.ts>) · [command](<../packages/fetch-enhanced/src/client/command.ts>) | 安装浏览器面、设置注入、`/setup-fetch` 的 decoration 与 Host 命令执行后的重读、可选 UI section；抓取连接菜单 section；/setup-fetch 选择框的选项。 |
| client/[connections](<../packages/fetch-enhanced/src/client/connections.ts>) · [locales](<../packages/fetch-enhanced/src/client/locales.ts>) | 就绪状态、URL 接收方与选择文案；中英文词典。 |
| client/[selection](<../packages/fetch-enhanced/src/client/selection.ts>) · [route](<../packages/fetch-enhanced/src/client/route.ts>) · [injected](<../packages/fetch-enhanced/src/client/injected.ts>) | 把 core 的选择 store 与路由状态绑定到抓取 Remote 与字段；设置页注入类型。 |
| [client/allowlist-lines.ts](<../packages/fetch-enhanced/src/client/allowlist-lines.ts>) | allowlist 物理行诊断与显式修复操作。 |
| client/settings/[SettingsPage](<../packages/fetch-enhanced/src/client/settings/SettingsPage.tsx>) · [model](<../packages/fetch-enhanced/src/client/settings/model.ts>) | 组合设置页、文档诊断与 Reset；目录转设置页事实与服务说明。 |
| client/settings/[AllowlistEditor](<../packages/fetch-enhanced/src/client/settings/AllowlistEditor.tsx>) · [LocalExtras](<../packages/fetch-enhanced/src/client/settings/LocalExtras.tsx>) | 两组 allowlist 草稿与显式原子保存；挂载本地 allowlist 与 User-Agent 编辑器。 |

其余设置模块是 core 工厂的抓取绑定：[CredentialEditor](<../packages/fetch-enhanced/src/client/settings/CredentialEditor.tsx>)、[CustomConnections](<../packages/fetch-enhanced/src/client/settings/CustomConnections.tsx>)、[DefaultsSection](<../packages/fetch-enhanced/src/client/settings/DefaultsSection.tsx>)、[EnhancedToolsSection](<../packages/fetch-enhanced/src/client/settings/EnhancedToolsSection.tsx>)、[OptionsEditor](<../packages/fetch-enhanced/src/client/settings/OptionsEditor.tsx>)、[PairingsSection](<../packages/fetch-enhanced/src/client/settings/PairingsSection.tsx>)、[ServicesSection](<../packages/fetch-enhanced/src/client/settings/ServicesSection.tsx>)、[parts](<../packages/fetch-enhanced/src/client/settings/parts.tsx>)、[sparse](<../packages/fetch-enhanced/src/client/settings/sparse.ts>)；CSS Modules 与声明文件提供局部样式和导入类型。

### ui

Host 入口只导出 `name` 与空 `apply`；浏览器入口导出 `inject`、`apply` 并安装共享连接界面。

```text
src/
└── client/
```

| 模块 | 职责 |
| --- | --- |
| [index.ts](<../packages/ui/src/index.ts>) | 不依赖搜索或抓取服务的 Host 插件入口。 |
| [client/index.tsx](<../packages/ui/src/client/index.tsx>) · [service.ts](<../packages/ui/src/client/service.ts>) | 安装 webConnections 服务，注册菜单、激活提示与组合包详情；管理独立注册的 section、路由事实与 observable。 |
| [ComposerConnectionMenu](<../packages/ui/src/client/ComposerConnectionMenu.tsx>) | 连接按钮（随输入栏的紧凑信号收起）、上层面板与底部能力切换的两层菜单（面板只列未停用的连接与所选的连接，远程服务全部停用时底部提示可在设置中打开），以及选择交互。 |
| [ActivationPrompt](<../packages/ui/src/client/ActivationPrompt.tsx>) · [ProfileDetailSection](<../packages/ui/src/client/ProfileDetailSection.tsx>) | 激活后的只读检查与导航提示（无预检问题时加远程服务缺省关闭的一句）；组合包路由状态与升级预检操作。 |
| [disabled.ts](<../packages/ui/src/client/disabled.ts>) · [preflight.ts](<../packages/ui/src/client/preflight.ts>) | 能力路由与插件行停用判断；升级预检结果与确认后的清理操作。 |
| [locales.ts](<../packages/ui/src/client/locales.ts>) | 共享界面的中英文词典。 |

## 构建与 scripts

运行顺序、CI 与发布步骤见[开发流程](development.md)；构建形态见[架构 · 构建与发布](architecture.md#构建与发布)。

| 模块 | 职责 |
| --- | --- |
| [tsdown.ts](<../build/tsdown.ts>) | pluginBuild：为各插件生成 Host ESM 与 browser CJS 构建配置。 |
| [platform.ts](<../build/platform.ts>) | 浏览器平台模块表与 isPlatformModule。 |
| [plugins.ts](<../build/plugins.ts>) | standardDecorators、cssModules 与测试专用 primitivesStub。 |
| [globals.d.ts](<../build/globals.d.ts>) | 构建时替换的 __PLUGIN_VERSION__。 |
| [workspace.ts](<../scripts/workspace.ts>) | 发现非 private 工作区包并以 pnpm pack 输出发布形态（verify-packages 与 e2e 共用）。 |
| [verify-packages.ts](<../scripts/verify-packages.ts>) | 检查打包后的 manifest 范围、统一 DSH 范围、Host 外部导入、profile 版本锁定、仓库地址与 Plugins 页资源，再运行 publint。 |
| [clean.ts](<../scripts/clean.ts>) | 清理当前包的相对产物目录，拒绝越界路径。 |
| [release-notes.ts](<../scripts/release-notes.ts>) | 输出 CHANGELOG 中某个标签的小节，作为 publish.yml 创建的 GitHub Release 正文。 |

[search](<../packages/search-enhanced/tsdown.config.ts>)、[fetch](<../packages/fetch-enhanced/tsdown.config.ts>) 与 [ui](<../packages/ui/tsdown.config.ts>) 的 tsdown.config.ts 都只调用 `pluginBuild(import.meta.url)`；profile 与 core 没有构建任务。

## 端到端目录

环境变量、隔离、运行与排查见[开发流程 · 端到端测试](development.md#端到端测试)。[global-setup.ts](<../e2e/global-setup.ts>) 准备套件的隔离环境、DSH 安装与发布形态包。

| harness | 作用 |
| --- | --- |
| [environment.ts](<../e2e/harness/environment.ts>) | 隔离环境、`dsh` 调用、`isolatedContext`（在本次运行下另建一套隔离目录，得到独立 home）、`addPlugins`（可选 profile 名）、`createBaseProfile`（经 `dsh-app-boot` 的 `initProfile` 建只有 base 的 profile）、`installUserFixture`（把夹具追加到真实的用户层 patch）、`composedRows`（读 `--dump-config`）。 |
| [host.ts](<../e2e/harness/host.ts>) | 按 CLI 的步骤在进程内启动 Host（`dsh-app-boot` 的公开导出），叠加 `fixtures/host-plane.yml` 去掉 GUI 行，不绑定端口；可选 `profileName`（Web 或 base）；`prepare` 回调在插件初始化前接入观察者（如日志）。按 `dsh-cmdline` 公开的 `onReady` 契约提供“应用就绪”源：启动完成后通知已登记的监听者，之后登记的立即回调（HMR 的初始重载等它，否则 Settings 写入一直排队）；`dispose` 先 await 公开的 `hmr.runExclusive(async () => {})` 作为屏障，再处置根 fiber。 |
| [web.ts](<../e2e/harness/web.ts>) | 启动 `dsh web`，监听 127.0.0.1 上 OS 分配的空闲端口（从不用 3080），输出写 `web.log`。 |
| [browser.ts](<../e2e/harness/browser.ts>) | 无头 Chromium（Playwright），按 context 语言关闭首次启动的对话框（可选保留本组合包的首次启用提示以便截图），导航前可接入页面观察者（如记录请求与 WebSocket 帧），失败时记录可访问性快照与截图。 |
| [terminal.ts](<../e2e/harness/terminal.ts>) · [terminal-pty.py](<../e2e/harness/terminal-pty.py>) | `startTerminal`：经 Python 标准库 `pty` 在真实伪终端里运行一条命令（如正式的 `dsh-tui` 入口，180×60，`DSH_TUI_LANG=en`），按输出事件等待文字（不计时），结束时把纯文本与 ANSI 原文存为证据。 |
| [navigation.ts](<../e2e/harness/navigation.ts>)、[theme.ts](<../e2e/harness/theme.ts>)、[model-visuals.ts](<../e2e/harness/model-visuals.ts>) | 经公开界面打开插件页、设置页、新会话、连接菜单及其能力标签与主题设置。 |
| [remote-fetch-api.ts](<../e2e/harness/remote-fetch-api.ts>)、[model-api.ts](<../e2e/harness/model-api.ts>)、[http.ts](<../e2e/harness/http.ts>) | 回环假远程服务 / 假模型 API（记录方法、路径、请求头与请求体，回复可替换或按请求生成）与本地抓取目标；`startAgentModelApi` 回放确定的 Messages SSE（第一步发出给定的工具调用，之后回答），驱动真实 Agent 循环，`startTextModelApi` 只回文本。 |
| [enhanced-tool-review.ts](<../e2e/harness/enhanced-tool-review.ts>) | `captureEnhancedToolReview`：回环假模型与假服务驱动真实 Agent，同一回合调用原生 `web_search`、两个成功与失败的增强工具，经传输闸门拍下运行中（切到 Compact）、展开的来源、原生与增强并列、失败行折叠与展开，以及会话关闭后的拒绝。 |
| [review.ts](<../e2e/harness/review.ts>) | `reviewScreenshot`：截图存入 `.e2e/artifacts`，并复制到不被全局准备清空的 `.e2e/review/<日期-主题>/` 供评审。 |

| fixtures | 内容 |
| --- | --- |
| [host-plane.yml](<../e2e/fixtures/host-plane.yml>) | 关闭浏览器服务行，保留 Host 所需服务。 |
| [command-defaults.yml](<../e2e/fixtures/command-defaults.yml>) | 命令往返用的免凭据默认搜索连接（显式启用 OpenAlex）。 |
| [remote-enabled.yml](<../e2e/fixtures/remote-enabled.yml>) / [search-exa-enabled.yml](<../e2e/fixtures/search-exa-enabled.yml>) / [fetch-remote-loopback.yml](<../e2e/fixtures/fetch-remote-loopback.yml>) | 显式启用缺省停用的远程服务（两侧的远程服务；只有 search Exa；fetch 的远程服务加回环白名单），不发远程请求。 |
| [enhanced-tools.yml](<../e2e/fixtures/enhanced-tools.yml>) / [enhanced-flow.ts](<../e2e/fixtures/enhanced-flow.ts>) | 两侧打开增强工具；回环模型驱动的四个工具调用、两行设置（固定模型搜索与自定义抓取连接）与期望文本。 |
| [disable-search.yml](<../e2e/fixtures/disable-search.yml>) / [disable-fetch.yml](<../e2e/fixtures/disable-fetch.yml>) / [disable-ui.yml](<../e2e/fixtures/disable-ui.yml>) | 分别停用搜索、抓取与共享 UI 行。 |
| [fetch-allow-loopback.yml](<../e2e/fixtures/fetch-allow-loopback.yml>) / [fetch-native-route.yml](<../e2e/fixtures/fetch-native-route.yml>) | 显式允许回环的本地连接；把抓取路由切到原生 HTTP。 |
| [remote-fetch.ts](<../e2e/fixtures/remote-fetch.ts>) / [search-model.ts](<../e2e/fixtures/search-model.ts>) | 自定义抓取连接与 Firecrawl 页响应；固定模型、Session 路由与协议响应。 |
| [subagent-selection.ts](<../e2e/fixtures/subagent-selection.ts>) | 两侧各两个指向不同回环目的地的连接（固定模型搜索、Firecrawl 抓取）；回环模型：按队列给父 Agent 下发工具调用，可在子 Agent 的请求处暂停。 |
| [setup-command-connections.yml](<../e2e/fixtures/setup-command-connections.yml>) | 命令与补全用的搜索连接：默认 OpenAlex、API key 访问的 Exa、大写 id 的自定义连接 `custom:MyEngine`。 |
| [setup-command-invalid-settings.yml](<../e2e/fixtures/setup-command-invalid-settings.yml>) / [setup-command-other-route.yml](<../e2e/fixtures/setup-command-other-route.yml>) | 两行都写不受支持的 `version: 1`（设置无效）；`web` 行把搜索路由给 `deepseek`。 |
| [tui-pty.yml](<../e2e/fixtures/tui-pty.yml>) / [tui-web-composition.yml](<../e2e/fixtures/tui-web-composition.yml>) / [disable-tui-frontend.yml](<../e2e/fixtures/disable-tui-frontend.yml>) | TUI profile 里 `dsh-tui` 行的设置（`provider: deepseek-official`、非全屏、不显示终端图片）并停用 `dsh-tui-webserver`；Web profile 叠入 TUI bundle 做服务级检查时，停用与 Web 行重复的 TUI 服务行；停用 TUI 的前端行（`dsh-tui`、`dsh-tui-webserver`）。 |

下表“套件”指共用本次运行的隔离 home，“独立”指另用 `isolatedContext` 派生 home，均不是用户的 DSH home。

| 规格 | 覆盖要点 | 浏览器 | home |
| --- | --- | --- | --- |
| [profile.e2e.ts](<../e2e/profile.e2e.ts>) | 安装、组合、路由和能力行停用 | 否 | 套件 |
| [fetch-allowlist.e2e.ts](<../e2e/fetch-allowlist.e2e.ts>) | 回环授权、User-Agent 与运行时提示 | 否 | 套件 |
| [remote-fetch-api.e2e.ts](<../e2e/remote-fetch-api.e2e.ts>) | 回环夹具记录与响应切换 | 否 | 不使用 DSH |
| [fetch-remote.e2e.ts](<../e2e/fetch-remote.e2e.ts>) | 自定义远程抓取的真实 Host 往返 | 否 | 独立 |
| [search-model.e2e.ts](<../e2e/search-model.e2e.ts>) | 固定模型及 Session 路由的真实 Host 协议请求 | 否 | 独立 |
| [plugins-page.e2e.ts](<../e2e/plugins-page.e2e.ts>) | 组合包标题、图标元数据及插件行 | 是 | 套件 |
| [settings-page.e2e.ts](<../e2e/settings-page.e2e.ts>) | 设置页 allowlist 校验及稀疏保存 | 是 | 套件 |
| [composer-menu.e2e.ts](<../e2e/composer-menu.e2e.ts>) | 搜索 Off 选择、持久化与工具恢复 | 是 | 独立 |
| [fetch-menu.e2e.ts](<../e2e/fetch-menu.e2e.ts>) | 抓取选择、Off 与搜索的独立性 | 是 | 独立 |
| [menu-rows-off.e2e.ts](<../e2e/menu-rows-off.e2e.ts>) | 单侧或双侧能力行停用后的菜单与说明 | 是 | 套件 |
| [ui-row-off.e2e.ts](<../e2e/ui-row-off.e2e.ts>) | 无共享菜单时仍有设置页和 `/setup-*` 选择框（斜杠菜单行按 Host 命令名定位） | 是 | 独立 |
| [fetch-remote-ui.e2e.ts](<../e2e/fetch-remote-ui.e2e.ts>) | 远程连接就绪、凭据与自定义端点设置 | 是 | 独立 |
| [search-model-ui.e2e.ts](<../e2e/search-model-ui.e2e.ts>) | model 连接设置、选择持久化与响应式页面 | 是 | 功能组 / 视口独立 |
| [search-model-visuals.e2e.ts](<../e2e/search-model-visuals.e2e.ts>) | 列表参数、互斥冲突恢复持久化、信任及 model 菜单状态 | 是 | 每例独立 |
| [screenshots.e2e.ts](<../e2e/screenshots.e2e.ts>) | 主题、视口、菜单和设置截图矩阵；输入栏宽度扫描下按钮随模型选择器收起、不折行 | 是 | 套件 |
| [review-settings-visuals.e2e.ts](<../e2e/review-settings-visuals.e2e.ts>) | 设置交互与中英文响应式截图 | 是 | 每例独立 |
| [enhanced-visibility.e2e.ts](<../e2e/enhanced-visibility.e2e.ts>) | standard、cordis、PTC、minimal preset 与 base profile 上新旧对话的增强工具表；停用一个插件行只少它的两个工具；fetch 路由到原生 HTTP 时没有 fetch 的增强工具 | 否 | 独立 |
| [enhanced-flow.e2e.ts](<../e2e/enhanced-flow.e2e.ts>) | 回环假模型驱动真实 Agent 调用四个增强工具，按指定 provider 执行且不改两侧会话选择；通用工具行的截图矩阵 | Host 部分否，截图是 | 独立 |
| [enhanced-settings.e2e.ts](<../e2e/enhanced-settings.e2e.ts>) | “增强工具”一节、远程服务缺省停用与菜单底部提示的宽度 / 主题 / 语言矩阵；在设置页打开远程服务后菜单与新 Agent 的 provider 列表 | 是 | 独立 |
| [enhanced-hot-switch.e2e.ts](<../e2e/enhanced-hot-switch.e2e.ts>) | 不重启：在 GUI 打开开关后两组工具出现，关掉 search 后下一次请求只少 search 的两个 | 是 | 独立 |
| [enhanced-readiness.e2e.ts](<../e2e/enhanced-readiness.e2e.ts>) | 同一 GUI Host 保存自定义连接的密钥并刷新浏览器后，菜单与列出工具的就绪状态一致 | 是 | 独立 |
| [enhanced-review-visuals.e2e.ts](<../e2e/enhanced-review-visuals.e2e.ts>) | 补拍的评审截图：工具行的真实结果、展开的远程服务说明、在 GUI 打开 Exa 前后同一会话的菜单、有无预检问题的首次启用提示（宽度 / 主题 / 语言矩阵） | 是 | 每例独立 |
| [enhanced-write-race.e2e.ts](<../e2e/enhanced-write-race.e2e.ts>) | 同一轮里跨节的连续写入都保存且没有警告；本页读到 revision 之后的外部修改仍被拒 | 是 | 每例独立 |
| [subagent-selection.e2e.ts](<../e2e/subagent-selection.e2e.ts>) | 回环模型让父 Agent 经 preset 的 `subagent` / `subagent_fork` 建两个子会话；在 Web 打开子会话，不在运行与运行中都经菜单改两侧连接，下一步（或父 Agent 用 `send_message` 再叫起时）请求发往新连接，模型记忆保持为空；Web 的分叉会话照常写两侧的模型记忆 | 是 | 独立 |
| [setup-commands.e2e.ts](<../e2e/setup-commands.e2e.ts>) | 真实 Host 的 `CommandRuntime`：两个命令的说明与参数提示、不带参数的显示、`off` / 连接 id（含大写的 `custom:MyEngine`）/ 三档实时性的写入与 Remote `get` 一致；用法、不可选与实时性不适用的拒绝不改选择；设置无效的固定措辞；插件行停用时命令消失，ui 行停用时照常 | 否 | 套件 |
| [setup-commands-ui.e2e.ts](<../e2e/setup-commands-ui.e2e.ts>) | 先跑一轮回环对话再在 Web 打开会话：斜杠菜单行与原来的选择框（截图）；带参数执行后命令卡显示输出、菜单与按钮反映新选择；展开命令卡看到路由警告；ui 行停用时选择框与带参数执行照常；插件行停用时命令与选择框一起消失。记录请求与 WebSocket 帧作证据 | 是 | 独立 |
| [tui-completion.e2e.ts](<../e2e/tui-completion.e2e.ts>) | 已安装的 dsh-TUI（根 devDependency）与本 bundle：Web profile 叠入 TUI bundle、经 `bootHost` 检查真实 `tuiCommandTrees` 里两棵补全树与 Host 命令输出；独立的 TUI profile（dsh-base → dsh-tui → 本 bundle）里经真实 PTY 启动正式 `dsh-tui` 入口，Tab 补全插入原样的 `custom:MyEngine` 并执行，另一次不带参数执行看到连接列表与路由行 | 否（PTY） | 独立 |

当前 e2e 基线为 27 个文件、175 个测试（最终 `pnpm run test:e2e`）。

## 测试清单

当前测试基线为 **105 个文件、2236 个测试**（最终 `pnpm run check`，不含 e2e）；逐包数量如下，参数化用例按实际展开计数。每行对应一个测试文件；tests/fixtures/ 下的辅助模块不计入。

| 包 | 测试文件 | 通过测试 |
| --- | ---: | ---: |
| core | 37 | 637 |
| search-enhanced | 30 | 816 |
| fetch-enhanced | 30 | 689 |
| ui | 7 | 86 |
| profile | 1 | 8 |

core 的测试夹具：[fixtures/enhanced.ts](<../packages/core/tests/fixtures/enhanced.ts>)（`inertEnhanced`：开关不打开的测试里，一旦构建或列出工具就报错）、[fixtures/web-settings.ts](<../packages/core/tests/fixtures/web-settings.ts>)（在一次性 profile 上挂真实的 Settings 与 `WebRuntime`）、[fixtures/shipped-preset.ts](<../packages/core/tests/fixtures/shipped-preset.ts>)（注册 DSH 自带的 standard / minimal / PTC Web preset，挂 PTC 运行时）、[fixtures/settings.ts](<../packages/core/tests/fixtures/settings.ts>)、[fixtures/client-command-ui.ts](<../packages/core/tests/fixtures/client-command-ui.ts>)（`commandUiHarness`：在 vm 里按模块加载器协议执行发布的 `dsh-client-ui-commands` 客户端 bundle，得到真实的 `CommandUiRuntime`；只按结构伪造它消费的 `/` 输入源、会话层与 `remote.commands`，`execute` 跑测试给的 Host 处理；两侧 `client-apply` 用它）。

### core 测试

| 文件 | 覆盖要点 |
| --- | --- |
| [adapter.spec.ts](<../packages/core/tests/adapter.spec.ts>) | 真实 HTTP 边界上的鉴权、keyless、期限、取消与 wire 映射；凭据解析器的任何异常在边界上固定化。 |
| [client-capability.spec.ts](<../packages/core/tests/client-capability.spec.ts>) | 能力无关 store、命令 decoration（只有 `name`、`available`、`ui`）、路由与凭据状态。 |
| [client-catalog.spec.ts](<../packages/core/tests/client-catalog.spec.ts>) | 目录派生字段、连接表单、凭据引用与端点信任。 |
| [client-document.spec.ts](<../packages/core/tests/client-document.spec.ts>) | 原始层合并、候选验证与版本写回。 |
| [client-fields.spec.ts](<../packages/core/tests/client-fields.spec.ts>) | 整数、URL、列表文本与互斥字段。 |
| [client-migration.spec.tsx](<../packages/core/tests/client-migration.spec.tsx>) | 未来迁移的写回、revision 与失败状态。 |
| [client-optin.spec.tsx](<../packages/core/tests/client-optin.spec.tsx>) | 服务开关在分层设置上的显示与稀疏写入矩阵、“未启用”与缺省停用说明；“增强工具”一节（同意语句、可访问组、写入）；菜单事实 `remoteServicesOff`；页面内连续写入的排队、外部修改被拒、keyless 切换按当下的快照保留参数。 |
| [client-selection-types.spec.ts](<../packages/core/tests/client-selection-types.spec.ts>) | 无会话选项能力的类型与 UI 接口兼容。 |
| [client-selection.spec.ts](<../packages/core/tests/client-selection.spec.ts>) | 读取失败分类、缓存保留与恢复；`invalidateSession` 只重读该会话（在途的旧读不显示、没有观察者时等下次加载、从未读过的不读）。 |
| [client-settings.spec.tsx](<../packages/core/tests/client-settings.spec.tsx>) | 共享设置组件、目录服务与自定义连接交互；真实校验与 revision 下的互斥列表原子恢复；多行标签单行显示。 |
| [enhanced-parts.spec.ts](<../packages/core/tests/enhanced-parts.spec.ts>) | 就绪子句（含读不到时）、拒绝措辞（unknown 才补“之后启用的 provider 只在新对话可用”）、换 provider 提示的位置与补句号、参数检查、一次显式执行；列出的规范值与文本（design 的例子逐行对照）。 |
| [explicit.spec.ts](<../packages/core/tests/explicit.spec.ts>) | 显式入口的每种拒绝与检查顺序、目标按当前设置重建、不写选择与记忆、身份隔离、列出的异常边界与取消、对话列表的继承与恢复、`ReadyProviders`；对话列表记录读不出时原生计划照常。 |
| [client-sparse.spec.ts](<../packages/core/tests/client-sparse.spec.ts>) | 稀疏写入、版本标记与 Reset。 |
| [host-command.spec.ts](<../packages/core/tests/host-command.spec.ts>) | 两侧真实插件行加真实 `CommandRuntime`：说明与参数提示的原文、插件行停用后命令与补全注销；fetch 与 search 不带参数的全文（状态、`current`、`applies freshness`、接收方、末行，会话模型的 `needs DeepSeek sign-in`）；四种来源、所选连接被停用；`off` / 连接 id / 实时性的写入与修订号、写入同一连接、模型记忆（子 Agent 会话不写，seeded 与否）；用法、实时性值、不可选的拒绝（控制字符、换行、代理对与 64 字符截断）；关键字不区分大小写、连接 id 区分；路由在别处或未指定时的附加行；设置无效与存储写入失败的措辞；按结构实现的补全注册表：条目、大写 id 原样、设置变化后更新、设置无效时只剩固定项、没有注册表时命令照常。 |
| [host-command-boundary.spec.ts](<../packages/core/tests/host-command-boundary.spec.ts>) | 直接 `installCapability`（search 能力）：没有 Settings 服务时的 `unknown` 路由行；补全注册抛错不影响命令；没有启用的连接与默认连接停用时的显示；deferred 卡住显示时的修订号冲突保留先到的写入；写入后 Remote `get` 与下一个请求步的计划反映新选择、当前步不变；存储写入失败与意外异常（含 `WebError`）的固定措辞，原始异常只进日志。 |
| [mcp.spec.ts](<../packages/core/tests/mcp.spec.ts>) | MCP JSON / SSE、分块边界、大小限制与错误去敏。 |
| [native.spec.ts](<../packages/core/tests/native.spec.ts>) | 共享原生鉴权、错误改写与成功内容处理。 |
| [nested-remote.spec.ts](<../packages/core/tests/nested-remote.spec.ts>) | 运行时服务、插件行与传输各在非根 fiber 下（同 DSH loader）时，两侧 Remote 的 `get` / `set` 照常读写、Host 日志没有未注入服务的访问错误。 |
| [plans.spec.ts](<../packages/core/tests/plans.spec.ts>) | 请求步冻结与当前连接复查。 |
| [providers-fetch.spec.ts](<../packages/core/tests/providers-fetch.spec.ts>) | 抓取 outcome、目标状态与服务失败说明。 |
| [providers-search.spec.ts](<../packages/core/tests/providers-search.spec.ts>) | 搜索 API 错误信封与说明边界。 |
| [redaction.spec.ts](<../packages/core/tests/redaction.spec.ts>) | 凭据检测、成功内容替换与安全诊断副本。 |
| [remote.spec.ts](<../packages/core/tests/remote.spec.ts>) | Remote 契约错误、存储异常与固定内部错误；运行中的 spawn / subagent_fork 子 Agent 可读（含继承）可写、不写模型记忆；真实 JSONL 的冷子会话读写不恢复 Agent、恢复后保持所选，没有记录时取默认或继承、不查模型记忆，并发写入只拒一个过期修订号；普通冷会话（含用户 fork）经真实 controller 恢复并写记忆；会话不存在时保留 controller 的 not-found；没有 `sessionPersistence` 时回到 controller。 |
| [restriction.spec.ts](<../packages/core/tests/restriction.spec.ts>) | 原生工具遮罩：路由返回、选择变化与卸载；子 Agent 会话写为关闭后立即隐藏；排队中的冷写入提交时目标已恢复，按恢复后的 Agent 同步、旧的捕获不覆盖，不写记忆。 |
| [row-visibility.spec.ts](<../packages/core/tests/row-visibility.spec.ts>) | 真实 Settings 行上的开关与 `web` 路由变化；真实 `sessionController` 建立的对话、空记录、JSONL 恢复的新建判断与子会话继承。 |
| [selectable.spec.ts](<../packages/core/tests/selectable.spec.ts>) | 各连接类型的可选择条件。 |
| [session-origin.spec.ts](<../packages/core/tests/session-origin.spec.ts>) | `sessionOrigin` 覆盖会话头公开字段的 8 种组合；选择继承、对话列表复制与新建判断经真实接缝与改用前的公式逐一对照。 |
| [sessions.spec.ts](<../packages/core/tests/sessions.spec.ts>) | 空选项能力与安装间存储隔离。 |
| [settings-grammar.spec.ts](<../packages/core/tests/settings-grammar.spec.ts>) | 共享文档语法、未知字段与 adapter / model 连接。 |
| [settings-labels.spec.ts](<../packages/core/tests/settings-labels.spec.ts>) | 标签在解析时单行化，不拒绝、不改写文档。 |
| [settings-migration.spec.ts](<../packages/core/tests/settings-migration.spec.ts>) | 连续迁移与有界文档校验。 |
| [settings-optin.spec.ts](<../packages/core/tests/settings-optin.spec.ts>) | 内置连接按目录 `optIn` 缺省停用、写了的 `disabled` 优先、自定义连接缺省启用、不改写文档。 |
| [snapshots.spec.ts](<../packages/core/tests/snapshots.spec.ts>) | 快照并发共享、失败重试与过期捕获。 |
| [storage.spec.ts](<../packages/core/tests/storage.spec.ts>) | 卸载后排队任务不重开存储；`provider_lists` 加入已有的 version 1 域；对话列表与选择共用每会话队列、只写一次。 |
| [terminal-contract.spec.ts](<../packages/core/tests/terminal-contract.spec.ts>) | `registerTerminal` 在 dsh-tui 真实的 `TuiCommandTreeRuntime` 上：注入子作用域满足它对插件调用方的要求，条目与描述（多行名称单行化）正确；卸载后注销（真实注册表拒绝重复的根，重新挂载成功即证明）。 |
| [transport.spec.ts](<../packages/core/tests/transport.spec.ts>) | 有界上游说明、错误体截断、凭据隐去与诊断。 |
| [visibility.spec.ts](<../packages/core/tests/visibility.spec.ts>) | 可见性控制器的时序（deferred promise）：同步注册与遮罩、世代与操作版本、遗忘与卸载、服务替换后重新注册、成对注册的回滚与恢复；只有对话列表的重读失败时原生选择照常提交。 |

### search-enhanced 测试

| 文件 | 覆盖要点 |
| --- | --- |
| [adapter-result.spec.ts](<../packages/search-enhanced/tests/adapter-result.spec.ts>) | 服务 outcome 到来源、错误与上游说明。 |
| [adapters.spec.ts](<../packages/search-enhanced/tests/adapters.spec.ts>) | wire 请求、keyless 路由与各服务响应解析；OpenAlex 属性名还原文本后的凭据去敏。 |
| [agent.spec.ts](<../packages/search-enhanced/tests/agent.spec.ts>) | 真实 Agent / loop、fork、Off 与 Session 模型切换；standard、minimal 与 PTC preset 上的增强工具表，路由、开关与 Off 变化后的下一次请求，不补建旧对话，子会话继承列表，卸载只撤本侧。 |
| [catalog.spec.ts](<../packages/search-enhanced/tests/catalog.spec.ts>) | 目录顺序、访问事实、freshness 与参数约束。 |
| [client-apply.spec.tsx](<../packages/search-enhanced/tests/client-apply.spec.tsx>) | 浏览器注册、可选 UI 注入、设置页与状态生命周期；在真实 `CommandUiRuntime` 上：选择框挂在同名 Host 命令上（菜单行是 Host 命令的，无参数弹框并经 Remote 写入，带参数交给 Host 命令）、本浏览器执行 Host 命令后只重读该会话并让模型记忆失效、卸载后交还 Host 命令。 |
| [client-command.spec.ts](<../packages/search-enhanced/tests/client-command.spec.ts>) | /setup-search 的 decoration：选项、写入与失败提示。 |
| [client-composition.spec.tsx](<../packages/search-enhanced/tests/client-composition.spec.tsx>) | 真实 UI × search 组合、菜单与命令选择框同步、激活预检。 |
| [client-locales.spec.ts](<../packages/search-enhanced/tests/client-locales.spec.ts>) | 中英文键、插值与状态文案。 |
| [client-route.spec.ts](<../packages/search-enhanced/tests/client-route.spec.ts>) | 浏览器路由观察与环境优先级。 |
| [client-section.spec.tsx](<../packages/search-enhanced/tests/client-section.spec.tsx>) | 搜索 section、选项组与状态通知。 |
| [client-selection.spec.ts](<../packages/search-enhanced/tests/client-selection.spec.ts>) | 共享读取、revision 写入、失效与并发竞态。 |
| [client-settings-model.spec.ts](<../packages/search-enhanced/tests/client-settings-model.spec.ts>) | model 协议分组、参数提示与连接表单事实。 |
| [client-settings.spec.tsx](<../packages/search-enhanced/tests/client-settings.spec.tsx>) | 设置交互、信任、无效文档与 Reset。 |
| [client-sparse.spec.ts](<../packages/search-enhanced/tests/client-sparse.spec.ts>) | 搜索设置的稀疏操作。 |
| [cold-host.spec.ts](<../packages/search-enhanced/tests/cold-host.spec.ts>) | 真实能力生命周期、`WebRuntime`、Remote 与 JSONL：冷的 spawn / subagent_fork 子会话经 Remote 改选择不恢复 Agent、不写记忆；恢复后 `agent/created` 的计划即用新连接，之后每一步按 `agent/request` 重新捕获（同一步内仍冻结）。 |
| [contract.spec.ts](<../packages/search-enhanced/tests/contract.spec.ts>) | Remote schema、视图与严格输入。 |
| [enhanced-credentials.spec.ts](<../packages/search-enhanced/tests/enhanced-credentials.spec.ts>) | 经真实增强工具：adapter 与固定模型的凭据依赖异常（含 `WebError`）不进入结果，真实取消仍为 `WEB_ABORTED`。 |
| [enhanced-listing.spec.ts](<../packages/search-enhanced/tests/enhanced-listing.spec.ts>) | `searchListing`：目录用途、接收方（运维端点取主机名）与按访问方式的实时性。 |
| [enhanced-search.spec.ts](<../packages/search-enhanced/tests/enhanced-search.spec.ts>) | 经真实 `WebRuntime` 与能力执行：按 id 调 adapter、native、固定模型与会话模型，不改会话选择；去敏与上游说明在提示之后；并行两个 provider；列出随设置变化而定义不变；就绪子句（含读不到时）；每个调用 Agent 的身份。 |
| [host.spec.ts](<../packages/search-enhanced/tests/host.spec.ts>) | 真实 Host 的选择、记忆、继承、冻结与恢复；子 Agent 会话的写入从下一请求步生效、不写记忆，顶层与用户 fork 写记忆；没有下一请求模型时会话模型连接为 `no-model`、native 只看 API key。 |
| [mcp.spec.ts](<../packages/search-enhanced/tests/mcp.spec.ts>) | 搜索 MCP 执行与错误边界。 |
| [model-execute.spec.ts](<../packages/search-enhanced/tests/model-execute.spec.ts>) | model 请求、鉴权、回答来源与凭据处理；API key 与账号令牌解析的依赖异常一律固定化。 |
| [model-protocols.spec.ts](<../packages/search-enhanced/tests/model-protocols.spec.ts>) | 模型 URL、协议请求与响应解析。 |
| [model-route.spec.ts](<../packages/search-enhanced/tests/model-route.spec.ts>) | 固定与 Session 路由、DeepSeek 方言与不支持状态。 |
| [native.spec.ts](<../packages/search-enhanced/tests/native.spec.ts>) | 原生鉴权、端点与请求级安全边界。 |
| [plugin.spec.ts](<../packages/search-enhanced/tests/plugin.spec.ts>) | provider 注册、Volatile 设置、公开路由与卸载。 |
| [selections.spec.ts](<../packages/search-enhanced/tests/selections.spec.ts>) | 连接选择与请求步快照的执行组合。 |
| [settings.spec.ts](<../packages/search-enhanced/tests/settings.spec.ts>) | 文档、原生参数、adapter 与 model 连接解析。 |
| [tools-search.spec.ts](<../packages/search-enhanced/tests/tools-search.spec.ts>) | 定义与 design 原文、超时与并行安全；参数错误（与 tool-web 原消息对照）；多查询并发、先截再合并、首个失败；与真实 tool-web `web_search` 的逐字节对照；列出工具。 |
| [transport.spec.ts](<../packages/search-enhanced/tests/transport.spec.ts>) | 传输期限、大小、取消与错误处理。 |

### fetch-enhanced 测试

| 文件 | 覆盖要点 |
| --- | --- |
| [adapter-exa.spec.ts](<../packages/fetch-enhanced/tests/adapter-exa.spec.ts>) | Exa REST / MCP 抓取 wire 与页解析。 |
| [adapter-firecrawl.spec.ts](<../packages/fetch-enhanced/tests/adapter-firecrawl.spec.ts>) | Firecrawl 请求、信封与目标状态。 |
| [adapter-tavily.spec.ts](<../packages/fetch-enhanced/tests/adapter-tavily.spec.ts>) | Tavily 请求、抽取结果与逐 URL 失败。 |
| [adapter-tinyfish.spec.ts](<../packages/fetch-enhanced/tests/adapter-tinyfish.spec.ts>) | Tinyfish 请求、页结果、状态与大小边界。 |
| [agent.spec.ts](<../packages/fetch-enhanced/tests/agent.spec.ts>) | 真实 loop 的 Off、fork 与本地提示刷新；与 search 相同的增强工具表与可见性用例。 |
| [catalog.spec.ts](<../packages/fetch-enhanced/tests/catalog.spec.ts>) | 目录、原生默认值与空选项契约。 |
| [client-allowlist-lines.spec.ts](<../packages/fetch-enhanced/tests/client-allowlist-lines.spec.ts>) | 物理行诊断、警告、替换与追加。 |
| [client-allowlist.spec.tsx](<../packages/fetch-enhanced/tests/client-allowlist.spec.tsx>) | allowlist 草稿、显式保存、修复与冲突状态。 |
| [client-apply.spec.tsx](<../packages/fetch-enhanced/tests/client-apply.spec.tsx>) | 浏览器注册、可选 UI、设置页与注入；与 search 相同的 decoration、Host 命令执行后重读与卸载用例。 |
| [client-command.spec.ts](<../packages/fetch-enhanced/tests/client-command.spec.ts>) | /setup-fetch 的 decoration：选择、写入与提示。 |
| [client-locales.spec.ts](<../packages/fetch-enhanced/tests/client-locales.spec.ts>) | 中英文键、连接状态与服务说明。 |
| [client-route.spec.ts](<../packages/fetch-enhanced/tests/client-route.spec.ts>) | 路由观察与环境值。 |
| [client-selection.spec.ts](<../packages/fetch-enhanced/tests/client-selection.spec.ts>) | 选择缓存、revision 与并发失效。 |
| [client-settings.spec.tsx](<../packages/fetch-enhanced/tests/client-settings.spec.tsx>) | 本地与远程设置、信任、无效文档与 Reset。 |
| [composition.spec.ts](<../packages/fetch-enhanced/tests/composition.spec.ts>) | 远程 / 本地切换、实时设置与 keyless 目录端点。 |
| [enhanced-credentials.spec.ts](<../packages/fetch-enhanced/tests/enhanced-credentials.spec.ts>) | 经真实增强工具：adapter 凭据依赖异常不进入结果，真实取消仍为 `WEB_ABORTED`。 |
| [enhanced-fetch.spec.ts](<../packages/fetch-enhanced/tests/enhanced-fetch.spec.ts>) | 经真实 `WebRuntime` 与能力执行：按 id 调 local、远程 adapter 与 native，不改会话选择；提示不加在 local 的 URL 无效与白名单拒绝上（远程服务的拒绝仍加）；并行；列出的接收方与 `this provider` 白名单说明。 |
| [enhanced-listing.spec.ts](<../packages/fetch-enhanced/tests/enhanced-listing.spec.ts>) | `fetchListing`：接收方（运维端点取主机名）与 local 的白名单说明。 |
| [host.spec.ts](<../packages/fetch-enhanced/tests/host.spec.ts>) | 真实 Host 的选择、记忆、继承、快照与恢复；子 Agent 会话的写入从下一请求步生效、不写记忆，顶层与用户 fork 写记忆；没有下一请求模型时只按 API key 判断就绪。 |
| [local-provider.spec.ts](<../packages/fetch-enhanced/tests/local-provider.spec.ts>) | 官方 HTTP transport 上的本地授权、取消与限制；自有错误前缀与上游错误原样透传。 |
| [native.spec.ts](<../packages/fetch-enhanced/tests/native.spec.ts>) | 原生鉴权、端点与请求级安全边界。 |
| [plugin.spec.ts](<../packages/fetch-enhanced/tests/plugin.spec.ts>) | provider 注册、设置行、公开路由与卸载。 |
| [prompt.spec.ts](<../packages/fetch-enhanced/tests/prompt.spec.ts>) | allowlist 提示规范化、去重与有界摘要；主语参数。 |
| [proxy.spec.ts](<../packages/fetch-enhanced/tests/proxy.spec.ts>) | 代理请求、代理解析与 IP literal 拦截。 |
| [remote-execute.spec.ts](<../packages/fetch-enhanced/tests/remote-execute.spec.ts>) | 远程传输、MCP、凭据（解析器异常固定化、调用方取消优先）、重定向与 deadline。 |
| [remote-page.spec.ts](<../packages/fetch-enhanced/tests/remote-page.spec.ts>) | 页状态、文本截断、失败码与上游说明。 |
| [resolver.spec.ts](<../packages/fetch-enhanced/tests/resolver.spec.ts>) | 完整 DNS 答案集、NAT64、取消与自有错误前缀。 |
| [rules.spec.ts](<../packages/fetch-enhanced/tests/rules.spec.ts>) | CIDR、hostname、公共地址与例外策略；规则校验错误前缀。 |
| [settings.spec.ts](<../packages/fetch-enhanced/tests/settings.spec.ts>) | 文档（缺省远程停用）、allowlist、原生与自定义连接解析。 |
| [tools-fetch.spec.ts](<../packages/fetch-enhanced/tests/tools-fetch.spec.ts>) | 定义与 design 原文、超时与并行安全；参数错误（与 tool-web 原消息对照）；按调用 Agent 执行一次、提示规则；与真实 tool-web `web_fetch` 的逐字节对照；列出工具。 |

### ui 与 profile 测试

| 文件 | 覆盖要点 |
| --- | --- |
| [ui/client-allowlist-disclosure.spec.tsx](<../packages/ui/tests/client-allowlist-disclosure.spec.tsx>) | 本地 allowlist 在共享界面中的披露。 |
| [ui/client-components.spec.tsx](<../packages/ui/tests/client-components.spec.tsx>) | 按钮与紧凑标记、能力标签与面板、键盘、选择、视口与组合包详情交互；只列启用的连接（保留所选的停用连接）、菜单底部提示；首次启用提示在预检有问题时整段替换。 |
| [ui/client-locales.spec.ts](<../packages/ui/tests/client-locales.spec.ts>) | 中英文键与插值一致性。 |
| [ui/client-pure.spec.ts](<../packages/ui/tests/client-pure.spec.ts>) | 路由、停用状态与升级预检纯函数。 |
| [ui/client-service.spec.ts](<../packages/ui/tests/client-service.spec.ts>) | section / 路由注册、排序与观察生命周期。 |
| [ui/client-settings-appearance.spec.tsx](<../packages/ui/tests/client-settings-appearance.spec.tsx>) | 设置与菜单样式（紧凑信号、面板叠放、底部提示的链接样式）、状态提示与对比度回归。 |
| [ui/plugin.spec.ts](<../packages/ui/tests/plugin.spec.ts>) | 没有能力插件服务时仍可激活。 |
| [profile/profile.spec.ts](<../packages/profile/tests/profile.spec.ts>) | 依赖、身份、真实 include patch 合成与双能力路由。 |

## 构建产物

search、fetch、ui 各输出 Host ESM（`lib/index.js`）与 browser CJS（`lib/client.cjs`，注册到 DSH module loader 的单文件脚本，CSS 随脚本注入）及其 source map；不生成声明文件。产物由构建生成、不纳入 git；发布的文件以各包 manifest 的 `files` 为准（另含 locale、图标与 README）。core 不单独构建（源码内联进使用方），profile 直接发布 patch 与资源。体积用 `ls -l packages/*/lib` 查看；构建与打包检查见[构建与 scripts](#构建与-scripts)。

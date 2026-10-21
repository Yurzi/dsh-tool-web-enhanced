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
| [profile](<../packages/profile/package.json>) | dsh-tool-web-enhanced-profile | 0.1.0 | 导出 patch、locale、icon、package.json；dsh.bundle.patch 指向 patch。 |
| [core](<../packages/core/package.json>) | dsh-tool-web-enhanced-core | 0.0.0 | private；./shared、./host、./client 直接指向源码；无 dsh 字段。 |
| [search-enhanced](<../packages/search-enhanced/package.json>) | dsh-web-search-enhanced | 0.2.0 | 插件导出；dsh.client.platform = web。 |
| [fetch-enhanced](<../packages/fetch-enhanced/package.json>) | dsh-web-fetch-enhanced | 0.2.0 | 插件导出；dsh.client.platform = web。 |
| [ui](<../packages/ui/package.json>) | dsh-tool-web-enhanced-ui | 0.1.0 | 插件导出；dsh.client.platform = web。 |

三个插件共用 exports：`. → ./lib/index.js`、`./client → ./lib/client.cjs`，以及 locale JSON、icon SVG 与 package.json；均为 `sideEffects: false`，没有运行时 dependencies。profile 的 dependencies 是三个公开插件；core 只作为开发依赖参与内联。

各包依赖与 `dsh.client.inject` 以本表的 manifest 为准；peer 的 optional 元数据不等同于 Cordis 的运行时注入要求。

下面的目录树只展示目录层级，文件见各表。

### profile

没有 src、main 或构建脚本：[cordis.patch.yml](<../packages/profile/cordis.patch.yml>) 声明共享 web 路由与插件行的组合 patch，[locale/{en,zh}.json](<../packages/profile/locale/en.json>) 与 [icon.svg](<../packages/profile/icon.svg>) 提供 Plugins 页元数据与图标，另有 package.json、README.md 与 tests/profile.spec.ts。

### core

三个入口分别导出共享文法、Host 机制与浏览器组件工厂；入口的分层理由见[架构 · core 的三个入口](architecture.md#core-的三个入口)。

```text
src/
├── shared/
├── host/
│   └── providers/
└── client/
    └── settings/
```

#### shared 入口

| 模块 | 职责 |
| --- | --- |
| [ids.ts](<../packages/core/src/shared/ids.ts>) | 包、row、provider 身份及 rowConfigKey。 |
| [connections.ts](<../packages/core/src/shared/connections.ts>) | 连接标识、访问方式、目录描述与参数校验。 |
| [settings.ts](<../packages/core/src/shared/settings.ts>) | 版本识别、迁移接口、文档 schema 与 resolveDocument。 |
| [route.ts](<../packages/core/src/shared/route.ts>) | web 路由字段、环境变量名与纯路由判断。 |
| [url.ts](<../packages/core/src/shared/url.ts>) · [search.ts](<../packages/core/src/shared/search.ts>) | 端点与来源 URL 校验；FRESHNESS 与 Freshness 类型。 |
| [selection.ts](<../packages/core/src/shared/selection.ts>) | 连接视图、会话选择、模型记忆与 Remote 契约。 |

#### host 入口

| 模块 | 职责 |
| --- | --- |
| [capability.ts](<../packages/core/src/host/capability.ts>) · [runtime.ts](<../packages/core/src/host/runtime.ts>) | 能力参数、选项 codec 与调用上下文类型；installCapability 连接会话选择、计划、Remote 与 provider 注册。 |
| [sessions.ts](<../packages/core/src/host/sessions.ts>) · [plans.ts](<../packages/core/src/host/plans.ts>) | 会话选择解析（fork 继承、revision、模型记忆）；请求步快照（Snapshots）与选择计划。 |
| [selectable.ts](<../packages/core/src/host/selectable.ts>) · [restriction.ts](<../packages/core/src/host/restriction.ts>) | 连接是否存在且启用；Agent 工具限制及路由变化后的重算。 |
| [storage.ts](<../packages/core/src/host/storage.ts>) · [pairings.ts](<../packages/core/src/host/pairings.ts>) | 选择 storage domain 及生命周期内存取；模型与连接的配对记录。 |
| [model.ts](<../packages/core/src/host/model.ts>) · [route.ts](<../packages/core/src/host/route.ts>) | 下一模型与当前请求模型身份；公开设置与环境中的 Host 路由事实。 |
| [settings-row.ts](<../packages/core/src/host/settings-row.ts>) · [remote.ts](<../packages/core/src/host/remote.ts>) | Volatile 设置行、候选文档校验与无效设置报告；连接 Remote 服务及服务端异常隔离。 |
| [credentials.ts](<../packages/core/src/host/credentials.ts>) | API key、路由 key（无 Credentials 服务时回退启动环境）、账号 token 与就绪状态。 |
| [errors.ts](<../packages/core/src/host/errors.ts>) · [native.ts](<../packages/core/src/host/native.ts>) | 能力错误类型、取消与错误工厂；包装 DSH 原生 provider 并重述错误。 |
| [transport.ts](<../packages/core/src/host/transport.ts>) · [mcp.ts](<../packages/core/src/host/mcp.ts>) | 有界 HTTP 读写、统一期限与上游说明；一次工具调用内的 MCP 握手与 JSON / SSE 解析。 |
| [adapter.ts](<../packages/core/src/host/adapter.ts>) | AdapterWire、目标、鉴权、mapWire 与 runAdapter。 |
| [redaction.ts](<../packages/core/src/host/redaction.ts>) | 检测本次请求凭据，生成成功内容与诊断的脱敏副本。 |
| [providers/search.ts](<../packages/core/src/host/providers/search.ts>) · [fetch.ts](<../packages/core/src/host/providers/fetch.ts>) | SearchInput / SearchOutcome 与行解析辅助；FetchInput / PageOutcome 与目标状态映射。 |
| providers/[exa](<../packages/core/src/host/providers/exa.ts>)、[firecrawl](<../packages/core/src/host/providers/firecrawl.ts>)、[tavily](<../packages/core/src/host/providers/tavily.ts>)、[tinyfish](<../packages/core/src/host/providers/tinyfish.ts>) | 各导出 `<service>Search` 与 `<service>Fetch` wire。 |
| providers/[openalex](<../packages/core/src/host/providers/openalex.ts>)、[semanticscholar](<../packages/core/src/host/providers/semanticscholar.ts>) | 只有搜索 wire：学术摘要字段与论文来源映射。 |
| [providers/tool-rows.ts](<../packages/core/src/host/providers/tool-rows.ts>) | MCP 搜索工具共用的结构化与文本行格式解析。 |

#### client 入口

| 模块 | 职责 |
| --- | --- |
| [section.ts](<../packages/core/src/client/section.ts>) | ConnectionSection、路由源、选择 store 与 WebConnectionsService 接口。 |
| [selection.ts](<../packages/core/src/client/selection.ts>) · [command.ts](<../packages/core/src/client/command.ts>) | ConnectionSelectionStore：共享缓存、revision 写入与失效重读；能力无关的选择命令 selectionCommand。 |
| [route.ts](<../packages/core/src/client/route.ts>) · [pairings.ts](<../packages/core/src/client/pairings.ts>) · [credentials.ts](<../packages/core/src/client/credentials.ts>) | 状态观察器：合并浏览器 web 设置与 Host provider 事实；按观察生命周期加载模型记忆；凭据配置状态（不读值）。 |
| [use-observable.ts](<../packages/core/src/client/use-observable.ts>) | 经 useSyncExternalStore 订阅稳定的 observable。 |
| settings/[model.ts](<../packages/core/src/client/settings/model.ts>) · [fields.ts](<../packages/core/src/client/settings/fields.ts>) · [connection-form.ts](<../packages/core/src/client/settings/connection-form.ts>) | 从目录推导连接名、凭据引用、参数字段与协议分组；编辑文本转换与标量 / 列表 / 互斥校验；自定义 adapter / model 连接草稿。 |
| settings/[document.ts](<../packages/core/src/client/settings/document.ts>) · [sparse.ts](<../packages/core/src/client/settings/sparse.ts>) | 可编辑文档视图、写入候选验证与迁移写回；相对继承层的稀疏写入与 Reset 操作。 |
| settings/[secret-diagnostics.ts](<../packages/core/src/client/settings/secret-diagnostics.ts>) · [injected.ts](<../packages/core/src/client/settings/injected.ts>) | 把公开 secret-presence 诊断加入设置快照；设置页注入的表单、状态与写入接口。 |
| settings/[parts.tsx](<../packages/core/src/client/settings/parts.tsx>) | 设置区块、输入部件与写入状态基础组件。 |
| settings/[ServicesSection](<../packages/core/src/client/settings/ServicesSection.tsx>) · [ServiceFields](<../packages/core/src/client/settings/ServiceFields.tsx>) | 按目录生成内置服务列表并挂载能力自有编辑器；内置连接的 credentialRef、端点与信任控件。 |
| settings/[CustomConnections](<../packages/core/src/client/settings/CustomConnections.tsx>) · [ConnectionEditor](<../packages/core/src/client/settings/ConnectionEditor.tsx>) | 自定义连接列表与增删改；连接格式、端点、信任与参数表单。 |
| settings/[CredentialEditor](<../packages/core/src/client/settings/CredentialEditor.tsx>) · [OptionsEditor](<../packages/core/src/client/settings/OptionsEditor.tsx>) · [DefaultsSection](<../packages/core/src/client/settings/DefaultsSection.tsx>) | 写入 DSH Credentials 的凭据编辑器；参数字段及其自保存表单；默认连接与能力自有默认控件。 |
| settings/[PairingsSection](<../packages/core/src/client/settings/PairingsSection.tsx>) · [ResetSection](<../packages/core/src/client/settings/ResetSection.tsx>) · [RouteNotice](<../packages/core/src/client/settings/RouteNotice.tsx>) | 模型记忆列表与忘记；重置确认；路由状态提示。 |

### search-enhanced

保留搜索目录、结果转换、原生后端、model 后端与能力绑定。Host 入口导出 `name`、`inject`、`Config`、`apply`、`resolveSettings` 及 `SearchSettings` / `ResolvedSettings` 等类型；browser 入口导出 `inject`、`apply`。

```text
src/
├── backends/
├── host/
├── model/
├── search/
│   └── adapters/
├── settings/
└── client/
    └── settings/
```

| 模块 | 职责 |
| --- | --- |
| [index.ts](<../packages/search-enhanced/src/index.ts>) · [seat.ts](<../packages/search-enhanced/src/seat.ts>) | 插件入口与设置行，安装搜索能力；交给 ctx.web 的搜索 provider 适配座。 |
| [catalog.ts](<../packages/search-enhanced/src/catalog.ts>) · [contract.ts](<../packages/search-enhanced/src/contract.ts>) | 搜索目录、参数规则与 MODEL_PROTOCOLS；searchConnections Remote 与搜索选项 schema。 |
| settings/[resolve](<../packages/search-enhanced/src/settings/resolve.ts>) · [types](<../packages/search-enhanced/src/settings/types.ts>) · [retired](<../packages/search-enhanced/src/settings/retired.ts>) · [version](<../packages/search-enhanced/src/settings/version.ts>) | 把共享文法结果转为搜索连接类型；设置文档与别名；只供诊断与 Reset 的退役字段；重导出共享版本常量。 |
| [host/runtime.ts](<../packages/search-enhanced/src/host/runtime.ts>) | searchCapability、执行目标解析与 installSearch。 |
| host/[connections](<../packages/search-enhanced/src/host/connections.ts>) · [options](<../packages/search-enhanced/src/host/options.ts>) · [remote](<../packages/search-enhanced/src/host/remote.ts>) | 浏览器可显示的连接就绪事实；搜索会话选项 codec；Remote 服务类型与 Context 扩展。 |
| backends/[native](<../packages/search-enhanced/src/backends/native.ts>) · [common](<../packages/search-enhanced/src/backends/common.ts>) | 按目录键创建原生后端；原生鉴权、结果标准化与错误措辞。 |
| backends/[deepseek-messages](<../packages/search-enhanced/src/backends/deepseek-messages.ts>) · [deepseek-search-api](<../packages/search-enhanced/src/backends/deepseek-search-api.ts>) | 实例化 DSH 的 Messages 搜索 provider；实例化 Search API provider 并提供当前用户问题。 |
| search/adapters/[index](<../packages/search-enhanced/src/search/adapters/index.ts>) · [types](<../packages/search-enhanced/src/search/adapters/types.ts>) | 把 core 服务 wire 与 searchSources 绑定成 ADAPTER_WIRES；按目录约束 adapter 与 keyless wire 类型。 |
| search/[adapter-result](<../packages/search-enhanced/src/search/adapter-result.ts>) · [sources](<../packages/search-enhanced/src/search/sources.ts>) | 服务 outcome 转搜索来源或搜索错误；来源与日期的验证、去重与标准化。 |
| search/[execute](<../packages/search-enhanced/src/search/execute.ts>) · [http](<../packages/search-enhanced/src/search/http.ts>) · [errors](<../packages/search-enhanced/src/search/errors.ts>) | 调度 adapter / model 执行并组装结果；HTTP / MCP 传输参数与消息；搜索错误与凭据提示。 |
| model/[types](<../packages/search-enhanced/src/model/types.ts>) · [bounds](<../packages/search-enhanced/src/model/bounds.ts>) | 模型路由、鉴权与支持状态类型；跨命名空间读取的路由字段约束。 |
| model/[route](<../packages/search-enhanced/src/model/route.ts>) · [deepseek](<../packages/search-enhanced/src/model/deepseek.ts>) | 从固定连接或 Session 公共路由重建执行目标；集中推导 DeepSeek 路由与 Messages 方言。 |
| model/[protocols](<../packages/search-enhanced/src/model/protocols.ts>) · [execute](<../packages/search-enhanced/src/model/execute.ts>) | 协议请求生成与回答、来源解析；解析本次鉴权并执行有界请求。 |
| client/[index.tsx](<../packages/search-enhanced/src/client/index.tsx>) · [section](<../packages/search-enhanced/src/client/section.ts>) · [command](<../packages/search-enhanced/src/client/command.ts>) | 安装浏览器面、设置注入、命令与可选 UI section；搜索选择与 freshness 的菜单 section；/setup-search 与 freshness 选项。 |
| client/[connections](<../packages/search-enhanced/src/client/connections.ts>) · [credentials](<../packages/search-enhanced/src/client/credentials.ts>) · [locales](<../packages/search-enhanced/src/client/locales.ts>) | 连接、状态、来源与写入结果文案；凭据引用与共享状态观察器；中英文词典。 |
| client/[selection](<../packages/search-enhanced/src/client/selection.ts>) · [route](<../packages/search-enhanced/src/client/route.ts>) · [pairings](<../packages/search-enhanced/src/client/pairings.ts>) · [injected](<../packages/search-enhanced/src/client/injected.ts>) | 把 core 的选择 store、路由状态、模型记忆绑定到搜索 Remote 与字段；设置页注入类型。 |
| client/settings/[SettingsPage](<../packages/search-enhanced/src/client/settings/SettingsPage.tsx>) · [model](<../packages/search-enhanced/src/client/settings/model.ts>) | 组合设置页、文档诊断与 Reset；把目录与 model 协议转为设置页事实和文案。 |

其余设置模块是 core 工厂的搜索绑定：[CredentialEditor](<../packages/search-enhanced/src/client/settings/CredentialEditor.tsx>)、[CustomConnections](<../packages/search-enhanced/src/client/settings/CustomConnections.tsx>)、[DefaultsSection](<../packages/search-enhanced/src/client/settings/DefaultsSection.tsx>)、[OptionsEditor](<../packages/search-enhanced/src/client/settings/OptionsEditor.tsx>)、[PairingsSection](<../packages/search-enhanced/src/client/settings/PairingsSection.tsx>)、[ServicesSection](<../packages/search-enhanced/src/client/settings/ServicesSection.tsx>)、[parts](<../packages/search-enhanced/src/client/settings/parts.tsx>)、[sparse](<../packages/search-enhanced/src/client/settings/sparse.ts>)；CSS Modules 与声明文件提供局部样式和导入类型。

### fetch-enhanced

保留本地地址策略、远程页结果转换与抓取能力绑定。入口导出与搜索同形，设置类型为 `FetchSettings` / `ResolvedSettings`。

```text
src/
├── backends/
├── host/
├── local/
├── remote/
│   └── adapters/
├── settings/
└── client/
    └── settings/
```

| 模块 | 职责 |
| --- | --- |
| [index.ts](<../packages/fetch-enhanced/src/index.ts>) · [prompt.ts](<../packages/fetch-enhanced/src/prompt.ts>) | 插件入口与设置行，安装抓取能力与提示；生成并注册当前请求步的本地 allowlist 提示。 |
| [catalog.ts](<../packages/fetch-enhanced/src/catalog.ts>) · [contract.ts](<../packages/fetch-enhanced/src/contract.ts>) | 抓取目录、本地默认值与参数规则；fetchConnections Remote 与空会话选项 schema。 |
| settings/[resolve](<../packages/fetch-enhanced/src/settings/resolve.ts>) · [types](<../packages/fetch-enhanced/src/settings/types.ts>) · [retired](<../packages/fetch-enhanced/src/settings/retired.ts>) · [version](<../packages/fetch-enhanced/src/settings/version.ts>) | 解析抓取连接并校验 allowlist；本地、原生、adapter 连接与设置类型；退役字段；重导出版本常量。 |
| [host/runtime.ts](<../packages/fetch-enhanced/src/host/runtime.ts>) | fetchCapability、目标构建与 installFetch。 |
| host/[connections](<../packages/fetch-enhanced/src/host/connections.ts>) · [options](<../packages/fetch-enhanced/src/host/options.ts>) · [remote](<../packages/fetch-enhanced/src/host/remote.ts>) | 本地与远程连接的显示事实；无会话参数的选项 codec；Remote 服务类型与 Context 扩展。 |
| local/[rules](<../packages/fetch-enhanced/src/local/rules.ts>) · [address-policy](<../packages/fetch-enhanced/src/local/address-policy.ts>) | CIDR、hostname 规则的解析、规范化与逐条诊断；地址是否公共可达或满足操作员例外。 |
| local/[resolver](<../packages/fetch-enhanced/src/local/resolver.ts>) · [backend](<../packages/fetch-enhanced/src/local/backend.ts>) | 完整验证 DNS 答案集与 NAT64 目标；向 DSH HttpFetchProvider 注入当前策略与 resolver。 |
| backends/[native](<../packages/fetch-enhanced/src/backends/native.ts>) · [common](<../packages/fetch-enhanced/src/backends/common.ts>) · [deepseek-fetch-api](<../packages/fetch-enhanced/src/backends/deepseek-fetch-api.ts>) | 创建原生抓取后端；原生鉴权、错误改写与 Host 诊断；实例化 DSH DeepSeek Fetch API provider。 |
| remote/[adapters/index](<../packages/fetch-enhanced/src/remote/adapters/index.ts>) · [types](<../packages/fetch-enhanced/src/remote/types.ts>) | 把 core 抓取 wire 绑定到目录；按目录约束 keyless 类型。 |
| remote/[execute](<../packages/fetch-enhanced/src/remote/execute.ts>) · [http](<../packages/fetch-enhanced/src/remote/http.ts>) · [errors](<../packages/fetch-enhanced/src/remote/errors.ts>) | 构建 adapter 后端并执行；HTTP / MCP 传输参数与消息；抓取能力错误工厂。 |
| [remote/page.ts](<../packages/fetch-enhanced/src/remote/page.ts>) | Page / PageFailure 转 WebFetchResult / WebError。 |
| client/[index.tsx](<../packages/fetch-enhanced/src/client/index.tsx>) · [section](<../packages/fetch-enhanced/src/client/section.ts>) · [command](<../packages/fetch-enhanced/src/client/command.ts>) | 安装浏览器面、设置注入、命令与可选 UI section；抓取连接菜单 section；/setup-fetch。 |
| client/[connections](<../packages/fetch-enhanced/src/client/connections.ts>) · [locales](<../packages/fetch-enhanced/src/client/locales.ts>) | 就绪状态、URL 接收方与选择文案；中英文词典。 |
| client/[selection](<../packages/fetch-enhanced/src/client/selection.ts>) · [route](<../packages/fetch-enhanced/src/client/route.ts>) · [injected](<../packages/fetch-enhanced/src/client/injected.ts>) | 把 core 的选择 store 与路由状态绑定到抓取 Remote 与字段；设置页注入类型。 |
| [client/allowlist-lines.ts](<../packages/fetch-enhanced/src/client/allowlist-lines.ts>) | allowlist 物理行诊断与显式修复操作。 |
| client/settings/[SettingsPage](<../packages/fetch-enhanced/src/client/settings/SettingsPage.tsx>) · [model](<../packages/fetch-enhanced/src/client/settings/model.ts>) | 组合设置页、文档诊断与 Reset；目录转设置页事实与服务说明。 |
| client/settings/[AllowlistEditor](<../packages/fetch-enhanced/src/client/settings/AllowlistEditor.tsx>) · [LocalExtras](<../packages/fetch-enhanced/src/client/settings/LocalExtras.tsx>) | 两组 allowlist 草稿与显式原子保存；挂载本地 allowlist 与 User-Agent 编辑器。 |

其余设置模块是 core 工厂的抓取绑定：[CredentialEditor](<../packages/fetch-enhanced/src/client/settings/CredentialEditor.tsx>)、[CustomConnections](<../packages/fetch-enhanced/src/client/settings/CustomConnections.tsx>)、[DefaultsSection](<../packages/fetch-enhanced/src/client/settings/DefaultsSection.tsx>)、[OptionsEditor](<../packages/fetch-enhanced/src/client/settings/OptionsEditor.tsx>)、[PairingsSection](<../packages/fetch-enhanced/src/client/settings/PairingsSection.tsx>)、[ServicesSection](<../packages/fetch-enhanced/src/client/settings/ServicesSection.tsx>)、[parts](<../packages/fetch-enhanced/src/client/settings/parts.tsx>)、[sparse](<../packages/fetch-enhanced/src/client/settings/sparse.ts>)；CSS Modules 与声明文件提供局部样式和导入类型。

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
| [ComposerConnectionMenu](<../packages/ui/src/client/ComposerConnectionMenu.tsx>) | 连接按钮、分组菜单与选择交互。 |
| [ActivationPrompt](<../packages/ui/src/client/ActivationPrompt.tsx>) · [ProfileDetailSection](<../packages/ui/src/client/ProfileDetailSection.tsx>) | 激活后的只读检查与导航提示；组合包路由状态与升级预检操作。 |
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
| [verify-packages.ts](<../scripts/verify-packages.ts>) | 检查打包后的 manifest 范围、统一 DSH 范围、Host 外部导入、profile 版本锁定与 Plugins 页资源，再运行 publint。 |
| [clean.ts](<../scripts/clean.ts>) | 清理当前包的相对产物目录，拒绝越界路径。 |

[search](<../packages/search-enhanced/tsdown.config.ts>)、[fetch](<../packages/fetch-enhanced/tsdown.config.ts>) 与 [ui](<../packages/ui/tsdown.config.ts>) 的 tsdown.config.ts 都只调用 `pluginBuild(import.meta.url)`；profile 与 core 没有构建任务。

## 端到端目录

环境变量、隔离、运行与排查见[开发流程 · 端到端测试](development.md#端到端测试)。[global-setup.ts](<../e2e/global-setup.ts>) 准备套件的隔离环境、DSH 安装与发布形态包。

| harness | 作用 |
| --- | --- |
| [environment.ts](<../e2e/harness/environment.ts>) | 隔离环境、`dsh` 调用、`addPlugins`、`composedRows`（读 `--dump-config`）。 |
| [host.ts](<../e2e/harness/host.ts>) | 按 CLI 的步骤在进程内启动 Host（`dsh-app-boot` 的公开导出），叠加 `fixtures/host-plane.yml` 去掉 GUI 行，不绑定端口；`prepare` 回调在插件初始化前接入观察者（如日志）。 |
| [web.ts](<../e2e/harness/web.ts>) | 启动 `dsh web`，监听 127.0.0.1 上 OS 分配的空闲端口（从不用 3080），输出写 `web.log`。 |
| [browser.ts](<../e2e/harness/browser.ts>) | 无头 Chromium（Playwright），关闭首次启动的对话框，失败时记录可访问性快照与截图。 |
| [navigation.ts](<../e2e/harness/navigation.ts>)、[theme.ts](<../e2e/harness/theme.ts>)、[model-visuals.ts](<../e2e/harness/model-visuals.ts>) | 经公开界面打开插件页、设置页、新会话、连接菜单与主题设置。 |
| [upgrade.ts](<../e2e/harness/upgrade.ts>) | `upgradeEnvironment()` 独立 home；安装 0.1.x 前身、创建旧会话、执行升级步骤。 |
| [remote-fetch-api.ts](<../e2e/harness/remote-fetch-api.ts>)、[model-api.ts](<../e2e/harness/model-api.ts>)、[http.ts](<../e2e/harness/http.ts>) | 回环假远程服务 / 假模型 API（记录方法、路径、请求头与请求体，回复可替换）与本地抓取目标。 |

| fixtures | 内容 |
| --- | --- |
| [host-plane.yml](<../e2e/fixtures/host-plane.yml>) | 关闭浏览器服务行，保留 Host 所需服务。 |
| [command-defaults.yml](<../e2e/fixtures/command-defaults.yml>) | 命令往返用的免凭据默认搜索连接。 |
| [disable-search.yml](<../e2e/fixtures/disable-search.yml>) / [disable-fetch.yml](<../e2e/fixtures/disable-fetch.yml>) / [disable-ui.yml](<../e2e/fixtures/disable-ui.yml>) | 分别停用搜索、抓取与共享 UI 行。 |
| [fetch-allow-loopback.yml](<../e2e/fixtures/fetch-allow-loopback.yml>) / [fetch-native-route.yml](<../e2e/fixtures/fetch-native-route.yml>) | 显式允许回环的本地连接；把抓取路由切到原生 HTTP。 |
| [upgrade-coexist.yml](<../e2e/fixtures/upgrade-coexist.yml>) / [upgrade-fetch-route.yml](<../e2e/fixtures/upgrade-fetch-route.yml>) | 前代设置与路由的持久化用户层；保留前代配置时让新 provider 接收调用。 |
| [upgrade-legacy-session.ts](<../e2e/fixtures/upgrade-legacy-session.ts>) | 在单独进程中经真实 storage domain 创建旧会话。 |
| [remote-fetch.ts](<../e2e/fixtures/remote-fetch.ts>) / [search-model.ts](<../e2e/fixtures/search-model.ts>) | 自定义抓取连接与 Firecrawl 页响应；固定模型、Session 路由与协议响应。 |

下表“套件”指共用本次运行的隔离 home，“独立”指另用 `upgradeEnvironment` 派生 home，均不是用户的 DSH home。

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
| [ui-row-off.e2e.ts](<../e2e/ui-row-off.e2e.ts>) | 无共享菜单时仍有设置页和 slash 命令 | 是 | 独立 |
| [fetch-remote-ui.e2e.ts](<../e2e/fetch-remote-ui.e2e.ts>) | 远程连接就绪、凭据与自定义端点设置 | 是 | 独立 |
| [search-model-ui.e2e.ts](<../e2e/search-model-ui.e2e.ts>) | model 连接设置、选择持久化与响应式页面 | 是 | 功能组 / 视口独立 |
| [search-model-visuals.e2e.ts](<../e2e/search-model-visuals.e2e.ts>) | 列表参数、互斥冲突恢复持久化、信任及 model 菜单状态 | 是 | 每例独立 |
| [screenshots.e2e.ts](<../e2e/screenshots.e2e.ts>) | 主题、视口、菜单和设置截图矩阵 | 是 | 套件 |
| [review-settings-visuals.e2e.ts](<../e2e/review-settings-visuals.e2e.ts>) | 设置交互与中英文响应式截图 | 是 | 每例独立 |
| [upgrade.e2e.ts](<../e2e/upgrade.e2e.ts>) | 前代安装升级、显式 Reset、旧 Off 与路由修复 | 是 | 独立 |

## 测试清单

当前测试基线为 **84 个文件、1874 个测试**（最终 `pnpm run check`，不含 e2e）；逐包数量如下，参数化用例按实际展开计数。每行对应一个测试文件；tests/fixtures/ 下的辅助模块不计入。

| 包 | 测试文件 | 通过测试 |
| --- | ---: | ---: |
| core | 25 | 411 |
| search-enhanced | 25 | 745 |
| fetch-enhanced | 26 | 636 |
| ui | 7 | 74 |
| profile | 1 | 8 |

### core 测试

| 文件 | 覆盖要点 |
| --- | --- |
| [adapter.spec.ts](<../packages/core/tests/adapter.spec.ts>) | 真实 HTTP 边界上的鉴权、keyless、期限、取消与 wire 映射。 |
| [client-capability.spec.ts](<../packages/core/tests/client-capability.spec.ts>) | 能力无关 store、命令、路由与凭据状态。 |
| [client-catalog.spec.ts](<../packages/core/tests/client-catalog.spec.ts>) | 目录派生字段、连接表单、凭据引用与端点信任。 |
| [client-document.spec.ts](<../packages/core/tests/client-document.spec.ts>) | 原始层合并、候选验证与版本写回。 |
| [client-fields.spec.ts](<../packages/core/tests/client-fields.spec.ts>) | 整数、URL、列表文本与互斥字段。 |
| [client-migration.spec.tsx](<../packages/core/tests/client-migration.spec.tsx>) | 未来迁移的写回、revision 与失败状态。 |
| [client-selection-types.spec.ts](<../packages/core/tests/client-selection-types.spec.ts>) | 无会话选项能力的类型与 UI 接口兼容。 |
| [client-selection.spec.ts](<../packages/core/tests/client-selection.spec.ts>) | 读取失败分类、缓存保留与恢复。 |
| [client-settings.spec.tsx](<../packages/core/tests/client-settings.spec.tsx>) | 共享设置组件、目录服务与自定义连接交互；真实校验与 revision 下的互斥列表原子恢复。 |
| [client-sparse.spec.ts](<../packages/core/tests/client-sparse.spec.ts>) | 稀疏写入、版本标记与 Reset。 |
| [mcp.spec.ts](<../packages/core/tests/mcp.spec.ts>) | MCP JSON / SSE、分块边界、大小限制与错误脱敏。 |
| [native.spec.ts](<../packages/core/tests/native.spec.ts>) | 共享原生鉴权、错误改写与成功内容处理。 |
| [plans.spec.ts](<../packages/core/tests/plans.spec.ts>) | 请求步冻结与当前连接复查。 |
| [providers-fetch.spec.ts](<../packages/core/tests/providers-fetch.spec.ts>) | 抓取 outcome、目标状态与服务失败说明。 |
| [providers-search.spec.ts](<../packages/core/tests/providers-search.spec.ts>) | 搜索 API 错误信封与说明边界。 |
| [redaction.spec.ts](<../packages/core/tests/redaction.spec.ts>) | 凭据检测、成功内容替换与安全诊断副本。 |
| [remote.spec.ts](<../packages/core/tests/remote.spec.ts>) | Remote 契约错误、存储异常与固定内部错误。 |
| [restriction.spec.ts](<../packages/core/tests/restriction.spec.ts>) | 路由返回、选择变化与卸载后的工具限制。 |
| [selectable.spec.ts](<../packages/core/tests/selectable.spec.ts>) | 各连接类型的可选择条件。 |
| [sessions.spec.ts](<../packages/core/tests/sessions.spec.ts>) | 空选项能力与安装间存储隔离。 |
| [settings-grammar.spec.ts](<../packages/core/tests/settings-grammar.spec.ts>) | 共享文档语法、未知字段与 adapter / model 连接。 |
| [settings-migration.spec.ts](<../packages/core/tests/settings-migration.spec.ts>) | 连续迁移与有界文档校验。 |
| [snapshots.spec.ts](<../packages/core/tests/snapshots.spec.ts>) | 快照并发共享、失败重试与过期捕获。 |
| [storage.spec.ts](<../packages/core/tests/storage.spec.ts>) | 卸载后排队任务不重开存储。 |
| [transport.spec.ts](<../packages/core/tests/transport.spec.ts>) | 有界上游说明、错误体截断、凭据隐去与诊断。 |

### search-enhanced 测试

| 文件 | 覆盖要点 |
| --- | --- |
| [adapter-result.spec.ts](<../packages/search-enhanced/tests/adapter-result.spec.ts>) | 服务 outcome 到来源、错误与上游说明。 |
| [adapters.spec.ts](<../packages/search-enhanced/tests/adapters.spec.ts>) | wire 请求、keyless 路由与各服务响应解析；OpenAlex 属性名还原文本后的凭据去敏。 |
| [agent.spec.ts](<../packages/search-enhanced/tests/agent.spec.ts>) | 真实 Agent / loop、fork、Off 与 Session 模型切换。 |
| [catalog.spec.ts](<../packages/search-enhanced/tests/catalog.spec.ts>) | 目录顺序、访问事实、freshness 与参数约束。 |
| [client-apply.spec.tsx](<../packages/search-enhanced/tests/client-apply.spec.tsx>) | 浏览器注册、可选 UI 注入、设置页与状态生命周期。 |
| [client-command.spec.ts](<../packages/search-enhanced/tests/client-command.spec.ts>) | /setup-search 选项、写入与失败提示。 |
| [client-composition.spec.tsx](<../packages/search-enhanced/tests/client-composition.spec.tsx>) | 真实 UI × search 组合、菜单同步与激活预检。 |
| [client-locales.spec.ts](<../packages/search-enhanced/tests/client-locales.spec.ts>) | 中英文键、插值与状态文案。 |
| [client-route.spec.ts](<../packages/search-enhanced/tests/client-route.spec.ts>) | 浏览器路由观察与环境优先级。 |
| [client-section.spec.tsx](<../packages/search-enhanced/tests/client-section.spec.tsx>) | 搜索 section、选项组与状态通知。 |
| [client-selection.spec.ts](<../packages/search-enhanced/tests/client-selection.spec.ts>) | 共享读取、revision 写入、失效与并发竞态。 |
| [client-settings-model.spec.ts](<../packages/search-enhanced/tests/client-settings-model.spec.ts>) | model 协议分组、参数提示与连接表单事实。 |
| [client-settings.spec.tsx](<../packages/search-enhanced/tests/client-settings.spec.tsx>) | 设置交互、信任、无效文档与 Reset。 |
| [client-sparse.spec.ts](<../packages/search-enhanced/tests/client-sparse.spec.ts>) | 搜索设置的稀疏操作。 |
| [contract.spec.ts](<../packages/search-enhanced/tests/contract.spec.ts>) | Remote schema、视图与严格输入。 |
| [host.spec.ts](<../packages/search-enhanced/tests/host.spec.ts>) | 真实 Host 的选择、记忆、继承、冻结与恢复。 |
| [mcp.spec.ts](<../packages/search-enhanced/tests/mcp.spec.ts>) | 搜索 MCP 执行与错误边界。 |
| [model-execute.spec.ts](<../packages/search-enhanced/tests/model-execute.spec.ts>) | model 请求、鉴权、回答来源与凭据处理。 |
| [model-protocols.spec.ts](<../packages/search-enhanced/tests/model-protocols.spec.ts>) | 模型 URL、协议请求与响应解析。 |
| [model-route.spec.ts](<../packages/search-enhanced/tests/model-route.spec.ts>) | 固定与 Session 路由、DeepSeek 方言与不支持状态。 |
| [native.spec.ts](<../packages/search-enhanced/tests/native.spec.ts>) | 原生鉴权、端点与请求级安全边界。 |
| [plugin.spec.ts](<../packages/search-enhanced/tests/plugin.spec.ts>) | provider 注册、Volatile 设置、公开路由与卸载。 |
| [selections.spec.ts](<../packages/search-enhanced/tests/selections.spec.ts>) | 连接选择与请求步快照的执行组合。 |
| [settings.spec.ts](<../packages/search-enhanced/tests/settings.spec.ts>) | 文档、原生参数、adapter 与 model 连接解析。 |
| [transport.spec.ts](<../packages/search-enhanced/tests/transport.spec.ts>) | 传输期限、大小、取消与错误处理。 |

### fetch-enhanced 测试

| 文件 | 覆盖要点 |
| --- | --- |
| [adapter-exa.spec.ts](<../packages/fetch-enhanced/tests/adapter-exa.spec.ts>) | Exa REST / MCP 抓取 wire 与页解析。 |
| [adapter-firecrawl.spec.ts](<../packages/fetch-enhanced/tests/adapter-firecrawl.spec.ts>) | Firecrawl 请求、信封与目标状态。 |
| [adapter-tavily.spec.ts](<../packages/fetch-enhanced/tests/adapter-tavily.spec.ts>) | Tavily 请求、抽取结果与逐 URL 失败。 |
| [adapter-tinyfish.spec.ts](<../packages/fetch-enhanced/tests/adapter-tinyfish.spec.ts>) | Tinyfish 请求、页结果、状态与大小边界。 |
| [agent.spec.ts](<../packages/fetch-enhanced/tests/agent.spec.ts>) | 真实 loop 的 Off、fork 与本地提示刷新。 |
| [catalog.spec.ts](<../packages/fetch-enhanced/tests/catalog.spec.ts>) | 目录、原生默认值与空选项契约。 |
| [client-allowlist-lines.spec.ts](<../packages/fetch-enhanced/tests/client-allowlist-lines.spec.ts>) | 物理行诊断、警告、替换与追加。 |
| [client-allowlist.spec.tsx](<../packages/fetch-enhanced/tests/client-allowlist.spec.tsx>) | allowlist 草稿、显式保存、修复与冲突状态。 |
| [client-apply.spec.tsx](<../packages/fetch-enhanced/tests/client-apply.spec.tsx>) | 浏览器注册、可选 UI、设置页与注入。 |
| [client-command.spec.ts](<../packages/fetch-enhanced/tests/client-command.spec.ts>) | /setup-fetch 选择、写入与提示。 |
| [client-locales.spec.ts](<../packages/fetch-enhanced/tests/client-locales.spec.ts>) | 中英文键、连接状态与服务说明。 |
| [client-route.spec.ts](<../packages/fetch-enhanced/tests/client-route.spec.ts>) | 路由观察与环境值。 |
| [client-selection.spec.ts](<../packages/fetch-enhanced/tests/client-selection.spec.ts>) | 选择缓存、revision 与并发失效。 |
| [client-settings.spec.tsx](<../packages/fetch-enhanced/tests/client-settings.spec.tsx>) | 本地与远程设置、信任、无效文档与 Reset。 |
| [composition.spec.ts](<../packages/fetch-enhanced/tests/composition.spec.ts>) | 远程 / 本地切换、实时设置与 keyless 目录端点。 |
| [host.spec.ts](<../packages/fetch-enhanced/tests/host.spec.ts>) | 真实 Host 的选择、记忆、继承、快照与恢复。 |
| [local-provider.spec.ts](<../packages/fetch-enhanced/tests/local-provider.spec.ts>) | 官方 HTTP transport 上的本地授权、取消与限制；自有错误前缀与上游错误原样透传。 |
| [native.spec.ts](<../packages/fetch-enhanced/tests/native.spec.ts>) | 原生鉴权、端点与请求级安全边界。 |
| [plugin.spec.ts](<../packages/fetch-enhanced/tests/plugin.spec.ts>) | provider 注册、设置行、公开路由与卸载。 |
| [prompt.spec.ts](<../packages/fetch-enhanced/tests/prompt.spec.ts>) | allowlist 提示规范化、去重与有界摘要。 |
| [proxy.spec.ts](<../packages/fetch-enhanced/tests/proxy.spec.ts>) | 代理请求、代理解析与 IP literal 拦截。 |
| [remote-execute.spec.ts](<../packages/fetch-enhanced/tests/remote-execute.spec.ts>) | 远程传输、MCP、凭据、重定向与 deadline。 |
| [remote-page.spec.ts](<../packages/fetch-enhanced/tests/remote-page.spec.ts>) | 页状态、文本截断、失败码与上游说明。 |
| [resolver.spec.ts](<../packages/fetch-enhanced/tests/resolver.spec.ts>) | 完整 DNS 答案集、NAT64、取消与自有错误前缀。 |
| [rules.spec.ts](<../packages/fetch-enhanced/tests/rules.spec.ts>) | CIDR、hostname、公共地址与例外策略；规则校验错误前缀。 |
| [settings.spec.ts](<../packages/fetch-enhanced/tests/settings.spec.ts>) | 文档、allowlist、原生与自定义连接解析。 |

### ui 与 profile 测试

| 文件 | 覆盖要点 |
| --- | --- |
| [ui/client-allowlist-disclosure.spec.tsx](<../packages/ui/tests/client-allowlist-disclosure.spec.tsx>) | 本地 allowlist 在共享界面中的披露。 |
| [ui/client-components.spec.tsx](<../packages/ui/tests/client-components.spec.tsx>) | 菜单、选择、视口与组合包详情交互。 |
| [ui/client-locales.spec.ts](<../packages/ui/tests/client-locales.spec.ts>) | 中英文键与插值一致性。 |
| [ui/client-pure.spec.ts](<../packages/ui/tests/client-pure.spec.ts>) | 路由、停用状态与升级预检纯函数。 |
| [ui/client-service.spec.ts](<../packages/ui/tests/client-service.spec.ts>) | section / 路由注册、排序与观察生命周期。 |
| [ui/client-settings-appearance.spec.tsx](<../packages/ui/tests/client-settings-appearance.spec.tsx>) | 设置样式、状态提示与对比度回归。 |
| [ui/plugin.spec.ts](<../packages/ui/tests/plugin.spec.ts>) | 没有能力插件服务时仍可激活。 |
| [profile/profile.spec.ts](<../packages/profile/tests/profile.spec.ts>) | 依赖、身份、真实 include patch 合成与双能力路由。 |

## 构建产物

search、fetch、ui 各输出 Host ESM（`lib/index.js`）与 browser CJS（`lib/client.cjs`，注册到 DSH module loader 的单文件脚本，CSS 随脚本注入）及其 source map；不生成声明文件。产物由构建生成、不纳入 git；发布的文件以各包 manifest 的 `files` 为准（另含 locale、图标与 README）。core 不单独构建（源码内联进使用方），profile 直接发布 patch 与资源。体积用 `ls -l packages/*/lib` 查看；构建与打包检查见[构建与 scripts](#构建与-scripts)。

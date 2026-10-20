# 架构

本文是 dsh-tool-web-enhanced 的设计文档，面向维护者：说明它在 DeepSeek Harness（DSH）里的位置、包怎么划分、一次 web_search / web_fetch 请求怎么走、后端怎么选与怎么扩展，以及哪些约束不能破坏。文件级的现状结构见 [code-structure.md](code-structure.md)，开发流程见 [development.md](development.md)。

除第 13 节的路线图和标为 **[计划]** 的条目（M4 及以后，尚无代码）外，本文描述的都是当前实现（M0–M3）。选择范式在 core 里只有一份实现，两个插件只提供目录、后端和能力参数。

## 1. 一句话

一个**不含代码的 profile bundle**（`dsh-tool-web-enhanced-profile`）挂载两个插件（`dsh-web-search-enhanced`、`dsh-web-fetch-enhanced`），并在共享的 `web` 行里选中它们注册的 provider（`search-enhanced`、`fetch-enhanced`）。模型继续使用 DSH 原生 tool-web 的 `web_search` / `web_fetch`；两个插件**用同一种选择范式**在 provider 内部切换后端：运维在插件行里定义可用的连接，每个会话从中选一个，选择在每个模型请求步冻结。会话的连接可以用各插件自己的 `/setup-search`、`/setup-fetch` 命令设置，也可以用第三个包 `dsh-tool-web-enhanced-ui` 提供的输入框菜单——两个能力共用一个按钮。

两级选择互不干扰：

| 层级 | 选什么 | 谁写 | 何时变 |
| --- | --- | --- | --- |
| `web` 行 | 由哪个 provider 服务 web_search / web_fetch | profile bundle（安装时一次） | 几乎不变 |
| 插件行设置 | 有哪些连接、默认用哪个、各自的参数与安全策略 | 运维，经插件设置页 | 运行中随时，热生效 |
| 会话选择 | 本会话用哪个连接（或关闭） | 会话的使用者，经输入框菜单或斜杠命令 | 运行中随时，从下一个请求步生效 |

切换后端从不改写 `web` 行，所以不会和其他插件、官方开关或用户层争抢同一个共享行。search 与 fetch 各自一套设置和会话选择，**分别**切换。

## 2. 目标与非目标

v1 目标：

1. 模型面不变：工具名、参数、结果、提示词都是 DSH 原生 tool-web 的；
2. search 与 fetch 各有多个后端，分别切换，且两侧的选择范式、设置结构、Remote 契约和界面一致；
3. 默认行为与原生一致：在**全新、未改过原生行配置**的 profile 上，装上即等价于未安装时的 DSH（原生行的自定义覆盖不会被继承，见第 11、14 节）；
4. 继承两个前身项目的能力：dsh-web-search-enhanced 0.1 的会话级搜索连接，dsh-web-fetch-enhanced 0.1 的可配置 HTTP(S) 本地抓取（成为 fetch 侧的 `builtin:local` 连接）。继承的是能力，不是配置文件：0.1.x 的配置不迁移（第 8、11 节）；
5. 模块可复用、可扩展：选择、存储、Remote、界面由 core 提供，两个插件各自只提供目录、后端和能力特有的策略；新增一个后端只动后端模块、目录项和文案（实际要碰的位置见第 7 节）；两侧的设置页都由目录驱动，新增后端不改页面代码。

v1 不做：注册自己的模型工具与模型可控的按调用参数（计划在 M5 以 `web_*_enhanced` 工具提供，第 13 节）；改写 tool-web 的 HTML→Markdown 转换。不自动重试、不自动 fallback 是不变量（第 10 节），不是待做的功能：一次调用失败后是否改换后端，由 Agent 经 M5 的工具决定。

## 3. 参照：DSH 自己如何组织 web 能力

DSH 0.2.1 把 web 能力拆成四种角色，彼此只通过 `ctx.web` 接缝相连（源码见 deepseek-harness `packages/web/*`、`packages/bundle/base/cordis.patch.yml`）：

~~~mermaid
flowchart LR
  subgraph bundle["@deepseek-ai/dsh-base（bundle，无代码）"]
    P["cordis.patch.yml<br/>web: searchProvider=deepseek-official, fetchProvider=http"]
  end
  subgraph providers["provider 包（各自独立发布）"]
    S1["dsh-web-search-deepseek<br/>注册 deepseek-official"]
    S2["dsh-web-deepseek-api<br/>注册 deepseek-search-api + deepseek-fetch-api"]
    F1["dsh-web-fetch-http<br/>注册 http"]
  end
  SEAM["dsh-web：ctx.web<br/>注册表 + 选择 + WebError"]
  TOOL["dsh-tool-web<br/>web_search / web_fetch 工具"]
  UI["dsh-client-ui-settings-web-search<br/>（web-app bundle 挂载）"]
  P -. 选中 .-> SEAM
  S1 & S2 & F1 -- registerXxxProvider --> SEAM
  TOOL -- ctx.web.search / fetch --> SEAM
  UI -. 改写用户层 web 行 .-> P
~~~

| 角色 | 包 | 做什么 | 不做什么 |
| --- | --- | --- | --- |
| 接缝 | `dsh-web` | 维护 search / fetch 两张 provider 表；每次调用按 `web` 行的 `searchProvider` / `fetchProvider`（缺省时用 `DSH_WEB_*_PROVIDER`）选一个；定义请求、结果和 `WebError` | 不联网，不注册工具 |
| provider | `dsh-web-search-deepseek`、`dsh-web-deepseek-api`、`dsh-web-fetch-http`（还有未组合的 exa、perplexity） | 各自 `registerSearchProvider` / `registerFetchProvider`；同时导出 provider 类供复用 | 不互相导入，不认识工具 |
| 消费者 | `dsh-tool-web` | 拥有模型面的工具名、schema、提示词、多查询合并、HTML→Markdown、截断 | 不认识任何具体 provider |
| 组合 | `dsh-base`（bundle） | 依赖上述包，用 patch 插入各行，并在 `web` 行选中 provider；Web 应用的 `dsh-web-app` 再把 tool-web 按 agent preset 组合 | 自身没有运行时代码 |

选择规则（`dsh-web` 的 `WebRuntime`）：配置的 id 已注册且 `available()` → 用它；已配置但未注册 → `WEB_PROVIDER_CONFIGURED_MISSING`；已配置但不可用 → `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`；未配置时恰好一个可用才自动选中，否则 `WEB_PROVIDER_AMBIGUOUS` / `WEB_PROVIDER_UNAVAILABLE`。同一 id 重复注册立即报 `WEB_DUPLICATE_PROVIDER`。没有 fallback，与注册顺序无关。

`@deepseek-ai/dsh-experimental-inspector-profile` 是同一范式的最小例子：package.json 只有 `dsh.bundle.patch` 和指向两个插件的 `dependencies`，patch 只做 `insert`。

## 4. 本项目的组织

### 4.1 对位

| DSH | 本项目 | 说明 |
| --- | --- | --- |
| `dsh-base` 的 web 段 / `inspector-profile` | **`dsh-tool-web-enhanced-profile`**（`packages/profile`） | bundle，无运行时代码；用户只安装它 |
| `dsh-web-search-deepseek` 等 search provider | **`dsh-web-search-enhanced`**（`packages/search-enhanced`） | 注册 `search-enhanced`，内部多后端；含自己的浏览器面 |
| `dsh-web-fetch-http` | **`dsh-web-fetch-enhanced`**（`packages/fetch-enhanced`） | 注册 `fetch-enhanced`，内部多后端；含自己的浏览器面 |
| （无对应） | `dsh-tool-web-enhanced-core`（`packages/core`，private） | 两个插件与 ui 共用的源码，构建时内联，不发布 |
| `dsh-web`、`dsh-tool-web` | 直接复用 | 不替换、不包装 |
| `dsh-client-ui-settings-web-search` | 各插件的 `./client` | 行设置页与 `/setup-*` 命令跟随插件，不单独成包 |
| （无对应） | **`dsh-tool-web-enhanced-ui`**（`packages/ui`） | 纯浏览器面：两个能力共用的输入框连接菜单、首次启用提示、bundle 概览；Host 面为空 |

### 4.2 包依赖

~~~mermaid
flowchart TD
  profile["dsh-tool-web-enhanced-profile<br/>bundle：cordis.patch.yml + locale + icon"]
  search["dsh-web-search-enhanced<br/>Host: lib/index.js　Client: lib/client.cjs"]
  fetch["dsh-web-fetch-enhanced<br/>Host: lib/index.js　Client: lib/client.cjs"]
  ui["dsh-tool-web-enhanced-ui<br/>Host: 空　Client: lib/client.cjs<br/>提供浏览器服务 webConnections"]
  core["dsh-tool-web-enhanced-core（private）<br/>./shared　./host　./client"]
  dsh["DSH 安装（@deepseek-ai/*）"]
  profile -- "dependencies（发布时精确版本）" --> search
  profile -- dependencies --> fetch
  profile -- dependencies --> ui
  search -. "可选注入：注册菜单分区" .-> ui
  fetch -. "可选注入：注册菜单分区" .-> ui
  ui -. "构建时内联" .-> core
  search -. "构建时内联" .-> core
  fetch -. "构建时内联" .-> core
  search -- "peer：安装方提供" --> dsh
  fetch -- peer --> dsh
  ui -- peer --> dsh
~~~

依赖规则：

- 插件的 Host 产物只能导入 Node 内置模块和 `@deepseek-ai/*`（由 DSH 安装提供，profile 解析会优先使用安装里的同名包）；其他代码包括 core 一律内联，插件没有运行时 `dependencies`。`scripts/verify-packages.ts` 检查打包后的产物与清单；
- search、fetch、ui 三者的 `src` 互不导入（组合测试可以导入别的包的 `src`）；共享代码只能放进 core；插件与 ui 之间只通过浏览器服务 `webConnections` 相连（第 9 节），类型来自 core。这一条靠评审守住，lint 只检查循环导入；
- core 不导入插件包，不持有模块级状态（两个插件各内联一份，状态无法共享）；`./shared` 同构，不导入 Node、浏览器或 Host 包；
- profile 只依赖本仓库发布的包，版本在打包时由 `workspace:*` 变为同一次发布的精确版本（verify-packages 检查）。

### 4.3 core 的模块

core 承载“选择范式”本身，插件只提供参数。三个入口在 `packages/core/package.json` 的 `exports` 里声明，指向源码：

| 入口 | 模块 | 内容 |
| --- | --- | --- |
| `./shared` | `ids` | `PROFILE_PACKAGE`、`SEARCH` / `FETCH`（包名、行 id、provider id）、`UI`（包名、行 id），插件页行配置键 `rowConfigKey()` |
| | `connections` | 连接 id 语法（`ConnectionId`、`custom:<name>` 的正则）、凭据引用语法 `CREDENTIAL_REF`、访问方式（持久化的 `AccessMode` 与按调用推导的 `Access`）、后端种类、`Descriptor` / `AccessFacts`、`OptionRule`（`enum` / `text` / `url` / `boolean` / `integer` / `list`；`text` 先查 `maxLength`，缺省 `TEXT_MAX_LENGTH` = 2000，再跑正则），以及按目录校验参数的 `validateOptions`（keyless 访问可以拒绝或收窄某个参数：`enum` 可收窄取值，`text` / `url` / `boolean` / `integer` 可声明 `keyless: false`） |
| | `settings` | 两侧共用的配置文档文法（第 8 节）：`documentSchema`、`builtinOverrideSchema`、`customConnectionSchema` 与对应的持久化形状 `CustomConnection<A>`，稀疏合并与严格校验 `resolveDocument`（自定义连接的 `adapter` 只能取目录里的 adapter 键；目录没有 adapter 项时 `custom:*` 按未知连接 id 拒绝，没有单独的开关），校验前预算，版本识别 `documentVersion` 与迁移管线 `migrateDocument` / `SETTINGS_MIGRATIONS`（N→N+1 表，当前为空），字段表 `SETTINGS_FIELDS` 与 Reset 提示 `SETTINGS_RESET_HINT` |
| | `route` | `routeOf(row, field, envProvider, providerId)`：Host 与浏览器共用的路由判断，结果为 `unknown` / `this` / `auto` / `other`（第 9.3 节）。与 `WebRuntime` 的 `config ?? env` 一致：只有字段缺席才回退环境变量，`''` 也算已配置；`isRouted` 只把 `this` 算作路由到本插件 |
| | `url` | 端点形状校验 `isEndpoint` 与来源 URL 规范化 `sourceUrl`（上限 8192 字符，第 10 节） |
| | `selection` | 会话选择 `Selection`、来源 `SelectionSource`、模型记忆 `Pairing`、连接状态与视图；`selectionContract({ namespace, packageName, options, extras })` 生成一个能力的 zod 片段与可挂载的 Remote 信息（`<ns>/get`、`<ns>/set`、`<ns>/provider`、`<ns>/pairings`、`<ns>/forgetPairing`），以及合并进 DSH 类型表的 `ConnectionsRemoteMap` / `ConnectionsRemoteErrors`。`providerView` 只含浏览器看不到的两个事实：`providerId` 与 `envProvider`；连接视图不含 `credentialRef` |
| `./host` | `capability` | `Capability` 接口：插件交给 core 的全部差异，以及 `CapabilitySettings`、`OptionsCodec`、`HostContract`、`CapabilityCall`（6.7） |
| | `runtime` | `installCapability(ctx, capability)`：装配存储、会话、每步计划、限制、Remote 与唯一的 Seat；返回只读的 `plan(agent?)`，供能力自己的上下文（fetch 的白名单提示）使用 |
| | `settings-row` | `settingsRow({ identity, capabilityLabel, retiredFields, secretFields, resolve })`：生成插件行的 `Config`（文档字段与退役字段都声明为 `z.any().volatile()`，密钥类退役字段标为 secret），启动时校验一次（无效只记日志）、在 Loader 的 `internal/config` 钩子里校验候选、把每次调用读取的 `settings()` 包成给模型的 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`（`InvalidSettingsError`，`WebError` 的子类，Remote 边界据此识别“设置无效”） |
| | `sessions` | `Sessions`：按会话排队、revision 比较并写入、fork 继承与 `inherited` 标记、模型记忆、未选择时的解析顺序与来源（6.2）；`peek` 只读不建记录 |
| | `storage` | storage-domain 的懒打开（facility 更换后可恢复）与 `selections` / `pairings` 两张表；`SessionStorage` 把能力的 `OptionsCodec` 与域绑在一起 |
| | `pairings` | 模型记忆的读、写、列出与清除 |
| | `plans` | `Plan` 与 `planFor`（只冻结 `{ connectionId, options }`），`Snapshots` 按 (Agent, turn, step) 保存，同一步的并发捕获共享一次读取 |
| | `selectable` | `isSelectable`：存在、未停用、不是 `model`；所有判定处只用它 |
| | `restriction` | `ToolRestriction`：关闭时对 Agent 隐藏工具，路由 guard、`disposed` 标记、`web` 行变化时对已知 Agent 重算 |
| | `remote` | `createConnectionsService`：在工厂内声明带 `@Remote` 的服务类，每次安装一个新类，生成 `<ns>/get`、`set`、`provider`、`pairings`、`forgetPairing`；每个方法包在同一个错误边界里（6.2 的 Remote） |
| | `route` | `routeFacts` / `providerView`：用 Settings 的公开数据（`settings.describe()` 中 `ns = web` 的值）和 `DSH_WEB_SEARCH_PROVIDER` / `DSH_WEB_FETCH_PROVIDER` 判断 `web` 行是否选中本插件；读不到时为 `unknown`，按“未路由”处理 |
| | `credentials` | `resolveApiKey(ctx, ref)`（只经 DSH Credentials，不回退环境变量，本项目自己的后端用它）；`nativeAuth(ctx, ref)`（交给 `native` 后端的凭据回调：照搬原生行，Credentials 服务缺席时才读 DSH 启动环境的同名变量，账号令牌只在 `deepseek-account` 路由上）；`credentialReadiness`（连接视图的 `ready` / `needs-credential` 与 `account` / `api-key`）；`accountTokenFor` |
| | `model` | 会话模型：`nextModel`（待生效的切换 → 上次请求 → Agent 路由），`requestModel`（本次请求已解析的路由，账号鉴权只认它） |
| | `transport` | `createTransport`：有界 HTTP，拒绝重定向、字节上限（先看 Content-Length，再在流上计数）、整体截止时间、状态码→错误消息；给模型的措辞由调用方传入 |
| | `mcp` | `createMcpClient(transport, errors, { clientInfo, messages })`：最小的 Streamable HTTP MCP 客户端，每次调用发一次 `tools/call`（服务端要求时先 `initialize` + `notifications/initialized`），会话状态不跨一次调用；接受 JSON 或 SSE 回复，SSE 逐行扫描、以空行结束事件（`\r\n`、`\n`、`\r` 可混用），每个字符只看一次；`isError` 的结果报能力给的 `toolFailed`；`toolTexts`、`toolJson`（只有 `SyntaxError` 才算散文） |
| | `adapter` | 两侧共用的请求/解析线（6.7）：`AdapterWire<I, O>`、`McpRoute`、`Auth`、`KeylessBound`、`AdapterTarget` 与 `adapterTarget`（keyless 永远发往目录端点）、执行骨架 `runAdapter`；请求辅助 `postJson`、`getJson`、`bearer`、`apiKeyHeader`、`isRecord` |
| | `errors` | `capabilityErrors(prefix)`：`WebError` 构造与取消辅助（`aborted`、`abortable`、`throwIfAborted`），只用已有的 `WEB_*` 码；`OnDiagnostic` 只进 Host 日志 |
| | `native` | `nativeBackend`（包一层上游 provider 实例，失败时先记诊断再改写）与 `restateNative`（只用能力自己的公开消息重述错误，未知码一律 `WEB_PROVIDER_ERROR`） |
| `./client` | `section` | 菜单分区契约 `ConnectionSection`、`SelectionStore` / `RouteStore` 接口、浏览器服务 `WebConnectionsService` 的类型（`register` 注册分区，`registerRoute` 独立地提供路由事实，`routes` 是各能力路由的快照），并声明 `Context.webConnections`（6.7、9.2） |
| | `use-observable` | `useObservable`：每个快照源只订阅一次的 React 读取钩子 |
| | `selection` | `ConnectionSelectionStore`：每会话一份可观察快照，基于插件的 `<ns>` Remote 读写；模型、设置、凭据变化或重连时失效重读，写入被拒后重读 |
| | `route` | `RouteStatus`（按 `web` 字段参数化，合并 `configForms.get('web')` 与 `<ns>/provider`）与 `clientRoute` |
| | `pairings` | `PairingsStatus`：列出、清除模型记忆 |
| | `credentials` | `CredentialStatus`：由能力给出 `refs(settings)`，只读“是否已配置”，不读密钥 |
| | `command` | `selectionCommand`：`/setup-<cap>` 命令工厂（关闭、可用连接、能力自定义的选项组），读写同一个 `SelectionStore` |
| | `settings/*` | 稀疏写入 `createSparseSettings`（含 Reset 的操作）；文档视图 `effectiveDocument` / `editableSettings` / `settingsOperations` / `useSettingsDocument`（校验、revision 栅栏、未来迁移的写回）；`withRetiredSecretDiagnostics`；参数字段 `fields`；目录事实 `model`（`builtinOverride`、`builtinAccess`、`builtinCredential`、`credentialRefs`、`connectionChoices`、`connectionName`、`customConnections`，以及按访问方式去掉或收窄参数的 `catalogFields` 与同一规则下列出已存参数中 keyless 不接受部分的 `keylessRejected`）；自定义 adapter 连接的表单规则 `connection-form` 与编辑器 `ConnectionEditor`；内置连接的通用字段 `ServiceFields`（凭据名称，`url` 参数与“信任此地址”开关）；行设置页骨架的组件工厂（路由提示、默认值、服务列表、参数、凭据、自定义连接、模型记忆、Reset）。服务列表工厂按目录渲染每一项，插件只传入目录、参数文案 `optionCopy`（标签、占位符、字段下方的说明 `hint`）、每项的说明 `notes`、按目录键覆盖的访问摘要 `summaries` 和按目录键注册的附加编辑器 `extras`（声明自己接管哪些参数）；自定义连接工厂只要目录与缺省连接，目录没有 adapter 项时不渲染。`./client` 只导出插件实际调用的工厂与类型，表单、编辑器与大部分目录辅助留在模块内部。文案由插件传入的 `t` 与键表提供，core 不带词典 |

抽取遵守“第二个使用者出现时再抽象”：只有两个插件都用到的部分才进 core。

插件里留下的部分：

- search 保留目录、各 adapter 的请求与解析（含 MCP 结果的行解析 `toolRows`）、来源规范化、执行层、传输常量与文案、`native` 后端、实时性和 `settings/resolve.ts`（建在 `resolveDocument` 上，派生 adapter / native 连接）；Host 侧只有把 core 组装成 search 能力的部分（`searchCapability`、连接状态 `describeConnections`、实时性的 `OptionsCodec`）和 Seat 包装 `createSearchSeat`。测试直接从 core 导入，没有转接文件。
- fetch 保留目录、`local`（白名单文法、地址策略、解析器、后端）、`native` 后端、`remote/`（四个 adapter、页面→`WebFetchResult` 的映射、传输常量与文案、执行层）、`settings/`、白名单提示 `prompt.ts` 与能力装配；浏览器面只有 `local` 的附加编辑器（白名单与 User-Agent，按目录键注册）、远程服务的说明和文案是自己的，其余用 core 的骨架。

### 4.4 发布与命名

四个包发布到 npm（profile、两个插件、ui），用户只安装 profile：`dsh plugin --profile <p> add dsh-tool-web-enhanced-profile`，pnpm 把两个插件和 ui 作为它的依赖装进 profile。这与 DSH 自己的做法一致（`@deepseek-ai/dsh-experimental-inspector` 等也是独立发布、由 bundle 依赖）。两个插件继续使用前身的 npm 名，版本从 0.2.0 起：从 0.2.0 开始它们是 profile 的普通插件，不再是 bundle。profile 与 ui 从 0.1.0 起。

| 标识 | search | fetch | 定义位置 |
| --- | --- | --- | --- |
| npm 包 | `dsh-web-search-enhanced` | `dsh-web-fetch-enhanced` | `core/src/shared/ids.ts` |
| 行 id = Settings 命名空间 = Cordis 插件名 | `web-search-enhanced` | `web-fetch-enhanced` | 同上 |
| `ctx.web` provider id | `search-enhanced` | `fetch-enhanced` | 同上 |
| storage-domain | `web_search_enhanced`（沿用前身） | `web_fetch_enhanced` | 各插件的能力定义 |
| Remote 命名空间 | `searchConnections`（沿用前身） | `fetchConnections` | 各插件的 `contract.ts` |
| 插件页行配置键 | `dsh-tool-web-enhanced-profile#web-search-enhanced` | `…#web-fetch-enhanced` | `rowConfigKey()` |
| 斜杠命令 | `/setup-search` | `/setup-fetch` | 各插件 |

ui 包：npm 名 `dsh-tool-web-enhanced-ui`，行 id `tool-web-enhanced-ui`（`ids.ts` 的 `UI`），浏览器面提供服务 `webConnections`。

**命名规则**（沿用 DSH 的惯例，如 `@deepseek-ai/dsh-tool-web` → 行 `tool-web`）：行 id = npm 包名去掉 `dsh-` 前缀，Cordis 插件名与 Settings 命名空间都等于行 id。包分两族：`web-*-enhanced` 是向 `ctx.web` 注册 provider 的插件（与 DSH 的 `web-search-deepseek`、`web-fetch-http` 同族，名字沿用前身）；`tool-web-enhanced-*` 是围绕 tool-web 的产品层——profile、ui 和私有的 core。profile 测试对每个插入行检查这条规则。

这些标识只在 `ids.ts` 定义一次；profile 的 patch 是 YAML，无法导入，由 `packages/profile/tests/profile.spec.ts` 断言它与 `ids.ts` 一致。

## 5. 组合：profile 的 patch

[packages/profile/cordis.patch.yml](../packages/profile/cordis.patch.yml)：

~~~yaml
- id: web
  config:
    searchProvider: search-enhanced
    fetchProvider: fetch-enhanced
- id: web-search-deepseek
  disabled: true
- insert:
    - id: web-search-enhanced
      name: dsh-web-search-enhanced
    - id: web-fetch-enhanced
      name: dsh-web-fetch-enhanced
    - id: tool-web-enhanced-ui
      name: dsh-tool-web-enhanced-ui
~~~

逐条说明：

- **profile 拥有 `web` 行，两个字段一起写。** patch 会整体替换目标行的 `config`，不做深合并；只写一个字段会丢掉另一个，这正是前身 0.1.9 的事故。由同一个 bundle 写全两个字段，就没有“另一半属于别人”的问题。之后的层（用户层、更晚的 bundle）改写 `web` 时整体覆盖我们的选择，这是 DSH 的层叠语义，也是用户退出本插件的正常途径。本仓库里除了这份 patch，没有任何代码写 `web` 行的值；ui 的预检修复只在用户确认后 `unset` 用户层的字段（第 11 节）。
- **用自己的 provider id，不占原生席位。** 前身用 `deepseek-official` / `http` 顶替原生 provider，以避免改写 `web` 行；现在 `web` 行归 profile，就没有理由冒用原生 id。自有 id 让错误、日志和路由判断都指向本插件，也让原生 provider 可以同时挂载而不触发 `WEB_DUPLICATE_PROVIDER`。
- **停用 `web-search-deepseek`。** 它的能力成为 search 插件的 `builtin:deepseek-messages` 连接（同一个上游类，同样的凭据解析）。停用它还会让内置的“网页搜索”页面消失（该页面只在这一行运行时注册）：那个页面的开关在用户层把 `web` 行改写成 `deepseek-search-api`/`deepseek-fetch-api` 或 `deepseek-official`/`http`（当下层值不同时），会悄悄把流量从本插件引走。
- **保留 `web-deepseek-api` 和 `web-fetch-http`。** 它们注册的 provider 没有被选中，不参与路由，也不造成歧义（选择已固定）。它们是手动退路：在用户层把 `web` 行改成 `searchProvider: deepseek-search-api` 加 `fetchProvider: http`（或 `deepseek-fetch-api`）即可绕开本插件。注意 `deepseek-official` 已随 `web-search-deepseek` 停用：要回到它，还必须在用户层重新启用那一行，否则报 `WEB_PROVIDER_CONFIGURED_MISSING`。最干净的退路是停用整个 profile。
- **菜单行不依赖插件行。** `tool-web-enhanced-ui` 不注入任何插件提供的服务，插件向它注册分区是可选注入（第 9.2 节）；任一插件行或两者都被停用时，它照常激活。被停用的那个能力不会回退到别的 provider：`web` 行仍指向它的 id，调用报 `WEB_PROVIDER_CONFIGURED_MISSING`（e2e `profile` 的进程内 Host 与 `menu-rows-off` 的界面都覆盖 search、fetch、两者三种组合）。
- **插件行由 profile 插入。** 插件页把 bundle 的 `insert` 行列为它的组件，每行显示**行所属包**自己的 `locale/*.json` 标题、描述和图标（e2e `plugins-page` 验证）。

与前身共存：0.1.x 的两个独立 bundle 插入同样的行 id，与 profile 同时安装会冲突。安装 profile 前先移除它们（第 11 节）。

## 6. 运行时

### 6.1 请求管线

两个插件采用同一条管线：

~~~mermaid
flowchart LR
  WEB["ctx.web<br/>按 web 行选中席位"] --> SEAT["Seat<br/>唯一注册的 provider"]
  SEAT --> PLAN["Planner<br/>本步用哪个连接"]
  PLAN --> EXEC["Executor<br/>复查 · 凭据 · 截止时间 · 错误改写"]
  EXEC --> BACKEND["Backend<br/>native · adapter · local"]
  BACKEND --> TRANSPORT["Transport<br/>上游类 · 有界 HTTP · 官方 HTTP 传输"]
~~~

| 层 | 职责 | 不变量 |
| --- | --- | --- |
| Seat | 在 `ctx.web` 注册一次，id 固定；把调用交给 Planner 选出的后端 | 注册随插件 fiber 释放；`available()` 恒为 `true`，不做 I/O（能否服务取决于会话选择，调用时才知道） |
| Planner | 产出 `Plan`：`off` / `failed` / `ready { connectionId, options }` | 同一步内不变；只读本地状态 |
| Executor | 每次调用按当前设置复查连接，构造本次的目标；为本项目自己的后端解析凭据、套截止时间；把所有后端的错误改写成给模型的简短消息（保留错误码）；search 统一规范化来源 | 后端拿到的是已解析的凭据和参数，不碰凭据存储 |
| Backend | 某个服务的协议，或一个上游 provider 实例 | 见 6.4 |
| Transport | 上游 DSH provider 类、core 的有界 HTTP、DSH 官方 HTTP(S) 抓取传输 | 见第 10 节 |

两侧都由 core 的 `installCapability` 装配：Seat 经能力的 `register` 注册一次（search 包一层 `createSearchSeat`，fetch 直接注册 `{ id, available: () => true, fetch }`），调用时取回发起 Agent 本步的计划（6.2），再由能力的 `target` / `execute` 执行。

### 6.2 共同的选择范式

search 与 fetch 用同一套概念、同一份 core 实现：

- **连接（connection）**：到某个后端的一种配置。`builtin:<id>` 来自插件目录，运维可以对它做稀疏覆盖（停用、访问方式、凭据引用、参数）；`custom:<name>` 由运维新建（目录里某个 adapter 的另一份配置，例如自建端点，需显式 `trustedEndpoint`；两侧都支持）。
- **插件行设置**：`{ version, defaultConnection, showSelector, defaults, connections }`（第 8 节），经插件设置页编辑，热生效。它决定会话**能**选什么。
- **会话选择**：`{ connectionId | null, revision, options }`，存在插件自己的 storage-domain，以 revision 比较并写入，同一会话的读写排队执行；fork 出的会话继承父会话的选择。revision 为 0 表示本会话还没选过，它的连接按下面的“未选择时的解析顺序”得出，并随之变化，直到用户选一次。
  - 存储记录（表 `selections`，键为会话 id）由两部分组成：core 拥有 `connectionId`、`revision`、`inherited?`，会话参数由能力的 `OptionsCodec`（`initial` / `fromRecord` / `toRecord`）编码。search 的记录是 `{ connectionId, revision, freshness?, inherited? }`，与前身相同：`freshness` 缺席的旧记录读到时补上当前默认值（`defaults.freshness`）。fetch 没有会话参数，记录是 `{ connectionId, revision, inherited? }`，历史上多出的字段被忽略。
  - `inherited` 标记 fork 时真实复制了父会话的记录；前身的旧记录没有这个字段，读到时按“父会话记录是否存在”补上。revision 为 0 的记录也会写入，以便 fork 出的子会话能复制它。
  - 只改会话参数（search 的实时性）也是一次选择：revision 加一，会话随之固定在当前连接，来源变为“本会话选择”，但不写模型记忆。这是前身的语义，作为已知行为保留。
- **模型记忆**（沿用前身的 pairing）：用户在会话里选连接（包括关闭）时，记下“这个会话下一次请求将使用的模型 → 所选连接”。模型按“待生效的切换 → 上次请求的模型 → Agent 的路由”确定，键为 `(provider, model)`，存在插件自己的 storage-domain 的 `pairings` 表（键为 `JSON.stringify([provider, model])`，值为 `{ connectionId }`）。选择已经落盘后才写记忆，记忆写入失败只记日志，不影响这次选择。它让换到某个模型的新会话沿用你上次为这个模型做的选择，例如自带搜索的模型配它自己的搜索连接。
- **未选择时的解析顺序**：① fork 出的会话：父会话的选择；② 该模型的记忆，前提是记住的连接仍可选（记住的是“关闭”则关闭）；③ `defaultConnection`。前身的第四步“唯一可用的连接”不再保留：它要在选择路径上查询凭据与账号状态。
  - 细节：父会话没有记录时，子会话不算继承，来源按 ②③ 得出；记忆指向已删除、已停用的连接时跳过，回落到 `defaultConnection`。“能否被选中”只有一条规则（core 的 `isSelectable`：存在、未停用、不是 `model`），模型记忆、Remote 写入和每次调用的复查都用它。`defaultConnection` 本身不经这条规则过滤：它指向一个已停用的连接时，未选择的会话照样得到它，调用时按下面的复查报错。
- **每步冻结**：`agent/request` 时为 (Agent, turn, step) 捕获计划；Seat 通过 `ctx.agents.currentInitiator()` 找到发起调用的 Agent，取它这一步的计划。`Plan` 只冻结 `{ connectionId, options }`（“用哪个连接、带哪些会话参数”）；连接是否仍可选、它的端点、访问方式、凭据引用和参数、fetch 的白名单与上限这类**运维策略在每次调用时读当前值**。
  - 每次调用先读当前设置，用 `isSelectable` 复查计划里的连接，已停用或已删除时报 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`；再由能力的 `target(connection, options, call)` 用当前连接构造本次调用的目标（adapter、native、local 一律如此，目标不缓存）。可选性只在调用时判定，所以停用与重新启用都从下一次调用生效，不必等下一步。
  - `agent/created` 也捕获一次（turn、step 记为 -1），让还没发过请求的 Agent 也有计划；捕获失败不影响 Agent 创建和普通对话，只有对应工具收到失败的计划。有发起 Agent 但没有捕获到计划时，调用报 `WEB_PROVIDER_ERROR`（选择无法读取，可重试）。
  - 行设置无效（第 8 节）时，读取当前设置即失败，调用报 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`，消息为“settings are invalid; ask the user to fix them on the settings page”，具体诊断只进 Host 日志。
- **会话之外的调用**：没有发起 Agent（其他宿主功能直接调用 `ctx.web`）时也就没有模型，模型记忆无从查起，按调用当时的 `defaultConnection` 与能力的初始参数计划；默认连接不可选时同样报 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`。
- **关闭**：选择为 `null`。Seat 对该会话的调用返回 `WEB_PROVIDER_UNAVAILABLE`（执行层兜底，提示用户在输入框或 `/setup-*` 里选连接），并用 `agent.ctx.tools.restrict({ deny: [<tool>] })` 对该 Agent 隐藏 `web_search` / `web_fetch`。Web profile 里 tool-web 由 agent preset 挂在 Agent 作用域的祖先上（DSH `agent-preset-registry` 的 `bindScopeParent`），根 ctx 上没有这两个工具：判断工具是否存在要看 Agent 自己作用域的视图（`tools.get(tool, scopeOf(agent.ctx))`），不能照搬前身 0.1 在根 ctx 上的 `tools.get` 判断——它在 Web profile 下总是不成立，限制从未生效。
  - **只在路由到本插件时隐藏**：限制只在 `web` 行确认选中本插件时安装（Host 用 Settings 的公开数据判断，见 4.3 的 `route`）；未路由或判断不了时不隐藏，以免藏掉别的 provider 提供的同名工具。
  - **同步时机**：Remote `set` 写入后立即同步；`agent/created`、`agent/request` 两个捕获点再同步一次。DSH 的 AgentLoop 在 `agent/request` 之前就组装好了本步的工具列表，所以“关闭”从下一次组装工具列表的步生效；同一步里已经发出的调用可能被 Seat 拒绝。
  - **web 行变化**：`settings/document-updated`（`ns = web`）时，对已知的 Agent（捕获过计划或装过限制的）立即重算：路由离开本插件时撤销限制（不读存储），回到本插件时立即为已关闭的会话安装限制，不再等下一个捕获点。重算用只读的 `peek` 读取会话选择，不为没有记录的会话创建记录。还没被捕获过的 Agent 在 `agent/created` / `agent/request` 时同步。
  - **卸载**：插件卸载时置 `disposed` 标记并撤销全部限制；卸载后仍在途的读写不再安装限制，捕获返回失败的计划。Agent 释放时显式撤销并忘记它。
- **Remote**：`<ns>/get`、`<ns>/set`（带 `expectedRevision`）、`<ns>/provider`、`<ns>/pairings`（列出模型记忆）、`<ns>/forgetPairing`（清除一条）；`get` / `set` 按被寻址的会话资源授权。search 用 `searchConnections`，fetch 用 `fetchConnections`，由 core 的同一个工厂 `createConnectionsService` 生成：带 `@Remote` 的服务类在工厂内声明，每次安装一个新类，不持有模块级状态；构建期装饰器降级对内联的 core 文件同样生效，在 Vitest 与 Rolldown 产物（e2e 的真实 Host）里都已验证。
  - 契约由 core 的 `selectionContract` 生成，请求与结果两端都是严格 schema。`set` 的连接必须可选（`isSelectable`），否则报 `<ns>/unavailable`；revision 过期报 `<ns>/conflict`；请求不合契约报 `gateway/bad-request`；sessionController 解析会话时给出的 `RemoteError` 也原样交出。行设置无效时，`settingsRow` 抛出的 `InvalidSettingsError`（`WebError` 的子类）被边界精确识别，`<ns>/get`、`<ns>/set` 返回契约内的 `<ns>/invalid-settings`：消息固定（“the row settings are invalid; fix them on the settings page”），details 为空，不记 warn（诊断已由设置校验记过）。其余异常一律改为 `gateway/internal`，消息固定（“connection request failed; retry or check the Host logs”），不带 cause，原始异常只写进 Host 日志（warn）。浏览器的 `SelectionState.readFailure` 区分 `'invalid-settings'` 与 `'failed'`：菜单对前者说明“<能力>的设置无效，请打开设置修复”并给出设置入口、不提供重试，对后者显示失败态并可重试；`/setup-*` 两种都按读取失败处理。`provider` 只返回 `{ providerId, envProvider }`，路由由浏览器用 `routeOf` 自己判断。
- **记忆要看得见**：前身的配对在界面上不可见，用户不知道新会话为什么选了某个连接。因此 `SelectionView` 带上来源（本会话选择 / 继承自父会话 / 模型记忆 / 默认），输入框菜单显示当前选择的来源，设置页列出全部模型记忆并可逐条清除。

### 6.3 两侧的差异只是参数

| 维度 | search | fetch |
| --- | --- | --- |
| 隐藏的工具 | `web_search` | `web_fetch` |
| storage-domain / Remote | `web_search_enhanced` / `searchConnections` | `web_fetch_enhanced` / `fetchConnections` |
| 默认连接 | `builtin:deepseek-messages`（原生等价） | `builtin:local`（原生等价） |
| 会话参数 | `freshness`（默认值在 `defaults.freshness`） | 无（`OptionsCodec` 为空，`defaults` 只接受空对象） |
| 连接视图的附加字段 | `freshness`（当前访问方式下是否支持实时性） | 无 |
| 自定义连接 | `custom:<name>`，`kind: adapter`，adapter 取 search 目录的六项 | `custom:<name>`，`kind: adapter`，adapter 取 fetch 目录的四项 |
| 特有的连接种类 | `model`（含跟随会话模型）**[计划]**（第 13 节 M4），当前配置不接受 | `local`（唯一的 HTTP 传输后端） |
| 每次调用读取的运维策略 | 连接可选性；adapter 的端点、访问方式、凭据引用与参数；native 的凭据引用与参数 | 连接可选性；`local` 的白名单、User-Agent 与上限；adapter 的端点、访问方式、凭据引用与参数；native 的凭据引用与 `baseURL` |
| 远程后端的传输上限 | 2 MiB、90 s | 5 MB、120 s，正文 100 000 字符（6.6） |
| 能力特有的上下文 | 无 | `local` 白名单提示（6.5） |

### 6.4 后端种类

| 种类 | 用于 | 怎么实现 | 行为基准 |
| --- | --- | --- | --- |
| `native` | search：`deepseek-messages`、`deepseek-search-api`；fetch：`deepseek-fetch-api` | 直接实例化 DSH 导出的 provider 类（`DeepSeekSearchProvider`、`DeepSeekSearchApiProvider`、`DeepSeekFetchApiProvider`），凭据与端点解析照搬对应原生行 | 与 DSH 原生 provider 完全一致；只改写错误消息（上游消息带端点、上游错误详情，并指向本 profile 已隐藏的内置“网页搜索”页面） |
| `adapter` | search 的结构化服务（Exa、Firecrawl、Tavily、Tinyfish、OpenAlex、Semantic Scholar）；fetch 的远程读取服务（Exa、Firecrawl、Tavily、Tinyfish） | 两侧都实现 core 的 `AdapterWire`（`request` / `parse` 与可选的 keyless 路由），由 core 的 `runAdapter` 执行，传输统一走 core 的有界 HTTP 与 MCP 客户端（6.7） | 对齐 DSH 远程 provider 的设计（6.6） |
| `model` | search **[计划]**（第 13 节 M4） | 让带服务端搜索的模型执行搜索，走 core 的有界 HTTP | 同上 |
| `local` | fetch | DSH 官方 `HttpFetchProvider` + 本插件注入的解析器 | 6.5 |

search 的目录（`src/catalog.ts`，顺序即显示顺序）有 8 项：native `deepseek-messages`（默认，原生等价；参数 `baseURL`、`model`、`apiVersion`、`maxTokens`、`maxUses`，未覆盖的端点与原生行一样可由启动环境的 `DEEPSEEK_SEARCH_BASE_URL` 给出）、`deepseek-search-api`（参数 `baseURL`、`count`（1–50）、`sendOriginalQuestion`，缺省与原生一样附带最近一条用户问题）；adapter `exa`、`firecrawl`、`tavily`、`tinyfish`、`openalex`、`semanticscholar`。两个 native 都只有 API key（缺省 `DEEPSEEK_API_KEY`）或 DeepSeek 账号两种访问方式。前身的 `deepseek` adapter 由 native `deepseek-search-api` 代替，设置文档里的 `builtin:deepseek` 按未知连接 id 拒绝。

fetch 的目录（`src/catalog.ts`）有 6 项：`local`（默认，kind `local`，keyless；参数 `allowCidrs`、`allowHostnames`（list，各至多 200 条）、`userAgent`（text，允许空串，发出空的请求头）、`maxResponseBytes`、`maxBodyChars`、`timeoutMs`、`maxRedirects`（integer），默认值等于原生 `web-fetch-http` 行：空白名单、DSH 的默认 User-Agent、5 000 000 字节、100 000 字符、30 000 ms、5 跳）；`deepseek-fetch-api`（kind `native`，实例化 `DeepSeekFetchApiProvider`；API key `DEEPSEEK_API_KEY` 或 DeepSeek 账号；参数 `baseURL`（url），与官方端点不同时需 `trustedEndpoint: true`；凭据与端点解析照搬原生 `web-deepseek-api` 行，错误消息改写为不含端点与上游详情的提示）；以及四个 adapter：

| 键 | API key 路由 | keyless 路由 | 参数（运维可设） |
| --- | --- | --- | --- |
| `exa` | POST `https://api.exa.ai/contents`，`x-api-key`（缺省 `EXA_API_KEY`）；体 `{ urls: [url], text: { maxCharacters: 100000 } }` 加参数 | 托管 MCP `https://mcp.exa.ai/mcp` 的 `web_fetch_exa`（先握手），参数 `{ urls: [url], maxCharacters: 100000 }` | `maxAgeHours`（−1–720）、`livecrawlTimeout`（1–90 000 ms），都只在 API key 下可用 |
| `firecrawl` | POST `https://api.firecrawl.dev/v2/scrape`，Bearer（缺省 `FIRECRAWL_API_KEY`）；体 `{ url, formats: ['markdown'] }` 加参数 | 同一端点，不带 Authorization | `onlyMainContent`、`maxAge`（ms）、`storeInCache`、`timeout`（1 000–110 000 ms）、`waitFor`（0–60 000 ms）、`proxy`（basic / enhanced / auto） |
| `tavily` | POST `https://api.tavily.com/extract`，Bearer（缺省 `TAVILY_API_KEY`）；体 `{ urls: [url], include_images: false }` 加参数，从不发 `query` / `chunks_per_source`（它们会把正文变成摘录） | 同一端点，加 `x-tavily-access-mode: keyless` | `extract_depth`（basic / advanced）、`format`（markdown / text）、`timeout`（1–60 s） |
| `tinyfish` | POST `https://api.fetch.tinyfish.ai`，`x-api-key`（缺省 `TINYFISH_API_KEY`，与 search 的 Tinyfish 同名）；体 `{ urls: [url], format: 'markdown' }` 加参数 | 无 | `ttl`（秒，≥ 0）、`per_url_timeout_ms`（1–110 000） |

- 每个请求体都是先展开参数、再写固定字段，参数改不了 URL 与格式；URL 原样放进请求体（6.6）。
- 有 keyless 路由的三项缺省为 keyless，Tinyfish 缺省为 API key。远程连接默认不停用；会话选了它们，URL 就会发给对应服务（菜单与设置页都写明）。
- Tinyfish 只有 API key：官方文档写明 Fetch API 的每个请求都要 `X-API-Key`，托管 MCP 用 OAuth；search 侧使用的匿名请求头只有第三方证据，而且只涉及搜索工具。本项目不向真实服务发探测请求，所以不提供未经证实的匿名路由。
- 服务端的超时参数上限都不超过 110 000 ms，留在本插件 120 s 的整体截止时间之内（6.6）。

Exa 与 Tinyfish（search）、Exa（fetch）的 keyless 路由走托管的 MCP 工具（core 的最小 MCP 客户端，一次 `tools/call`，同样经 core 的有界 HTTP），其余 keyless 路由走 REST。`native` 结果与 adapter 结果一样经 `sourceUrl` 过滤来源（search）。

### 6.5 fetch 的 local：唯一做地址检查的后端

只有经 HTTP(S) 直接访问目标的后端才需要、也才能做目标地址检查，fetch 里只有 `local` 是这样。

- 传输是官方 `HttpFetchProvider`，本插件只注入解析器，不重写传输。URL 策略（仅 http(s)、≤2048 字符、拒绝 URL 内嵌凭据）、同源重定向与逐跳复查、代理路由、字节/字符/时间/跳数上限都是官方的。
- 白名单为空时与原生 public-only 完全一致；非空时按 CIDR（可再用主机名收窄）放行非公网地址。**直连**的请求校验完整 DNS 答案集与 NAT64，任一不合规即拒绝，连接固定到已验证地址；IP 字面量在交给传输层之前先检查。**走代理**的域名请求沿用上游行为：DNS 由代理完成，本机没有地址可校验，也不固定连接（`web-fetch-http` `provider.ts` 的 `requestOnce`），所以**经代理访问的域名由代理解析，规则无法限制**；非公网 IP 字面量永远不走这条捷径。设置页的白名单说明与 fetch 的 README 都写明了这一点。
- 白名单、User-Agent 和上限是 `builtin:local` 的参数，只有运维能改；会话只能选择是否使用 `local`。
- 给模型的白名单提示：只在本步计划用的是 `local`、白名单非空、且确认 `web_fetch` 路由到本插件时加入运行时上下文；路由无法判断时**不加**。

实际做法：

- 规则文法在 `src/local/rules.ts`（`parseCidr`、`parseHostnameRule`、`cidrWarnings`、`describeProblem`），Host 校验与设置页的逐行诊断用同一个模块；地址判断在 `address-policy.ts`（公网单播总是放行；IPv4-mapped 与 IPv4-compatible 的 IPv6 按其中的 IPv4 判断；非公网地址必须落在某条 CIDR 内，且有主机名规则时 URL 的主机名要匹配其中一条，`*.example.com` 只匹配子域）；解析在 `resolver.ts`（一次解析、整组校验，并检查 RFC 6052 前缀与 `ipv4only.arpa` 发现的 NAT64）。地址解析用 `ipaddr.js`（与 DSH `web-fetch-http` 同版本），构建时内联进 fetch 的 Host 产物；`rules.ts` 里的非公网范围表与 `ipaddr.js` 的 `range()` 对齐。
- 官方传输把它判为公网的 IP 字面量直接交给已配置的代理而不调用解析器，而且会把 `[::7f00:1]` 这类 IPv4-compatible 地址判为公网，所以 `createLocalBackend` 在交给传输之前先检查 IP 字面量（同源重定向下请求 URL 的主机就是每一跳的主机）。
- 每次调用读当前的 `builtin:local` 参数并新建 `HttpFetchProvider`。官方传输抛出的 `WebError` 原样交给模型（它们是 DSH 原生给模型的安全消息，与原生 `http` provider 一致）；只有本插件自己的白名单拒绝用本插件的文案（`WEB_BLOCKED_URL`，目标在白名单之外，请运维检查）；不是 `WebError` 的异常只记 debug 日志，给模型固定的 `WEB_PROVIDER_ERROR` 文案。
- 提示注册为系统提示的运行时上下文 `web-fetch-enhanced:allowlist`（排在 `SANDBOX_POLICY` 之后）。它用组装上下文里的 Agent，缺席时用 `currentInitiator()`；都没有时按当前 `defaultConnection` 判断（与“会话之外的调用”一致）。只有计划为 `ready`、连接是未停用的 `local`、`allowCidrs` 非空且 `routeFacts` 确认路由到本插件时返回文本，例如 “The operator has authorized web_fetch to reach non-public addresses within [10.0.0.0/8]. Only URLs whose hostname matches [*.corp.example] may use these exceptions. All other URL, DNS, redirect, and transport safety checks still apply.”，否则返回空串。规则先规范化、去重；全文超过 2000 字符时改为计数摘要加部分示例，总长仍在预算内。

### 6.6 远程后端：对齐 DSH 的设计

DSH 对远程抓取的立场（deepseek-harness `.agents/notes/implemented/feature/2026-10-15-deepseek-search-fetch-api.md`）：“选择 DeepSeek 即把页面获取与目标访问策略委托给该服务；Harness 拒绝 API 请求的重定向，保留取消和有界的工具输出。” 本项目的远程后端（search 与 fetch 一样）照此执行：

- 每次操作一个 API 请求（或一次 MCP `tools/call`）；本项目自己的 API 请求一律 `redirect: 'error'`（keyless 的也一样）；凭据按访问方式解析（keyless 不碰密钥，永远发往目录端点；api-key 经 DSH Credentials；DeepSeek 账号会话用账号令牌，只经 `native` 后端）；
- 不对目标 URL 做地址检查，也不做“披露”检查：URL 原样发给服务（不规范化、不解码），目标是否可达、能否抓取由服务决定。e2e `fetch-remote` 证明私网地址与编码过的回环地址都原样转发给服务，目标本身没有被访问；同一个 URL 交给 `local` 时被拒绝。设置页与菜单写明“URL 会发送给 <服务>”；
- 本项目自己实现的远程后端走 core 的有界 HTTP：search 为 2 MiB、90 s，fetch 为 5 MB、120 s（见下）；`native` 后端保持 DSH 原生 provider 的行为，模型可见输出由 tool-web 的 `fetchMaxOutputChars` 和搜索结果数兜底。

**fetch 的结果映射**（`src/remote/page.ts`）：

1. adapter 的 `parse` 返回 `PageOutcome`：`{ kind: 'page', page }` 或 `{ kind: 'failure', failure }`。`Page` 只有三项：`content`（服务返回的 Markdown 或纯文本）、`target`（服务报告的目标状态码与最终 URL，可缺席）、`truncated`（服务报告，或由它的字符预算可推断，正文被截过）。
2. 执行层用 `fetchResult(page, request)` 生成 `WebFetchResult`：`body` 固定为 `{ kind: 'text', content }`，tool-web 原样透传，不走 HTML→Markdown。`target` 缺席时用请求的 URL 与 200——这是兼容映射，与 DSH 的 `DeepSeekFetchApiProvider` 一样：200 表示“服务取到了页面”，不表示本机看到目标回了 200。
3. 服务报告的目标：只在服务给出 100–599 的整数状态码时采用（`reportedTarget`），最终 URL 经 `sourceUrl` 规范化，不可用时退回请求的 URL。Firecrawl 给 `data.metadata.statusCode` 与 `data.metadata.url`；Tinyfish 成功时只给 `final_url`，状态码按兼容映射记为 200；Exa 与 Tavily 都不给，整体按兼容映射。
4. `statusPage`：服务对这个 URL 报失败、但**明确给出目标的 HTTP 状态**时，结果是该状态码、请求的 URL、空正文，与 DSH“非 2xx 是结果，不是错误”一致。适用于 Tinyfish `errors[0].status`、Exa REST `statuses[0].error.httpStatusCode` 为整数，以及 Firecrawl 正文为空而 `statusCode` 不是 2xx。不从文字标签推断状态码（Exa 的 `CRAWL_NOT_FOUND` 不当成 404）。
5. 其余逐 URL 的失败用共享词汇 `PageFailure`；执行层用连接的 label 生成给模型的错误（`pageFailure(label, failure)`），从不带服务的原文：

   | `PageFailure` | 来源 | 错误码 |
   | --- | --- | --- |
   | `timeout` | Exa `CRAWL_TIMEOUT` / `CRAWL_LIVECRAWL_TIMEOUT`；Tinyfish `timeout` | `WEB_FETCH_TIMEOUT` |
   | `too-large` | Tinyfish `content_too_large` | `WEB_FETCH_TOO_LARGE` |
   | `invalid-url` | Tinyfish `invalid_url` / `invalid_redirect_url` | `WEB_INVALID_URL` |
   | `empty` | 没有结果或正文为空；Exa keyless 的 “No content found…”；Tinyfish `empty_content` | `WEB_PROVIDER_ERROR` |
   | `rate-limited` | Exa keyless 结果的 `_meta['ai.exa/rateLimited'] === true`（这种限流提示不带 `isError`，不识别就会被当成正文） | `WEB_PROVIDER_ERROR`，提示稍后重试或改用个人密钥 |
   | `failed` | Firecrawl `success !== true`；Tavily `failed_results` 非空或没有结果；Exa、Tinyfish 的其余错误标签 | `WEB_PROVIDER_ERROR` |
   | `invalid` | 响应不符合服务文档描述的形状 | `WEB_PROVIDER_ERROR` |

   服务自身的 HTTP 非 2xx（鉴权、额度、限流、5xx）由 core 的传输报 provider 错误；MCP 结果的 `isError` 由 core 的 MCP 客户端报 “<label> could not read the page…”。
6. 截断：本插件把正文截到 100 000 字符（不切开代理对），截过就 `truncated: true`。服务都不给截断标志：Exa 的请求带字符预算 `maxCharacters: 100000`，返回正文长度 ≥ 预算时视为可能被截断，也记 `truncated: true`；其他服务没有字符参数，`false` 只表示服务没有说、本插件也没截。
7. 标题不拼进正文，与 DSH 的 DeepSeek Fetch API provider 一致：只返回服务给的正文。
8. Exa keyless 的工具文本是几行元数据（`# 标题`、`URL:`、`Published:`、`Author:`）、一个空行、正文。解析只在开头 8192 个字符内找第一个空行，之前的每一行都是这几种元数据时才剥掉，否则整段原样作为正文。工具文本整体先限 512 × 1024 个字符、至多 100 个 text 块（超出报 `invalid`），只做逐行的 `indexOf` 推进，不对整段正文跑多行正则。

**能力参数**（fetch 自己的常量，`src/remote/http.ts`、`page.ts`，不是运维参数；给模型的文案由常量生成）：

| 参数 | 值 | 理由 |
| --- | --- | --- |
| 响应字节上限 | 5 000 000（文案写 “5 MB”） | 等于 `local` 缺省的 `maxResponseBytes`；页面比搜索结果大，search 的 2 MiB 会让正常的长页面整体失败 |
| 整体截止时间 | 120 000 ms（覆盖读凭据、MCP 握手与读正文） | 覆盖 Tinyfish 的 120 s 批量上限与 Firecrawl 的缺省超时；目录里服务端超时参数的上限都不超过 110 000 ms；tool-web 缺省 30 s 的工具超时通常先到 |
| 正文字符上限 | 100 000 | 等于原生 `maxBodyChars` 的缺省；接受字符预算的服务（Exa）按同一个值请求 |

**每家服务的缓存与隐私**：只写 2026-10-20 读公开文档与源码时核实过的说法；设置页每个远程服务的说明与此一致。

| 服务 | 已核实 | 未核实 |
| --- | --- | --- |
| Exa | keyless 走 Exa 托管 MCP 的 `web_fetch_exa`，免登录、限流，额度不公布；内容可能来自 Exa 的索引缓存（REST 的 `maxAgeHours` 控制，MCP 不能设置）；零数据保留只对 Enterprise 开通；MCP 网关按会话保存客户端信息（clientInfo，即本插件的名称与版本，以及 User-Agent），带过期时间 | 是否用查询或 URL 训练；匿名额度的线上取值 |
| Firecrawl | keyless 是同一 REST 端点、不带 Authorization，按 IP 每天限额（数字不公布）；缺省可返回 2 天内的缓存（`maxAge`），结果缺省存入 Firecrawl 的缓存与索引（`storeInCache`）；零数据保留只对企业开通 | 训练用途；keyless 下受限的参数 |
| Tavily | keyless 是同一端点加 `X-Tavily-Access-Mode: keyless`，额度不公布，错误格式与带 key 时不同；FAQ 写零数据保留，隐私政策写保留到提供服务所需的期限 | Extract 是否缓存；训练用途 |
| Tinyfish | 只接受个人密钥；缺省可能返回已有缓存（`ttl` 控制）；服务条款授予 Tinyfish 用客户数据训练与改进其模型的许可 | 匿名抓取；该条款之后的限制条件；保留期 |

### 6.7 共用的词汇

下面是 core 里实际的接口（省略 `readonly` 与部分泛型约束；以源码为准：`core/src/shared/connections.ts`、`shared/selection.ts`、`shared/settings.ts`、`host/capability.ts`、`host/plans.ts`、`host/adapter.ts`、`host/mcp.ts`、`client/section.ts`）。

~~~ts
// ./shared —— Host 与浏览器同构，不导入 Node、浏览器或 Host 包
type ConnectionId = `builtin:${string}` | `custom:${string}`   // custom 名：[A-Za-z0-9][A-Za-z0-9._-]{0,99}
type AccessMode = 'keyless' | 'api-key'          // 持久化的访问方式
type Access = AccessMode | 'account'             // 一次调用实际的鉴权方式；account 按会话的模型路由推导
type BackendKind = 'native' | 'adapter' | 'model' | 'local'

type OptionRule =
  | { kind: 'enum'; values: readonly string[]; keyless?: readonly string[] | false }
  | { kind: 'text'; pattern: RegExp; maxLength?: number; keyless?: false }  // 先查长度（缺省 2000）再跑正则
  | { kind: 'url'; keyless?: false }                                        // isEndpoint
  | { kind: 'boolean'; keyless?: false }
  | { kind: 'integer'; min: number; max: number; keyless?: false }
  | { kind: 'list'; pattern: RegExp; max: number }                          // 能力再加语义检查（CIDR）

interface AccessFacts { keyless: boolean; apiKey: { credentialRef: string } | false; account: boolean }
interface Descriptor {                     // 目录事实；能力扩展它（search：endpoint、freshness；fetch 的 native 与 adapter：endpoint）
  label: string
  homepage?: string
  kind: BackendKind
  remote: boolean                          // 查询或 URL 是否离开本机（只用于说明文字）
  access: AccessFacts
  options: Record<string, OptionRule>
}

interface Selection<O> { connectionId: string | null; revision: number; options: O }  // null = 关闭；revision 0 = 从未选择
type SelectionSource = 'session' | 'inherited' | 'model' | 'default'
interface Pairing { provider: string; model: string; connectionId: string | null }
type ConnectionStatus = 'ready' | 'disabled' | 'needs-credential' | 'unsupported'   // 只看本地事实
type ConnectionView = { id: string; label: string; kind: BackendKind; remote: boolean
  access: Access; status: ConnectionStatus; detail?: string } & Record<string, unknown>  // 能力用 extras 加字段
interface SelectionView<O> { selection: Selection<O>; source: SelectionSource; connections: ConnectionView[] }
declare function selectionContract(spec: { namespace: string; packageName: string; options: ZodRawShape; extras: ZodRawShape }):
  { options, optionsChange, connectionView, selection, selectionView, selectionChange, remoteInfo }

interface ResolvedDocument<D, C = ResolvedBase> {
  version: number; defaultConnection: string; showSelector: boolean; defaults: D; connections: ReadonlyMap<string, C>
}
type ResolvedBase = { id: string; label: string; disabled: boolean; remote: boolean
  trustedEndpoint: boolean; options: Record<string, unknown>; catalogKey: string } & (
  | { kind: 'local'; access: 'keyless' }
  | { kind: 'native' | 'adapter'; access: AccessMode; credentialRef: string; endpoint: string })
declare function resolveDocument(input: { catalog; document: unknown; defaults: { schema; defaultConnection: string }
  capabilityLabel: string; retiredFields?: string[]; migrations? }): ResolvedDocument<D>
interface CustomConnection<A extends string = string> {   // 持久化形状；文法是 customConnectionSchema(目录的 adapter 键)
  kind: 'adapter'; adapter: A; label: string; credentialRef: string
  endpoint?: string; trustedEndpoint?: boolean; disabled?: boolean; options?: Record<string, unknown>
}

// ./host —— 只在 Host
interface CapabilitySettings<C extends { id: string; disabled: boolean; kind: BackendKind }> {
  defaultConnection: string; connections: ReadonlyMap<string, C>
}
interface OptionsCodec<O, S> {             // 只编码会话参数；connectionId、revision、inherited 归 core
  initial(settings: S): O
  fromRecord(record: Record<string, unknown>, settings: S): O   // 旧记录缺的参数用当前默认值
  toRecord(options: Partial<O>): Record<string, unknown>
}
interface CapabilityCall { ctx: Context; agent: Agent | undefined; signal: AbortSignal | undefined }  // agent 只来自 currentInitiator()

/** 每个插件交给 core 的全部差异；core 据此装配存储、会话、计划、限制、Remote 与 Seat。不放状态。 */
interface Capability<S extends CapabilitySettings, O, V extends ConnectionView, T, Q, R> {
  identity: PluginIdentity                 // 包名、行 id、provider id
  tool: 'web_search' | 'web_fetch'
  field: 'searchProvider' | 'fetchProvider'   // web 行里对应的字段，用于路由判断
  remoteNamespace: string
  storageDomain: string
  contract: HostContract<O>                // selectionContract 的 Host 部分（selectionChange）
  optionsCodec: OptionsCodec<O, S>
  settings(): S                            // 当前运维设置；无效时抛给模型看的 WebError
  describe(settings: S, agent: Agent): Promise<V[]>                               // 连接状态，不含凭据引用
  target(connection: Selectable<ConnectionOf<S>>, options: O, call: CapabilityCall): T  // 每次调用新建，不缓存
  execute(target: T, request: Q, call: CapabilityCall): Promise<R>
  register(ctx: Context, invoke: (request: Q, signal?: AbortSignal) => Promise<R>): void  // 注册唯一的 provider
}
type Plan<O> = { kind: 'off' } | { kind: 'failed'; error: WebError } | { kind: 'ready'; connectionId: string; options: O }
declare function isSelectable(connection): boolean   // 存在、未停用、不是 model
declare function installCapability(ctx: Context, capability: Capability): { plan(agent?: Agent): Plan<O> | undefined }

// ./host 的 adapter 与 mcp —— 两侧远程后端共用的请求/解析线
type Auth = { kind: 'keyless' } | { kind: 'api-key'; key: string }   // 账号令牌只经 native 后端
interface McpToolCall { url: string; tool: string; arguments: Record<string, unknown>; handshake: boolean; headers?: Record<string, string> }
interface McpRoute<I, O> extends Omit<McpToolCall, 'arguments'> {
  arguments(input: I): Record<string, unknown>
  parse(result: McpToolResult, input: I): O
}
interface AdapterWire<I, O> {
  request(input: I, endpoint: string, auth: Auth): HttpRequest
  parse(payload: unknown, input: I): O
  keyless?: 'rest' | McpRoute<I, O>         // 'rest'：同一个 request，以 keyless 身份发往目录端点
}
/** 目录标为 keyless 的项缺 keyless 路由即编译失败。 */
type KeylessBound<Facts extends { keyless: boolean }, W extends AdapterWire<never, unknown>> =
  Facts['keyless'] extends true ? W & Required<Pick<W, 'keyless'>> : W
type AdapterTarget =
  | { access: 'keyless'; label: string; endpoint: string }                       // 总是目录端点
  | { access: 'api-key'; label: string; endpoint: string; credentialRef: string }
declare function adapterTarget(connection: AdapterTarget, catalogEndpoint: string): AdapterTarget   // keyless 改写为目录端点
interface AdapterIO {
  errors: CapabilityErrors; transport: Transport; mcp: McpClient
  credential(ref: string): Promise<string | undefined>
  onDiagnostic?: OnDiagnostic
  credentialMissing(ref: string): string     // 没有存密钥
  credentialInvalid(ref: string): string     // 密钥含可见 ASCII 与空格以外的字符
}
/**
 * 在 transport.withDeadline 内：keyless → 'rest' 发 request(input, 目录端点, keyless)，或一次 MCP tools/call，不读凭据；
 * api-key → 读凭据并去掉首尾空白，为空或含非法字符都报 WEB_PROVIDER_CREDENTIAL_MISSING（消息只有凭据名称，
 * 不发请求、不进诊断），再发往 target.endpoint；最后 parse。不改写非 WebError：能力的执行层负责。
 */
declare function runAdapter<I, O>(io: AdapterIO, wire: AdapterWire<I, O>, target: AdapterTarget, input: I, signal: AbortSignal | undefined): Promise<O>

// ./client —— 只在浏览器
interface SelectionState<V> { view: V | undefined; saving: boolean; readFailure: 'invalid-settings' | 'failed' | undefined }
interface SelectionUpdate { connectionId?: string | null; options?: Record<string, unknown> }
type WriteResult = { ok: true } | { ok: false; error: RemoteFailure }
interface SelectionStore<V extends SelectionView = SelectionView> {
  source(sessionId: string): ObservableSnapshot<SelectionState<V>>   // 每会话一个稳定的快照源
  load(sessionId: string, modelKey?: string): Promise<void>          // 会话模型变化时重读
  set(sessionId: string, update: SelectionUpdate): Promise<WriteResult>  // 用视图中的 revision 写入，被拒后重读
}
interface RouteStore { source: ObservableSnapshot<Route> }
interface ConnectionText { label: string; caption?: string; reason?: string }
interface ConnectionSection {
  capability: 'search' | 'fetch'
  order: number                                             // 菜单中的位置，小的在前
  title: () => string                                       // 已本地化
  selection: SelectionStore
  describe: (connection: ConnectionView) => ConnectionText
  sourceText: (view: SelectionView) => string
  writeFailureText: (error: RemoteFailure) => string
  Options?: ComponentType<{ sessionId: string }>            // 能力特有的会话参数，如 search 的实时性
  settings: ObservableSnapshot<(() => void) | undefined>    // 打开本插件的设置；插件页不可用时为 undefined
}
interface WebConnectionsService {
  registerRoute(capability: 'search' | 'fetch', route: RouteStore): () => void   // 路由事实，与分区无关（9.2）
  routes: ObservableSnapshot<ReadonlyMap<'search' | 'fetch', Route>>   // 缺条目 = 没有运行中的插件提供环境变量事实
  register(section: ConnectionSection): () => void          // 在注册者的 effect 里调用，随其 fiber 释放
  sections: ObservableSnapshot<readonly ConnectionSection[]>   // 按 order 排序
}
~~~

几点说明：

- 校验不在 `Capability` 里：插件的 `settings()` 由 core 的 `settingsRow` 包装，每次调用都对当前行配置跑一次插件的 `resolveSettings`（建在 `resolveDocument` 上）。计划由 core 的 `planFor` 生成，没有能力自己的 `plan`；也没有“invalid”计划，连接是否可选在调用时由 `isSelectable` 判定。
- `Selection.connectionId` 是 `string | null`，id 语法由设置校验保证；Remote 层再限制长度（≤128）。
- core 只处理“用哪个连接”；`T`（执行目标）与后端接口都归能力。

后端接口：两侧的 adapter 都是上面的 `AdapterWire`，能力只给出输入与解析结果的类型：

~~~ts
// search（src/search/adapters/types.ts、src/search/execute.ts）
type Adapter = AdapterWire<SearchInput, WebSearchSource[]>
type AdapterFor<K extends AdapterKey> = KeylessBound<typeof CATALOG[K]['access'], Adapter>
const ADAPTER_WIRES = { exa, firecrawl, tavily, tinyfish, openalex, semanticscholar } satisfies { [K in AdapterKey]: AdapterFor<K> }
type SearchTarget =
  | { kind: 'adapter'; connection: AdapterConnection; freshness: Freshness }   // executeSearch → runAdapter
  | { kind: 'native'; provider: WebSearchProvider }          // 包装后的上游实例

// fetch（src/remote/types.ts、src/remote/page.ts）
interface FetchInput { url: string; options: Record<string, unknown> }    // URL 原样；参数已按访问方式校验
type FetchWire = AdapterWire<FetchInput, PageOutcome>
type FetchWireFor<K extends AdapterKey> = KeylessBound<typeof CATALOG[K]['access'], FetchWire>
const ADAPTER_WIRES = { exa, firecrawl, tavily, tinyfish } satisfies { [K in AdapterKey]: FetchWireFor<K> }
interface ReportedTarget { statusCode: number; url: string }
interface Page { content: string; target: ReportedTarget | undefined; truncated: boolean }
type PageFailure = 'timeout' | 'too-large' | 'invalid-url' | 'empty' | 'rate-limited' | 'failed' | 'invalid'
type PageOutcome = { kind: 'page'; page: Page } | { kind: 'failure'; failure: PageFailure }
// fetch 的执行目标是一个 WebFetchProvider（src/host/runtime.ts），execute 调用它的 fetch：
//   local   → createLocalBackend(() => connection.options)
//   native  → createNativeFetchBackend(…)（包装后的 DeepSeekFetchApiProvider）
//   adapter → createRemoteBackend(connection, deps)：runAdapter → pageFailure(label, failure) 或 fetchResult(page, request)
~~~

两侧的执行层（search `executeSearch`、fetch `createRemoteBackend`）形状相同：先查取消；`runAdapter`（目标由 `adapterTarget(connection, 目录端点)` 构造）；`WebError` 原样交出，其余异常先进诊断，再改写为固定的 `WEB_PROVIDER_ERROR`；已取消时优先报 `WEB_ABORTED`。

**刻意不统一的部分**：请求/结果类型（DSH 本来就分开）；输入与解析结果（search 是来源列表，fetch 是 `PageOutcome`），以及 fetch 自己的页面→`WebFetchResult` 映射；传输数值（6.3；fetch 的 `local` 由运维配置）；search 独有的实时性、模型连接、来源规范化；fetch 独有的 `local` 白名单、解析器、白名单提示。共享的是选择范式与机制，不是数值和能力语义。

**为什么 fetch 的 adapter 也是请求/解析对**：另一种做法是让 fetch 的 adapter 承担整次调用（`fetch(request, signal) → WebFetchResult`）。本设计让两侧都实现同一个 `AdapterWire`，由 core 的 `runAdapter` 执行，理由：调研的四个抓取服务都是一次 API 请求（或一次 MCP 调用）就取到页面；“keyless 永不读取密钥”“keyless 永远发往目录端点”“密钥只含合法的请求头字符”这几条安全规则因此只有一处实现、一组测试（core `adapter.spec.ts`）；两侧真正不同的只有输入、解析结果和 fetch 的页面映射。若以后某个服务必须多步调用，再单独设计。

## 7. 新增一个后端

总的步骤：

1. 在插件的 `src/catalog.ts` 加一条 Descriptor（位置即显示顺序，键成为 `builtin:<键>`），写明 `kind`、`remote`、访问方式、端点和参数规则；
2. 实现并登记后端（位置见下表）；`native` 只需实例化上游类并照搬原生行的凭据/端点解析（用 core 的 `nativeAuth` 与 `nativeBackend`）；
3. 文案：连接说明（远程服务写明会收到什么）、参数名、占位符、枚举值（zh / en 同键）；
4. 测试：adapter 的测试覆盖请求形状（URL 原样、请求头、请求体）与解析映射；传输边界（API 重定向被拒且目标未被访问、字节上限、截止时间、取消、keyless 不发送密钥）在 core 与能力的执行层各测一次（search 的 adapter 测试仍用本地 HTTP 服务充当远程 API）；`native` 只测凭据解析与错误改写。

| 插件 · 种类 | 要碰的位置 |
| --- | --- |
| search · adapter | `src/search/adapters/<键>.ts`；`catalog.ts` 的 `ADAPTER_KEYS`；`adapters/index.ts` 的 `ADAPTER_WIRES`。`settings/resolve.ts` 把非 native 的目录项自动派生为 adapter 连接，设置页与菜单由目录驱动，不用改 |
| search · native | `src/backends/<键>.ts`；`catalog.ts` 的 `NATIVE_KEYS`；`backends/native.ts` 的 `createNativeBackend`；`settings/resolve.ts` 的 native 分支与 `NativeConnection['native']`（两项写死） |
| fetch · adapter | `src/remote/adapters/<键>.ts`（`export const <键>: FetchWireFor<'<键>'>`）；`catalog.ts` 的 `ADAPTER_KEYS`；`remote/adapters/index.ts` 的 `ADAPTER_WIRES`；服务说明（`client/settings/model.ts` 的 `SERVICE_NOTES`）与参数文案。`resolveSettings` 按目录项的 `kind` 派生连接，设置页、菜单与自定义连接的格式列表由目录驱动，不用改 |
| fetch · native | `src/backends/<键>.ts`；`catalog.ts` 的 `NATIVE_KEYS`；`backends/native.ts` 的 `createNativeFetchBackend`（目前只有一项，直接返回 `deepseekFetchApi`；加第二项时改为按键选择）。浏览器面不用改：凭据名称、`baseURL` 与信任开关由 core 的服务列表按目录渲染 |

不需要改 profile、`web` 行、Seat、Planner 或输入框菜单：菜单只渲染 Host 给出的连接视图。新增后端时同步第 6.4 节的目录说明与插件 README。

## 8. 配置、状态与凭据

| 位置 | 内容 | 编辑方 |
| --- | --- | --- |
| `web` 行 | 两个 provider id | 只有 profile patch；用户层覆盖视为用户主动退出（第 11 节的预检会提示） |
| `web-search-enhanced` 行 | 统一配置文档（8.1）；`defaults.freshness` | 插件设置页，经 Settings（volatile 字段，热生效） |
| `web-fetch-enhanced` 行 | 统一配置文档；`connections['builtin:local'].options` 含 `allowCidrs`、`allowHostnames`、`userAgent`、`maxResponseBytes`、`maxBodyChars`、`timeoutMs`、`maxRedirects`；远程 adapter 的覆盖与自定义连接 | 同上 |
| storage-domain `web_search_enhanced` / `web_fetch_enhanced` | 表 `selections`（每会话的选择）与 `pairings`（模型记忆），域版本 1；记录形状见 6.2，与 0.1.x 相同 | `searchConnections` / `fetchConnections` Remote；记忆由会话里的选择写入，设置页可清除 |
| DSH Credentials | API 密钥 | 设置页经 `remote.credentials`；配置里只存 `credentialRef` |

### 8.1 统一配置文档

两个插件的行配置是同一份文法（core `shared/settings.ts`），Host 与浏览器用同一个纯函数解析（各插件的 `resolveSettings` 建在 `resolveDocument` 上）；两侧的差别只有目录和 `defaults` 的字段。全部字段可选，缺省由目录给出；设置页的写入是稀疏的，只记录与下层或目录不同的部分。

顶层字段：

| 字段 | 类型与限制 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `version` | 只接受 `2` | 省略时按 2 读取 | 见 8.3 |
| `defaultConnection` | 连接 id，≤200 字符，必须是存在的连接 | search `builtin:deepseek-messages`，fetch `builtin:local` | 未选择过的会话用它（6.2）；不检查是否停用；可以是 `custom:*` |
| `showSelector` | boolean | `true` | `false` 时不向输入框菜单注册本能力的分区，`/setup-*` 与设置页照常 |
| `defaults` | 严格对象 | search `{ freshness: 'auto' }`，fetch `{}` | search：`freshness` 为 `auto` / `fresh` / `realtime`；fetch 没有会话参数 |
| `connections` | 记录，至多 200 个键，键 ≤200 字符 | `{}` | 键为 `builtin:<目录键>`（覆盖）或 `custom:<name>`（自定义） |

连接字段：

| 字段 | 内置覆盖 `builtin:*` | 自定义 `custom:*` |
| --- | --- | --- |
| `kind` | 不接受 | 必填，只接受 `adapter` |
| `adapter` | 不接受 | 必填，本插件目录里的 adapter 键（search 六项，fetch 四项） |
| `label` | 可选，1–200 字符 | 必填，1–200 字符 |
| `disabled` | 可选，缺省 `false` | 同左 |
| `access` | 可选，`keyless` / `api-key`，只能是目录允许的；缺省有 keyless 路由时为 `keyless`，否则 `api-key` | 不接受，总是 `api-key` |
| `credentialRef` | 可选，DSH Credentials 里的名字（`^[A-Za-z_][A-Za-z0-9_]*$`），目录没有 API key 访问方式时拒绝；缺省用目录给的名字 | 必填 |
| `endpoint` | 不接受（内置 adapter 的端点不可改） | 可选，绝对 http(s) URL，不带凭据、查询与片段；缺省为目录端点 |
| `trustedEndpoint` | 可选；`url` 类参数（如 native 的 `baseURL`）不同于目录端点时必须为 `true` | 可选；`endpoint` 不同于目录端点时必须为 `true` |
| `options` | 可选，按目录的 `OptionRule` 校验，未知参数拒绝；keyless 访问可能拒绝或收窄某些参数 | 同左，按 `api-key` 访问校验 |

search 行的例子：

~~~yaml
version: 2                              # 可省略；只接受 2
defaultConnection: custom:team-tavily
showSelector: true
defaults:
  freshness: auto                       # auto | fresh | realtime
connections:
  builtin:exa:
    access: api-key                     # 目录允许 keyless 与 api-key
    credentialRef: EXA_API_KEY          # DSH Credentials 里的名字，不是密钥本身
    options: { type: fast }
  builtin:deepseek-messages:
    trustedEndpoint: true               # baseURL 不同于官方端点，必须确认
    options: { baseURL: https://deepseek-proxy.example.internal/anthropic/v1, maxUses: 3 }
  custom:team-tavily:
    kind: adapter
    adapter: tavily
    label: Team Tavily
    credentialRef: TEAM_TAVILY_KEY
    endpoint: https://tavily.example.internal/search
    trustedEndpoint: true               # endpoint 不同于官方端点，必须确认
    options: { topic: news }
~~~

fetch 行的例子：

~~~yaml
defaultConnection: builtin:local
connections:
  builtin:local:
    label: Intranet fetch
    options:
      allowCidrs: [10.0.0.0/8]
      allowHostnames: ['*.corp.example']
      timeoutMs: 15000
  builtin:deepseek-fetch-api:
    credentialRef: DEEPSEEK_API_KEY
    trustedEndpoint: true
    options: { baseURL: https://deepseek-proxy.example.internal/v1/tools }
  builtin:firecrawl:
    access: api-key                     # 缺省 keyless；改用个人密钥（缺省 credentialRef 为 FIRECRAWL_API_KEY）
    options: { storeInCache: false, maxAge: 0 }
  custom:team-firecrawl:
    kind: adapter
    adapter: firecrawl
    label: Team Firecrawl
    credentialRef: TEAM_FIRECRAWL_KEY
    endpoint: https://firecrawl.example.internal/v2/scrape
    trustedEndpoint: true               # endpoint 不同于官方端点，必须确认
~~~

校验规则（`resolveDocument`，能力的 `resolveSettings` 在其上派生自己的连接形状）：

- **校验前预算**：在复制、迁移或解析文档之前，先遍历一次并拒绝过大的输入：任何容器至多 200 项、文本与键至多 2000 字符、嵌套深度至多 20、总节点至多 100 000；任意层级出现 `__proto__` / `constructor` / `prototype` 键即拒绝。迁移的每一步之后再查一次。
- 文档与连接都是严格对象：未知字段、未知连接 id 拒绝。文本参数至多 `TEXT_MAX_LENGTH`（2000）字符，或规则自己更小的 `maxLength`；fetch 白名单每个数组至多 200 条。
- `options` 按目录的 `OptionRule` 校验；fetch 再用 `local/rules.ts` 检查每条 CIDR 与主机名规则，错误点名第几条。
- 自定义连接的 `adapter` 只能取本插件目录里的 adapter 键，总是 api-key，参数按 api-key 访问校验；目录没有 adapter 项时任何 `custom:*` 都按未知连接 id 拒绝并附 Reset 提示（没有单独的开关）。持久化形状 `CustomConnection` 与 `customConnectionSchema` 有类型级的相等断言。search 的 `model` 连接是计划（第 13 节 M4），字段随它一起设计；当前 `builtin:session-model` 按未知 id 拒绝，`kind: model` / `kind: structured` 按非法值拒绝。
- 错误消息点名字段路径；未知字段、未知连接 id 与参数错误附带 “this release does not read 0.1.x settings; remove the field or use Reset on the settings page”。

校验在哪里发生：

- Host（core `settingsRow`）：插件启动时校验一次（无效只记日志，插件照常激活，以便设置页能修复）；Loader 的 `internal/config` 钩子在写入前校验，非法候选不落盘；每次调用经 `settings()` 读取，当前文档无效时报 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`；具体诊断只在启动校验与写入钩子里记入 Host 日志，不给模型。插件的 `Config` schema 把每个文档字段和退役字段都声明为 `z.any().volatile()`，校验全部留给共享的解析函数。
- 浏览器：设置页对有效文档（两层叠加后的结果）显示正常的编辑器，每次写入前对“写入后的完整候选文档”再校验一次；文档无效时只显示一条提示（诊断在提示的 title 里）和 Reset；两侧的提示都是“无法读取这些设置，可能来自 0.1.x 或更新的版本……”（`settings.unsupported`），“设置无效，未保存。”（`settings.invalid`）只用于写入前的校验失败与迁移写回失败。

### 8.2 0.1.x 的配置不迁移

配置格式在 0.2 重新设计（用户的决定），不兼容 0.1.x 的配置。退役的 0.1.x 顶层字段（各插件 `src/settings/retired.ts`）：

- search：`providerId`、`freshness`（顶层；现为 `defaults.freshness`）、`modelMode`、`protocol`、`baseURL`、`model`、`fallbackModel`、`apiKey`、`apiKeyEnv`、`apiVersion`、`toolIdentifier`、`maxTokens`、`maxUses`、`chatSearchMode`、`searchContextSize`；
- fetch：`schemaVersion`、`providerId`、`allowCidrs`、`allowHostnames`、`userAgent`、`maxResponseBytes`、`maxBodyChars`、`timeoutMs`、`maxRedirects`（现为 `connections['builtin:local'].options` 的同名参数）。

它们在插件的 `Config` schema 里仍有声明，只为让浏览器看得见、诊断能点名、Reset 能删除；Host 照样拒绝读取，消息为 “<字段> is a 0.1.x setting this release does not read; remove it or use Reset”。

**Reset**：设置页的 Reset 在确认后对本行用户层的每个字段执行 `unset`（下层与 DSH Credentials 里的密钥不动）。`apiKey` 在 schema 里标为 secret，设置视图里被遮蔽，页面无法判断它在哪一层：search 设置页用 `withRetiredSecretDiagnostics` 点名它并提示手工删除。会话选择与模型记忆（storage-domain）的记录格式不变，照常可用。

### 8.3 版本与迁移

- `documentVersion` 把文档分为 current、older、newer、invalid。省略 `version` 的文档永远按 2 读取（2 是这份文法的起点）；从 v3 起，手写的文档必须显式写出 `version`。大于当前版本的拒绝并提示升级插件；不是正整数时拒绝。
- `migrateDocument` 是 N→N+1 的纯函数表（`SETTINGS_MIGRATIONS`），在校验之前于内存中执行；当前为空表。较旧版本缺少迁移步骤时报错并给出 Reset 提示。前身的格式不是这张表的一员：不猜测前身的 schema，也不改写它的字段。
- 设置页对需要迁移的旧版本文档先显示迁移后的视图并锁定编辑，按 revision 把迁移结果写回一次（写入带 `expectedRevision`，revision 变了就不再写）；Host 从不静默改写文档。
- 设置页的写入只要含 `set` 就顺带写上 `version: 2`；纯 `unset`（包括 Reset）不写。新增可选字段不提升版本；只有不兼容的变化才提升版本（`CURRENT_SETTINGS_VERSION`），并同时增加一个迁移步骤。

## 9. 浏览器面

### 9.1 谁注册什么

| 槽位 / 入口 | 注册者 | 说明 |
| --- | --- | --- |
| `commandUi`：`/setup-search`、`/setup-fetch` | 各插件 | 用命令选择或关闭本会话的连接；不依赖 ui 包，ui 包停用时仍可用。两者都由 core 的 `selectionCommand` 生成：`/setup-search` 列出关闭、各个可用连接、所选连接支持时的实时性；`/setup-fetch` 列出关闭与各个可用连接（fetch 没有会话参数） |
| `plugins.row.config`（键 `rowConfigKey()`） | 各插件 | 行设置页：路由提示、默认连接、服务列表、自定义连接、模型记忆（可逐条清除）、Reset。只在本行运行时注册（`configForms.whileServed`），由 core 的骨架按目录组成，写入前用本插件的 `resolveSettings` 校验写入后的完整文档；文档无效时只显示无效提示与 Reset（第 8 节）。服务列表给每个目录项：启用开关；访问方式（目录同时有 keyless 与 API key 时）；凭据名称与只写的密钥输入；`url` 参数与“信任此地址”开关；其余参数的自动保存表单（boolean 参数是“默认 / 开 / 关”三态菜单，“默认”即不写，不把服务的缺省显示成“关”）。行的副标题只显示访问方式摘要；展开面板里写明“URL（或查询）会发送给 <服务>”，fetch 的四个远程服务另有一条缓存与保留说明（6.6）。fetch 的 `local` 注册了自己的附加编辑器：白名单编辑器保留显式“保存”，逐行诊断（语法、可一键套用的修正、重复行，以及过宽、含回环、含云元数据地址、公网范围这类不阻止保存的提醒），点“保存”时用一次写入同时设置 `allowCidrs` 与 `allowHostnames` 两个数组，说明里写明经代理访问的域名由代理解析、规则无法限制；User-Agent 编辑器允许空串并可一键恢复缺省。其余字段在编辑结束时稀疏保存。自定义连接区两侧相同：每行写明 URL（或查询）会发送给哪个服务（目录里的服务名，自定义端点时附上主机名）；编辑器、信任确认、删除时的默认复原见下 |
| 浏览器服务 `webConnections` | ui 包提供 | 菜单分区的注册表；search 注册 order 10 的分区，fetch 注册 order 20 的分区 |
| `conversation.input.right`（一个按钮） | ui 包 | 两个能力共用的连接菜单 |
| `plugins.bundle.activation`（键为 profile 包名） | ui 包 | 首次启用提示，覆盖两个能力。该键只能有一个注册者，ui 包是自然的主人：说明用法并提供打开详情页的按钮；它跑与 bundle 概览相同的预检（第 11 节），发现问题时改为提示“之前的设置可能让本组合包无法接管网页工具”，引导到详情页处理 |
| `plugins.detail.section` | ui 包 | profile 详情页的概览：两个能力是否路由到本插件（取自插件提供的路由事实，见 9.2）、插件行是否停用、第 11 节的预检结果 |

设置页的写入规则（core 骨架，两侧相同）：

- **信任绑定到确认过的地址**：内置连接的 `url` 参数（如 native 的 `baseURL`）填了非官方地址时，要打开“信任此地址”才写入，地址与 `trustedEndpoint: true` 在同一次写入里保存。已信任地址 A 后改成 B，开关显示为关、不写入，并提示“尚未保存：请先确认信任此地址”；确认后才写入 B。关闭生效中的信任时，一次写入清除该连接所有非官方的 `url` 参数并写 `trustedEndpoint: false`；下层也有非官方值时，在用户层写官方值，保证生效的端点确实回到官方。清空地址即回到官方值。自定义连接编辑器同理：同意绑定到目的地（格式、端点与 `url` 参数），目的地变了要重新勾选；编辑一个已信任、目的地未变的连接时保持已同意。
- **切到 keyless**：访问方式切回 keyless 时，同一次写入清掉 keyless 不接受的参数（`keylessRejected`，与 `catalogFields` 同一规则：规则为 `keyless: false`，或枚举值不在 keyless 列表里），否则写入后的文档会被校验拒绝；切回 API key 不清理。
- **删除自定义连接**：只有它正是 `defaultConnection` 时，才在同一次写入里把默认复原为目录缺省。
- **凭据名称**：内置连接可以改用另一个 DSH Credentials 名称，清空即回到目录给的名称；两侧文案都叫“凭据名称”。

可视化的连接选择集中在 ui 包；插件只负责“本能力的数据与命令”。命令和菜单读写同一个 `SelectionStore`，在任一处切换，另一处立即反映。

“打开设置”的入口：DSH 0.2.1-rc.2 的 `pluginNavigation` 只公开 `openBundle`，所以两个插件的分区与 ui 包都打开 profile 的插件页，行设置页在那里展开。

### 9.2 分区契约

契约在 `core/src/client/section.ts`（只有类型，形状见 6.7）；`SelectionStore` 的实现是 core 的 `ConnectionSelectionStore`，两个插件各实例化一份。插件端用可选注入注册分区，并跟随 `showSelector` 注册或注销；ui 包不存在或被停用时，插件的命令和设置页照常工作：

~~~ts
ctx.inject(['webConnections'], ui => {
  ui.effect(() => {
    // settings 变化时：showSelector !== false 则 register(section)，否则调用返回的注销函数
    …
  }, 'search: composer section')
})
~~~

- **一个或两个插件行被停用**：ui 包必须照常工作，它对插件没有任何依赖。
  - 停用一个：该插件的浏览器 fiber 释放，分区随之注销；菜单只剩另一个分区，按钮照常显示。ui 包自己根据 `ids.ts` 中的身份、`configForms.whileServed([<rowId>])` 和 `configForms.get('web')` 发现“`web` 行仍指向一个已停用插件的 provider”，在菜单底部和 bundle 概览里说明该能力当前不可用、可在插件页重新启用该行——这条信息不能依赖已经注销的分区来提供。
  - 两个都停用：没有分区，不显示按钮；bundle 概览说明两个能力都不可用。
  - 恢复：插件行重新启用后分区重新注册，按钮回来，不需要刷新页面。
  - 判断来源：bundle 概览用插件页传入的 `subject.pkg.rows` 中各行的 `enabled`；菜单对 search 与 fetch 都用 `configForms.whileServed` 判断。e2e `menu-rows-off` 覆盖 search、fetch、两者分别停用：菜单只剩可用的分区，两者都停用时没有按钮，概览说明不可用的能力。
- **`showSelector: false`**：该插件不向 `webConnections` 注册分区（两侧相同；两个都关掉时按钮消失），`/setup-*` 与行设置页照常工作；改回 `true` 时分区重新注册。
- **路由事实与分区解耦**：插件在注入 `webConnections` 后用 `registerRoute(capability, route)` 提供路由事实（它的 `RouteStatus`：`web` 行加 `<ns>/provider` 给出的 `envProvider`），与分区的注册互相独立；`showSelector: false` 只撤下分区，路由事实照常提供。ui 读 `routes` 快照：菜单各分区的路由提示、菜单底部的停用提示与 bundle 概览都用它，因此看得到 `DSH_WEB_*_PROVIDER`。某个能力没有条目时（插件行未运行），浏览器没有环境变量的来源，只能按 `web` 行的值判断（ui 的 `routeFor`：有条目用条目，没有时 `routeOf(value, field, null, providerId)`）；这是已知限制（第 14 节）。
- **分区手风琴**：任一时刻至多一个分区展开，每次打开菜单展开第一个分区；每个分区的标题行总是显示“标题 · 当前连接 · 来源”。点已展开的标题收起它；→ 展开本分区并收起其他，← 收起本分区。分区展开（或展开后连接列表加载完）时，把选中的行滚动到可见处。分区标题在滚动时吸顶，底部的“设置”入口吸底。
- **菜单内容**：每个分区列出 Host 给出的连接（`ready` 可选，说明行是访问方式摘要，远程连接再写明接收方，例如 search “No key needed · the query is sent to Exa”、fetch “API key · the URL is sent to Firecrawl”；其余显示原因）、关闭行、当前选择的来源说明、分区的 `Options` 和“设置”入口；首次读取前显示加载中；读取失败时分区显示失败态并可重试，设置无效时说明“<能力>的设置无效，请打开设置修复”并给出设置入口（不提供重试）；`web` 行把该能力路由给别的 provider 时，分区顶部给出路由提示；写入被拒时用提示条显示 `writeFailureText`。会话模型变化（`modelSelection` 投影）时各分区按新模型重读。
- **能力特有的界面归插件**：search 的实时性等会话参数由插件以 `Options` 组件提供，ui 包只负责外壳、布局、收起和通用行（连接列表、状态、来源、关闭）。这样新增一种会话参数不需要改 ui 包。
- **一个按钮**：按钮按分区 `order` 显示每个已注册分区的当前状态（连接名，或带分区名的“已关闭”“读取失败”“设置无效”“连接已移除”等），两侧以“·”分隔；某侧需要处理（读取失败、设置无效、所选连接被移除或未就绪、路由给了别的 provider）时该侧带警示点。按钮的可访问名称与 title 是逐侧的状态，例如 “Search: Exa · Fetch: Local HTTP”，需要处理的一侧加 “(needs attention)”。输入栏变窄时按 container query 逐级收起：≤460px 隐藏文字，警示点移到地球图标上（search 在右上、fetch 在右下）；≤380px 只剩图标，警示点保留；不用 JavaScript 测量。
- **契约版本**：两个插件与 ui 包同一节奏发布，profile 精确锁定版本，所以分区契约不需要跨版本兼容；契约变化时三个包一起改。

### 9.3 共同约束

- **产物**：每个有浏览器面的包一个 `lib/client.cjs`，由 `build/tsdown.ts` 生成 DSH 模块加载器格式（`window.__ModuleLoader__.load({ id, factory })`）。扩展名用 `.cjs` 是因为包是 `"type": "module"` 而产物是 CJS 形状，publint 要求如此；DSH 的模块加载器不关心扩展名。只有壳的平台模块外置（`build/platform.ts`：React、Cordis、zod、`@tanstack/react-virtual`、`dsh-client-store`、`dsh-client-ui-slots` / `-primitives` / `-dockkit`），其余内联；其他 DSH 浏览器能力（设置表单、命令、插件导航等）经注入的服务使用，代码里只导入它们的类型。CSS Modules 编译进包，每个样式表注入一个带 `data-plugin` 的 `<style>`。package.json 声明 `dsh.client` 与 `exports["./client"]` 后，构建工厂自动产出客户端。ui 包的 Host 面是空插件：DSH 只为已挂载的行加载浏览器面，所以它也要作为一行挂载。
- **路由提示**：读 `configForms.get('web')` 与 `<ns>/provider`，用 core 的 `routeOf` 判断；`web` 行没有选中本插件时，在行设置页顶部和菜单对应分区说明原因与恢复方法。
- **文案与样式**：界面文字全部走 locale 字典（zh 为主，en 完整对应）；Host 只返回错误码和英文诊断；样式只用 DSH 的 `--dsw-*` 变量；浏览器不读取密钥。字典在各包的 `src/client/locales.ts`（命名空间等于行 id），`locale/*.json` 只放插件页读取的 `meta`。

## 10. 安全不变量

本项目自己的传输与执行层：

1. 本项目自己发出的 API 请求（含带凭据的）一律 `redirect: 'error'`，回归测试证明重定向目标未被访问；
2. core 的有界 HTTP 执行字节上限（先看 Content-Length，再在流上计数）和整体截止时间（覆盖鉴权、握手和读正文）；
3. 不自动重试，不自动 fallback；改换后端只由 Agent 显式选择（第 13 节 M5）；
4. keyless 永不读取、发送或回退到密钥，并且永远发往目录端点（core `adapterTarget`）；
5. 密钥只在 DSH Credentials；配置只存引用；每次调用解析，不跨调用缓存。本项目自己的后端只经 Credentials 解析（`resolveApiKey`）；`native` 后端照搬原生行（`nativeAuth`）：Credentials 服务存在时只读它，缺席时才读 DSH 启动环境的同名变量。本项目自己的后端在发请求前校验密钥：去掉首尾空白后只能含可见 ASCII 与空格，否则报 `WEB_PROVIDER_CREDENTIAL_MISSING`（消息只有凭据名称，提示重新录入），不发请求，密钥与异常都不进诊断——含换行等控制字符的值会让 `fetch` 构造请求头时抛出带整个头值的异常；
6. 自定义端点需显式 `trustedEndpoint`，内置 adapter 端点不可改；例外是内置 `native` 连接的 `baseURL`：为提供与原生行同等的参数（第 14 节）允许覆盖，但覆盖值与官方端点不同时必须同时写 `trustedEndpoint: true`，否则校验拒绝。设置页的信任确认绑定到确认时的地址：地址变了要重新确认，关闭信任即撤销并回到官方端点（9.1）。设置校验还拒绝 `__proto__` / `constructor` / `prototype` 键，并在复制或展开文档之前先按预算拒绝过大的输入（8.1）；
7. 给模型的错误只含错误码和可操作的简短英文提示，不含端点、上游正文、cause 或密钥——`native` 后端的错误同样改写（未知码一律 `WEB_PROVIDER_ERROR`）；fetch 的 `local` 对官方 `HttpFetchProvider` 抛出的 `WebError` 原文透传（它们本就是 DSH 给模型的安全消息），只有本插件白名单的拒绝用本插件文案，其余异常给固定文案；白名单提示按规范化、去重后的规则生成，总长度有预算（2000 字符），超出时给出计数摘要和部分示例而不是全文；诊断细节只进 Host 日志。Remote 服务对浏览器同理：契约外的异常一律报 `gateway/internal` 加固定消息，原始异常只进 Host 日志；
8. `available()` 只做本地判断；
9. 本项目自己的出站一律用全局 `fetch`，继承 DSH 安装的代理策略，不自建 dispatcher。

`native` 后端：行为与 DSH 原生 provider 一致，包括它们的上限策略（例如原生 DeepSeek provider 读取 API 响应时不设字节上限，由 tool-web 限制模型可见输出）。这是“与原生等价”的一部分，不另加约束；若要收紧，应改为本项目自己的 `adapter` / `model` 实现。

fetch 的 `local`：

10. 白名单为空时与原生 public-only 等价，任何默认值都不扩大可达范围；
11. 直连请求校验完整 DNS 答案集，任一不合规即拒绝，连接固定到已验证地址；走代理的域名请求由代理解析，白名单无法约束它们（上游传输的既有行为，设置页和文档都已写明）；
12. 模型与会话都不能控制白名单、请求头、方法或代理；重定向只在同源内跟随，每跳复查；
13. 白名单提示只在本步计划使用 `local`、`allowCidrs` 非空且确认路由到本插件时进入模型上下文，无法判断时不加。

远程后端（两侧）：

14. 目标访问策略由服务负责，本项目不对目标 URL 做地址检查；连接说明写明查询或 URL 会发给谁；
15. fetch 的远程结果只来自服务的回答：正文一律 `text`；服务没给目标状态时用请求的 URL 与 200（兼容映射，不表示本机见过目标）；只有服务明确给出的目标状态码才成为非 2xx 结果，不从文字标签推断；正文按 100 000 字符截断并如实标记（6.6）；
16. 会话只能在运维启用的连接之间选择；冻结的只是“用哪个连接”（和会话参数），连接是否停用、是否为 `model` 这类运维策略在每次调用时按当前设置判定（core 的 `isSelectable`），连接的端点、凭据引用与参数也在每次调用时读当前值。关闭时的工具限制只在确认 `web` 行选中本插件时安装，未路由或无法判断时不隐藏，以免藏掉别的 provider 的同名工具；插件卸载后不再安装限制。

search：

17. 来源只保留无用户信息的 http(s) URL，长度有上限（8192）；`native` 后端的结果同样经过这道过滤；
18. 发起调用的会话来自 `currentInitiator()`，从不来自工具参数。

## 11. 从 0.1.x 升级

| 前身 0.1.x | 0.2 / profile |
| --- | --- |
| 各自是 bundle，分别安装 | 只装 profile；两个插件成为它的依赖 |
| 顶替原生 id：`deepseek-official` / `http`，不改 `web` 行 | 自有 id：`search-enhanced` / `fetch-enhanced`，profile 拥有 `web` 行 |
| 共存模式（改 `providerId` 并手写 `web` 行） | 不需要：原生 provider 可以同时挂载 |
| fetch 只有行级配置 | fetch 与 search 一样：连接 + 会话选择；白名单、User-Agent 与上限成为 `builtin:local` 的参数（格式不同，不自动迁移） |
| 两个插件各自的配置格式（search `version: 2` 加顶层字段，fetch `schemaVersion`） | 两侧同一份配置文档（第 8 节）；0.1.x 的配置被拒绝，用 Reset 或手工删除 |
| 配置页挂在 `plugins.bundle.config`（键为插件包名） | 挂在 `plugins.row.config`（键为 `dsh-tool-web-enhanced-profile#<行 id>`） |

升级步骤：移除 `dsh-web-search-enhanced`、`dsh-web-fetch-enhanced` 两个直接依赖，安装 `dsh-tool-web-enhanced-profile`。直接把旧包升级到 0.2 而不安装 profile 时，包失去 `dsh.bundle` 声明，行随之消失：README 和 0.2.0 的 CHANGELOG 写明了这一点。

要区分三件事：

- **数据保留**：插件管理器移除 bundle 时只取消选择、重载组合，再 `pnpm remove`，不删除用户层中的任何覆盖（deepseek-harness `packages/boot/plugin-manager/src/index.ts` 的 `removeBundle` / `selectBundle`）；storage-domain 的数据也留在 DSH home。行 id 与 search 的存储域名不变，所以这些数据在安装 profile 后仍然挂在同名的行和域上。
- **数据可用**：配置不迁移。两个插件都不读 0.1.x 的配置：Host 拒绝它（插件照常激活，调用报 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`，Host 日志点名退役字段并提示 Reset），设置页显示无效提示、在 title 里点名字段并提供 Reset；被保留的旧配置在用户确认 Reset 或手工删除之前原样留在用户层，从不被静默改写。storage-domain 里的会话选择与模型记忆照常可用：记录格式没有变，关闭搜索的旧会话在 Reset 之后仍是关闭。
- **路由残留（需要预检）**：被保留的还有用户层里对 `web` 行的覆盖和行的启用状态。前身共存模式写下的自定义 provider id（现已无人注册）、内置开关写下的原生或 API 选择、重新启用的 `web-search-deepseek`，都会压过 profile 的选择，让本插件收不到流量。
  - 预检在 bundle 概览里，检查三项：(a) 用户层 `web` 行把某个字段改成了原生或 API provider（search：`deepseek-official`、`deepseek-search-api`；fetch：`http`、`deepseek-fetch-api`）；(b) 用户层字段是前身共存模式留下的自定义 id（既不是本插件的，也不是原生的）；(c) `web-search-deepseek` 被重新启用（`configForms.whileServed`）。(a)(b) 旁边提供“移除遗留设置”（只在可修复的项旁出现）：确认后对用户层执行 `unset`，只移除这些字段；取消不写任何东西。(c) 不是本包能写的，只说明并指引到插件页。首次启用提示跑同一个预检（`checkUpgradePreflight`）：没有问题时说明用法，有问题时提示之前的设置可能让本组合包无法接管网页工具，并引导到详情页处理；它自己不写任何东西。
  - 预检看不到已停用的原生 `web-search-deepseek` 行上的用户覆盖（`baseURL`、`model` 等）：浏览器只为运行中的行投影配置（第 14 节）。
  - e2e `upgrade` 覆盖两侧：真实的前身 0.1.x bundle（含共存模式、search 与 fetch 的已保存设置、关闭搜索的会话）→ 移除 → 安装 profile；组合后的配置与用户层文件不变；Host 拒绝两份旧配置、日志点名字段且不改写它们；概览的修复取消时不写、确认后才执行，修复后 (c) 仍在提示；两个设置页显示无效提示，Reset 后行配置为空、两侧恢复默认连接；冷启动后旧会话的关闭仍然保留。

升级前的人工预检清单：先移除两个 0.1.x bundle 再安装 profile；记下旧设置里要保留的内容（白名单、自定义连接），升级后在设置页重新录入；密钥留在 DSH Credentials，不受 Reset 影响。

## 12. 构建、测试与发布

- **构建**：`build/tsdown.ts` 是所有插件的唯一构建定义（每个包的 `tsdown.config.ts` 只有 `pluginBuild(import.meta.url)`）。Host 产物为 ESM，内联非 `@deepseek-ai/*` 依赖；有 `./client` 导出时同时产出浏览器产物。`build/plugins.ts` 提供标准装饰器降级（DSH 的 `@Remote`，对内联的 core 文件同样生效）和 CSS Modules，构建与 Vitest 共用。fetch 的 `ipaddr.js` 是 devDependency，构建时内联进 Host 产物。
- **检查**：`pnpm run check` = typecheck → oxlint（type-aware）→ build → vitest → verify:package。`verify-packages` 用 pnpm 打包每个可发布包，检查：清单里没有残留 `workspace:` / `catalog:`；所有包的 `engines.dsh` 相同，`@deepseek-ai/dsh-*` peer 与之一致；插件没有 `dependencies`，Host 产物只导入 Node 内置和 `@deepseek-ai/*`；profile 依赖的版本等于本次发布的插件版本；导出目标、图标、`locale/{en,zh}.json` 的 `meta` 都在包里；最后跑 publint。
- **单元与组合测试**：在接缝处测试行为——在真实 `WebRuntime` 里注册插件，断言 `web` 行选中后调用落到插件；profile 的 patch 用真实的 include 补丁算法叠加到 base 的 web 行上，断言 `web` 行、停用行、插入行和最终路由。会话行为在真实的 Web preset Agent 上测试，而不只是 `ctx.web`（search 与 fetch 各自的 `agent.spec.ts`，用 `@deepseek-ai/dsh-agent-loop-testkit`）；core 的会话、计划、限制、存储与配置文法有自己的测试（`packages/core/tests`），fetch 的白名单用本地 HTTP 服务、可替换的 DNS 查询与本地代理测试。浏览器面用 jsdom 渲染真实的 DSH 界面原语；测试环境的两处补丁见 development.md。
- **端到端**：`pnpm run test:e2e` 在 `.e2e/` 里建立隔离的 DSH 世界（HOME、DSH_HOME、XDG、缓存、pnpm store 全部重定向，清除 `DSH_*`、`DEEPSEEK_*`），按 `pnpm-workspace.yaml` catalog 中的版本安装 DSH，用 pnpm 打包全部可发布包，再用真实插件管理器把 profile 装进 `web` profile（插件依赖经 profile 的 pnpm `overrides` 指向本次的 tarball）。之后读 `--dump-config` 验证组合，按 CLI 的步骤在进程内启动 Host 验证路由与运行时行为，启动 `dsh web` 并用 Playwright 驱动真实界面。规格清单、覆盖点与排查方法见 [development.md](development.md#8-端到端测试)。
- **发布**：四个可发布包同一节奏发布（release train），profile 精确依赖同一次发布的插件与 ui 版本。CI 在 `v<profile 版本>` 标签上先核对标签与 profile 版本一致并跑 `pnpm run check`，再用 npm trusted publishing（OIDC + provenance）执行 `pnpm -r publish`，已发布的版本会被跳过。

## 13. 路线图与扩展点

按纵向切片推进，每个里程碑都端到端可用；共享抽象在第二个使用者出现时才进入 core。

| 里程碑 | 内容 |
| --- | --- |
| **M0 [已完成]** | monorepo、构建与检查工具链、profile 组合（含 ui 行）、两个插件各一个原生等价后端、空的 ui 包、单元/组合/e2e 测试（含插件行停用的组合） |
| **M1 search 切片 [已完成]** | 在 search 包内移植前身的会话选择、模型记忆（含可见的来源与清除）、每步计划、关闭与隐藏、Remote、`/setup-search`、行设置页；ui 包的浏览器面（`webConnections`、共用菜单、首次启用提示、插件行停用时的说明），search 注册第一个分区；`native` 连接 `deepseek-messages`、`deepseek-search-api` 与六个 `adapter`；第 11 节的路由预检；在真实 Web preset Agent 上的 e2e |
| **M2 fetch 对齐 [已完成]** | 把选择范式抽进 core（`./host`、`./client`、`./shared/settings`），search 迁移到 core 且行为断言未改；两侧统一的配置文档、退役字段的诊断与 Reset、版本识别与（空的）迁移表，不读 0.1.x 配置；fetch 的目录（`builtin:local`、`builtin:deepseek-fetch-api`）、`local` 白名单与提示、会话选择、模型记忆、关闭与隐藏、`fetchConnections`、`/setup-fetch`、行设置页（白名单编辑器）与菜单分区；ui 菜单的分区折叠与观感修复；`web` 行变化时的重算 |
| **M3 fetch 远程后端 [已完成]** | MCP 客户端与 adapter 的请求/解析线、执行骨架移入 core（`AdapterWire`、`runAdapter`、`adapterTarget`），search 改用，MCP 的 SSE 改为逐行线性扫描；fetch 的四个远程 adapter（Exa、Firecrawl、Tavily、Tinyfish）与结果映射、能力参数（6.4、6.6），fetch 的自定义连接；设置页完全由目录驱动（凭据名称、`url` 参数与信任开关、按目录键注册的附加编辑器，自定义连接区移入 core），信任绑定到确认过的地址，两侧无效文档文案统一；API key 的请求头值校验；Remote 未知异常的脱敏；首次启用提示里的预检；路由事实与菜单分区解耦；e2e 补“ui 行停用”的组合、真实 Host 上的远程抓取、远程连接的菜单与设置页、截图。原生 `web-search-deepseek` 行覆盖的迁移提示没有干净的数据来源，记入第 14 节 |
| **M4 [计划]** | ① core 的统一 provider 抽象：一个服务（如 Exa、Firecrawl）在 core 里只实现一次，按能力提供 `search` 与 `fetch` 两个可选方法，两个插件从同一份 provider 表取用；只做搜索或只做抓取的服务只实现其一，两侧不强求共用同一组 provider（现状：两侧只共用 `AdapterWire` / `runAdapter` 与 MCP 客户端，同一服务的 search 与 fetch adapter 各写一份）。② search 的 `model` 后端与“跟随会话模型”：`model` 后端参考前身 0.1 的实现（`src/search/model.ts`）移植；跟随会话模型参考前身的 `src/host/follow-model.ts`，但 DSH 已更新 provider 设置的范式，需要按当前范式重新解析会话模型的路由，并对 DeepSeek 官方 provider 做专门处理；两者的配置字段按统一配置文档（第 8 节）重新设计 |
| **M5 [计划]** | 自有增强工具：带参数的 `web_search_enhanced` 与 `web_fetch_enhanced`，让 Agent 在运维启用的连接中自己选择本次调用的后端；辅助工具 `list_web_search_providers` 与 `list_web_fetch_providers` 列出当前可用的连接及其能力，设计参考 DSH 官方“列出可用子 agent 路由”的做法。工具以 preset 行的形式由 bundle 组合（见下方扩展原则），可选范围仍受行设置与可选性规则（`isSelectable`）约束。不提供自动 fallback：Agent 可在一次调用失败后用 `web_*_enhanced` 自行选择另一个后端重试 |
| **M6 [计划]** | 支持 [dsh-tui](https://github.com/ccch1mneyyy/dsh-TUI)：在终端界面里提供与浏览器面对应的连接选择与状态（Host 侧的选择、Remote 与 `/setup-*` 语义不变） |

扩展原则：新能力优先落在 Planner（选什么）或 Backend（怎么取），不改 Seat 与 `web` 行；每个插件只注册一个 provider。增加模型工具时遵循 DSH 的做法——由 bundle 在 agent preset 中组合工具行，而不是全局注册同名工具：全局同名注册在 base profile 会直接失败，在 Web profile 会被 preset 内的原生工具遮蔽。

## 14. 风险与已知限制

风险：

- **`web` 行被更晚的层覆盖**：其他 bundle 或用户层改写 `web` 行会覆盖我们的选择（只写一个字段时还会丢掉另一个）。对策：路由提示、第 11 节的预检和 e2e 断言组合；不做运行时自我修复。
- **原生 `web-search-deepseek` 行的用户配置不被继承**：停用后其 `baseURL`、`model`、`apiKeyEnv` 等覆盖不再生效。`builtin:deepseek-messages` 提供同等参数（`baseURL`、`model`、`apiVersion`、`maxTokens`、`maxUses` 与 `credentialRef`，`baseURL` 需 `trustedEndpoint: true`），但预检看不到原生行的这些覆盖（见下方已知限制），只能靠文档提醒。
- **内置 native 连接的 `baseURL` 可改**（search 的两项与 fetch 的 `deepseek-fetch-api`）：自定义连接的端点也可改：这让密钥或账号令牌可能发往运维指定的端点；以显式 `trustedEndpoint: true` 作为确认，与官方端点相同的值视为未覆盖，设置页的确认绑定到确认时的地址。
- **远程服务的行为由服务决定**：fetch 的目录、请求形状与结果映射依据 2026-10-20 读到的公开文档与源码，测试与调研都没有向真实服务发请求。服务改了字段或错误形状时，adapter 报 `invalid` 或 provider 错误，不猜测；URL 与读到的内容会交给服务，各服务的缓存与保留以 6.6 的表为准。
- **`native` 后端随 DSH 版本变化**：它们直接使用上游类和原生行的解析逻辑，升级 DSH 基线时要逐一对照（见 development.md）。fetch 的 `local` 同样依赖 `HttpFetchProvider` 的构造签名、解析器接缝与它对 IP 字面量、代理的处理；`rules.ts` 的非公网范围表依赖 `ipaddr.js` 的版本。
- **0.1.x 配置被拒绝**：升级后旧配置让对应能力不可用，直到用户 Reset 或手工删除；这是用户的决定（第 8、11 节）。设置页与 Host 日志都点名字段；密钥类退役字段（`apiKey`）在设置视图里被遮蔽，只能提示手工删除。
- **ui 包是可选的**：插件对 `webConnections` 只做可选注入，ui 包停用或加载失败时，连接仍可通过 `/setup-*` 命令和行设置页管理。单元测试覆盖插件在没有 ui 服务时照常注册命令与设置页，e2e `ui-row-off` 在真实 GUI 里停用 ui 行，验证两个设置页仍能从插件页打开、两个 `/setup-*` 命令的选择能持久化。
- **构建期装饰器降级**：`@Remote` 依赖 `build/plugins.ts` 的 `standardDecorators()`（构建与 Vitest 各接一次）。换构建器或升级 TypeScript 时，要同时复查单元测试与 e2e 真实 Host 两条路径。
- **e2e 依赖 DSH 的启动积木**：`e2e/harness/host.ts` 用 `@deepseek-ai/dsh-app-boot` 的公开导出按 CLI 的步骤启动 Host，它们不是文档化的嵌入 API；DSH 版本变化时这是唯一要调整的地方。

已知限制：

- **停用的原生 `web-search-deepseek` 行在浏览器里没有配置命名空间**：Settings 只为运行中的行投影 schema 与值，profile 停用这一行后，浏览器读不到它的用户覆盖（`baseURL`、`model`、`apiKeyEnv` 等），预检因此无法提示把它们迁移到 `builtin:deepseek-messages`。
- **插件行未运行时浏览器无法得知 `DSH_WEB_*_PROVIDER`**：环境变量事实来自插件的 `<ns>/provider`，插件行停用后，菜单的停用提示与 bundle 概览只按 `web` 行的值判断（9.2）。
- **Tinyfish 只提供 API key**：匿名抓取没有官方依据，也没有实测（6.4）。
- **Exa 的 keyless 不能设置 `maxAgeHours` / `livecrawlTimeout`**：托管 MCP 工具只接受 URL 与字符预算，目录用 `keyless: false` 拒绝这两个参数，缓存策略按服务缺省。
- **服务调研中未核实的行为**：社区报告 Firecrawl v2 对目标 404 / 503 / 拦截页可能统一返回 HTTP 500（`SCRAPE_ALL_ENGINES_FAILED`），这时本插件报 provider 错误而不是 404 结果；Tavily 对目标 404 的表现、keyless 的错误体形状、Extract 是否缓存；Firecrawl keyless 下受限的参数；Exa 匿名额度的线上取值；各服务是否用收到的数据训练（Tinyfish 的条款允许）。adapter 对这些情形都按 provider 错误处理，等有真实样本再调整。

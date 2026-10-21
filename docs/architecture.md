# 架构

本文说明 dsh-tool-web-enhanced 的五个包如何组合为 DeepSeek Harness（DSH）的搜索与抓取能力，以及运行时、浏览器与安全边界为何这样划分。

产品行为（连接目录、配置字段、各后端的具体行为、错误措辞）见 [设计文档](design.md)；文件级结构见 [代码结构](code-structure.md)；开发流程见 [开发文档](development.md)；里程碑见 [开发计划](plan.md)。

## 定位

一个**不含代码的 profile bundle**（`dsh-tool-web-enhanced-profile`）挂载两个插件，并在共享的 `web` 行里选中它们注册的 provider。模型继续使用 DSH 原生 tool-web 的 `web_search` / `web_fetch` 的名称、参数与结果契约，不改写工具定义（`local` 的授权范围另以运行时上下文提示）；两个插件用**同一种选择范式**在各自唯一的 provider 内部切换后端。

三级选择各管一件事，互不改写：

| 层级 | 选什么 | 谁写 | 何时变 |
| --- | --- | --- | --- |
| `web` 行 | 哪个 provider 服务 web_search / web_fetch | profile patch，安装时一次 | 几乎不变 |
| 插件行设置 | 有哪些连接、默认用哪个、各自的参数与安全策略 | 运维，经插件设置页 | 随时，热生效 |
| 会话选择 | 本会话用哪个连接，或关闭 | 会话的使用者，经输入框菜单或 `/setup-*` | 随时，从下一个模型请求步生效 |

切换后端从不改写 `web` 行，所以不会与别的插件、DSH 的内置开关或用户层争抢这一共享行。search 与 fetch 各有一套设置和会话选择，分别切换。

本项目不做：注册自己的模型工具（计划中的 `web_*_enhanced`，见 [开发计划](plan.md)）、改写 tool-web 的 HTML→Markdown 转换、自动重试或自动 fallback（失败后是否改换后端由 Agent 决定）。

## DSH 的 web 接缝

DSH 把 web 能力拆成四种角色，彼此只经 `ctx.web` 相连。本项目只在“provider”与“组合”两个位置插入，其余原样复用。

~~~mermaid
flowchart LR
  subgraph bundle["组合：dsh-base（bundle，无代码）"]
    P["cordis.patch.yml<br/>web: searchProvider / fetchProvider"]
  end
  subgraph providers["provider 包"]
    S1["dsh-web-search-deepseek<br/>deepseek-official"]
    S2["dsh-web-deepseek-api<br/>deepseek-search-api · deepseek-fetch-api"]
    F1["dsh-web-fetch-http<br/>http"]
  end
  SEAM["接缝：dsh-web<br/>ctx.web 注册表 · 选择 · WebError"]
  TOOL["消费者：dsh-tool-web<br/>web_search / web_fetch"]
  P -. 选中 .-> SEAM
  S1 & S2 & F1 -- "registerSearchProvider / registerFetchProvider" --> SEAM
  TOOL -- "ctx.web.search / fetch" --> SEAM
~~~

| 角色 | DSH 的包 | 职责 |
| --- | --- | --- |
| 接缝 | `dsh-web` | 两张 provider 表；每次调用按 `web` 行的 `searchProvider` / `fetchProvider`（字段缺席时读 `DSH_WEB_SEARCH_PROVIDER` / `DSH_WEB_FETCH_PROVIDER`）选一个；定义请求、结果与 `WebError` |
| provider | `dsh-web-search-deepseek`、`dsh-web-deepseek-api`、`dsh-web-fetch-http` 等 | 各自注册 provider，并导出 provider 类供复用 |
| 消费者 | `dsh-tool-web` | 模型面的工具名、schema、提示词、多查询合并、HTML→Markdown、截断；不认识具体 provider |
| 组合 | `dsh-base` 等 bundle | 用 patch 插入行，并在 `web` 行选中 provider |

`WebRuntime` 的选择规则：配置的 id 已注册且 `available()` 即用它；已配置但未注册报 `WEB_PROVIDER_CONFIGURED_MISSING`，不可用报 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`；未配置时恰好一个可用才自动选中；同一 id 重复注册报 `WEB_DUPLICATE_PROVIDER`。没有 fallback，与注册顺序无关。

本项目与 DSH 的对位：

| DSH | 本项目 | 说明 |
| --- | --- | --- |
| `dsh-base` 的 web 段 | `dsh-tool-web-enhanced-profile` | bundle，用户只安装它 |
| search provider 包 | `dsh-web-search-enhanced` | 注册 `search-enhanced`，内部多后端，含自己的浏览器面 |
| `dsh-web-fetch-http` | `dsh-web-fetch-enhanced` | 注册 `fetch-enhanced`，内部多后端，含自己的浏览器面 |
| `dsh-web`、`dsh-tool-web` | 直接复用 | 不替换、不包装 |
| （无） | `dsh-tool-web-enhanced-ui` | 两个能力共用的输入框菜单与 bundle 概览；Host 面为空 |
| （无） | `dsh-tool-web-enhanced-core`（private） | 共享源码，构建时内联进各包，不发布 |

DSH 原生的 provider 类在本项目里作为 `native` 后端被直接实例化（见[后端种类与执行层](#后端种类与执行层)），所以“与原生等价”的默认连接就是原生实现本身。

## 包与依赖

五个包按“谁注册 provider、谁组合、谁只有浏览器面、谁只是共享源码”划分。

~~~mermaid
flowchart TD
  profile["profile<br/>cordis.patch.yml · locale · icon"]
  search["search-enhanced<br/>Host lib/index.js · Client lib/client.cjs"]
  fetch["fetch-enhanced<br/>Host lib/index.js · Client lib/client.cjs"]
  ui["ui<br/>Host 空 · Client lib/client.cjs<br/>提供 webConnections"]
  core["core（private）<br/>./shared · ./host · ./client"]
  dsh["DSH 安装（@deepseek-ai/*）"]
  profile -- "dependencies（发布时为精确版本）" --> search & fetch & ui
  search -. "可选注入：注册分区与路由事实" .-> ui
  fetch -. "可选注入" .-> ui
  search & fetch & ui -. "构建时内联" .-> core
  search & fetch & ui -- "peerDependencies" --> dsh
~~~

| 包 | npm 名 · 行 id · provider id | 职责 |
| --- | --- | --- |
| profile | `dsh-tool-web-enhanced-profile` | 只有 patch、locale 与图标；依赖另外三个包 |
| search | `dsh-web-search-enhanced` · `web-search-enhanced` · `search-enhanced` | 搜索目录、adapter 绑定与来源规范化、`native` 与 `model` 后端、实时性、设置解析、`/setup-search` 与行设置页 |
| fetch | `dsh-web-fetch-enhanced` · `web-fetch-enhanced` · `fetch-enhanced` | 抓取目录、`local`（白名单、地址策略、解析器）、`native` 后端、远程 adapter 绑定与页面映射、白名单提示、`/setup-fetch` 与行设置页 |
| ui | `dsh-tool-web-enhanced-ui` · `tool-web-enhanced-ui` | 浏览器服务 `webConnections`、共用的输入框连接菜单、首次启用提示、bundle 概览与升级预检 |
| core | `dsh-tool-web-enhanced-core`（private） | 选择范式的唯一实现、远程服务的 wire、设置文法、浏览器侧的选择存储与设置页骨架 |

依赖规则（由 `scripts/verify-packages.ts` 与评审守住）：

- 插件的 Host 产物只导入 Node 内置与 `@deepseek-ai/*`（由 DSH 安装提供，且必须是声明的 peer）；其他一切（包括 core 与 fetch 的 `ipaddr.js`）内联，插件没有 `dependencies`。
- search、fetch、ui 的 `src` 互不导入；共享代码只进 core。组合测试可以导入别的包的 `src` 来测真实接缝。
- core 不导入插件，不持有模块级状态：每个插件各内联一份 core，模块级状态既无法共享，又会让两次安装互相影响。
- 插件与 ui 之间只经浏览器服务 `webConnections` 相连，契约类型在 core。

标识只在 `packages/core/src/shared/ids.ts` 定义一次；patch 是 YAML 无法导入，由 profile 的测试断言它与 `ids.ts` 一致。命名沿用 DSH 惯例：行 id = npm 名去掉 `dsh-` 前缀，Cordis 插件名与 Settings 命名空间都等于行 id；`web-*-enhanced` 是注册 provider 的插件族，`tool-web-enhanced-*` 是围绕 tool-web 的产品层。两个插件的存储域与 Remote 命名空间分别是 `web_search_enhanced` / `searchConnections` 与 `web_fetch_enhanced` / `fetchConnections`。

## 组合：profile patch

profile 对 base profile 只叠加一层 patch（[cordis.patch.yml](../packages/profile/cordis.patch.yml)）：

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

- **profile 拥有 `web` 行，两个字段一起写。** patch 整体替换目标行的 `config`，不做深合并，只写一个字段会丢掉另一个。本仓库里除了这份 patch，没有代码写 `web` 行的值；更晚的层（用户层、别的 bundle）改写它即覆盖本项目的选择，这是 DSH 的层叠语义，也是退出的正常途径。
- **用自有 provider id。** `search-enhanced` / `fetch-enhanced` 不占原生席位，错误、日志与路由判断都指向本插件，原生 provider 也能同时挂载而不触发重复注册。
- **停用 `web-search-deepseek`。** 它的能力由 search 的 `native` 连接 `deepseek-messages` 承接；停用它同时撤下 DSH 内置的“网页搜索”页面，那个页面的开关会在用户层改写 `web` 行、把流量引走。
- **保留 `web-deepseek-api` 与 `web-fetch-http`。** 它们注册的 provider 未被选中，不参与路由，是手动退路。
- **ui 行不依赖插件行。** 插件向 ui 注册是可选注入，任一或两个插件行停用时 ui 照常激活；被停用的能力不会回退到别的 provider，调用报 `WEB_PROVIDER_CONFIGURED_MISSING`。

升级与退出路径（前身 0.1.x 的移除、路由残留预检）见 [设计文档 · 从 0.1.x 升级](design.md#从-01x-升级)。

## 运行时

本节讲 Host 侧的结构：一次调用经过哪些层、选择范式在哪一层生效、后端怎么分类、core 怎么分层。

### 一次调用的管线

两个插件用同一条管线，由 core 的 `installCapability` 装配；插件只提供一个 `Capability` 对象（身份、工具名、`web` 字段、存储域、Remote 命名空间、会话参数编解码、`settings()`、`describe`、`target`、`execute`、`register`）。

~~~mermaid
sequenceDiagram
  participant T as tool-web
  participant W as ctx.web（WebRuntime）
  participant S as Seat（唯一 provider）
  participant C as core installCapability
  participant B as 后端
  participant U as 上游
  T->>W: web_search / web_fetch
  W->>S: 按 web 行选中席位
  S->>C: invoke(request, signal)
  C->>C: currentInitiator() → 本步冻结的 Plan
  alt Plan 为 off / failed
    C-->>T: WebError（关闭或选择无法读取）
  else Plan 为 ready
    C->>C: settings() 读当前设置 · isSelectable 复查
    C->>B: capability.target(当前连接, 会话参数) → execute
    B->>U: DSH provider 类 / 有界 HTTP / MCP / HttpFetchProvider
    U-->>B: 回复
    B-->>T: 结果，或改写过的 WebError
  end
~~~

| 层 | 职责 | 不变量 |
| --- | --- | --- |
| Seat | 在 `ctx.web` 注册一次，id 固定 | `available()` 恒为 `true`、不做 I/O：能否服务取决于会话选择，调用时才知道 |
| Planner | 每个模型请求步产出 `Plan`：`off` / `failed` / `ready { connectionId, options }` | 同一步内不变；只冻结“哪个连接”与会话参数 |
| 复查与目标 | 读当前设置，`isSelectable` 复查，`target` 用当前连接新建执行目标 | 目标不缓存；运维策略每次调用读当前值 |
| 执行层 | 凭据、截止时间、把各后端的失败改写成给模型的短消息 | 后端拿到已解析的凭据与参数，不碰凭据存储 |
| 后端 | 某个服务的协议，或一个 DSH provider 实例 | 见[后端种类与执行层](#后端种类与执行层) |
| 传输 | DSH provider 类、core 的有界 HTTP 与 MCP 客户端、DSH 的 `HttpFetchProvider` | 见[安全架构](#安全架构) |

search 的 Seat 经 `createSearchSeat` 包一层，fetch 直接注册 `{ id, available: () => true, fetch }`。

### 选择范式

search 与 fetch 共用一份 core 实现；两侧的差别只是目录数据与能力参数，没有第二套机制。用户可见的行为（菜单、命令、来源说明）见 [设计文档 · 会话选择](design.md#会话选择)。

**概念**

- **连接**：到某个后端的一种配置。`builtin:<键>` 来自插件目录，运维可做稀疏覆盖；`custom:<name>` 由运维新建。连接与设置文档的字段见 [设计文档 · 配置文档](design.md#配置文档)。
- **插件行设置**：一份两侧共用文法的文档（core `shared/settings.ts`），Host 与浏览器用同一个纯函数解析（插件的 `resolveSettings` 建在 core `resolveDocument` 上）。它决定会话**能**选什么。
- **会话选择**：`{ connectionId | null, revision, options }`，存在插件自己的存储域表 `selections`。同一会话的读写排队执行，写入按 revision 比较；core 拥有 `connectionId`、`revision`、`inherited`，会话参数由能力的 `OptionsCodec` 编码（search 有 `freshness`，fetch 没有）。
- **模型记忆**：(provider, model) → 连接，存在表 `pairings`；选择落盘后才写记忆，记忆写失败只记日志。

未选择时由 core `Sessions` 解析出当前连接；选择来源、模型记忆与默认值的行为见[会话选择](design.md#会话选择)。

**冻结、复查与重建**

~~~mermaid
flowchart LR
  A["agent/request<br/>（turn, step）"] --> P["捕获 Plan<br/>只冻结 connectionId + options"]
  B["agent/created<br/>（-1, -1）"] --> P
  P --> CALL["每次调用"]
  CALL --> R["settings() 读当前文档"]
  R --> Q{"isSelectable<br/>存在且未停用"}
  Q -- 否 --> E["WEB_PROVIDER_CONFIGURED_UNAVAILABLE"]
  Q -- 是 --> TGT["target(当前连接)<br/>端点 · 访问方式 · 凭据引用 · 参数 · model 路由"]
~~~

- **每步冻结**：`agent/request` 时按 (Agent, turn, step) 捕获计划，`agent/created` 再捕获一次，让还没发过请求的 Agent 也有计划。同一步的并发捕获共享一次读取，只有失败的捕获可以在同一步重试。Seat 用 `ctx.agents.currentInitiator()` 找到发起调用的 Agent，从不从工具参数推断。
- **每次复查**：可选性只有一条规则（core `isSelectable`：存在且未停用），模型记忆、Remote 写入与每次调用的复查都用它。停用与重新启用因此从下一次调用生效，不必等下一步。
- **每次重建**：`target` 用当前连接新建执行目标，四种后端一律如此。search 的 `model` 连接的路由（协议、端点、凭据引用）也在这里推导，不进计划；跟随会话模型时取发起本次调用的那次请求的已解析路由。
- **设置无效**：`settings()` 由 core `settingsRow` 包装，当前文档无效时抛 `InvalidSettingsError`（码为 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` 的 `WebError` 子类），诊断只在启动校验与 Loader 的 `internal/config` 写入钩子里进 Host 日志。插件照常激活，以便设置页修复。
- **会话之外的调用**：没有发起 Agent 时按当时的 `defaultConnection` 与能力的初始参数计划。

**关闭与工具限制**

选择为 `null` 即关闭：Seat 对计划为关闭的调用报错，core `ToolRestriction` 用 `agent.ctx.tools.restrict({ deny: [<tool>] })` 对该 Agent 隐藏工具。关闭的用户语义见[关闭](design.md#关闭)。

- **只在路由到本插件时隐藏**：Host 用 Settings 的公开数据（`settings.describe()` 中 `ns = web` 的值）加环境变量判断路由（core `routeFacts` / `routeOf`），只有确认为 `this` 才安装；未路由或判断不了时不隐藏，以免藏掉别的 provider 的同名工具。
- **看 Agent 自己作用域的视图**：Web profile 里 tool-web 由 agent preset 挂在 Agent 作用域的祖先上，根 ctx 上没有这两个工具，所以判断工具是否存在用 `tools.get(tool, scopeOf(agent.ctx))`。
- **同步时机**：Remote 写入后立即同步；两个捕获点再同步。DSH 在 `agent/request` 之前已组装好本步的工具列表，所以关闭从下一次组装工具列表的步生效。
- **`web` 行变化**：`settings/document-updated`（`ns = web`）时对已知 Agent 重算：路由离开时立即撤销、不读存储；回到本插件时用只读的 `peek` 读选择（不为没有记录的会话建记录）。
- **卸载**：插件卸载时置 disposed 并撤销全部限制，之后在途的读写不再安装限制、捕获返回失败的计划。

**Remote**

浏览器经 `<ns>/get`、`<ns>/set`（带 `expectedRevision`）、`<ns>/provider`、`<ns>/pairings`、`<ns>/forgetPairing` 读写；契约由 core `selectionContract` 生成（两端都是严格 schema），服务由 core `createConnectionsService` 在工厂内声明带 `@Remote` 的类，每次安装一个新类。`get` / `set` 按被寻址的会话资源授权。Remote 在此隔离服务异常：契约内的错误原样交出，其余一律改为固定消息、原异常只进 Host 日志；对浏览器的错误分类统一见[浏览器看到的错误](design.md#浏览器看到的错误)。

`provider` 只返回浏览器看不到的两项事实 `{ providerId, envProvider }`，路由由浏览器用同一个 `routeOf` 判断。连接视图不含凭据引用。

**两侧的差别只是参数**

| 维度 | search | fetch |
| --- | --- | --- |
| 隐藏的工具 · `web` 字段 | `web_search` · `searchProvider` | `web_fetch` · `fetchProvider` |
| 会话参数 | `freshness` | 无 |
| 特有的后端种类 | `model` | `local` |
| 远程后端的传输上限 | 2 MiB、90 s | 5 MB、120 s |
| 能力特有的上下文 | 无 | `local` 白名单提示（系统提示的运行时上下文，只在本步计划用 `local`、白名单非空且确认路由到本插件时加入） |

### 后端种类与执行层

后端按“谁实现协议、谁负责目标访问”分四种；目录项的 `kind` 决定连接走哪一种。各目录项与各后端的具体行为见 [设计文档 · 连接与目录](design.md#连接与目录) 与 [设计文档 · 各后端的行为](design.md#各后端的行为)。

| 种类 | 用于 | 实现 | 行为基准 |
| --- | --- | --- | --- |
| `native` | search / fetch | 实例化 DSH 导出的 `DeepSeekSearchProvider`、`DeepSeekSearchApiProvider`、`DeepSeekFetchApiProvider`，凭据与端点解析照搬对应原生行（core `nativeAuth`、`nativeBackend`） | 与原生一致，只改写错误消息（core `restateNative`） |
| `adapter` | search / fetch（含 `custom:*` 的 `kind: adapter`） | core 的 provider wire，由 `runAdapter` 执行 | 对齐 DSH 远程 provider 的立场：目标访问策略归服务 |
| `model` | 仅 search（跟随会话模型与固定模型） | search `src/model/`：三种协议的请求与解析、路由推导（DeepSeek 集中在 `deepseek.ts`）、跨命名空间读取预算、凭据与执行；走 search 的有界传输 | 各厂商当前的 API；跟随 DeepSeek 时与 DSH 自带的 DeepSeek 搜索一致 |
| `local` | 仅 fetch | DSH `HttpFetchProvider` 加本插件注入的解析器，每次调用按当前参数新建 | 白名单为空时等于原生 public-only |

执行层（两侧形状相同）：

- search：`target` 产出 `adapter` / `native` / `model` 三种目标；`executeSearch` 跑 adapter 与 native，`executeModelSearch` 跑 model。所有来源（含 native 与 model）经同一个 `SourceList` 规范化。
- fetch：`target` 直接产出一个 `WebFetchProvider`：`createLocalBackend`、`createNativeFetchBackend`、`createRemoteBackend`（`runAdapter` 之后由 `page.ts` 把页面映射为 `WebFetchResult` 或措辞失败）。
- 共同顺序：先查取消；执行；`WebError` 原样交出；其余异常以去敏副本进诊断，改写为固定的 `WEB_PROVIDER_ERROR`；已取消时优先报 `WEB_ABORTED`。

**为什么 `local` 是唯一做地址检查的后端**：只有经 HTTP(S) 直接访问目标的后端才需要、也才能检查目标地址。`local` 不重写传输，只注入解析器：直连请求校验完整 DNS 答案集与 NAT64，连接固定到已验证地址；IP 字面量在交给传输前先查（官方传输对它判为公网的字面量会直接交给代理）；经代理的域名由代理解析，规则无法约束，与上游一致。

### core 的 provider wires 与 runAdapter

远程服务的协议在 core 里每个服务一个模块（`host/providers/<服务>.ts`），按能力分别命名导出 wire（如 `exaSearch` / `exaFetch`；完整导出见[代码结构 · core](code-structure.md#core)）。插件只把 wire 绑定到目录键：

~~~ts
// search：src/search/adapters/index.ts —— 解析结果映射成 DSH 来源
const ADAPTER_WIRES = { exa: mapWire(exaSearch, searchSources), /* … */ } satisfies { [K in AdapterKey]: AdapterFor<K> }
// fetch：src/remote/adapters/index.ts —— 直接绑定，映射在执行层
const ADAPTER_WIRES = { exa: exaFetch, firecrawl: firecrawlFetch, tavily: tavilyFetch, tinyfish: tinyfishFetch } satisfies { [K in AdapterKey]: FetchWireFor<K> }
~~~

| 构件 | 作用 |
| --- | --- |
| `AdapterWire<I, O>` | `request(input, endpoint, auth)` 与 `parse(payload, input)`，可选的 keyless 路由：`'rest'`（同一请求、匿名发往目录端点）或一次 MCP `tools/call` |
| `KeylessBound` / `KeylessWire` | 目录标为 keyless 的项缺 keyless 路由即编译失败 |
| `mapWire` | 把 REST 与 MCP 两条解析结果都经同一个函数映射一次，请求与路由不变 |
| `adapterTarget` | keyless 目标一律改写为目录端点，不带凭据引用 |
| `runAdapter` | 在一个截止时间内：keyless 不读凭据，发 REST 或 MCP；api-key 读凭据，经 `storedApiKey` 检查（见[安全架构](#安全架构)的密钥格式），再发往目标端点；最后 `parse` 并对解析结果再次去敏，覆盖键名转成文本的服务格式。非 `WebError` 以去敏副本抛出 |
| 能力词汇 | `providers/search.ts`：`SearchInput`、`SearchRow`、`SearchOutcome`（行，或 `api` / `invalid` 失败）；`providers/fetch.ts`：`FetchInput`、`Page`、`PageFailure`、`PageOutcome`、`MAX_BODY_CHARS` |

分界与理由：

- **wire 不写给模型的措辞**：服务模块只放服务知识（请求、信封、字段名与语义），解析返回闭合的 outcome，不构造 `WebError`；上游自己的说明只作为数据（`detail`）带出。措辞、来源规范化、页面映射与截断在插件，同一个服务因此能在两侧以各自的口吻报错。
- **REST 端点由插件解析连接后传入 wire**：内置连接与 keyless 使用目录端点，自定义 API-key 连接可使用运维给出、已确认信任（`trustedEndpoint: true`）的端点；MCP URL 定义在服务 wire 中，不另建统一端点表。
- **独立的命名导出，没有 provider 表**：同一服务的两侧 wire 只共享模块私有常量，各自是独立的对象字面量，模块顶层不执行工厂。只用一侧的插件因此在打包时摇掉另一侧的解析；在出现需要枚举服务的使用者之前不建表。
- **fetch 的 adapter 也是请求/解析对**：调研的抓取服务都是一次请求取到页面，让两侧共用 `runAdapter`，“keyless 不读密钥”“keyless 只发目录端点”“密钥只含合法头字符”这几条规则就只有一处实现、一组测试。
- **刻意不统一**：两侧的输入与解析结果、同一服务两侧的解析语义、传输数值、search 独有的实时性与 model 后端、fetch 独有的 `local`。共享的是机制，不是数值和能力语义。

新增后端、服务或 model 协议要碰哪些位置见 [开发文档](development.md)。

### core 的三个入口

core 是只有源码的私有包，`package.json` 的 `exports` 指向 `src`，由各插件构建时内联。三个入口按运行位置分层：

| 入口 | 运行位置 | 内容 |
| --- | --- | --- |
| `./shared` | Host 与浏览器（同构，不导入 Node、浏览器或 Host 包） | 同构契约与纯校验：身份、连接与设置文法、路由判断、URL 校验、会话选择与 Remote 契约 |
| `./host` | Host | 选择、执行与传输：选择范式、凭据、有界传输与去敏、MCP 客户端、adapter 骨架与各服务 wire |
| `./client` | 浏览器 | 浏览器契约与组件骨架：分区契约、选择存储与状态观察器、`/setup-*` 命令工厂、目录驱动的设置页骨架 |

模块与导出位置见[代码结构 · core](code-structure.md#core)。

为什么这样分：同一份设置文法与路由判断必须在 Host 与浏览器得出相同结论，所以放在同构的 `./shared`；选择范式与传输只在 Host；浏览器侧的存储与骨架只在浏览器。抽取遵守“第二个使用者出现时再抽象”：只有两侧都用到的部分才进 core；远程服务的协议作为整体放在 core，只用于搜索的 OpenAlex 与 Semantic Scholar 也在这里，新增服务只有一个位置。core 的设置骨架两个插件都整体内联（fetch 也带着 model 表单与 list 字段的代码），拆开要给骨架多加一层注入 API，收益不抵。

## 浏览器面

浏览器面按“能力的数据与命令归插件，可视化的选择集中在 ui”划分；ui 对插件没有任何依赖。界面文案与交互见 [设计文档 · 会话选择](design.md#会话选择)。

| 槽位 / 入口 | 注册者 | 说明 |
| --- | --- | --- |
| `commandUi`：`/setup-search`、`/setup-fetch` | 各插件 | 由 core `selectionCommand` 生成；不依赖 ui，ui 停用时仍可用 |
| `plugins.row.config`（键 `dsh-tool-web-enhanced-profile#<行 id>`） | 各插件 | 行设置页，由 core 骨架按目录组成；只在本行运行时注册（`configForms.whileServed`）；写入前用本插件的 `resolveSettings` 校验写入后的完整文档 |
| 浏览器服务 `webConnections` | ui | 分区与路由事实的注册表 |
| `conversation.input.right` | ui | 两个能力共用的一个连接按钮与菜单 |
| `plugins.bundle.activation`（键为 profile 包名） | ui | 首次启用提示，跑与概览相同的升级预检 |
| `plugins.detail.section` | ui | profile 详情页的概览：两侧路由、插件行是否停用、升级预检与修复 |

**`webConnections` 与分区**

~~~mermaid
flowchart LR
  subgraph plugin["search / fetch 的浏览器面"]
    STORE["ConnectionSelectionStore<br/>（经 ns Remote 读写）"]
    ROUTE["RouteStatus<br/>web 行 + ns/provider"]
    CMD["/setup-*"]
    PAGE["行设置页"]
  end
  subgraph ui["ui 的浏览器面"]
    SVC["webConnections<br/>register · registerRoute"]
    MENU["输入框菜单"]
    OV["bundle 概览 · 首次启用提示"]
  end
  STORE --> CMD & PAGE
  STORE -- "ConnectionSection（showSelector 为 true 时）" --> SVC
  ROUTE -- "registerRoute（与分区无关）" --> SVC
  SVC --> MENU & OV
~~~

- 插件用可选注入 `ctx.inject(['webConnections'], …)` 注册分区（search `order: 10`，fetch `order: 20`），并随 `showSelector` 注册或注销；注销在注册者的 effect 里运行，随插件 fiber 释放。
- 分区带上本能力的 `SelectionStore`、文案函数、可选的会话参数组件 `Options`（search 的实时性）与“打开设置”入口；ui 只负责外壳与通用行。新增一种会话参数不改 ui。
- 命令、设置页与菜单读写同一个 `SelectionStore`，在任一处切换，另一处立即反映。
- **路由事实与分区解耦**：插件另用 `registerRoute` 提供路由事实（含浏览器看不到的 `DSH_WEB_*_PROVIDER`），`showSelector: false` 只撤下分区。插件行未运行时没有条目，ui 只能按 `web` 行的值判断。
- **插件行停用**：ui 用 `ids.ts` 的身份、`configForms.whileServed` 与 `configForms.get('web')` 自己发现“`web` 行仍指向已停用插件的 provider”，在菜单与概览里说明；这条信息不能依赖已经注销的分区。
- **契约版本**：三个包同一节奏发布、profile 精确锁定版本，分区契约不需要跨版本兼容，变化时三个包一起改。
- “打开设置”经 `pluginNavigation.openBundle` 打开 profile 的插件页，行设置页在那里展开。

共同约束：界面文字全部走各包 `src/client/locales.ts` 的字典（zh 与 en 同键，命名空间等于行 id），`locale/*.json` 只放插件页读取的 `meta`；Host 只返回错误码与英文消息；样式只用 DSH 的 `--dsw-*` 变量；浏览器从不读取密钥，凭据状态只读“是否已配置”。

## 构建与发布

search、fetch、ui 三个插件共用构建定义；profile 直接发布 patch 与资源，core 作为源码内联。插件产物的外部依赖仅来自 DSH 安装与平台模块。

- **tsdown 工厂**：`build/tsdown.ts` 的 `pluginBuild(import.meta.url)` 是唯一的构建定义，每个包的 `tsdown.config.ts` 只调用它。
  - Host 面：`lib/index.js`，ESM、Node 22；Node 内置与 `@deepseek-ai/*` 外置，其余（含 core）内联；注入 `__PLUGIN_VERSION__`。
  - Client 面：清单导出 `./client` 时产出 `lib/client.cjs`，形如 `window.__ModuleLoader__.load({ id, factory })` 的 DSH 模块加载器脚本；只有 Web 壳模块表里的平台模块外置（`build/platform.ts`：React、Cordis、zod、`@tanstack/react-virtual`、`dsh-client-store`、`dsh-client-ui-slots` / `-primitives` / `-dockkit`），其他 DSH 浏览器能力经注入的服务使用、只导入类型。扩展名用 `.cjs` 是因为包为 `"type": "module"` 而产物是 CJS 形状。
  - `build/plugins.ts`：标准装饰器降级（DSH 的 `@Remote`，对内联的 core 同样生效）与 CSS Modules（每个样式表注入一个带 `data-plugin` 的 `<style>`），构建与 Vitest 共用。
- **ui 的 Host 面是空插件**：DSH 只为已挂载的行加载浏览器面，所以 ui 也作为一行挂载。
- **打包边界**由 `verify-packages` 检查（`pnpm run check` 的最后一步）；四个可发布包（profile、search、fetch、ui）组成同一发布列车，profile 精确锁定插件版本。校验清单、版本操作与 CI 见[开发流程 · 发布与 CI](development.md#发布与-ci)。

命令与 e2e 见[开发流程](development.md)；产物路径与形态见[代码结构 · 构建产物](code-structure.md#构建产物)。

## 安全架构

本节列信任边界与守住它们的不变量；对应的用户可见行为（错误码、措辞、`[redacted]`）见 [设计文档 · 错误与上游说明](design.md#错误与上游说明)。

| 边界 | 不变量 | 落在哪里 |
| --- | --- | --- |
| 凭据存放 | 密钥只在 DSH Credentials，设置里只存 `credentialRef`；每次调用解析、不缓存。本项目自己的后端与固定 model 连接只经 Credentials（`resolveApiKey`）；`native` 后端与跟随会话模型的 model 连接照搬 DSH 模型路由的规则（`routeApiKey`：Credentials 存在时只读它，缺席时才读启动环境）。浏览器只写入、不读取 | core `host/credentials.ts` |
| 密钥格式 | adapter 与 model 后端发请求前：API key 去首尾空白后只能含可见 ASCII 与空格，否则报 `WEB_PROVIDER_CREDENTIAL_MISSING`（只含凭据名称），不发请求，密钥不进诊断；`native` 沿用 DSH 的处理，没有这项预校验 | core `storedApiKey`（`runAdapter` 与 model 后端共用） |
| keyless | 不读取、不发送、不回退到密钥，并且永远发往目录端点 | core `adapterTarget`、`runAdapter` |
| 出站请求 | 本项目自己的请求一律用全局 `fetch`（继承 DSH 的代理策略）、`redirect: 'error'`；字节上限（先看 Content-Length，再在流上计数）与覆盖凭据、握手、读正文的整体截止时间；不自动重试、不自动 fallback | core `host/transport.ts` |
| 端点信任 | 自定义端点与不同于目录端点的 `url` 参数（如 native 的 `baseURL`）都要 `trustedEndpoint: true`；固定 model 连接总是需要；内置 adapter 的端点不可改。设置文法拒绝 `__proto__` / `constructor` / `prototype` 键，并在解析前按预算拒绝过大的输入 | core `shared/settings.ts`、设置页骨架 |
| 账号令牌 | 只经 `native` 后端（沿用 DSH provider：本次请求路由为 `deepseek-account` 且取得令牌时用令牌，否则用 API key），以及唯一的扩展：跟随 `deepseek-account` 路由的 search `model` 连接。后者只用账号令牌，只在本次请求已解析的路由确为 `deepseek-account` 时取得，只发往会话端点，发送前校验只含可见 ASCII 与空格（不 trim），不回退 API key | core `accountTokenFor`、search `model/execute.ts` |
| 目标访问策略 | 只有 fetch 的 `local` 检查目标地址（白名单为空等于原生 public-only）；远程后端把目标访问策略交给服务，不检查目标 URL，界面写明 URL 或查询会发给谁 | fetch `src/local/`；连接说明 |
| 远程结果 | fetch 的远程正文一律为文本；服务没报告目标状态时记为请求的 URL 与 200（兼容映射），只有服务明确给出的状态码才成为非 2xx 结果；search 的来源只保留无用户信息的 http(s) URL（≤ 8192 字符），`native` 与 model 的结果同样过滤 | fetch `remote/page.ts`；search `sources.ts`、core `shared/url.ts` |
| 会话与模型 | 会话只能在运维启用的连接之间选择；冻结的只是“哪个连接”，可选性与目标每次调用按当前设置判定；发起调用的会话来自 `currentInitiator()`；`available()` 只做本地判断 | core `installCapability`、`isSelectable` |
| 跨命名空间读取 | 跟随会话模型时读别的插件命名空间的路由配置，先按与设置文法同一组上限限制长度与条数，超出判为不支持且不回显原值 | search `model/bounds.ts` |

**给模型的错误与去敏的位置**

本插件让本次请求的 API key 或账号令牌不进入给模型的内容：错误文字检出即整段隐去，成功体中替换为 `[redacted]`。已知的缺口是 DSH 原生 provider 解析失败时，其错误第一段可能带短于 8 字符的凭据片段，见[已知限制](design.md#已知限制)。错误格式、检测与替换规则见[功能设计 · 错误与上游说明](design.md#错误与上游说明)与[凭据隐去](design.md#凭据隐去)。处理只在下面几处边界发生：

| 位置 | 错误文字 | 成功体 |
| --- | --- | --- |
| core 有界传输 | HTTP 非 2xx 的错误体 | JSON 回复的字符串值（adapter 与 model 后端） |
| core MCP 客户端 | `isError` 的工具文本、JSON-RPC 错误 | 成功的 `result` |
| core `runAdapter` | — | 服务解析后的结果，覆盖从 JSON 键名还原的文本 |
| core `nativeBackend` / `restateNative` | DSH 错误的第一段 | DSH provider 的结果 |

凭据由调用方经 `secretMatcher` 交给这些位置（adapter 与 model 交给传输，`native` 经 `nativeAuth` 记录本次交给 DSH 的值）；后端不自己拼上游文字。所有诊断（传输、MCP、`native`、两侧执行层、model 后端）只以 `redactDiagnostic` 的去敏副本进 Host 日志，不带原 cause 与 stack。

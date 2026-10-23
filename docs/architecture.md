# 架构

本文说明 dsh-tool-web-enhanced 的五个包如何组合为 DeepSeek Harness（DSH）的搜索与抓取能力，以及运行时、浏览器与安全边界为何这样划分。

产品行为（连接目录、配置字段、各后端的具体行为、错误措辞）见 [设计文档](design.md)；文件级结构见 [代码结构](code-structure.md)；开发流程见 [开发文档](development.md)；里程碑见 [开发计划](plan.md)。

## 定位

一个**不含代码的 profile bundle**（`dsh-tool-web-enhanced-profile`）挂载两个插件，并在共享的 `web` 行里选中它们注册的 provider。模型继续使用 DSH 原生 tool-web 的 `web_search` / `web_fetch` 的名称、参数与结果契约，不改写工具定义（`local` 的授权范围另以运行时上下文提示）；两个插件用**同一种选择范式**在各自唯一的 provider 内部切换后端。

此外，两个插件各自注册本侧的**增强工具**：运维在行设置里打开“增强工具”后，search 注册 `web_search_enhanced` 与 `list_web_search_providers`，fetch 注册 `web_fetch_enhanced` 与 `list_web_fetch_providers`，Agent 用它们为单次调用指定后端。模型面把连接叫 provider（参数 `provider` 的取值就是连接 id），代码内部仍叫 connection；这与 `ctx.web` 的 provider（`search-enhanced` / `fetch-enhanced`）是两层含义，只在本项目内部区分。增强工具执行时走同一个能力与执行层，不是第二个 `ctx.web` provider。行为见 [设计文档 · 增强工具](design.md#增强工具)，结构见[增强工具的运行时](#增强工具的运行时)。

选择分五层，各管一件事，互不改写：

| 层级 | 选什么 | 谁写 | 何时变 |
| --- | --- | --- | --- |
| `web` 行 | 哪个 provider 服务 web_search / web_fetch | profile patch，安装时一次 | 几乎不变 |
| 插件行设置 | 有哪些连接、默认用哪个、各自的参数与安全策略，是否提供增强工具 | 运维，经插件设置页 | 随时，热生效 |
| 对话的 provider 列表 | 本对话里 Agent 能显式指定哪些连接 | core：新的顶层对话建立时快照当时可选的连接，子对话继承 | 对话内不变 |
| 会话选择 | 本会话的原生工具用哪个连接，或关闭 | 会话的使用者，经输入框菜单或 `/setup-*` | 随时，从下一个模型请求步生效 |
| Agent 的显式选择 | 这一次增强工具调用用列表里的哪个连接 | Agent，经增强工具的 `provider` 参数 | 每次调用 |

切换后端从不改写 `web` 行，所以不会与别的插件、DSH 的内置开关或用户层争抢这一共享行。search 与 fetch 各有一套设置、对话列表和会话选择，分别切换。显式选择只对这一次调用有效，不写会话选择与模型记忆：之后的调用不依赖参数里看不到的状态，菜单里始终是用户自己的选择；会话选择为关闭时，显式调用同样被拒绝。

本项目不做：覆盖或改写原生工具的定义（增强工具用新名字，理由见[组合](#组合profile-patch)）、改写 tool-web 的 HTML→Markdown 转换（增强工具直接调用 tool-web 导出的格式化函数）、切换会话连接的模型工具（显式参数覆盖它的全部用途，又不留下看不到的状态）、自动重试或自动 fallback（失败后由 Agent 用增强工具改换 provider）。

## DSH 的 web 接缝

DSH 把 web 能力拆成四种角色，彼此只经 `ctx.web` 相连。本项目在“provider”与“组合”两个位置插入，其余原样复用；增强工具是 provider 插件自己的模型工具，直接调用本插件的能力，不经 `ctx.web`（见[增强工具的运行时](#增强工具的运行时)）。

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
| search provider 包 | `dsh-web-search-enhanced` | 注册 `search-enhanced` 与本侧两个增强工具，内部多后端，含自己的浏览器面 |
| `dsh-web-fetch-http` | `dsh-web-fetch-enhanced` | 注册 `fetch-enhanced` 与本侧两个增强工具，内部多后端，含自己的浏览器面 |
| `dsh-web`、`dsh-tool-web` | 直接复用 | 不替换、不包装；增强工具调用 tool-web 导出的格式化函数与 meta 函数 |
| （无） | `dsh-tool-web-enhanced-ui` | 两个能力共用的输入框菜单与 bundle 概览；Host 面为空 |
| （无） | `dsh-tool-web-enhanced-core`（private） | 共享源码，构建时内联进各包，不发布 |

DSH 原生的 provider 类在本项目里作为 `native` 后端被直接实例化（见[后端种类与执行层](#后端种类与执行层)），所以“与原生等价”的默认连接就是原生实现本身。

## 包与依赖

五个包按“谁注册 provider 与模型工具、谁组合、谁只有浏览器面、谁只是共享源码”划分；增强工具由两个插件各自注册，没有单独的工具行包。

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
| search | `dsh-web-search-enhanced` · `web-search-enhanced` · `search-enhanced` | 搜索目录、adapter 绑定与来源规范化、`native` 与 `model` 后端、实时性、设置解析、增强工具 `web_search_enhanced` / `list_web_search_providers`（`src/tools/`）、`/setup-search` 与行设置页 |
| fetch | `dsh-web-fetch-enhanced` · `web-fetch-enhanced` · `fetch-enhanced` | 抓取目录、`local`（白名单、地址策略、解析器）、`native` 后端、远程 adapter 绑定与页面映射、白名单提示、增强工具 `web_fetch_enhanced` / `list_web_fetch_providers`（`src/tools/`）、`/setup-fetch` 与行设置页 |
| ui | `dsh-tool-web-enhanced-ui` · `tool-web-enhanced-ui` | 浏览器服务 `webConnections`、共用的输入框连接菜单、首次启用提示、bundle 概览与升级预检 |
| core | `dsh-tool-web-enhanced-core`（private） | 选择范式与可见性控制器的唯一实现、增强工具的显式入口与共用部件、远程服务的 wire、设置文法、浏览器侧的选择存储与设置页骨架 |

依赖规则（由 `scripts/verify-packages.ts` 与评审守住）：

- 插件的 Host 产物只导入 Node 内置与 `@deepseek-ai/*`（由 DSH 安装提供，且必须是声明的 peer）；其他一切（包括 core 与 fetch 的 `ipaddr.js`）内联，插件没有 `dependencies`。
- 两个插件以 `@deepseek-ai/dsh-tool-web` 为 peer（它是 DSH 主包的直接依赖，任何 profile 都已安装，与 tool-web 行是否启用无关），增强工具的输出因此与原生逐字节一致；它的 HTML→Markdown 依赖 turndown，内联等于新增依赖并与 DSH 的转换分叉。
- 没有工具行包：注册条件（路由、开关）、遮罩、对话列表与执行都在同一个插件的 `installCapability` 里，卸载时一个 effect 就能先注销定义、再撤遮罩；插件行停用即只少该能力的两个工具。
- search、fetch、ui 的 `src` 互不导入；共享代码只进 core。组合测试可以导入别的包的 `src` 来测真实接缝。
- core 不导入插件，不持有模块级状态：每个插件各内联一份 core，模块级状态既无法共享，又会让两次安装互相影响。
- 插件与 ui 之间只经浏览器服务 `webConnections` 相连，契约类型在 core。

标识（含每个能力的两个增强工具名 `PluginIdentity.tools`）只在 `packages/core/src/shared/ids.ts` 定义一次；patch 是 YAML 无法导入，由 profile 的测试断言它与 `ids.ts` 一致。命名沿用 DSH 惯例：行 id = npm 名去掉 `dsh-` 前缀，Cordis 插件名与 Settings 命名空间都等于行 id；`web-*-enhanced` 是注册 provider 的插件族，`tool-web-enhanced-*` 是围绕 tool-web 的产品层。两个插件的存储域与 Remote 命名空间分别是 `web_search_enhanced` / `searchConnections` 与 `web_fetch_enhanced` / `fetchConnections`。

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
- **增强工具不经 preset 组合。** 两个插件从 Host 行把增强工具注册到全局工具层，所有 agent preset（含没有原生工具的 minimal）与 base profile 都会带上；这是 DSH 官方可选 bundle 的做法，DSH 不提供往具名 preset 插行的 patch 操作。也不做同名覆盖：Web profile 里 tool-web 挂在 preset 的 `config.plugins` 里，Host 行注册的同名工具会被它遮蔽，base profile 里重名注册直接失败，覆盖还等于 fork tool-web 的契约。

升级与退出路径（前身 0.1.x 的移除、路由残留预检）见 [设计文档 · 从 0.1.x 升级](design.md#从-01x-升级)。

## 运行时

本节讲 Host 侧的结构：一次调用经过哪些层、选择范式与工具可见性在哪一层生效、增强工具怎样接进同一条管线、后端怎么分类、core 怎么分层。

### 一次调用的管线

两个插件用同一条管线，由 core 的 `installCapability` 装配；插件只提供一个 `Capability` 对象（身份、工具名、`web` 字段、存储域、Remote 命名空间、会话参数编解码、`settings()`、`describe`、`target`、`execute`、`register`，以及增强工具的部分 `enhanced`）。

管线有两个入口：原生工具经 `ctx.web` 到 Seat，增强工具经显式入口（`EnhancedAccess`）。两者在“复查与目标”汇合，之后的目标、执行层、后端与传输完全相同。

~~~mermaid
sequenceDiagram
  participant T as tool-web
  participant E as 增强工具（插件 src/tools）
  participant W as ctx.web（WebRuntime）
  participant S as Seat（唯一 provider）
  participant C as core installCapability
  participant B as 后端
  participant U as 上游
  alt 原生工具
    T->>W: web_search / web_fetch
    W->>S: 按 web 行选中席位
    S->>C: invoke(request, signal)
    C->>C: currentInitiator() → 本步冻结的 Plan
  else 增强工具
    E->>C: run(provider, request, { agent, signal })
    C->>C: 注册条件 · agent 本步冻结的 Plan · 对话的 provider 列表
  end
  alt 被拒（关闭、选择无法读取、不在列表里…）
    C-->>T: Seat：WebError
    C-->>E: 显式入口：rejected（由工具代码措辞）
  else 放行
    C->>C: settings() 读当前设置 · 复查
    C->>B: capability.target(当前连接, 会话参数) → execute
    B->>U: DSH provider 类 / 有界 HTTP / MCP / HttpFetchProvider
    U-->>B: 回复
    B-->>C: 结果，或改写过的 WebError
  end
~~~

| 层 | 职责 | 不变量 |
| --- | --- | --- |
| Seat | 在 `ctx.web` 注册一次，id 固定 | `available()` 恒为 `true`、不做 I/O：能否服务取决于会话选择，调用时才知道 |
| 显式入口 | 增强工具的唯一入口：按注册条件、本步计划与对话的 provider 列表放行一次调用 | 只替换“哪个连接”，不绕过关闭与失败的计划；不写会话状态；见[增强工具的运行时](#增强工具的运行时) |
| Planner | 每个模型请求步产出 `Plan`：`off` / `failed` / `ready { connectionId, options }` | 同一步内不变；只冻结“哪个连接”与会话参数 |
| 复查与目标 | 读当前设置并复查（Seat：`isSelectable`；显式入口：连接仍存在），`target` 用当前连接新建执行目标 | 目标不缓存；运维策略每次调用读当前值 |
| 执行层 | 凭据、截止时间、把各后端的失败改写成给模型的短消息 | 后端拿到已解析的凭据与参数，不碰凭据存储 |
| 后端 | 某个服务的协议，或一个 DSH provider 实例 | 见[后端种类与执行层](#后端种类与执行层) |
| 传输 | DSH provider 类、core 的有界 HTTP 与 MCP 客户端、DSH 的 `HttpFetchProvider` | 见[安全架构](#安全架构) |

search 的 Seat 经 `createSearchSeat` 包一层，fetch 直接注册 `{ id, available: () => true, fetch }`。

### 选择范式

search 与 fetch 共用一份 core 实现；两侧的差别只是目录数据与能力参数，没有第二套机制。用户可见的行为（菜单、命令、来源说明）见 [设计文档 · 会话选择](design.md#会话选择)。

**概念**

- **连接**：到某个后端的一种配置。`builtin:<键>` 来自插件目录，运维可做稀疏覆盖，目录项的 `optIn` 决定它缺省是否停用（[远程服务缺省停用](design.md#远程服务缺省停用)）；`custom:<name>` 由运维新建，建立时启用。连接与设置文档的字段见 [设计文档 · 配置文档](design.md#配置文档)。
- **插件行设置**：一份两侧共用文法的文档（core `shared/settings.ts`），Host 与浏览器用同一个纯函数解析（插件的 `resolveSettings` 建在 core `resolveDocument` 上）。它决定会话**能**选什么，以及是否向新对话提供增强工具（`enhancedTools`）。
- **会话选择**：`{ connectionId | null, revision, options }`，存在插件自己的存储域表 `selections`。读写以会话为目标（core `SessionTarget`）：`live` 是有运行中 Agent 的会话，带着这个 Agent（`liveSession(agent)`）；`cold` 是不在运行的子 Agent 会话，只有会话 id 与会话头，读写不碰 Agent。同一会话的读写排队执行，写入按 revision 比较；core 拥有 `connectionId`、`revision`、`inherited`，会话参数由能力的 `OptionsCodec` 编码（search 有 `freshness`，fetch 没有）。
- **会话来源**：core `sessionOrigin` 只读会话头的公开字段，返回判别联合：`top-level`、`fork`（有 `parentSession`：用户 fork）与 `subagent`（`origin === 'subagent'`：spawn 与 subagent_fork），各带 `seeded`（`isSeeded`）。`origin` 先于父会话判断，与 DSH 判断子 Agent 路由归属的依据一致。继承父会话的选择（有父会话且 `seeded`）、复制父会话的对话列表（有父会话）、[新建的判断](#增强工具的运行时)与是否写模型记忆都经它。
- **模型记忆**：(provider, model) → 连接，存在表 `pairings`；选择落盘后才写记忆，记忆写失败只记日志。写不写由 `Sessions.change` 按会话决定，调用方不传参数：选了连接（不是只改会话参数）、会话来源不是 `subagent`、且知道下一次请求的模型时才写。

未选择时由 core `Sessions` 解析出当前连接；选择来源、模型记忆与默认值的行为见[会话选择](design.md#会话选择)。下一次请求的模型（`nextModel`）只有 `live` 目标才有，`cold` 目标的模型为未知：默认来源不查模型记忆，连接视图也按未知描述——`Capability.describe(settings, model)` 与 core `credentialReadiness` 收的是这个模型而不是 Agent，跟随会话模型的连接为 `no-model`，native 只看 API key。

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
- **每次复查**：可选性只有一条规则（core `isSelectable`：存在且未停用），模型记忆、Remote 写入、每次 Seat 调用的复查与对话列表的快照都用它。停用与重新启用因此从下一次调用生效，不必等下一步。显式入口是唯一的例外：对话列表里的连接停用后在该对话里仍可用，只要求它仍存在（列表是对话开始时的授权，见[对话的 provider 列表](design.md#对话的-provider-列表)）。
- **每次重建**：`target` 用当前连接新建执行目标，四种后端一律如此。search 的 `model` 连接的路由（协议、端点、凭据引用）也在这里推导，不进计划；跟随会话模型时取发起本次调用的那次请求的已解析路由。
- **设置无效**：`settings()` 由 core `settingsRow` 包装，当前文档无效时抛 `InvalidSettingsError`（码为 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` 的 `WebError` 子类），诊断只在启动校验与 Loader 的 `internal/config` 写入钩子里进 Host 日志。插件照常激活，以便设置页修复。
- **会话之外的调用**：没有发起 Agent 时按当时的 `defaultConnection` 与能力的初始参数计划。

**可见性控制器**

选择为 `null` 即关闭：Seat 对计划为关闭的调用报错，显式入口拒绝，core 的可见性控制器对该 Agent 遮住工具。控制器是 core `host/restriction.ts` 的 `ToolRestriction`（保留原来只管原生工具时的类名，推广为管两组），规则方向相反（规则表见[设计文档 · 注册与可见性](design.md#注册与可见性)，关闭的用户语义见[关闭](design.md#关闭)）：原生 `web_search` / `web_fetch` 判断不了时**不**遮，以免藏掉别的 provider 的同名工具；增强工具是自己的，判断不了时不注册、已注册则遮住。

- **路由判断**：Host 用 Settings 的公开数据（`settings.describe()` 中 `ns = web` 的值）加环境变量判断路由（core `routeFacts` / `routeOf`），只有确认为 `this` 才算路由到本插件；`other`、`auto` 与 `unknown` 都不算。原生组只在确认路由时遮住关闭的会话；增强组只在确认路由、行设置有效且“增强工具”开关打开时注册到全局工具层（`ctx.tools.register`），否则注销。
- **遮罩**：都用 `agent.ctx.tools.restrict({ deny })`，只对该 Agent 生效、只撤自己装的。原生组看 Agent 自己作用域的视图：Web profile 里 tool-web 由 agent preset 挂在 Agent 作用域的祖先上，根 ctx 上没有这两个工具，所以判断工具是否存在用 `tools.get(tool, scopeOf(agent.ctx))`。增强组不看视图：`tools.get` 返回被别人遮罩后的结果，不能当作“是否已注册”的事实；DSH 的 `restrict` 只接受已注册的名字（被别人遮住的也接受），所以增强遮罩总在注册之后、同一段同步代码里装上。增强组遮住的是没有对话列表、会话关闭、或选择尚未读到 / 读取失败的 Agent。
- **状态、世代与提交点**：控制器持有注册世代与每个 Agent 的状态（对话列表有 / 无 / 未读到，选择 on / off / 未读到）及操作版本。所有异步读取记下世代与版本，只有仍是当前世代与版本、插件存活、Agent 未遗忘、注册条件仍成立时才提交；所有提交经同一个提交点，不用定时器。
- **注册与注销**：注册条件变为成立时，同步注册两个定义，并在同一段同步代码里对 `ctx.agents.list()` 的每个 Agent 按已知状态装遮罩（不确定的遮住），再异步读取对话列表与选择，读到可见才撤遮罩。两个定义的注册是一次可回滚的提交：逐个记下 disposer，任一步抛错（如名字已被别的 owner 注册）就倒序撤销本次已注册的定义、不装遮罩、只记固定的 Host 日志，控制器仍是“未注册”，下一次重算可以恢复；从不撤销别的 owner 的定义。条件不再成立时同步注销定义（世代 +1，在途读取作废），再撤增强遮罩；原生遮罩按自己的规则处理，不读存储。
- **增强组的生命周期**：增强组的注册与遮罩绑定在 `ctx.inject(['tools', 'agents'], …)` 的注入作用域上：两个服务都到位后才开始判断注册条件（并对已有的 Agent 补做），任一服务被替换或撤下时，该作用域的 effect 先注销、撤遮罩，服务恢复后用同一份定义重新注册。定义按安装只构建一次（`enhanced.tools(access)`），首次需要注册时才构建。
- **同步时机**：`agent/created` 先同步把 Agent 记为未读到（已注册时同步遮住），再建立对话列表、捕获计划后提交；DSH 串行等待 created 监听器后才开始模型循环。`agent/request` 捕获计划后同样同步；捕获失败时显式记为未读到并遮住增强工具，原生遮罩不动。选择写入落盘后，按那一刻 `agents.get(会话 id)` 里运行中的 Agent 同步（排队期间从冷变为运行中的目标也同步）；没有运行中的 Agent 就不同步，由它下一次的 `agent/created` / `agent/request` 按存储的选择计算。捕获时只有已注册且注册条件成立才读对话列表（结果是 `ProviderListRead`：`read` 带记录，或 `unread`）；条件不成立（如开关关闭）时不读 `provider_lists`，记为未读到，注册后由重算（reconcile → refresh）去读。列表读取失败只记日志、记为 `unread`：该 Agent 的增强工具保持遮住，选择与原生计划照常；设置事件触发的重算同理。插件启动时对 `ctx.agents.list()` 里已有的 Agent 补做一遍。
- **`web` 行与插件行变化**：`settings/document-updated`（`ns = web` 或本插件行）时重算注册条件。原生组对已知 Agent 重算：路由离开时立即撤销、不读存储；回到本插件时用只读的 `peek` 读选择（不为没有记录的会话建记录）。
- **卸载**：增强组在注入作用域的一个 effect 里同步完成“作废在途读取（世代 +1）→ 注销定义 → 撤增强遮罩”；原生遮罩由控制器自己的 effect 撤下，之后捕获返回失败的计划。定义与增强遮罩放在同一个 effect，是因为 Cordis 卸载时并行运行兄弟 effect，拆开会出现“遮罩已撤、定义仍在”的瞬间。
- **生效边界**：保证落在同步提交完成后、正常模型循环的下一次工具组装。DSH 在 `agent/request` 之前已组装好本步的工具列表，所以变化从下一步生效；Native 模式下 DSH 在下一请求追加工具增删的 developer 消息，PTC 模式只改 SDK。已注销或已遮住的旧调用由 DSH 报 `UNKNOWN_TOOL`，不进工具体；已经发出的请求不因随后的变化撤回。公开 registry 的同步通知里能看到注册与遮罩之间的中间态，见[已知限制](design.md#已知限制)。
- **子 Agent 与 fork**：继承全局工具，不继承父 Agent 的遮罩，各自经 `agent/created` / `agent/request` 得到自己的遮罩；对话列表的继承见[增强工具的运行时](#增强工具的运行时)。不拒绝子 Agent：web 调用是即时的只读请求，没有投递目标的限制。

**Remote**

浏览器经 `<ns>/get`、`<ns>/set`（带 `expectedRevision`）、`<ns>/provider`、`<ns>/pairings`、`<ns>/forgetPairing` 读写；契约由 core `selectionContract` 生成（两端都是严格 schema），服务由 core `createConnectionsService` 在工厂内声明带 `@Remote` 的类，每次安装一个新类，安装在 `sessionController`、`typert`、`agents` 的注入作用域里（dsh-TUI 没有 `sessionController`，不创建 Remote）。`get` / `set` 按被寻址的会话资源授权，用同一种取法得到 `SessionTarget`：

1. `ctx.agents.get(sessionId)` 有运行中的 Agent（含子 Agent 与 subagent_fork）→ `live`。
2. 否则读可选服务 `sessionPersistence` 的 `stat(sessionId)`（只读会话头，不读事件日志、不取得写入权）；会话来源为 `subagent` → `cold`，直接读写记录，不恢复 Agent：DSH 把这类会话留给子 Agent 路由，`resolveAgent` 会拒为 `session/agent-busy`。
3. 其余（普通会话、会话不存在、没有 `sessionPersistence`）→ `sessionController.resolveAgent`，解析或恢复普通会话（写模型记忆要知道它下一次请求的模型），错误原样交出（如 `session/not-found`）。

之后经 `sessions.current()` / `change()` 与 `connections()`（建记录与继承不变）；`set` 先按 `isSelectable` 检查连接，修订冲突改为 `<ns>/conflict`。Remote 在此隔离服务异常：契约内的错误原样交出，其余一律改为固定消息、原异常只进 Host 日志；对浏览器的错误分类统一见[浏览器看到的错误](design.md#浏览器看到的错误)。

`provider` 只返回浏览器看不到的两项事实 `{ providerId, envProvider }`，路由由浏览器用同一个 `routeOf` 判断。连接视图不含凭据引用。

**两侧的差别只是参数**

| 维度 | search | fetch |
| --- | --- | --- |
| 原生工具 · `web` 字段 | `web_search` · `searchProvider` | `web_fetch` · `fetchProvider` |
| 增强工具 | `web_search_enhanced`、`list_web_search_providers` | `web_fetch_enhanced`、`list_web_fetch_providers` |
| 会话参数 | `freshness` | 无 |
| 特有的后端种类 | `model` | `local` |
| 远程后端的传输上限 | 2 MiB、90 s | 5 MB、120 s |
| 能力特有的上下文 | 无 | `local` 白名单提示（系统提示的运行时上下文，只在本步计划用 `local`、白名单非空且确认路由到本插件时加入） |
| 列出时的能力事实 | 用途、接收方、是否应用会话的实时性 | 用途、接收方、`local` 的白名单说明（主语为 “this provider”） |
| 增强工具的组装 | 去重后的查询并发执行，复制 tool-web 的合并逻辑，先截到 `maxResults` 再合并 | 一次执行 |

### 增强工具的运行时

增强工具与原生工具共用能力、计划与执行层，多出的是显式入口、对话的 provider 列表与工具代码。用户可见的工具定义、输出、列出内容与错误措辞见 [设计文档 · 增强工具](design.md#增强工具)。

**分工**

| 位置 | 负责 |
| --- | --- |
| core `installCapability` | 何时注册、对谁遮罩（[可见性控制器](#选择范式)）、对话的 provider 列表、显式执行与列出前的检查；把 `EnhancedAccess` 交给能力的工具代码 |
| core `./host` 的工具部件 | 两侧都用的部分：`provider` 的文法校验、拒绝的措辞、换 provider 提示的插入、列出文本、规范值 schema |
| 插件 `src/tools/` | 两个静态定义、参数校验、输出与模型面措辞；search 另有复制自 tool-web 的查询校验与多查询合并（tool-web 没有导出它们）和 `capSources` |
| 能力的 `enhanced`（`CapabilityEnhanced`） | 工具名、按安装构建一次的两个定义 `tools(access)`、列出用的能力事实 `listing`（不做 I/O、不含秘密） |
| `@deepseek-ai/dsh-tool-web` | `formatSearchOutput` / `formatFetchOutput`、`searchMetaFromValue` / `fetchMetaFromValue`、`parseFetchArgs` 与上限常量，原样导入 |

契约类型（`ExplicitCall`、`Explicit`、`Rejection`、`ReadyProviders`、`ProviderListing`、`ListingFacts`、`EnhancedAccess`、`CapabilityEnhanced` 等）在 core `host/enhanced.ts`，由 `./host` 导出。工具代码只拿到 `run`、`list` 与 `ready`，看不到会话存储、计划、目标或凭据。

**显式入口**

`ExplicitCall` 是 `{ agent, signal }`，取自 DSH 给工具体的 `exec.agent` 与 `exec.signal`，从不从工具参数推断；缺 `exec.agent` 时工具代码报普通 Error（`<工具名> can only be called by an Agent`），不走默认连接。`run` 与 `list` 返回 `Explicit<T>`：`done`，或 `rejected` 加一个 `Rejection`（`unknown` / `removed` / `off` / `withdrawn` / `unavailable`，后者带 core 自己的安全错误）。只有 `unknown` 与 `removed` 各带一个 `ReadyProviders`：`{ kind: 'read', ids }`（列表里仍存在且现在就绪的 id，按列表顺序，就绪忽略 `disabled`），或读不到时（就绪状态抛错、调用已取消）为 `{ kind: 'unread' }`，让措辞分清“没有其他就绪项”与“不知道”。选择阶段的拒绝用返回值而不是抛错，因为同一个 `WEB_*` 码有多种来源，工具代码要按原因措辞，并且只给后端失败加换 provider 的提示；后端失败照旧抛 `WebError`。

`ready(call)` 返回同一个 `ReadyProviders`，供 `provider` 不合文法、根本不进入 `run` 的参数错误措辞：与拒绝里的值同源，`list` 会拒绝、就绪读不到或调用已取消时为 `unread`，从不抛错。这样读就绪状态的异常边界只在 core 一处，工具代码不必为拿 id 去 try/catch `list`。

`run(connectionId, request, call)` 依次检查：

1. 插件已卸载 → `unavailable`（与 Seat 的“选择无法读取”同一错误）。
2. `settings()` 抛设置无效 → `unavailable`（原 `InvalidSettingsError`）。先于注册条件判断：设置无效也会注销工具，但对在途调用，“请用户修复设置”比“不可用”更有用。
3. 注册条件不成立（未路由到本插件或开关关闭）→ `withdrawn`。
4. `call.agent` 本步冻结的计划：没有或失败 → `unavailable`；关闭 → `off`；就绪 → 取会话参数（search 的实时性）。
5. 读对话列表失败 → `unavailable`；读完再复查第 1–3 步；会话没有对话列表 → `withdrawn`；id 不在列表里 → `unknown`。
6. 当前设置里没有该连接 → `removed`。列表成员即使已停用也继续。
7. 在 `agents.withInitiator(call.agent, …)` 里 `capability.target(当前连接, 会话参数, call)` → `capability.execute(target, request, call)`。

之后与 Seat 路径完全相同：目标每次用当前设置重建，凭据、keyless、端点信任、截止时间、去敏、上游说明与取消都在同一执行层。`run` 不写会话选择与模型记忆，所以四个工具都声明并行安全，同一步可以并行用两个 provider。显式入口绕过了 `ctx.web`，`WebRuntime` 对来源按 `maxResults` 的截断不会发生，所以 search 的工具代码对每个结果先 `capSources` 再合并。

**为什么要 `withInitiator`**：`native` 后端的账号令牌、原问题与请求记录取 ambient initiator（`currentInitiator()`），`model` 的会话路由取 `requestModel(call.agent)`。正常模型循环里二者一致，但入口的契约是 `call.agent`，所以目标与执行整段放进 `withInitiator(call.agent, …)`：外层是别的 Agent 时也不会取到它的令牌或原问题，嵌套返回后外层的异步链不受影响。原生 Seat 的 ambient 与无 Agent 时的语义不变。

`list(call)` 做第 1–4 步与第 5 步的“有对话列表”，然后按列表顺序给出仍存在的连接：名称（同一次 `describe` 视图的标签）、就绪状态与 `listing` 事实；就绪状态按连接本身判断：`describe` 拿到的设置副本只含列表里仍存在的连接，且 `disabled` 一律为 `false`，视图再映射为 `ready`、`needs-credential`（`api-key` / 账号 `account`）或带原因的 `unsupported`，不给 `Capability` 加第二个就绪函数；`session` 给本步冻结的连接与它现在是否可选。`describe` 与 `listing` 不经执行层的去敏边界（它们会调用 Credentials 与账号服务），所以列出有自己的异常边界：任何异常（含依赖抛出的 `WebError`）一律变为固定的 `WEB_PROVIDER_ERROR`，原消息、cause 与 stack 不给模型，日志也只记固定诊断——异常可能发生在取得凭据之前，无法按本次凭据去敏。调用前与每次 `await` 后查 `call.signal`，已取消报 `WEB_ABORTED`；底层只读查询没有取消 API，在后台排空、结果丢弃。

**对话的 provider 列表**

列表的内容与之后设置变化的影响见[设计文档 · 对话的 provider 列表](design.md#对话的-provider-列表)；结构上：

- **新建的判断**（core `isNewConversation`，经 `sessionOrigin`）：没有父会话（`header.parentSession` 为空）、不是 `header.isSeeded`、`firstLiveSeq === 0` 且 `firstLifecycleSeq === 0`。照 DSH `tool-subagent` 的 `selectForSession` 的语义，只用 Session 公开、未弃用的字段；不看事件序号，因为真实的 `sessionController.create` 在 `agent/created` 之前已经写入事件。恢复的非空会话不是新建；真正空的恢复会话两个字段都为 0，被当作新建（里面没有对话）。
- **建立**：`agent/created` 时（`ProviderLists.create`）：已有记录就读它，从不改写（含空记录）；有父会话就复制父会话的记录；否则只对新建的会话写入一次——注册条件成立时写当时可选（`isSelectable`）的 id，不成立时写空数组。空记录读出来就是“没有列表”，它的作用是占住这个会话：同一进程里之后再为它创建 Agent 时不会在对话中途补建。建立失败只记日志；随后由捕获计划或重算再读列表（见[可见性控制器](#选择范式)的同步时机），读不到只把该 Agent 的增强工具记为未读到并遮住，原生计划照常。
- **继承**：有父会话的会话（用户 fork、spawn 与 subagent_fork；`sessionOrigin` 的 `parent`）等父会话的队列落定后复制父会话的记录；父会话没有记录，子会话也没有。
- **恢复**：读记录；没有记录（早于增强工具的会话）或记录为空（开关关闭时建立的对话）就没有列表。
- **持久化**：表 `provider_lists`（会话 id → id 数组）与 `selections`、`pairings` 同在插件的存储域里，域的 version 仍是 1：新增的表对已有的域不需要迁移，旧域里它一开始是空的，所以升级前的会话都没有记录。每会话一条，写一次，不改写、不随设置迁移；读写与会话选择共用 `SessionStorage` 的每会话队列（`exclusive` / `settled`）与存储生命周期。

为什么是快照：照 DSH 子 agent 路由授权的原则，运维的操作只影响新对话。Agent 在一个对话里能指定的范围不会被中途扩大，运维新启用的服务只交给之后的对话；停用不收回已授予的连接，删除的连接在调用时报 `removed`。

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
| `./shared` | Host 与浏览器（同构，不导入 Node、浏览器或 Host 包） | 同构契约与纯校验：身份（含增强工具名）、连接与设置文法（含连接 id 文法 `isConnectionId`）、路由判断、URL 校验、会话选择与 Remote 契约 |
| `./host` | Host | 选择、执行与传输：选择范式、可见性控制器、增强工具的显式入口、对话列表与共用部件（类型在 `host/enhanced.ts`）、凭据、有界传输与去敏、MCP 客户端、adapter 骨架与各服务 wire |
| `./client` | 浏览器 | 浏览器契约与组件骨架：分区契约、选择存储与状态观察器、`/setup-*` 命令工厂、目录驱动的设置页骨架 |

模块与导出位置见[代码结构 · core](code-structure.md#core)。

为什么这样分：同一份设置文法与路由判断必须在 Host 与浏览器得出相同结论，所以放在同构的 `./shared`；选择范式与传输只在 Host；浏览器侧的存储与骨架只在浏览器。抽取遵守“第二个使用者出现时再抽象”：只有两侧都用到的部分才进 core；远程服务的协议作为整体放在 core，只用于搜索的 OpenAlex 与 Semantic Scholar 也在这里，新增服务只有一个位置。core 的设置骨架两个插件都整体内联（fetch 也带着 model 表单与 list 字段的代码），拆开要给骨架多加一层注入 API，收益不抵。

## 浏览器面

浏览器面按“能力的数据与命令归插件，可视化的选择集中在 ui”划分；ui 对插件没有任何依赖。界面文案与交互见 [设计文档 · 会话选择](design.md#会话选择)。

| 槽位 / 入口 | 注册者 | 说明 |
| --- | --- | --- |
| `commandUi`：`/setup-search`、`/setup-fetch` | 各插件 | 由 core `selectionCommand` 生成；不依赖 ui，ui 停用时仍可用 |
| `plugins.row.config`（键 `dsh-tool-web-enhanced-profile#<行 id>`） | 各插件 | 行设置页，由 core 骨架按目录组成；只在本行运行时注册（`configForms.whileServed`）；写入前用本插件的 `resolveSettings` 校验写入后的完整文档；页面内的写入串行（见下） |
| 浏览器服务 `webConnections` | ui | 分区与路由事实的注册表 |
| `conversation.input.right` | ui | 两个能力共用的一个连接按钮与菜单；按钮读取输入栏为模型选择器设置的 `--dsh-composer-model-text-display` / `--dsh-composer-model-icon-display`，与它一起收起，不自设断点 |
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
- 分区带上本能力的 `SelectionStore`、文案函数、可选的会话参数组件 `Options`（search 的实时性）、“打开设置”入口，以及布尔事实 `remoteServicesOff`（菜单底部的提示）：目录里 `optIn` 的内置服务全部停用时为真，自定义连接不计，行设置未读到或无效时为假；由 core `remoteServicesOffSource` 从浏览器的行设置快照用与 Host 同一个解析函数算出，快照变化时才重算。ui 只负责外壳与通用行（菜单只列未停用的连接，会话所选的停用连接除外）。新增一种会话参数不改 ui。
- 命令、设置页与菜单读写同一个 `SelectionStore`，在任一处切换，另一处立即反映。
- **路由事实与分区解耦**：插件另用 `registerRoute` 提供路由事实（含浏览器看不到的 `DSH_WEB_*_PROVIDER`），`showSelector: false` 只撤下分区。插件行未运行时没有条目，ui 只能按 `web` 行的值判断。
- **插件行停用**：ui 用 `ids.ts` 的身份、`configForms.whileServed` 与 `configForms.get('web')` 自己发现“`web` 行仍指向已停用插件的 provider”，在菜单与概览里说明；这条信息不能依赖已经注销的分区。
- **契约版本**：三个包同一节奏发布、profile 精确锁定版本，分区契约不需要跨版本兼容，变化时三个包一起改。
- “打开设置”经 `pluginNavigation.openBundle` 打开 profile 的插件页，行设置页在那里展开。

**设置页的写入**（core `client/settings/document.ts` 的 `useSettingsDocument`）：各节各自写入，页面用一条 promise 队列把它们串行，一次落定后才提交下一次。写入有两种形状（`WriteSettings`）：

- **操作数组**：编辑器类（凭据名称、地址与信任、自定义连接的编辑与删除、Reset、白名单、User-Agent）按页面显示的 revision 作 fence，编辑的是用户看到的内容，所以文档在别处变了就被拒。
- **`SettingsChange`**（`layers => ops`）：开关与逐项保存（服务的启用与访问方式、参数表单、默认值、增强工具、自定义连接的启用）。轮到它时，队列用 `readSettings()` 取当下的设置快照（插件注入，含前面已被接受的写入），在其上计算稀疏操作、经同一个 `resolveSettings` 校验，并以那一刻的 revision 作 fence。依赖当前值的派生（如切回 keyless 时保留哪些参数）也在函数里从这份快照读，不用渲染时的旧值。

两种写入都经 Host 的 revision 比较：别处（另一个页面、手工改文件）的修改还没传到本页时，本页的写入带着旧 revision 被拒，不会覆盖它；队列只消除同一页面里连续写入互相作废。

增强工具没有自己的浏览器面：GUI 只按名字为 `web_search` / `web_fetch` 画 web 卡片、不读 Host 的展示回调，增强工具显示为 DSH 的通用工具行（见[设计文档 · 展示](design.md#展示)）；它们照原生写 `presentationMeta`，持久化的记录留给以后的自定义卡片。

共同约束：界面文字全部走各包 `src/client/locales.ts` 的字典（zh 与 en 同键，命名空间等于行 id），`locale/*.json` 只放插件页读取的 `meta`；Host 只返回错误码与英文消息；样式只用 DSH 的 `--dsw-*` 变量与输入栏公开的上述紧凑信号；浏览器从不读取密钥，凭据状态只读“是否已配置”。

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
| 凭据解析的异常 | 向 Credentials 或账号服务取凭据时，依赖抛出的任何异常（含带 `WEB_*` 码的 `WebError`）都不可信：它发生在拿到凭据之前，无法按本次凭据去敏，消息里可能就是密钥。在最窄的边界捕获，只有调用的 signal 确实已取消时报 `WEB_ABORTED`，其余换成固定文本的普通 Error，由执行层改写为固定措辞的 `WEB_PROVIDER_ERROR`，诊断也只记固定文本 | core `runAdapter`（adapter，含 fetch 远程执行）、`nativeAuth`（native）、search `model/execute.ts`（API key 与账号令牌） |
| keyless | 不读取、不发送、不回退到密钥，并且永远发往目录端点 | core `adapterTarget`、`runAdapter` |
| 出站请求 | 本项目自己的请求一律用全局 `fetch`（继承 DSH 的代理策略）、`redirect: 'error'`；字节上限（先看 Content-Length，再在流上计数）与覆盖凭据、握手、读正文的整体截止时间；不自动重试、不自动 fallback | core `host/transport.ts` |
| 端点信任 | 自定义端点与不同于目录端点的 `url` 参数（如 native 的 `baseURL`）都要 `trustedEndpoint: true`；固定 model 连接总是需要；内置 adapter 的端点不可改。设置文法拒绝 `__proto__` / `constructor` / `prototype` 键，并在解析前按预算拒绝过大的输入 | core `shared/settings.ts`、设置页骨架 |
| 账号令牌 | 只经 `native` 后端（沿用 DSH provider：本次请求路由为 `deepseek-account` 且取得令牌时用令牌，否则用 API key），以及唯一的扩展：跟随 `deepseek-account` 路由的 search `model` 连接。后者只用账号令牌，只在本次请求已解析的路由确为 `deepseek-account` 时取得，只发往会话端点，发送前校验只含可见 ASCII 与空格（不 trim），不回退 API key | core `accountTokenFor`、search `model/execute.ts` |
| 目标访问策略 | 只有 fetch 的 `local` 检查目标地址（白名单为空等于原生 public-only）；远程后端把目标访问策略交给服务，不检查目标 URL，界面写明 URL 或查询会发给谁 | fetch `src/local/`；连接说明 |
| 远程结果 | fetch 的远程正文一律为文本；服务没报告目标状态时记为请求的 URL 与 200（兼容映射），只有服务明确给出的状态码才成为非 2xx 结果；search 的来源只保留无用户信息的 http(s) URL（≤ 8192 字符），`native` 与 model 的结果同样过滤 | fetch `remote/page.ts`；search `sources.ts`、core `shared/url.ts` |
| 会话与模型 | 会话只能在运维启用的连接之间选择；冻结的只是“哪个连接”，可选性与目标每次调用按当前设置判定；发起调用的会话来自 `currentInitiator()`；`available()` 只做本地判断 | core `installCapability`、`isSelectable` |
| 显式调用 | 模型给的 `provider` 是不可信输入：工具代码先按连接 id 文法（1–128 字符且 `isConnectionId`）校验，不合文法不回显原值；只能落到本对话 provider 列表里仍存在的连接，之后一律使用列表里的 id；不能指定端点、凭据引用或参数。身份来自 `exec.agent`，目标与执行在 `withInitiator(call.agent)` 里；关闭与失败的计划照样拒绝；凭据、keyless、端点信任与去敏规则不变（同一执行层）；不写会话选择与模型记忆 | core 显式入口、两侧 `src/tools/` |
| 列出与新增文本 | `describe` 与 `listing` 的任何异常都变为固定的 `WEB_PROVIDER_ERROR`，原消息、cause 与 stack 不给模型也不进日志。增强工具新增的文本（拒绝措辞、换 provider 提示、列出文本）只含固定措辞与列表里的 id；列出不含凭据引用、完整端点、请求头或内部错误，标签与说明是运维数据，单行化、有界，不当作指令 | core 显式入口与工具部件 |
| 跨命名空间读取 | 跟随会话模型时读别的插件命名空间的路由配置，先按与设置文法同一组上限限制长度与条数，超出判为不支持且不回显原值 | search `model/bounds.ts` |

**给模型的错误与去敏的位置**

本插件让本次请求的 API key 或账号令牌不进入给模型的内容：错误文字检出即整段隐去，成功体中替换为 `[redacted]`。已知的缺口是 DSH 原生 provider 解析失败时，其错误第一段可能带短于 8 字符的凭据片段，见[已知限制](design.md#已知限制)。错误格式、检测与替换规则见[功能设计 · 错误与上游说明](design.md#错误与上游说明)与[凭据隐去](design.md#凭据隐去)。处理只在下面几处边界发生：

| 位置 | 错误文字 | 成功体 |
| --- | --- | --- |
| core 有界传输 | HTTP 非 2xx 的错误体 | JSON 回复的字符串值（adapter 与 model 后端） |
| core MCP 客户端 | `isError` 的工具文本、JSON-RPC 错误 | 成功的 `result` |
| core `runAdapter` | — | 服务解析后的结果，覆盖从 JSON 键名还原的文本 |
| core `nativeBackend` / `restateNative` | DSH 错误的第一段 | DSH provider 的结果 |

增强工具不新增去敏位置：显式调用的上游说明就是执行层已去敏的结果，换 provider 的提示插在原消息第一段末尾，即不可信说明之前，不会被读成上游文字。

凭据由调用方经 `secretMatcher` 交给这些位置（adapter 与 model 交给传输，`native` 经 `nativeAuth` 记录本次交给 DSH 的值）；后端不自己拼上游文字。所有诊断（传输、MCP、`native`、两侧执行层、model 后端）只以 `redactDiagnostic` 的去敏副本进 Host 日志，不带原 cause 与 stack。

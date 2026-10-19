# 架构

本文是 dsh-tool-web-enhanced 的设计文档，面向维护者：说明它在 DeepSeek Harness（DSH）里的位置、包怎么划分、一次 web_search / web_fetch 请求怎么走、后端怎么选与怎么扩展，以及哪些约束不能破坏。开发流程见 [development.md](development.md)。

状态标记：**[已实现]** 指 M0 骨架里已有的代码；**[计划]** 指本文给出的设计，尚无代码。

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
3. 默认行为与原生一致：在**全新、未改过原生行配置**的 profile 上，装上即等价于未安装时的 DSH（M0 已做到；原生行的自定义覆盖不会被继承，见第 11 节）；
4. 继承两个前身项目的能力：dsh-web-search-enhanced 0.1 的会话级搜索连接，dsh-web-fetch-enhanced 0.1 的可配置 HTTP(S) 本地抓取（成为 fetch 侧的 `builtin:local` 连接）；
5. 模块可复用、可扩展：选择、存储、Remote、界面由 core 提供，两个插件各自只提供目录、后端和能力特有的策略；新增一个后端只动一个后端模块、一条目录项和文案。

v1 不做：注册自己的模型工具；模型可控的按调用参数；自动重试与 fallback 链；改写 tool-web 的 HTML→Markdown 转换。它们在第 13 节作为扩展点预留。

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
| （无对应） | `dsh-tool-web-enhanced-core`（`packages/core`，private） | 两个插件共用的源码，构建时内联，不发布 |
| `dsh-web`、`dsh-tool-web` | 直接复用 | 不替换、不包装 |
| `dsh-client-ui-settings-web-search` | 各插件的 `./client` | 行设置页与 `/setup-*` 命令跟随插件，不单独成包 |
| （无对应） | **`dsh-tool-web-enhanced-ui`**（`packages/ui`） | 纯浏览器面：两个能力共用的输入框连接菜单、首次启用提示、bundle 概览；Host 面为空。M0 只有空的 Host 面与行 **[已实现]**，浏览器面随 M1 |

### 4.2 包依赖

~~~mermaid
flowchart TD
  profile["dsh-tool-web-enhanced-profile<br/>bundle：cordis.patch.yml + locale + icon"]
  search["dsh-web-search-enhanced<br/>Host: lib/index.js　Client: lib/client.js [计划]"]
  fetch["dsh-web-fetch-enhanced<br/>Host: lib/index.js　Client: lib/client.js [计划]"]
  ui["dsh-tool-web-enhanced-ui<br/>Host: 空 [已实现]　Client: lib/client.js [计划]<br/>提供浏览器服务 webConnections"]
  core["dsh-tool-web-enhanced-core（private）<br/>./shared　./host [计划]　./client [计划]"]
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
~~~

依赖规则（由 `scripts/verify-packages.ts` 和 lint 守住）：

- 插件的 Host 产物只能导入 Node 内置模块和 `@deepseek-ai/*`（由 DSH 安装提供，profile 解析会优先使用安装里的同名包）；其他代码包括 core 一律内联，插件没有运行时 `dependencies`；
- search、fetch、ui 三者互不导入；共享代码只能放进 core；插件与 ui 之间只通过浏览器服务 `webConnections` 相连（第 9 节），类型来自 core；
- core 不导入插件包，不持有模块级状态（两个插件各内联一份，状态无法共享）；
- profile 只依赖本仓库发布的包，版本精确锁定到同一次发布。

### 4.3 core 的模块 [计划，除 ./shared/ids 外]

core 承载"选择范式"本身，插件只提供参数：

| 入口 | 模块 | 内容 |
| --- | --- | --- |
| `./shared` | `ids` **[已实现]** | 包名、行 id、provider id、插件页键 |
| | `connections` | 连接 id 语法、访问方式、`OptionRule` 与按目录校验参数、稀疏覆盖的合并规则 |
| | `selection` | 会话选择记录、视图（`ConnectionView` / `SelectionView`）与 Remote 契约的 zod 片段 |
| | `url` | URL 形状校验与规范化（第 6.4 节），search 的来源规范化也用它 |
| `./host` | `errors` | `WebError` 构造与取消辅助，消息模板按能力参数化 |
| | `transport` | 有界 HTTP：拒绝重定向、字节上限、整体截止时间、状态码→错误码 |
| | `credentials` | 按访问方式解析凭据（keyless / api-key / account） |
| | `sessions` | 会话选择与模型记忆的存储：storage-domain 懒打开、按会话排队、revision 比较并写入、fork 继承 |
| | `plans` | 每步冻结：`agent/request` 捕获、`currentInitiator()` 取回 |
| | `restriction` | 关闭时对 Agent 隐藏工具 |
| | `remote` | 由命名空间生成 `<ns>/get`、`<ns>/set`、`<ns>/provider` 的 Remote 服务 |
| | `route` | 用公开的 Settings 数据判断 `web` 行是否选中本插件（配置优先于环境变量，与 `WebRuntime` 相同） |
| `./client` | `selection` | 会话选择状态 `SelectionStore`：每会话一份可观察快照，基于插件的 `<ns>` Remote 读写，模型、设置、凭据变化或重连时失效重读 |
| | `section` | 菜单分区契约 `ConnectionSection` 与浏览器服务 `webConnections` 的类型（第 9 节） |
| | `command` | `/setup-<cap>` 命令工厂，读写同一个 `SelectionStore` |
| | `settings` | 行设置页骨架（默认连接、服务列表、自定义连接、凭据、模型记忆）、稀疏写入、路由提示 |

抽取顺序遵守"第二个使用者出现时再抽象"：search 先在自己包里移植前身实现，fetch 接入同一范式时再把共用部分移入 core（第 13 节）。MCP 客户端只在第二个 MCP 后端出现时进入 core。

### 4.4 发布与命名

三个包都发布到 npm，用户只安装 profile：`dsh plugin --profile <p> add dsh-tool-web-enhanced-profile`，pnpm 把两个插件作为它的依赖装进 profile。这与 DSH 自己的做法一致（`@deepseek-ai/dsh-experimental-inspector` 等也是独立发布、由 bundle 依赖）。两个插件继续使用前身的 npm 名，版本从 0.2.0 起：从 0.2.0 开始它们是 profile 的普通插件，不再是 bundle。

| 标识 | search | fetch | 定义位置 |
| --- | --- | --- | --- |
| npm 包 | `dsh-web-search-enhanced` | `dsh-web-fetch-enhanced` | `core/src/shared/ids.ts` |
| 行 id = Settings 命名空间 = Cordis 插件名 | `web-search-enhanced` | `web-fetch-enhanced` | 同上 |
| `ctx.web` provider id | `search-enhanced` | `fetch-enhanced` | 同上 |
| storage-domain | `web_search_enhanced`（沿用前身） | `web_fetch_enhanced` | 各插件 |
| Remote 命名空间 | `searchConnections`（沿用前身） | `fetchConnections` | 各插件 |
| 插件页行配置键 | `dsh-tool-web-enhanced-profile#web-search-enhanced` | `…#web-fetch-enhanced` | `rowConfigKey()` |
| 斜杠命令 | `/setup-search` | `/setup-fetch` | 各插件 |

ui 包：npm 名 `dsh-tool-web-enhanced-ui`，行 id `tool-web-enhanced-ui`（`ids.ts` 的 `UI`），浏览器面提供服务 `webConnections` [计划]。

**命名规则**（沿用 DSH 的惯例，如 `@deepseek-ai/dsh-tool-web` → 行 `tool-web`）：行 id = npm 包名去掉 `dsh-` 前缀，Cordis 插件名与 Settings 命名空间都等于行 id。包分两族：`web-*-enhanced` 是向 `ctx.web` 注册 provider 的插件（与 DSH 的 `web-search-deepseek`、`web-fetch-http` 同族，名字沿用前身）；`tool-web-enhanced-*` 是围绕 tool-web 的产品层——profile、ui 和私有的 core。profile 测试对每个插入行检查这条规则。

这些标识只在 `ids.ts` 定义一次；profile 的 patch 是 YAML，无法导入，由 `packages/profile/tests/profile.spec.ts` 断言它与 `ids.ts` 一致。

## 5. 组合：profile 的 patch

[packages/profile/cordis.patch.yml](../packages/profile/cordis.patch.yml) **[已实现]**：

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

- **profile 拥有 `web` 行，两个字段一起写。** patch 会整体替换目标行的 `config`，不做深合并；只写一个字段会丢掉另一个，这正是前身 0.1.9 的事故。由同一个 bundle 写全两个字段，就没有"另一半属于别人"的问题。之后的层（用户层、更晚的 bundle）改写 `web` 时整体覆盖我们的选择，这是 DSH 的层叠语义，也是用户退出本插件的正常途径。
- **用自己的 provider id，不占原生席位。** 前身用 `deepseek-official` / `http` 顶替原生 provider，以避免改写 `web` 行；现在 `web` 行归 profile，就没有理由冒用原生 id。自有 id 让错误、日志和路由判断都指向本插件，也让原生 provider 可以同时挂载而不触发 `WEB_DUPLICATE_PROVIDER`。
- **停用 `web-search-deepseek`。** 它的能力成为 search 插件的 `builtin:deepseek-messages` 连接（同一个上游类，同样的凭据解析）。停用它还会让内置的"网页搜索"页面消失（该页面只在这一行运行时注册）：那个页面的开关在用户层把 `web` 行改写成 `deepseek-search-api`/`deepseek-fetch-api` 或 `deepseek-official`/`http`（当下层值不同时），会悄悄把流量从本插件引走。
- **保留 `web-deepseek-api` 和 `web-fetch-http`。** 它们注册的 provider 没有被选中，不参与路由，也不造成歧义（选择已固定）。它们是手动退路：在用户层把 `web` 行改成 `searchProvider: deepseek-search-api` 加 `fetchProvider: http`（或 `deepseek-fetch-api`）即可绕开本插件。注意 `deepseek-official` 已随 `web-search-deepseek` 停用：要回到它，还必须在用户层重新启用那一行，否则报 `WEB_PROVIDER_CONFIGURED_MISSING`。最干净的退路是停用整个 profile。
- **菜单行不依赖插件行。** `tool-web-enhanced-ui` 不注入任何插件提供的服务，插件向它注册分区是可选注入（第 9.2 节）；任一插件行或两者都被停用时，它照常激活。被停用的那个能力不会回退到别的 provider：`web` 行仍指向它的 id，调用报 `WEB_PROVIDER_CONFIGURED_MISSING`（单元与 e2e 均覆盖这三种组合）。
- **插件行由 profile 插入。** 插件页把 bundle 的 `insert` 行列为它的组件，每行显示**行所属包**自己的 `locale/*.json` 标题、描述和图标（e2e 截图已验证）。

与前身共存：0.1.x 的两个独立 bundle 插入同样的行 id，与 profile 同时安装会冲突。安装 profile 前先移除它们（第 11 节）。

## 6. 运行时

### 6.1 请求管线

两个插件采用同一条管线：

~~~mermaid
flowchart LR
  WEB["ctx.web<br/>按 web 行选中席位"] --> SEAT["Seat<br/>唯一注册的 provider"]
  SEAT --> PLAN["Planner<br/>本步用哪个连接"]
  PLAN --> EXEC["Executor<br/>凭据 · 截止时间 · 错误改写"]
  EXEC --> BACKEND["Backend<br/>native · adapter · local …"]
  BACKEND --> TRANSPORT["Transport<br/>上游类 · 有界 HTTP · 官方 HTTP 传输"]
~~~

| 层 | 职责 | 不变量 |
| --- | --- | --- |
| Seat **[已实现]** | 在 `ctx.web` 注册一次，id 固定；把调用交给 Planner 选出的后端 | 注册随插件 fiber 释放；`available()` 恒为 `true`，不做 I/O（能否服务取决于会话选择，调用时才知道） |
| Planner **[计划]** | 产出 `Plan`：`off` / `invalid` / `failed` / `ready(connection)` | 同一步内不变；只读本地状态 |
| Executor **[计划]** | 为本项目自己的后端解析凭据、套截止时间；把所有后端的错误改写成给模型的简短消息（保留错误码）；search 统一规范化来源 | 后端拿到的是已解析的凭据和参数，不碰凭据存储 |
| Backend | 某个服务的协议，或一个上游 provider 实例 | 见 6.4 |
| Transport | 上游 DSH provider 类、core 的有界 HTTP、DSH 官方 HTTP(S) 抓取传输 | 见第 10 节 |

M0 的 Planner 是固定返回原生等价后端的函数：`createSearchSeat(id, select)` / `createFetchSeat(id, select)`。换成真正的 Planner 不改变注册代码。

### 6.2 共同的选择范式 [计划，移植自 search 0.1]

search 与 fetch 用同一套概念、同一份 core 实现：

- **连接（connection）**：到某个后端的一种配置。`builtin:<id>` 来自插件目录，运维可以对它做稀疏覆盖（停用、访问方式、凭据引用、参数）；`custom:<name>` 由运维新建（例如自建端点，需显式 `trustedEndpoint`）。
- **插件行设置**：`{ version, defaultConnection, connections }`，经插件设置页编辑，热生效。它决定会话**能**选什么。
- **会话选择**：`{ connectionId | null, revision, options }`，存在插件自己的 storage-domain，以 revision 比较并写入，同一会话的读写排队执行；fork 出的会话继承父会话的选择。revision 为 0 表示本会话还没选过，它的连接按下面的"未选择时的解析顺序"得出，并随之变化，直到用户选一次。
- **模型记忆**（沿用前身的 pairing）：用户在会话里选连接（包括关闭）时，记下"这个会话下一次请求将使用的模型 → 所选连接"。模型按"待生效的切换 → 上次请求的模型 → Agent 的路由"确定，键为 `(provider, model)`，存在插件自己的 storage-domain 的 `pairings` 表。它让换到某个模型的新会话沿用你上次为这个模型做的选择，例如自带搜索的模型配它自己的搜索连接。
- **未选择时的解析顺序**：① fork 出的会话：父会话的选择；② 该模型的记忆，前提是记住的连接仍存在且未被停用（记住的是"关闭"则关闭）；③ `defaultConnection`。前身的第四步"唯一可用的连接"不再保留：它要在选择路径上查询凭据与账号状态。
- **每步冻结**：`agent/request` 时为 (Agent, turn, step) 捕获计划；Seat 通过 `ctx.agents.currentInitiator()` 找到发起调用的 Agent，取它这一步的计划。冻结的是"用哪个连接、带哪些会话参数"；连接是否仍启用、fetch 的白名单这类**运维策略在每次调用时读当前值**，收紧立即生效。
- **会话之外的调用**：没有发起 Agent（其他宿主功能直接调用 `ctx.web`）时也就没有模型，模型记忆无从查起，按调用当时的 `defaultConnection` 计划；默认连接需要会话上下文（如 search 的"跟随会话模型"）时返回 `invalid`。
- **关闭**：选择为 `null`。Seat 对该会话的调用返回带固定错误码的 `WebError`（执行层兜底），并用 `agent.ctx.tools.restrict({ deny: [<tool>] })` 对该 Agent 隐藏 `web_search` / `web_fetch`。Web profile 里 tool-web 由 agent preset 挂在 Agent 作用域的祖先上（DSH `agent-preset-registry` 的 `bindScopeParent`），根 ctx 上没有这两个工具：判断工具是否存在要看 Agent 自己的视图，不能照搬前身 0.1 在根 ctx 上的 `tools.get` 判断——它在 Web profile 下总是不成立，限制从未生效。
- **Remote**：`<ns>/get`、`<ns>/set`（带 `expectedRevision`）、`<ns>/provider`；`get` / `set` 按被寻址的会话资源授权。search 用 `searchConnections`，fetch 用 `fetchConnections`，由同一个工厂生成。
- **记忆要看得见**：前身的配对在界面上不可见，用户不知道新会话为什么选了某个连接。现在 `SelectionView` 带上来源（本会话选择 / 继承自父会话 / 模型记忆 / 默认），输入框菜单显示当前选择的来源，设置页列出全部模型记忆并可逐条清除。

### 6.3 两侧的差异只是参数

| 维度 | search | fetch |
| --- | --- | --- |
| 隐藏的工具 | `web_search` | `web_fetch` |
| storage-domain / Remote | `web_search_enhanced` / `searchConnections` | `web_fetch_enhanced` / `fetchConnections` |
| 默认连接 | `builtin:deepseek-messages`（原生等价） | `builtin:local`（原生等价） |
| 会话参数 | `freshness` | 无 |
| 特有的连接种类 | `model`（含跟随会话模型） | `local`（唯一的 HTTP 传输后端） |
| 每次调用读取的运维策略 | 连接启用状态 | 连接启用状态；`local` 的白名单与上限 |

### 6.4 后端种类

| 种类 | 用于 | 怎么实现 | 行为基准 |
| --- | --- | --- | --- |
| `native` | search：`deepseek-messages` **[已实现]**、`deepseek-search-api`；fetch：`deepseek-fetch-api` | 直接实例化 DSH 导出的 provider 类（`DeepSeekSearchProvider`、`DeepSeekSearchApiProvider`、`DeepSeekFetchApiProvider`），凭据与端点解析照搬对应原生行 | 与 DSH 原生 provider 完全一致；只改写错误消息（上游消息带端点、上游错误详情，并指向本 profile 已隐藏的内置"网页搜索"页面） |
| `adapter` | search 的结构化服务（Exa、Tavily、Firecrawl、TinyFish、OpenAlex、Semantic Scholar…）；fetch 的远程读取服务（Jina Reader、Firecrawl…） | search 提供 `request` / `parse`，fetch 提供整次调用；传输统一走 core 的有界 HTTP | 对齐 DSH 远程 provider 的设计（6.6） |
| `model` | search | 让带服务端搜索的模型执行搜索，走 core 的有界 HTTP | 同上 |
| `local` | fetch | DSH 官方 `HttpFetchProvider` + 本插件注入的解析器 | 6.5 |

### 6.5 fetch 的 local：唯一做地址检查的后端

只有经 HTTP(S) 直接访问目标的后端才需要、也才能做目标地址检查，fetch 里只有 `local` 是这样。**[M0 为原生等价；白名单随 fetch 对齐移植]**

- 传输是官方 `HttpFetchProvider`，本插件只注入解析器，不重写传输。URL 策略（仅 http(s)、≤2048 字符、拒绝 URL 内嵌凭据）、同源重定向与逐跳复查、代理路由、字节/字符/时间/跳数上限都是官方的。
- 白名单为空时与原生 public-only 完全一致；非空时按 CIDR（可再用主机名收窄）放行非公网地址。**直连**的请求校验完整 DNS 答案集与 NAT64，任一不合规即拒绝，连接固定到已验证地址；IP 字面量在交给传输层之前先检查。**走代理**的域名请求沿用上游行为：DNS 由代理完成，本机没有地址可校验，也不固定连接（`web-fetch-http` `provider.ts` 的 `requestOnce`）；非公网 IP 字面量永远不走这条捷径。
- 白名单、User-Agent 和上限是 `builtin:local` 的参数，只有运维能改；会话只能选择是否使用 `local`。
- 给模型的白名单提示：只在本步计划用的是 `local`、白名单非空、且确认 `web_fetch` 路由到本插件时加入运行时上下文；路由无法判断时**不加**。

### 6.6 远程后端：对齐 DSH 的设计

DSH 对远程抓取的立场（deepseek-harness `.agents/notes/implemented/feature/2026-10-15-deepseek-search-fetch-api.md`）："选择 DeepSeek 即把页面获取与目标访问策略委托给该服务；Harness 拒绝 API 请求的重定向，保留取消和有界的工具输出。" 本项目的远程后端（search 与 fetch 一样）照此执行：

- 每次操作一个 API 请求；带凭据的 API 请求 `redirect: 'error'`；凭据按访问方式解析（keyless 不碰密钥；api-key 经 DSH Credentials；DeepSeek 账号会话用账号令牌）；
- 不对目标 URL 做地址检查，也不做"披露"检查：URL 原样发给服务，目标是否可达、能否抓取由服务决定。设置页在连接说明中写明"URL 会发送给 <服务>"；
- fetch 结果：服务不提供目标状态码与最终 URL 时，返回请求的 URL 与 200（代表"服务取到了页面"，不代表本机看到了目标响应），正文为服务返回的 Markdown / 纯文本（`kind: 'text'`）；服务的非成功响应是 provider 错误；
- 本项目自己实现的远程后端走 core 的有界 HTTP（字节上限、整体截止时间）；`native` 后端保持 DSH 原生 provider 的行为，模型可见输出由 tool-web 的 `fetchMaxOutputChars` 和搜索结果数兜底。

### 6.7 共用的词汇 [计划]

~~~ts
// core/shared —— Host 与浏览器同构，不导入 Node、浏览器或 Host 包
type ConnectionId = `builtin:${string}` | `custom:${string}`
type AccessMode = 'keyless' | 'api-key'            // 持久化；'account' 按调用推导

interface Descriptor {                              // 目录事实：校验、设置页、状态判断都读它
  readonly label: string
  readonly homepage?: string
  readonly kind: 'native' | 'adapter' | 'model' | 'local'
  readonly remote: boolean                          // 查询或 URL 是否发给第三方服务（只用于说明文字）
  readonly access: {
    readonly keyless: boolean
    readonly apiKey: { readonly credentialRef: string } | false
    readonly account: boolean
  }
  readonly options: Readonly<Record<string, OptionRule>>
}

interface Selection<O> { readonly connectionId: ConnectionId | null; readonly revision: number; readonly options: O }
type SelectionSource = 'session' | 'inherited' | 'model' | 'default'   // 当前连接从哪来，界面据此说明
interface Pairing { readonly provider: string; readonly model: string; readonly connectionId: ConnectionId | null }

// core/host —— 只在 Host
type Auth = { kind: 'keyless' } | { kind: 'api-key'; key: string } | { kind: 'account'; token: string }
type Plan<C> = { kind: 'off' } | { kind: 'invalid'; reason: string } | { kind: 'failed' } | { kind: 'ready'; connection: C }

/** 每个插件交给 core 的全部差异；core 据此生成存储、计划、Remote、限制与界面。 */
interface Capability<D extends Descriptor, O, C> {
  readonly tool: 'web_search' | 'web_fetch'
  readonly remoteNamespace: string
  readonly storageDomain: string
  readonly catalog: Readonly<Record<string, D>>
  readonly sessionOptions: { readonly schema: ZodType<O>; readonly initial: O }
  resolve(document: unknown): ResolvedSettings<D>   // 纯函数：稀疏合并 + 严格校验
  plan(settings: ResolvedSettings<D>, selection: Selection<O>, route: RouteFacts): Plan<C>
}
~~~

后端接口按能力分开：

~~~ts
// search：请求/解析对，传输统一
interface SearchAdapter {
  request(input: SearchInput, endpoint: string, auth: Auth): HttpRequest
  parse(payload: unknown, input: SearchInput): WebSearchSource[]
  readonly keyless?: 'rest' | McpRoute
}

// fetch：整次调用（local 用官方传输，远程服务各有协议）
interface FetchBackend {
  fetch(request: WebFetchRequest, call: { auth: Auth; options: Readonly<Record<string, unknown>>; signal: AbortSignal }): Promise<WebFetchResult>
}
// native：两侧都直接是一个 WebSearchProvider / WebFetchProvider 实例
~~~

目录与实现用类型绑定：`const WIRES = { … } satisfies Record<keyof typeof CATALOG, …>`，漏写实现即编译失败。

**刻意不统一的部分**：请求/结果类型（DSH 本来就分开）；search 的请求/解析对与 fetch 的整次调用；上限数值（search 固定，fetch 的 `local` 由运维配置）；search 独有的实时性、模型连接、来源规范化；fetch 独有的 `local` 白名单、解析器、白名单提示。共享的是选择范式与机制，不是数值和能力语义。

## 7. 新增一个后端 [计划]

1. 在插件的 `src/catalog.ts` 加一条 Descriptor（位置即显示顺序，id 成为 `builtin:<id>`），写明 `kind`、`remote`、访问方式和参数规则；
2. 在 `src/backends/<id>.ts` 实现对应接口并在 `WIRES` 注册；`native` 只需实例化上游类并照搬原生行的凭据/端点解析；
3. 文案：连接说明（远程服务写明会收到什么）、参数名、占位符、枚举值（zh / en 同键）；
4. 测试：本地 HTTP 服务充当远程 API，覆盖请求形状、响应映射、API 重定向被拒且目标未被访问、取消、错误改写；`native` 只测凭据解析与错误改写。

不需要改 profile、`web` 行、Seat、Planner 或界面：设置页和输入框菜单都由目录驱动。

## 8. 配置、状态与凭据

| 位置 | 内容 | 编辑方 |
| --- | --- | --- |
| `web` 行 | 两个 provider id | 只有 profile patch；用户层覆盖视为用户主动退出（第 11 节的预检会提示） |
| `web-search-enhanced` 行 [计划] | `{ version: 2, defaultConnection, connections }` | 插件设置页，经 Settings（volatile 字段，热生效） |
| `web-fetch-enhanced` 行 [计划] | `{ version: 2, defaultConnection, connections }`；`connections['builtin:local'].options` 含 `allowCidrs`、`allowHostnames`、`userAgent`、`maxResponseBytes`、`maxBodyChars`、`timeoutMs`、`maxRedirects` | 同上 |
| storage-domain `web_search_enhanced` / `web_fetch_enhanced` [计划] | 表 `selections`（每会话的选择）与 `pairings`（模型记忆） | `searchConnections` / `fetchConnections` Remote；记忆由会话里的选择写入，设置页可清除 |
| DSH Credentials | API 密钥 | 设置页经 `remote.credentials`；配置里只存 `credentialRef` |

- **校验**：每个插件一个纯函数校验器（即 `Capability.resolve`），Host 在 Loader 的 `internal/config` 钩子里调用它（Settings 写入前校验，非法候选不落盘），浏览器端用同一函数给出即时反馈；不再使用前身 fetch 的 `hostChecked`（改写 schema 的 `toJSON`）和迁移 Proxy。
- **版本**：两侧都用 `version` 字段，当前为 2。search 的 v2 就是前身的格式，原地有效。fetch 前身用 `schemaVersion`（0 或 1）和顶层字段，迁移步骤把它们移入 `connections['builtin:local'].options`，显式的 `[]` 原样保留。迁移是纯函数 N→N+1 表，在校验前于内存中执行；只有需要客户端编辑新形状时才由迁移器按 revision 写回。新增可选字段不提升版本。
- **退役字段**：前身的 `providerId` 不再有意义，接受并忽略，第一次写入设置时去掉。

## 9. 浏览器面 [计划]

### 9.1 谁注册什么

| 槽位 / 入口 | 注册者 | 说明 |
| --- | --- | --- |
| `commandUi`：`/setup-search`、`/setup-fetch` | 各插件 | 用命令选择或关闭本会话的连接；不依赖 ui 包，ui 包停用时仍可用 |
| `plugins.row.config`（键 `rowConfigKey()`） | 各插件 | 行设置页：默认连接、服务列表、自定义连接、凭据、模型记忆（可逐条清除）。fetch 的 `local` 白名单编辑器保留显式"保存"（一次性原子写入），其余字段稀疏自动保存 |
| 浏览器服务 `webConnections` | ui 包提供 | 菜单分区的注册表 |
| `conversation.input.right`（一个按钮） | ui 包 | 两个能力共用的连接菜单 |
| `plugins.bundle.activation`（键为 profile 包名） | ui 包 | 首次启用提示，覆盖两个能力。该键只能有一个注册者，ui 包是自然的主人 |
| `plugins.detail.section` | ui 包 | profile 详情页的概览：两个能力是否路由到本插件、第 11 节的预检结果 |

可视化的连接选择集中在 ui 包；插件只负责"本能力的数据与命令"。命令和菜单读写同一个 `SelectionStore`，在任一处切换，另一处立即反映。

### 9.2 分区契约

~~~ts
// core/client —— 只有类型和 SelectionStore 实现；插件与 ui 包各自内联
interface ConnectionSection {
  readonly capability: 'search' | 'fetch'
  readonly order: number                                  // 菜单中的位置
  readonly title: () => string                            // 已本地化
  readonly selection: SelectionStore                      // 本能力的会话选择：choices、selected、source、revision；select / turnOff
  readonly route: RouteStore                              // web 行是否选中本插件，供概览与菜单提示
  readonly Options?: ComponentType<{ sessionId: string }> // 能力特有的会话参数，如 search 的实时性
  readonly settings: () => void                           // 打开本插件的行设置页
}

interface WebConnectionsService {
  register(section: ConnectionSection): () => void        // 随注册者的 fiber 释放
}
~~~

插件端用可选注入注册分区，ui 包不存在或被停用时，插件的命令和设置页照常工作：

~~~ts
ctx.inject(['webConnections'], scope => {
  scope.effect(() => scope.webConnections.register(section), 'web-search-enhanced: composer section')
})
~~~

- **一个或两个插件行被停用**：ui 包必须照常工作，它对插件没有任何依赖。
  - 停用一个：该插件的浏览器 fiber 释放，分区随之注销；菜单只剩另一个分区，按钮照常显示。ui 包自己根据 `ids.ts` 中的身份、`configForms.whileServed([<rowId>])` 和 `configForms.get('web')` 发现"`web` 行仍指向一个已停用插件的 provider"，在菜单底部和 bundle 概览里说明该能力当前不可用、可在插件页重新启用该行——这条信息不能依赖已经注销的分区来提供。
  - 两个都停用：没有分区，不显示按钮；bundle 概览说明两个能力都不可用。
  - 恢复：插件行重新启用后分区重新注册，按钮回来，不需要刷新页面。
- **能力特有的界面归插件**：search 的实时性等会话参数由插件以 `Options` 组件提供，ui 包只负责外壳、布局、收起和通用行（连接列表、状态、来源、关闭）。这样新增一种会话参数不需要改 ui 包。
- **一个按钮**：按钮显示 search 的当前连接（最常用），菜单里按 `order` 列出各分区；输入栏变窄时按 container query 与 DSH 提供的 `--dsh-composer-model-text-display` 逐级收起为图标，不用 JavaScript 测量。
- **契约版本**：三个包同一节奏发布，profile 精确锁定版本，所以分区契约不需要跨版本兼容；契约变化时三个包一起改。

### 9.3 共同约束

- **产物**：每个有浏览器面的包一个 `lib/client.js`，由 `build/tsdown.ts` 生成 DSH 模块加载器格式（`window.__ModuleLoader__.load({ id, factory })`）。只有壳的平台模块（React、Cordis、`@deepseek-ai/dsh-client-ui-*` 等，见 `build/platform.ts`）外置，其余内联；CSS Modules 编译进包，每个样式表注入一个带 `data-plugin` 的 `<style>`。package.json 声明 `dsh.client` 与 `exports["./client"]` 后，构建工厂自动产出客户端。ui 包的 Host 面是空插件：DSH 只为已挂载的行加载浏览器面，所以它也要作为一行挂载。
- **路由提示**：读 `configForms.get('web')` 与 `<ns>/provider`；`web` 行没有选中本插件时，在行设置页顶部和菜单对应分区说明原因与恢复方法。
- **文案与样式**：界面文字全部走 locale 字典（zh 为主，en 完整对应）；Host 只返回错误码和英文诊断；样式只用 DSH 的 `--dsw-*` 变量；浏览器不读取密钥。

## 10. 安全不变量

本项目自己的传输与执行层：

1. 带凭据的 API 请求一律 `redirect: 'error'`，回归测试证明重定向目标未被访问；
2. core 的有界 HTTP 执行字节上限（先看 Content-Length，再在流上计数）和整体截止时间（覆盖鉴权、握手和读正文）；
3. 不自动重试，不自动 fallback；
4. keyless 永不读取、发送或回退到密钥；
5. 密钥只在 DSH Credentials；配置只存引用；每次调用解析，不跨调用缓存；
6. 自定义端点需显式 `trustedEndpoint`，内置端点不可改；
7. 给模型的错误只含错误码和可操作的简短提示，不含端点、上游正文、cause 或密钥——`native` 后端的错误同样改写；
8. `available()` 只做本地判断；
9. 本项目自己的出站一律用全局 `fetch`，继承 DSH 安装的代理策略，不自建 dispatcher。

`native` 后端：行为与 DSH 原生 provider 一致，包括它们的上限策略（例如原生 DeepSeek provider 读取 API 响应时不设字节上限，由 tool-web 限制模型可见输出）。这是"与原生等价"的一部分，不另加约束；若要收紧，应改为本项目自己的 `adapter` / `model` 实现。

fetch 的 `local`：

10. 白名单为空时与原生 public-only 等价，任何默认值都不扩大可达范围；
11. 直连请求校验完整 DNS 答案集，任一不合规即拒绝，连接固定到已验证地址；走代理的域名请求由代理解析，白名单无法约束它们（上游传输的既有行为，设置页和文档必须写明）；
12. 模型与会话都不能控制白名单、请求头、方法或代理；重定向只在同源内跟随，每跳复查；
13. 白名单提示只在本步计划使用 `local` 且确认路由到本插件时进入模型上下文，无法判断时不加。

远程后端（两侧）：

14. 目标访问策略由服务负责，本项目不对目标 URL 做地址检查；连接说明写明查询或 URL 会发给谁；
15. 会话只能在运维启用的连接之间选择。

search：

16. 来源只保留无用户信息的 http(s) URL，长度有上限；
17. 发起调用的会话来自 `currentInitiator()`，从不来自工具参数。

## 11. 从 0.1.x 升级

| 前身 0.1.x | 0.2 / profile |
| --- | --- |
| 各自是 bundle，分别安装 | 只装 profile；两个插件成为它的依赖 |
| 顶替原生 id：`deepseek-official` / `http`，不改 `web` 行 | 自有 id：`search-enhanced` / `fetch-enhanced`，profile 拥有 `web` 行 |
| 共存模式（改 `providerId` 并手写 `web` 行） | 不需要：原生 provider 可以同时挂载 |
| fetch 只有行级配置 | fetch 与 search 一样：连接 + 会话选择；原配置成为 `builtin:local` 的参数 |
| 配置页挂在 `plugins.bundle.config`（键为插件包名） | 挂在 `plugins.row.config`（键为 `dsh-tool-web-enhanced-profile#<行 id>`） |

升级步骤：移除 `dsh-web-search-enhanced`、`dsh-web-fetch-enhanced` 两个直接依赖，安装 `dsh-tool-web-enhanced-profile`。直接把旧包升级到 0.2 而不安装 profile 时，包失去 `dsh.bundle` 声明，行随之消失：README 和 0.2.0 的 CHANGELOG 必须写清这一点。

要区分三件事：

- **数据保留（已确认）**：插件管理器移除 bundle 时只取消选择、重载组合，再 `pnpm remove`，不删除用户层中的任何覆盖（deepseek-harness `packages/boot/plugin-manager/src/index.ts` 的 `removeBundle` / `selectBundle`）；storage-domain 的数据也留在 DSH home。行 id 与 search 的存储域名不变，所以这些数据在安装 profile 后仍然挂在同名的行和域上。
- **数据可用（随各自的移植里程碑）**：M0 的插件还没有设置 schema，也不读存储域，旧配置此时只是被保留。search 移植后直接读 v2 文档和原存储表；fetch 对齐后经迁移步骤读取前身配置。兼容性由迁移测试保证，用前身的真实文档做样例。
- **路由残留（需要预检）**：被保留的还有用户层里对 `web` 行的覆盖和行的启用状态。前身共存模式写下的自定义 provider id（现已无人注册）、内置开关写下的原生或 API 选择、重新启用的 `web-search-deepseek`，都会压过 profile 的选择，让本插件收不到流量。插件页概览和首次启用提示读取 `web` 行与相关行的有效配置，发现残留时说明原因，并提供"改为使用增强 provider"的操作：经用户确认后移除用户层中的对应覆盖，从不静默改写。端到端测试覆盖"装旧 bundle（含共存模式、已保存设置和关闭搜索的会话）→ 移除 → 安装 profile"的全过程。

## 12. 构建、测试与发布 [已实现]

- **构建**：`build/tsdown.ts` 是所有插件的唯一构建定义（每个包的 `tsdown.config.ts` 只有一行）。Host 产物为 ESM，内联非 `@deepseek-ai/*` 依赖；有 `./client` 导出时同时产出浏览器产物。`build/plugins.ts` 提供标准装饰器降级（DSH 的 `@Remote`）和 CSS Modules，构建与 Vitest 共用。
- **检查**：`pnpm run check` = typecheck → oxlint（type-aware）→ build → vitest → verify:package。`verify-packages` 用 pnpm 打包每个可发布包，检查：清单里没有残留 `workspace:` / `catalog:`；所有包的 `engines.dsh` 相同，`@deepseek-ai/dsh-*` peer 与之一致；插件的 Host 产物只导入 Node 内置和 `@deepseek-ai/*`；profile 依赖的版本等于本次发布的插件版本；导出目标、图标、`locale/{en,zh}.json` 的 `meta` 都在包里；最后跑 publint。
- **单元与组合测试**：在接缝处测试行为——在真实 `WebRuntime` 里注册插件，断言 `web` 行选中后调用落到插件；profile 的 patch 用真实的 include 补丁算法叠加到 base 的 web 行上，断言 `web` 行、停用行、插入行和最终路由。选择范式落地后，会话行为在真实的 Web preset Agent 上测试，而不只是 `ctx.web`。
- **端到端**：`pnpm run test:e2e` 在 `.e2e/` 里建立隔离的 DSH 世界（HOME、DSH_HOME、XDG、缓存、pnpm store 全部重定向，清除 `DSH_*`、`DEEPSEEK_*`），按 `pnpm-workspace.yaml` catalog 中的版本安装 DSH（按版本缓存，暂存目录原子改名），用 pnpm 打包全部可发布包，再用真实插件管理器把 profile 装进 `web` profile（插件依赖经 profile 的 pnpm `overrides` 指向本次的 tarball）。之后读 `--dump-config` 验证组合；按 CLI 的步骤在进程内启动 Host，验证 web_search / web_fetch 路由到本插件；启动 `dsh web`，用 Playwright 验证插件页显示 bundle 与两个组件。共享 harness 在 `e2e/harness/`，规格文件按场景分开。
- **发布**：三个包同一节奏发布（release train），profile 精确依赖同一次发布的插件版本。CI 在 `v<profile 版本>` 标签上用 npm trusted publishing（OIDC + provenance）执行 `pnpm -r publish`，已发布的版本会被跳过。

## 13. 路线图与扩展点

按纵向切片推进，每个里程碑都端到端可用；共享抽象在第二个使用者出现时才进入 core。

| 里程碑 | 内容 |
| --- | --- |
| **M0 [已完成]** | monorepo、构建与检查工具链、profile 组合（含 ui 行）、两个插件各一个原生等价后端、空的 ui 包、单元/组合/e2e 测试（含插件行停用的组合） |
| M1 search 切片 | 在 search 包内移植前身的会话选择、模型记忆（含可见的来源与清除）、每步计划、关闭与隐藏、Remote、`/setup-search`、行设置页；ui 包的浏览器面（`webConnections`、共用菜单、首次启用提示、插件行停用时的说明），search 注册第一个分区；设置 v2（以前身真实文档为迁移样例）；`native` 连接 `deepseek-messages`、`deepseek-search-api` 与少量 `adapter`；第 11 节的路由预检；在真实 Web preset Agent 上的 e2e |
| M2 fetch 对齐 | 把 search 的选择范式抽进 core（第二个使用者）；fetch 设置 v2 与前身迁移；`local` 白名单与提示；`native` 连接 `deepseek-fetch-api`；`/setup-fetch`、行设置页，并向 ui 包注册 fetch 分区 |
| M3 更多后端 | 两侧的远程 `adapter`（Jina Reader、Firecrawl…）；第二个 MCP 后端出现时把 MCP 客户端移入 core；bundle 级路由概览 |
| M4（可选） | 自有增强工具（如批量抓取、带选项的搜索），以 preset 行的形式提供；显式配置的 fallback 列表（只对可重试的传输错误） |

扩展原则：新能力优先落在 Planner（选什么）或 Backend（怎么取），不改 Seat 与 `web` 行。增加模型工具时遵循 DSH 的做法——由 bundle 在 agent preset 中组合工具行，而不是全局注册同名工具：全局同名注册在 base profile 会直接失败，在 Web profile 会被 preset 内的原生工具遮蔽。

## 14. 风险与待定

- **`web` 行被更晚的层覆盖**：其他 bundle 或用户层改写 `web` 行会覆盖我们的选择（只写一个字段时还会丢掉另一个）。对策：路由提示、第 11 节的预检和 e2e 断言组合；不做运行时自我修复。
- **原生 `web-search-deepseek` 行的用户配置不被继承**：停用后其 `baseURL`、`model`、`apiKeyEnv` 等覆盖不再生效，M0 的 `deepseek-messages` 只用默认值。M1 让该连接提供同等参数，预检提示用户迁移这些覆盖。
- **`native` 后端随 DSH 版本变化**：它们直接使用上游类和原生行的解析逻辑，升级 DSH 基线时要逐一对照（见 development.md）。
- **ui 包是可选的**：插件对 `webConnections` 只做可选注入，ui 包停用或加载失败时，连接仍可通过 `/setup-*` 命令和行设置页管理；e2e 需要覆盖"ui 行停用"的组合。
- **构建期装饰器降级**：`standardDecorators()` 已接入 tsdown 与 Vitest，但 M0 没有装饰器代码；首个 `@Remote` 服务落地时需要验证它在 Rolldown 中的执行顺序，不行则回到前身的 tsc 预编译。
- **Host 侧路由判断**：白名单提示和路由提示需要知道 `web` 行是否选中本插件。前身通过嗅探 Loader 树实现，违反"不读私有内部"的约定；改用公开的 Settings 数据，按与 `WebRuntime` 相同的"配置优先于环境变量"规则判断，无法判断时按"未路由"处理。

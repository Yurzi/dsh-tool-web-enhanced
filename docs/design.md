# 功能设计

本文说明连接选择、配置文法、后端行为、错误与升级规则。组件怎么连起来见[架构](architecture.md)；代码在哪里见[代码结构](code-structure.md)；怎么改见[开发流程](development.md)。

一句话：模型照常使用 DSH 原生的 `web_search` / `web_fetch`；profile 把 `web` 行的两个字段指向本项目的两个插件，每个会话再在运维启用的**连接**里选一个后端，或者关闭。

~~~mermaid
flowchart LR
  OP["运维<br/>行设置：启用哪些连接、默认值、凭据名称"] --> CONN["可选的连接"]
  USER["用户<br/>输入框菜单 · /setup-* "] --> SEL["会话选择<br/>连接或关闭"]
  CONN --> SEL
  SEL --> CALL["web_search / web_fetch 调用<br/>按本步冻结的连接执行"]
~~~

## 连接与目录

连接是“到某个后端的一份配置”。每个插件有一份内置目录，运维还可以新建自定义连接；会话只能在未停用的连接之间选择。

- `builtin:<键>`：目录项，运维可做稀疏覆盖（改名、停用、访问方式、凭据名称、参数）。
- `custom:<名字>`：运维新建，名字为字母或数字开头、至多 100 个字符的 `[A-Za-z0-9._-]`。
- 目录顺序即菜单与设置页的显示顺序。远程连接（查询或 URL 会离开本机）缺省都是启用的；会话选了它，内容才会发出去，菜单与设置页都写明接收方。

后端有四种：`native`（直接使用 DSH 导出的 provider）、`adapter`（本项目实现的远程服务协议）、`model`（让带服务端搜索的模型搜一次，仅 search）、`local`（本机抓取，仅 fetch）。它们在系统里的位置见[架构](architecture.md)。

### search 目录（9 项）

| 连接 | 种类 | 访问方式 | 说明 |
| --- | --- | --- | --- |
| `builtin:deepseek-messages` | native | API key（`DEEPSEEK_API_KEY`）或 DeepSeek 账号 | **缺省连接**，等同 DSH 原生 DeepSeek 搜索 |
| `builtin:deepseek-search-api` | native | 同上 | DSH 原生 DeepSeek Search API |
| `builtin:session-model` | model | 跟随会话路由 | 用会话当前的模型搜索 |
| `builtin:exa` | adapter | keyless（缺省）/ API key `EXA_API_KEY` | 通用网页搜索 |
| `builtin:firecrawl` | adapter | keyless（缺省）/ `FIRECRAWL_API_KEY` | 网页搜索，可附抓取的正文 |
| `builtin:tavily` | adapter | keyless（缺省）/ `TAVILY_API_KEY` | 网页搜索 |
| `builtin:tinyfish` | adapter | keyless（缺省）/ `TINYFISH_API_KEY` | 网页、新闻、论文搜索 |
| `builtin:openalex` | adapter | keyless（缺省）/ `OPENALEX_API_KEY` | 学术文献（OpenAlex works） |
| `builtin:semanticscholar` | adapter | 仅 API key `SEMANTIC_SCHOLAR_API_KEY` | 学术文献（Semantic Scholar） |

### fetch 目录（6 项）

| 连接 | 种类 | 访问方式 | 说明 |
| --- | --- | --- | --- |
| `builtin:local` | local | 本机直连，无密钥 | **缺省连接**，等同 DSH 原生 `http` 抓取，另可放行运维指定的非公网地址 |
| `builtin:deepseek-fetch-api` | native | API key（`DEEPSEEK_API_KEY`）或 DeepSeek 账号 | DSH 原生 DeepSeek Fetch API |
| `builtin:exa` | adapter | keyless（缺省）/ `EXA_API_KEY` | Exa contents |
| `builtin:firecrawl` | adapter | keyless（缺省）/ `FIRECRAWL_API_KEY` | Firecrawl scrape |
| `builtin:tavily` | adapter | keyless（缺省）/ `TAVILY_API_KEY` | Tavily extract |
| `builtin:tinyfish` | adapter | 仅 API key `TINYFISH_API_KEY` | Tinyfish fetch（没有有据可查的匿名路由） |

### 访问方式与就绪状态

- **keyless**：不读取、不发送任何密钥，永远发往目录端点。有匿名路由的目录项缺省用它。
- **API key**：设置里只存 DSH Credentials 的**凭据名称**（`credentialRef`），密钥在每次调用时解析，不缓存。
- **DeepSeek 账号**：只用于 `native` 连接，以及跟随 `deepseek-account` 路由的会话模型连接；只在本次请求的模型路由为 `deepseek-account` 时尝试取得令牌。`native` 沿用 DSH provider 的规则：取得令牌时用令牌，否则用 API key（见 [native](#native)）；跟随该路由的会话模型连接只用账号令牌，缺失或畸形即失败，不回退 API key。

连接视图给出四种状态，菜单与 `/setup-*` 据此显示：`ready`（可选；只说明本地条件齐备，不证明上游可用）、`disabled`、`needs-credential`（缺密钥，或账号令牌拿不到）、`unsupported`（会话模型无法推导，附原因，见[跟随会话模型](#跟随会话模型)）。

### 自定义连接

两侧都可以新建 `kind: adapter` 的自定义连接：选目录里的一个 adapter（search 六项、fetch 四项），配自己的标签、凭据名称、可选的自建端点和参数，总是用 API key。search 另可新建 `kind: model` 的固定模型连接：选三种协议之一，写模型 id、端点与凭据名称（见 [model 后端](#model-后端)）。

自建端点、以及固定模型连接，都必须写 `trustedEndpoint: true`：查询与密钥会发往运维给的地址，所以要显式确认。规则见[配置文档](#配置文档)。

## 会话选择

每个会话在两个能力上各有一份选择：一个连接，或“关闭”。用户在输入框菜单或 `/setup-*` 里改，运维在设置页决定能选什么。

### 选择从哪里来

会话还没选过时，按顺序得出当前连接，界面显示来源：

| 来源 | 何时 |
| --- | --- |
| 本会话（This conversation） | 用户在这个会话里选过 |
| 来自父会话 | fork 出的会话，复制父会话的选择 |
| 该模型上次的选择 | 用户上次在同一模型的会话里选的连接（含“关闭”），且该连接仍存在、未停用 |
| 默认连接 | 行设置的 `defaultConnection` |

- **模型记忆**：用户在会话里选连接（含关闭）时，记下“该会话下一次请求将使用的模型 → 所选连接”，键为 (provider, model)。它让换到某个模型的新会话沿用上次的选择，例如自带搜索的模型配它自己的搜索连接。设置页列出全部记忆，可逐条清除；记忆写入失败不影响这次选择。
- 只改会话参数（search 的实时性）也算一次选择：会话随之固定在当前连接，来源变为“本会话”，但不写模型记忆。
- `defaultConnection` 不检查是否停用：指向已停用的连接时，未选择的会话照样得到它，调用时报错。

### 生效时机

- 选择按模型请求的每一步冻结：一步之内的工具调用都用这一步开始时的连接与会话参数。
- 冻结的只是“用哪个连接”。连接是否仍可选（存在且未停用）、它的端点、访问方式、凭据名称、参数、fetch 的白名单与上限，都在**每次调用时**读当前设置，所以停用与重新启用从下一次调用生效。
- 不在会话里的调用（其他宿主功能直接调用 `ctx.web`）用当时的 `defaultConnection`。

### 关闭

选择“关闭”后：

- 从下一个模型请求步起，该会话的 Agent 看不到对应的工具（`web_search` 或 `web_fetch`）。当前步已按冻结计划执行的调用照常使用冻结的连接；仍落在冻结为“关闭”的步里的调用收到 `WEB_PROVIDER_UNAVAILABLE`，提示用户在输入框或 `/setup-*` 里选连接。
- 隐藏只在 `web` 行确认把该能力路由到本插件时发生；没路由或判断不了时不隐藏，以免藏掉别的 provider 提供的同名工具。`web` 行改动时，已知会话立即按新路由重算。

### 输入框菜单

输入框右侧有一个地球按钮，两个能力共用：

- 按钮文字是各侧的当前状态，以“·”分隔（如“Exa · 本机 HTTP”），或“已关闭”“读取失败”“设置无效”“连接已移除”；需要处理的一侧（读取失败、设置无效、所选连接被移除或未就绪、路由给了别的 provider）带警示点，可访问名称写明“（需要处理）”。输入栏变窄时先隐藏文字（警示点移到图标上），再只剩图标。
- 菜单每个能力一个分区（search 在前），手风琴式：至多展开一个，打开时展开第一个；→ 展开、← 收起，选中行自动滚动到可见处。分区标题总是显示“标题 · 当前连接 · 来源”。
- 分区列出未停用的连接：就绪的可选，说明行是访问方式与接收方（如“无需密钥 · 查询会发送给 Exa”“API Key · URL 会发送给 Firecrawl”，会话模型写“发送给会话模型的服务商”）；未就绪的显示原因（缺密钥、需要重新登录 DeepSeek 账号、会话模型不可用的具体原因）。另有“关闭”行、来源说明、能力自己的选项（search 的实时性）和“设置”入口。
- `web` 行把该能力路由给别的 provider 时，分区顶部说明“这里的选择不会生效”；行设置无效时说明并给出设置入口（不提供重试）；读取失败可重试；写入被拒（选择已在别处改变、连接不可用）用提示条说明。
- 插件行停用时它的分区消失，菜单底部说明该能力不可用并指向插件页；两个都停用时按钮消失。插件行设置 `showSelector: false` 时也不显示该分区，命令与设置页照常。会话模型切换时菜单按新模型重读状态。

### /setup-search 与 /setup-fetch

键盘入口，与菜单读写同一份选择，任一处修改另一处立即反映：

- `/setup-search`：列出“关闭”、所有就绪的连接，以及（所选连接支持时）三档实时性。
- `/setup-fetch`：列出“关闭”与所有就绪的连接。
- ui 行停用时两个命令照常可用。

### 设置页

每个插件行在 Plugins 页 profile 下有一个设置页（菜单与概览的“设置”都打开这里），由目录驱动，依次是：

1. **路由提示**：`web` 行没有选中本插件时说明原因与恢复方法。
2. **默认值**：`defaultConnection`（指向不存在的连接时提示）；search 还有新会话的缺省实时性。
3. **服务列表**：每个目录项一行，启用开关；目录同时有 keyless 与 API key 时可切换访问方式；凭据名称与只写的密钥输入；`url` 参数与“信任此地址”开关；其余参数的自动保存表单（boolean 为“默认 / 开 / 关”三态，“默认”即不写）。展开面板写明查询或 URL 会发送给谁；fetch 的四个远程服务另有缓存与数据保留说明。
4. **自定义连接**：增删改；每行写明接收方（服务名，自建端点附主机名）。
5. **模型记忆**：列出并可逐条清除。
6. **Reset**：确认后清除本行用户层的全部字段；DSH Credentials 里的密钥与会话选择不受影响。

写入规则：

- 写入是稀疏的，只记录与下层或目录不同的部分；每次写入前用与 Host 相同的解析函数校验写入后的完整文档，不合法就不写。
- **信任绑定到确认过的地址**：非官方地址要打开“信任此地址”才写入，地址与 `trustedEndpoint: true` 一次写入；地址变了要重新确认；关闭信任即清除非官方地址、回到官方端点。自定义连接编辑器同理，确认绑定到格式、端点与 `url` 参数。
- 切回 keyless 时，同一次写入清掉 keyless 不接受的参数；删除正是默认连接的自定义连接时，默认复原为目录缺省。
- 文档无效（例如 0.1.x 的旧配置）时，页面只显示一条提示（诊断在 title 里）与 Reset。

fetch 的 `local` 有专门的编辑器，见 [fetch local](#fetch-local白名单与提示)；search 的会话模型行与固定模型表单见 [model 后端](#model-后端)。

### 首次启用提示与组合包概览

- 启用 profile 时弹出一次提示：说明用菜单为会话选连接、在插件设置里配置连接与密钥；如果[升级预检](#从-01x-升级)发现问题，改为提示“之前的设置可能让本组合包无法接管网页工具”，引导到详情页。它自己不写任何东西。
- profile 详情页的概览：两个能力当前由谁提供（生效值、组合包默认、你的设置）、插件行是否停用、升级预检结果。

## 配置文档

两个插件行用同一份配置文法，Host 与浏览器用同一个纯函数解析（core `shared/settings.ts` 的 `resolveDocument`，两侧各自的 `resolveSettings` 在其上派生）。全部字段可选，缺省由目录给出。

### 顶层字段

| 字段 | 类型与限制 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `version` | 只接受 `2` | 省略按 2 读取 | 见[版本](#版本与迁移) |
| `defaultConnection` | 存在的连接 id，≤ 200 字符 | search `builtin:deepseek-messages`，fetch `builtin:local` | 可以是 `custom:*` |
| `showSelector` | boolean | `true` | `false` 时不在输入框菜单显示本能力 |
| `defaults` | 严格对象 | search `{ freshness: auto }`，fetch `{}` | 新会话的会话参数 |
| `connections` | 至多 200 个键，键 ≤ 200 字符 | `{}` | `builtin:<键>` 为覆盖，`custom:<名字>` 为自定义 |

### 连接字段

| 字段 | 内置覆盖 `builtin:*` | 自定义 `custom:*` |
| --- | --- | --- |
| `kind` | 不接受 | 必填：`adapter`；search 另有 `model` |
| `adapter` | 不接受 | `kind: adapter` 必填，本插件目录里的 adapter 键 |
| `protocol` / `model` | 不接受 | `kind: model` 必填：`anthropic-messages` / `openai-responses` / `openai-chat-completions`；模型 id 1–200 字符、无控制字符 |
| `label` | 可选，1–200 字符 | 必填 |
| `disabled` | 可选，缺省 `false` | 同左 |
| `access` | `keyless` / `api-key`，只能是目录允许的；缺省有匿名路由时为 `keyless` | 不接受，总是 API key |
| `credentialRef` | 可选，形如 `EXA_API_KEY`；目录没有 API key 方式时拒绝 | 必填 |
| `endpoint` | 不接受（内置端点不可改） | 绝对 http(s) URL，不带凭据、查询与片段；`adapter` 可选（缺省目录端点），`model` 必填 |
| `trustedEndpoint` | `url` 参数（如 native 的 `baseURL`）不同于目录端点时必须为 `true` | `adapter` 的端点不同于目录端点时必须为 `true`；`model` 总是 `true` |
| `options` | 按目录参数规则校验，未知参数拒绝；keyless 下可能拒绝或收窄某些参数 | `adapter` 按 API key 规则；`model` 按所选协议的规则 |

`builtin:session-model` 只接受 `label`、`disabled`、`options`：它的端点与凭据来自会话，写 `access`、`credentialRef` 或 `trustedEndpoint` 会被拒绝（“this connection takes its route from the Session model”）。

### 例子

~~~yaml
# web-search-enhanced 行
defaultConnection: custom:team-tavily
defaults: { freshness: auto }           # auto | fresh | realtime
connections:
  builtin:exa:
    access: api-key                     # 改用个人密钥
    options: { type: fast }
  builtin:deepseek-messages:
    trustedEndpoint: true               # baseURL 不同于官方端点，必须确认
    options: { baseURL: https://deepseek-proxy.example.internal/anthropic/v1, maxUses: 3 }
  builtin:session-model:
    options: { maxUses: 3, searchContextSize: low }   # 按跟随路由的协议取用，其余忽略
  custom:claude-search:
    kind: model
    protocol: anthropic-messages
    model: claude-sonnet-4-5
    label: Claude search
    endpoint: https://api.anthropic.com # Messages 会补 /v1
    trustedEndpoint: true
    credentialRef: ANTHROPIC_API_KEY
    options: { allowedCallers: direct, blockedDomains: [example.com] }
  custom:team-tavily:
    kind: adapter
    adapter: tavily
    label: Team Tavily
    credentialRef: TEAM_TAVILY_KEY
    endpoint: https://tavily.example.internal/search
    trustedEndpoint: true
~~~

~~~yaml
# web-fetch-enhanced 行
connections:
  builtin:local:
    options:
      allowCidrs: [10.0.0.0/8]
      allowHostnames: ['*.corp.example']
      timeoutMs: 15000
  builtin:firecrawl:
    access: api-key
    options: { storeInCache: false, maxAge: 0 }
~~~

### 校验

- **先查预算**：解析之前遍历一次，任何容器至多 200 项、文本与键至多 2000 字符、嵌套至多 20 层、总节点至多 100 000；任意层级出现 `__proto__` / `constructor` / `prototype` 键即拒绝。
- 文档与连接都是严格对象：未知字段、未知连接 id 拒绝；文本参数至多 2000 字符（或规则自己更小的上限）。
- 参数按目录的规则校验（枚举、文本模式、整数范围、URL、列表）；fetch 再逐条检查白名单的 CIDR 与主机名规则，错误点名第几条。
- **互斥参数**：Anthropic 只接受一个域名列表，所以自定义 Anthropic 连接与 `builtin:session-model` 不能同时设 `allowedDomains` 与 `blockedDomains`；设置页在两个字段上就地报错、都不写入。清空其中一项解除冲突时，清空操作与另一项暂存的有效草稿在同一次候选校验、同一个 revision 下原子保存，避免连续写入使用旧快照。
- 错误消息点名字段路径；未知字段、未知 id 与参数错误附带 Reset 提示（“this release does not read 0.1.x settings; remove the field or use Reset on the settings page”）。

校验在哪里发生：插件启动时校验一次（无效只记 Host 日志，插件照常激活以便修复）；写入前再校验，非法候选不落盘；每次调用读取当前文档，无效时调用报 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`（“settings are invalid; ask the user to fix them on the settings page”），诊断不给模型。

### 版本与迁移

- 省略 `version` 的文档按 2 读取；大于当前版本的拒绝并提示升级插件；不是正整数的拒绝。
- 将来不兼容的变化通过 N→N+1 的纯函数迁移表（`migrateDocument`，目前为空）在校验前于内存中执行；设置页先显示迁移后的视图，再按 revision 写回一次。Host 从不静默改写文档。
- 设置页的写入只要含 `set` 就写上 `version: 2`；新增可选字段不提升版本。
- **0.1.x 的配置不读也不迁移**，见[从 0.1.x 升级](#从-01x-升级)。

## 各后端的行为

### native

直接实例化 DSH 导出的 provider 类（`DeepSeekSearchProvider`、`DeepSeekSearchApiProvider`、`DeepSeekFetchApiProvider`），行为、上限与原生行一致，只有给模型的错误消息改写（见[错误与上游说明](#错误与上游说明)）。

| 连接 | 可设参数 | 与原生行一致的缺省 |
| --- | --- | --- |
| `deepseek-messages` | `baseURL`、`model`、`apiVersion`、`maxTokens`、`maxUses` | 未设 `baseURL` 时用启动环境的 `DEEPSEEK_SEARCH_BASE_URL`，再用 DSH 缺省；请求照常记入会话 |
| `deepseek-search-api` | `baseURL`、`count`（1–50）、`sendOriginalQuestion` | 缺省附带会话最近一条用户问题；`sendOriginalQuestion: false` 不附带 |
| `deepseek-fetch-api` | `baseURL` | 端点 `https://api.deepseek.com/v1/tools` |

- 凭据沿用 DSH provider 的行为：本次请求路由为 `deepseek-account` 且取得令牌时用账号令牌，否则用 API key；API key 按 `credentialRef`（缺省 `DEEPSEEK_API_KEY`）经 DSH Credentials 解析，Credentials 服务缺席时才读启动环境。没有本插件对 API key 的可见 ASCII 预校验。
- `baseURL` 与目录端点不同时，必须同时写 `trustedEndpoint: true`。
- 原生 provider 读 API 响应不设字节上限，模型可见的输出由 tool-web 的结果数与 `fetchMaxOutputChars` 兜底；search 结果与 adapter 一样经来源过滤。

### search 的六个远程服务

都是一次 API 请求（或一次托管 MCP `tools/call`），`redirect: 'error'`，响应至多 2 MiB，整体截止 90 s（含读凭据与 MCP 握手）。结果数取 tool-web 请求的数目，再受服务上限约束。

| 服务 | API key 路由 | keyless 路由 | 可设参数 | 要点 |
| --- | --- | --- | --- | --- |
| Exa | POST `api.exa.ai/search`，`x-api-key` | 托管 MCP `mcp.exa.ai` 的 `web_search_exa` | `type`（auto / fast / instant，仅 API key） | 每条结果请求至多 4000 字符正文作摘要；≤ 100 条 |
| Firecrawl | POST `api.firecrawl.dev/v2/search`，Bearer | 同端点，不带鉴权 | `country`、`location`、`safe` | ≤ 100 条；实时性非 auto 时附带抓取的 Markdown 作摘要 |
| Tavily | POST `api.tavily.com/search`，Bearer | 同端点加 `x-tavily-access-mode: keyless` | `search_depth`、`topic` | ≤ 20 条；不要服务生成的答案；`published_date` 是估计值，不报告 |
| Tinyfish | GET `api.search.tinyfish.ai`，`x-api-key` | 托管 MCP `agent.tinyfish.ai` 的 `search` | `location`、`language`、`purpose`、`domain_type`（research_paper 仅 API key） | 没有数目参数，由 tool-web 截取 |
| OpenAlex | GET `api.openalex.org/works`，key 作查询参数 | 同端点 | `sort`、`filter`、`is_oa`、`mailto` | ≤ 100 条；缺省带一个 polite pool 邮箱；摘要由引用数、作者、开放获取 PDF 与重建的摘要组成 |
| Semantic Scholar | GET `…/graph/v1/paper/search`，`x-api-key` | 无 | `year`、`fieldsOfStudy`、`publicationTypes` | ≤ 100 条；摘要由 TL;DR、引用数、作者、PDF 与摘要组成 |

来源过滤（native、adapter、model 三种后端相同）：只保留无用户信息的 http(s) URL（≤ 8192 字符），同一 URL 只保留一条、后来者只补缺字段；标题至多 1000 字符，摘要至多 4000 字符；日期只接受可解析的日历日期或时间戳，统一为 ISO 8601。

### 实时性

search 的会话参数 `freshness` 控制内容缓存的新旧，不是按发布日期筛选：

| 值 | 菜单文字 | Exa（仅 API key） | Firecrawl（两种访问方式） |
| --- | --- | --- | --- |
| `auto` | 自动 | 服务缺省 | 服务缺省，摘要为 SERP 描述 |
| `fresh` | 24 小时内 | contents `maxAgeHours: 24` | 抓取 Markdown，`maxAge` 1 天 |
| `realtime` | 实时 | `maxAgeHours: 0` | 抓取 Markdown，`maxAge: 0` |

其他连接不支持，按 `auto` 发送；菜单在这类连接上注明“不支持此偏好”，`/setup-search` 不列出实时性选项。Firecrawl 抓取缺失时摘要就缺失，不拿旧的 SERP 描述冒充新内容。

### fetch 的四个远程服务

URL 原样交给服务（不规范化、不解码），目标能否访问由服务决定，本项目不做地址检查。每个请求先展开参数、再写固定字段，参数改不了 URL 与格式。

| 服务 | API key 路由 | keyless 路由 | 可设参数 |
| --- | --- | --- | --- |
| Exa | POST `api.exa.ai/contents`，`x-api-key`，请求 100 000 字符 | 托管 MCP `web_fetch_exa` | `maxAgeHours`（−1–720）、`livecrawlTimeout`（1–90 000 ms），都仅 API key |
| Firecrawl | POST `api.firecrawl.dev/v2/scrape`，Bearer，Markdown | 同端点，不带鉴权 | `onlyMainContent`、`maxAge`、`storeInCache`、`timeout`（1 000–110 000 ms）、`waitFor`、`proxy` |
| Tavily | POST `api.tavily.com/extract`，Bearer | 同端点加 keyless 头 | `extract_depth`、`format`、`timeout`（1–60 s） |
| Tinyfish | POST `api.fetch.tinyfish.ai`，`x-api-key`，Markdown | 无 | `ttl`（秒）、`per_url_timeout_ms`（1–110 000） |

设置页对每个服务说明缓存与数据去向：Exa 的匿名请求经其托管 MCP 并带本插件名称与版本，内容可能来自缓存；Firecrawl 缺省可能返回 2 天内的缓存并把结果存入其缓存与索引（关掉 `storeInCache` 可避免）；Tavily 声称零数据保留，但隐私政策写保留到提供服务所需的期限；Tinyfish 可能返回缓存，其服务条款允许用这些数据训练模型。

### 远程抓取的结果映射与上限

- 正文一律是文本（`body.kind: 'text'`，服务给的 Markdown 或纯文本），标题不拼进正文。
- **状态码**：服务没报告目标状态时，结果是请求的 URL 与 200——兼容映射，与 DSH 的 DeepSeek Fetch API 相同，200 表示“服务取到了页面”。只有服务明确给出的 100–599 整数状态码才成为结果的状态（Firecrawl 的 `metadata.statusCode`、Tinyfish 与 Exa REST 逐 URL 错误里的状态码）：服务说目标回了 404，结果就是 404 加空正文，与 DSH“非 2xx 是结果不是错误”一致；不从文字标签推断状态码。最终 URL 取服务报告的（Firecrawl、Tinyfish），不可用时用请求的 URL。
- **其余逐 URL 失败**按类别给出错误码，见[错误与上游说明](#错误与上游说明)。
- **上限**：响应至多 5 MB，整体截止 120 s（含凭据、握手与读正文），正文截到 100 000 字符（不切开代理对）并标记 `truncated`；Exa 返回的正文达到请求的字符预算时也视为可能被截断。服务端超时参数的上限都留在 120 s 之内；tool-web 缺省 30 s 的工具超时通常先到。

### fetch local：白名单与提示

`builtin:local` 是唯一检查目标地址的连接：传输是 DSH 官方的 `HttpFetchProvider`（URL 策略、同源重定向与逐跳复查、代理、各项上限都是它的），本插件只注入地址解析器。

| 参数 | 缺省（等于原生 `web-fetch-http` 行） |
| --- | --- |
| `allowCidrs` / `allowHostnames` | 空（各至多 200 条） |
| `userAgent` | DSH 的缺省 User-Agent；允许空串（发送空请求头） |
| `maxResponseBytes` / `maxBodyChars` | 5 000 000 字节 / 100 000 字符 |
| `timeoutMs` / `maxRedirects` | 30 000 ms / 5 跳 |

- **空白名单与原生 public-only 完全一致**。非空时：公网单播地址总是放行；非公网地址必须落在某条 CIDR 内，且有主机名规则时 URL 的主机名要匹配其中一条（`*.example.com` 只匹配子域）。主机名规则只收窄 CIDR 例外，不单独放行。
- 规则文法：CIDR 写网络地址（`10.1.2.3/8` 会提示改为 `10.0.0.0/8`），IPv4 只接受四段十进制，不接受 IPv6 zone，IPv4-mapped 的 IPv6 要写成 IPv4。
- 直连时一次解析、校验完整答案集（含 NAT64 转换后的 IPv4），任一地址不合规即拒绝，连接固定到已校验的地址；IP 字面量在交给传输前先检查。**走代理的域名由代理解析，白名单无法约束它们**，与上游行为一致，设置页写明了这一点。
- 白名单、User-Agent 与上限只有运维能改；会话只能选择用不用 `local`。
- 设置页的白名单编辑器有显式“保存”，逐行诊断：语法错误、可一键套用的修正、重复行，以及不阻止保存的提醒（覆盖云元数据地址、覆盖回环、过宽（IPv4 短于 /8、IPv6 短于 /16）、公网范围本就可达）；保存时两个列表一次写入。User-Agent 编辑器可一键恢复缺省。
- **给模型的提示**：本步用的是 `local`、`allowCidrs` 非空且确认 `web_fetch` 路由到本插件时，系统提示里加入一段运行时上下文，例如：

  > The operator has authorized web_fetch to reach non-public addresses within [10.0.0.0/8]. Only URLs whose hostname matches [*.corp.example] may use these exceptions. All other URL, DNS, redirect, and transport safety checks still apply.

  规则先规范化、去重；超过 2000 字符时改为计数摘要加部分示例。路由判断不了时不加。

### model 后端

让带服务端搜索工具的模型执行一次搜索：一次非流式请求，走 search 的有界传输（2 MiB、90 s，不重试）。两种连接：

| 连接 | 路由 | 凭据 | 端点信任 |
| --- | --- | --- | --- |
| `builtin:session-model`（会话模型） | 每次调用按本次请求的模型路由推导 | 会话路由自己的凭据 | 不需要：会话本身已把内容发往这个端点 |
| `custom:*`，`kind: model`（固定模型） | 设置里的协议、模型、端点 | `credentialRef`，只经 DSH Credentials | 必须 `trustedEndpoint: true` |

查询以 `Perform a web search for the query: <query>` 发送，与 DSH 原生 DeepSeek 搜索相同。

#### 三种协议的缺省

缺省跟随各厂商当前的 API 标准；其他兼容服务的差异由运维用参数调整。

| 协议 | URL | 鉴权 | 不设参数时的请求 |
| --- | --- | --- | --- |
| `anthropic-messages` | 端点去尾斜杠，路径不以 `/v1` 结尾时补 `/v1`，再接 `/messages` | `x-api-key`（账号为 `x-dsh-auth-token`），`anthropic-version: 2023-06-01` | `max_tokens: 4096`，工具 `web_search_20260318`，`max_uses: 5` |
| `openai-responses` | `<端点>/responses`（端点要写到 `/v1`） | Bearer | 工具 `web_search`，`tool_choice: auto`，请求 `web_search_call.action.sources`，`store: false`，不发 token 上限 |
| `openai-chat-completions` | `<端点>/chat/completions` | Bearer | `web_search_options: {}`，不发 token 上限 |

#### 按协议的参数

参数名跨协议唯一。固定模型连接只接受自己协议的那部分；会话模型连接接受全部，按本次推导出的协议取用、其余忽略。除上一节列出的显式缺省外，未设置的可选参数不发送。

| 参数 | 取值 | Messages | Responses | Chat |
| --- | --- | --- | --- | --- |
| `maxTokens` | 1–128 000 | ✓（缺省 4096） | ✓ | ✓ |
| `anthropicTool` | `web_search_20260318` / `_20260209` / `_20250305` | ✓ | | |
| `maxUses` | 1–50 | ✓（缺省 5） | | |
| `allowedCallers` | `direct` / `code_execution_20260120` | ✓ | | |
| `responseInclusion` | `full` / `excluded` | ✓（仅工具为 `20260318` 时发送） | | |
| `responsesTool` | `web_search` / `web_search_preview` | | ✓ | |
| `searchContextSize` | low / medium / high | | ✓ | ✓ |
| `externalWebAccess` | boolean | | ✓ | |
| `returnTokenBudget` | `default` / `unlimited` | | ✓ | |
| `allowedDomains` / `blockedDomains` | 不带 scheme 的域名加可选路径，各 ≤ 100 条 | ✓（二选一） | ✓（可同时） | |
| `userCity` / `userRegion` / `userCountry` / `userTimezone` | 近似位置；国家为两字母，发送前转大写 | ✓ | ✓ | ✓ |

设置页上，会话模型行没有访问方式与凭据控件，参数按适用的协议分组显示；固定模型表单在自定义连接区的格式列表里（“模型搜索 · <协议>”），多一个模型 id 字段，端点必填，并按协议说明端点写法与在 DeepSeek 上的可用性。

#### 跟随会话模型

每次调用重新推导，不缓存、不进冻结的计划；只读 DSH 的公开模型目录与 Settings，不读凭据、不联网：

1. 会话模型取发起本次调用的那次请求已解析的路由。菜单与 `/setup-search` 的状态则按会话下一次请求的模型判断。
2. **DeepSeek 官方两条路由**（`deepseek-official`、`deepseek-account`）统一处理：协议恒为 Messages，模型就是会话模型；端点与会话一致——配置的 `baseURL` → 启动环境的 `DEEPSEEK_BASE_URL` → `https://api.deepseek.com/anthropic`；`deepseek-official` 用配置的 `apiKeyEnv`（缺省 `DEEPSEEK_API_KEY`），`deepseek-account` 用账号令牌、不回退 API key。
3. **其他路由**（如 pi-ai）：协议取模型条目（`models[]` 或 `modelOverrides`）的 `api`，否则路由的 `api`，须为 `anthropic-messages`、`openai-responses` 或 `openai-completions`（即 Chat Completions）；端点取模型条目 → 路由 → 目录缺省的 `baseURL`，且不能由环境变量拼出；不能带自定义请求头；凭据为路由的 `apiKeyEnv`，或目录声明的唯一一个非 OAuth 环境变量名。
4. 读别的插件命名空间时先按预算限制（模型 id ≤ 200 字符、端点与凭据名 ≤ 2000 字符、列表 ≤ 200 项），超出按原因判为不支持，不回显原值。

推导不了时连接状态为 `unsupported`，调用报 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`（“the session model cannot run web search: <原因>; choose another search connection”），从不静默换连接：

| 原因 | 含义 | 菜单文字 |
| --- | --- | --- |
| `no-model` | 没有会话模型 | 本会话还没有选择模型 |
| `unknown-route` | 目录里没有该 provider，或读不出它的路由配置 | 读不到这个模型服务商的设置 |
| `protocol` | 没有声明三种协议之一 | 路由没有声明受支持的 api |
| `endpoint` | 没有合法的固定端点 | 路由没有固定端点 |
| `headers` | 带自定义请求头 | 不支持路由的自定义请求头 |
| `credential` | 没有唯一、合法的凭据名称 | 路由没有指定唯一的 API key |

凭据：会话路由的 API key 按 DSH 模型路由的规则读（Credentials 服务存在时只读它，否则读启动环境）；固定连接只读 Credentials；两者发送前都去首尾空白并校验只含可见 ASCII 与空格。跟随 `deepseek-account` 路由时只用账号令牌：只在本次请求路由为 `deepseek-account` 时向 DSH 账号服务取用，只发往会话的 Messages 端点，发送前校验只含可见 ASCII 与空格，不回退 API key。缺 key、key 畸形、令牌缺失或畸形都报 `WEB_PROVIDER_CREDENTIAL_MISSING`，不发请求。

#### DeepSeek 的处理

跟随 DeepSeek 路由时使用 DeepSeek 方言：Anthropic 工具缺省改为 `web_search_20250305`，并发送 `thinking: { type: 'disabled' }`，与 DSH 自带的 DeepSeek 搜索一致；运维显式设置的 `anthropicTool` 优先。为什么只走 Messages：DeepSeek 的 Messages 只接受 `web_search_20250305` 与 `web_search_20260209` 两个工具版本；它的 Responses 搜索只在 `deepseek-v4-pro` 上执行且不给来源，Chat Completions 没有服务端搜索。指向 DeepSeek 的固定连接按标准方言处理，运维要选 Messages 并把工具版本设为上述两者之一（表单说明写明）。

#### 回答透传

- 模型的回答原样作为 `content`：按出现顺序拼接文本块，相邻文本块直接相连（引用切开的句子拼回原样），中间隔着工具块时插入一个空行；不去空白、不截断（长度由 `maxTokens` 与 2 MiB 上限约束）。唯一的改动是把本次请求的凭据替换为 `[redacted]`。
- 不替 Agent 下结论：不判定“没有搜索”，工具报错块也不改写成错误，照样返回回答与已有来源。
- 来源只取协议的结构化字段：Messages 的 `web_search_result`（摘要取引用它的 `cited_text`）与 `web_search_result_location` 引用；Responses 的 `action.sources` 与 `url_citation` 注释；Chat 的 `url_citation` 注释与兼容网关的顶层 `citations`。之后同样经来源过滤。
- 回复不是该协议的形状时报 `WEB_PROVIDER_ERROR`（“<label> returned an incompatible model search response…”）。
- 费用与时延：服务端搜索按次计费，一次搜索还消耗数千输入 token；`maxUses` 缺省 5，可能超过 tool-web 缺省 30 s 的工具超时，需要时调小。

## 错误与上游说明

adapter、model 与 native 的错误以已有的 `WEB_*` 码和本插件的简短英文消息（指出下一步）呈现；`local` 保留 DSH 官方传输的 `WebError`。上游有自己的说明时按[上游说明](#上游说明)附在其后。没有自动重试或回退，换后端由 Agent 决定。这些规则在哪些边界落实见[架构 · 安全架构](architecture.md#安全架构)。

### 错误码

下表列共享选择层及自有 adapter / model 执行层的错误；native 与 local 的例外在表后说明。

| 情形 | 码 |
| --- | --- |
| 本会话已关闭该能力 | `WEB_PROVIDER_UNAVAILABLE` |
| 所选连接已停用或删除；行设置无效；会话模型推导不了 | `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` |
| 缺少 API key；adapter / model 的 API key 未通过可见 ASCII 校验；model 的账号令牌缺失或畸形（native 的凭据处理沿用 DSH，错误按下文 native 规则重述） | `WEB_PROVIDER_CREDENTIAL_MISSING`（只含凭据名称或提示重新登录） |
| 服务 HTTP 非 2xx：401/403 按访问方式提示（keyless 建议加个人密钥、账号提示重新登录、API key 提示检查密钥），402、429 与其他状态各有提示 | `WEB_PROVIDER_ERROR` |
| 本插件的截止时间到期（search 90 s、fetch 120 s）、响应超过字节上限、读取中断、网络失败或被拒的重定向、非 JSON、回复形状不对 | `WEB_PROVIDER_ERROR`（固定措辞） |
| search 回复里的 API 错误信封（非 null 的 `error` 或 `success: false`） | `WEB_PROVIDER_ERROR` |
| 托管 MCP 工具报错 / JSON-RPC 错误 | `WEB_PROVIDER_ERROR` |
| 选择无法读取、选择存储不可用 | `WEB_PROVIDER_ERROR`（可重试） |
| 取消 | `WEB_ABORTED` |
| 其他意外异常 | `WEB_PROVIDER_ERROR`（固定措辞） |

fetch 远程服务在 2xx 回复里报告的逐 URL 失败：

| 类别 | 来自 | 码 |
| --- | --- | --- |
| 超时 | Exa `CRAWL_TIMEOUT` / `CRAWL_LIVECRAWL_TIMEOUT`；Tinyfish `timeout` | `WEB_FETCH_TIMEOUT` |
| 过大 | Tinyfish `content_too_large` | `WEB_FETCH_TOO_LARGE` |
| URL 无效 | Tinyfish `invalid_url` / `invalid_redirect_url` | `WEB_INVALID_URL` |
| 无内容 | 无结果或正文为空；Exa 匿名的 “No content found…” | `WEB_PROVIDER_ERROR` |
| 匿名限流 | Exa 托管 MCP 的限流标记 | `WEB_PROVIDER_ERROR`，建议稍后重试或加个人密钥 |
| 失败 | Firecrawl `success: false`、Tavily `failed_results` 及其余错误标签 | `WEB_PROVIDER_ERROR` |
| 形状不对 | 不符合服务文档的回复 | `WEB_PROVIDER_ERROR` |

fetch `local`：DSH 官方传输抛出的 `WebError` 原样交给模型（它们本就是 DSH 给模型的消息）；本插件自行生成的错误统一带 `dsh-web-fetch-enhanced: ` 前缀，包括白名单拒绝、DNS 校验与解析失败、取消、兜底失败及规则校验。白名单之外的目标报 `WEB_BLOCKED_URL`（请运维检查白名单）；DNS 失败报 `WEB_PROVIDER_ERROR`。

native：按 DSH 的错误码给本插件的短消息，未知码一律 `WEB_PROVIDER_ERROR`，例如 “DeepSeek search failed. If every query fails, ask the user to check search connection settings, the API key or DeepSeek account sign-in. Do not retry in a loop.”（fetch 为 “DeepSeek fetch failed. If every URL fails, …”）——先报失败，不先怪 API key。

### 上游说明

格式为短消息之后的 `\n\n<label> responded (untrusted): <说明>`；`<label>` 是连接的标签，search 的 API 错误信封写作 “The search service responded (untrusted)”，native 写作 “DeepSeek responded (untrusted)”。上游没有说明时，消息与只有短消息时逐字相同。

| 入口 | 说明取自 |
| --- | --- |
| HTTP 非 2xx（adapter 与 model） | 错误体前 16 384 字节：JSON 依次取第一个非空字符串的 `error`、`error.message`、`message`、`detail`，否则用原文 |
| fetch 的逐 URL 失败 | Exa 的 `tag` 与 `message`、Firecrawl 的 `error`、Tavily `failed_results[0].error`、Tinyfish 的 `message` / `code` / `error`、Exa 限流结果的工具文本 |
| search 的 API 错误信封 | `error`、`error.message`、`message` |
| MCP 工具报错 / JSON-RPC 错误 | 工具的文本块 / `error.message` |
| native | DSH 消息的第一段（第一个空行之前，即上游的报告）；之后 DSH 为它自己内置行写的设置指引不带 |

不附带说明的情形：缺 key 或 key 畸形、取消、本插件的截止时间与字节上限、网络失败、回复形状不对、意外异常。说明至多 2000 字符（超出以 “…” 结尾，不切开代理对）。说明与抓到的正文一样是数据，本插件不按其中的端点或指示做任何事。

### 凭据隐去

本插件让本次请求交给上游的 API key 或账号令牌不进入给模型的内容（core `redaction.ts`）；检测的边界见[已知限制](#已知限制)：

- **错误文字**（HTTP 错误体、MCP 错误、native 的 DSH 原文）检出凭据——完整或任意 8 字符片段，含一层 JSON 转义后的形式——即整段不附带，换成 “<label>'s response was withheld because it contained this request's credential.”（native 为 “DeepSeek's response …”）。错误体在 16 KiB 处截断时，先去掉末尾的凭据前缀残片。
- **成功体**（含其中的逐 URL 失败说明与 search 信封、model 回答、抓到的页面、MCP 结果、native 结果）里的凭据替换为 `[redacted]`，其余原样。adapter 在服务解析后再次处理结果，覆盖从 JSON 键名还原出的文本（如 OpenAlex 倒排摘要）。
- **Host 日志**只收到诊断的去敏副本：不带原 cause 与 stack，检出凭据的消息被隐去；解析失败只记不引用正文的固定诊断。

### 浏览器看到的错误

菜单、命令与设置页经 `searchConnections` / `fetchConnections` 读写选择：行设置无效报 `<ns>/invalid-settings`，选择已在别处改变报 `<ns>/conflict`，连接缺失或停用报 `<ns>/unavailable`，请求不合契约报 `gateway/bad-request`；其余异常一律 `gateway/internal` 加固定消息，原始异常只进 Host 日志。

## 从 0.1.x 升级

0.2 起两个插件不再各自是 bundle，由 profile 组合；配置格式重新设计，**不读也不迁移** 0.1.x 的配置。升级后统一安装 profile，按本页[配置文档](#配置文档)重新录入连接配置（fetch 的白名单、User-Agent 与上限成为 `builtin:local` 的参数）。

**步骤**：移除 `dsh-web-search-enhanced`、`dsh-web-fetch-enhanced` 两个直接依赖，安装 profile。只把旧包升级到 0.2 而不装 profile，包会失去 bundle 声明，行随之消失。

**旧配置**：旧格式由退役字段诊断识别（字段清单在两侧的 `settings/retired.ts`：[search](../packages/search-enhanced/src/settings/retired.ts)、[fetch](../packages/fetch-enhanced/src/settings/retired.ts)）；`builtin:deepseek` 与 `kind: structured` 也不再接受（改用 `builtin:deepseek-search-api` 与 `kind: adapter`）。不读取、不迁移，使用 Reset 后按本页配置文法重新填写。

- Host 拒绝含这些字段的文档：插件照常激活，调用报 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`，Host 日志点名字段（“<字段> is a 0.1.x setting this release does not read; remove it or use Reset”）。
- 设置页显示无效提示并提供 Reset；旧配置在用户 Reset 或手工删除之前原样保留，从不被静默改写。search 的 `apiKey` 在设置视图里被遮蔽，页面只能点名并提示手工删除。
- 会话选择与模型记忆的存储格式没有变，照常可用（关闭搜索的旧会话仍是关闭）。

**升级预检**（profile 概览与首次启用提示共用）：用户层残留的设置会压过 profile 的选择，让本插件收不到流量。预检三项：

1. 用户层 `web` 行把某个字段改成了原生 provider（search `deepseek-official`、`deepseek-search-api`；fetch `http`、`deepseek-fetch-api`）；
2. 用户层字段是 0.1.x 共存模式留下的、已无人注册的 provider id；
3. 原生 `web-search-deepseek` 行被重新启用。

前两项旁有“移除遗留设置”：确认后对用户层 `web` 行执行 `unset`，只移除这些字段，取消则不写。第三项不归本包写，只说明并指向插件页。

**人工清单**：升级前记下旧设置里要保留的内容（白名单、自定义连接、原生 `web-search-deepseek` 行上的 `baseURL` / `model` 等覆盖），升级后在设置页重新录入（后者对应 `builtin:deepseek-messages` 的参数）；密钥留在 DSH Credentials，不受 Reset 影响。

## 已知限制

- **`web` 行可被更晚的层覆盖**：其他 bundle 或用户层改写 `web` 行会压过 profile（只写一个字段时另一个也丢失）。路由提示与升级预检会说明，不做运行时自我修复。
- **预检看不到停用的 `web-search-deepseek` 行上的覆盖**：浏览器只为运行中的行投影配置，所以无法提示把它的 `baseURL`、`model` 等迁到 `builtin:deepseek-messages`。
- **插件行未运行时浏览器无法得知 `DSH_WEB_*_PROVIDER`**：菜单的停用提示与概览只按 `web` 行的值判断路由。
- **菜单与本步可能不一致**：会话模型连接的状态按下一次请求的模型判断，执行按本次请求的路由；切换模型后的第一步里，菜单可能已显示新模型的状态。
- **跟随会话模型的范围**：能跟随哪些路由见[跟随会话模型](#跟随会话模型)，走 OAuth / 订阅的路由不支持；三种协议之外的厂商搜索（Gemini 原生、Kimi、智谱 / DashScope 的厂商字段、Perplexity）不支持；不能“跟随会话但换一个模型”，要用别的模型就建固定连接。
- **Anthropic 缺省工具版本**：`web_search_20260318` 缺省经代码执行调用搜索，不支持程序化工具调用的模型会被拒（HTTP 400）；把 `allowedCallers` 设为 `direct` 或选较旧的工具版本。
- **匿名路由的缺口**：部分服务没有匿名路由，或匿名时少几项参数与实时性，见[search 目录](#search-目录9-项)、[fetch 目录](#fetch-目录6-项)与[实时性](#实时性)。
- **远程服务的行为由服务决定**：请求形状与结果映射依据服务的公开文档；有些情形没有真实样本，例如 Firecrawl 可能对目标 404 / 503 统一返回 HTTP 500，这时报 provider 错误而不是 404 结果。服务改了字段或错误形状时报“形状不对”，不猜测。
- **native 随 DSH 变化**：它们直接使用上游类与原生行的解析规则，包括“不限 API 响应字节”的上限策略；给模型的说明只取 DSH 消息的第一段，依赖 DSH 的消息布局。
- **上游说明只就地标注不可信**：DSH 的“不可信数据”提示只加在成功结果上，错误里附带的说明靠 `(untrusted)` 标注，服务仍可能写指令式文字，由 Agent 判断。
- **凭据检测有边界**：只识别本次请求的凭据，完整或 ≥ 8 字符片段、至多一层 JSON 转义；多层编码或变形不识别。DSH 原生 provider 解析失败时，其错误第一段带 Node 的正文摘录，可能含短于 8 字符的凭据片段，检测不到，会随说明进入给模型的错误；彻底消除需要 DSH 提供不带正文摘录的结构化解析错误。
- **没有自动重试与回退**：失败后换后端目前要用户改选择；让 Agent 自己选择后端的工具见[开发计划 · M5](plan.md#m5-自有增强工具)。

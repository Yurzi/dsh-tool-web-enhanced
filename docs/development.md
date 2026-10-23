# 开发流程

本文讲怎么在这个仓库里干活：环境与命令、日常改动走哪些文件与测试、新增后端的步骤、测试与 e2e、DSH 基线升级、发布与文档维护。项目由什么组成见 [架构](architecture.md)，产品行为见 [功能设计](design.md)，文件级结构见 [代码结构](code-structure.md)。

## 环境

- Node `^22.19.0` 或 `>=24.0.0`：脚本用 Node 的类型剥离直接运行 `.ts`；CI 在 22.19.0 与 24 上各跑一遍 `check`。
- pnpm 12（根 `package.json` 的 `packageManager`：`pnpm@12.14.0`）。
- e2e 另需 Chromium 或 Chrome；第一次跑 e2e 需要网络（安装被测 DSH）。

在仓库根执行任何 pnpm / npm / vitest 命令前，先把它们的家目录指进仓库，免得读写你自己的 pnpm store、缓存与 XDG 状态：

~~~sh
export PNPM_HOME=$PWD/.pnpm-home \
  XDG_CACHE_HOME=$PWD/.xdg/cache \
  XDG_DATA_HOME=$PWD/.xdg/data \
  XDG_STATE_HOME=$PWD/.xdg/state \
  npm_config_cache=$PWD/.npm-cache \
  XDG_RUNTIME_DIR=$PWD/.xdg/runtime
~~~

`XDG_RUNTIME_DIR` 也要指进仓库：pnpm 12 在它下面放 store 的操作锁，系统的 `/run/user/<uid>` 不存在或只读时（容器、沙箱）命令会直接失败。这些目录都在 `.gitignore` 里。它们只管开发命令本身；e2e 另有一套更彻底的隔离（见[隔离与 harness](#隔离与-harness)）。

开发时不碰你自己的 DSH home（`~/.dsh`）和正在运行的 GUI：单元测试在内存里组装 DSH，e2e 在 `.e2e/run` 里建自己的世界，`dsh web` 只监听 127.0.0.1 上的随机端口。

## 命令

| 命令 | 作用 |
| --- | --- |
| `pnpm install` | 安装依赖（CI 用 `--frozen-lockfile`）。新增依赖要先征得同意 |
| `pnpm run check` | 依次执行下面五步，任一步失败即停；提交前必须通过 |
| `pnpm run typecheck` | `tsc -p tsconfig.json`：覆盖 `packages/*/src`、`packages/*/tests`、`build`、`scripts`、`e2e` 与各处 `*.config.ts` |
| `pnpm run lint` | `oxlint --type-aware`（`.oxlintrc.json`：correctness 类为错误；`no-floating-promises`、`import/no-cycle`、`rules-of-hooks` 为错误） |
| `pnpm run build` | 对有 `build` 脚本的包（search、fetch、ui）先清 `lib/` 再 `tsdown`；profile 与 core 不构建 |
| `pnpm run test` | `vitest run`：`packages/*/tests/**/*.spec.{ts,tsx}` 全部单元与组合测试 |
| `pnpm run verify:package` | 打包并检查每个可发布包（见[发布与 CI](#发布与-ci)） |
| `pnpm exec vitest run packages/<pkg>/tests/<file>.spec.ts -t '<用例名片段>'` | 单个测试文件或用例；去掉 `run` 进入监听模式 |
| `pnpm run test:coverage` | v8 覆盖率，范围 `packages/*/src/**` |
| `pnpm run test:e2e` | 先构建，再跑隔离的真实 DSH 端到端测试（不在 `check` 里） |
| `pnpm run build && pnpm exec vitest run --config vitest.e2e.config.ts e2e/<spec>.e2e.ts` | 单个 e2e 规格（全局准备照样安装 DSH、打包全部包、装好 profile） |

测试文件清单与当前数量见 [代码结构 · 测试清单](code-structure.md#测试清单)。

## 日常改动对照表

先判断改动属于哪一类，再动对应的文件、跑对应的测试；`<pkg>` 指 search-enhanced 或 fetch-enhanced，测试列写的是 `tests/` 下的文件名（省略 `.spec.ts(x)`）。改 core 时两侧插件的测试都必须保持通过。

| 要改什么 | 改哪里 | 跑哪些测试 |
| --- | --- | --- |
| 设置文档（字段、连接形状、预算、版本、标签单行化） | 文法：core `shared/settings.ts`；插件派生：`<pkg>/src/settings/resolve.ts`、`types.ts`、`retired.ts`；Host 行：core `host/settings-row.ts`；浏览器：core `client/settings/document.ts`、`sparse.ts` | core `settings-grammar`、`settings-migration`、`settings-labels`、`client-document`、`client-sparse`、`client-migration`；插件 `settings`、`client-settings` |
| 目录（连接项、参数规则、默认值、`optIn`、`use`） | `<pkg>/src/catalog.ts`；文案在 `<pkg>/src/client/locales.ts`；`optIn` 的解析在 core `shared/settings.ts`，开关的分层稀疏写入在 core `client/settings/`，菜单底部提示的事实在 core `client/remote-services.ts` | 插件 `catalog`、`settings`、`client-settings*`；core `settings-grammar`、`settings-optin`、`client-optin`、`client-sparse` |
| 某个远程服务的请求与解析 | core `host/providers/<服务>.ts`；绑定在 search `src/search/adapters/index.ts`、fetch `src/remote/adapters/index.ts` | search `adapters`、`mcp`、`adapter-result`；fetch `adapter-<键>`、`remote-page`；core `providers-search`、`providers-fetch`。一个模块同时有两侧 wire 时两侧都要绿 |
| adapter 骨架、MCP 客户端、有界传输、去敏 | core `host/adapter.ts`、`mcp.ts`、`transport.ts`、`redaction.ts`、`providers/search.ts`、`providers/fetch.ts`；各能力的上限与传输文案在 search `src/search/http.ts`、fetch `src/remote/http.ts` | core `adapter`、`mcp`、`transport`、`redaction`；search `transport`、`adapters`、`mcp`；fetch `remote-execute`、`composition` |
| native 后端 | `<pkg>/src/backends/*`；core `host/native.ts`（`restateNative`、`nativeBackend`）、`host/credentials.ts`（`nativeAuth`） | 两侧与 core 的 `native` |
| 凭据解析的异常边界 | adapter：core `host/adapter.ts`（`runAdapter` 读凭据处）；native：core `host/credentials.ts`（`nativeAuth`）；model：search `src/model/execute.ts`（API key 与账号令牌）。依赖抛出的异常一律换成固定文本，只按真实的取消信号报 `WEB_ABORTED` | core `adapter`；search `model-execute`、`enhanced-credentials`；fetch `remote-execute`、`enhanced-credentials` |
| search 的 model 后端 | search `src/model/*`；协议表 `MODEL_PROTOCOLS` 在 `src/catalog.ts`；会话模型的读取在 core `host/model.ts` | `model-protocols`、`model-route`、`model-execute`、`client-settings-model`，加 `host`、`agent`、`settings` |
| fetch 的 local（白名单、地址策略、解析器、提示） | fetch `src/local/*`、`src/prompt.ts`、`client/settings/AllowlistEditor.tsx`、`LocalExtras.tsx` | fetch `rules`、`resolver`、`proxy`、`local-provider`、`prompt`、`client-allowlist*` |
| 选择范式（会话、会话来源、计划、Remote） | core `host/*`（会话来源在 `host/session-origin.ts`）；能力装配在 `<pkg>/src/host/runtime.ts` | core `sessions`、`session-origin`、`plans`、`snapshots`、`storage`、`remote`、`nested-remote`、`restriction`、`selectable`；两侧 `agent`、`host`（search 另有 `selections`、`cold-host`）；改子 Agent 会话的读写时跑 e2e `subagent-selection` |
| 可见性与对话列表 | 可见性控制器 core `host/restriction.ts`（`ToolRestriction`：原生组与增强组）；对话列表 `host/provider-lists.ts`（新建判断、建立、继承）与 `host/storage.ts`（表 `provider_lists`、每会话队列）；显式入口 `host/explicit.ts`（`run` / `list` / `ready`）；三者在 `host/runtime.ts` 的 `installCapability` 里装配；能力装配在 `<pkg>/src/host/runtime.ts` | core `restriction`（原生组）、`visibility`、`row-visibility`（真实 Settings 行与 `sessionController`）、`explicit`、`storage`；两侧 `agent`（真实 Agent 与 Web preset 上的工具表）、`host`。时序用 deferred promise，不用 sleep |
| 增强工具（定义、参数、输出、列出、错误措辞） | 定义、参数校验、输出与超时在 `<pkg>/src/tools/`（`index.ts` 的 `searchEnhanced` / `fetchEnhanced`、`definitions.ts`；search 另有复制的 `queries.ts`）；两侧共用的部件在 core `host/enhanced-parts/`（`calls.ts`：参数与一次显式执行；`wording.ts`：就绪子句、拒绝措辞、提示插入；`listing.ts`：规范值 schema、值与文本）；列出的能力事实在 `<pkg>/src/host/listing.ts`（fetch 的白名单说明经 `src/prompt.ts` 的 `allowlistNotice`）；契约类型在 core `host/enhanced.ts` | core `enhanced-parts`；两侧 `tools-search` / `tools-fetch`（定义、参数、与真实 tool-web 的逐字节与参数错误对照）、`enhanced-search` / `enhanced-fetch`（经真实 `WebRuntime` 与能力执行）、`enhanced-listing`、`enhanced-credentials`；改 `allowlistNotice` 时加 fetch `prompt`。定义定稿后不随手改：它进每个请求的 schema 与前缀缓存 |
| 设置页 | 骨架在 core `client/settings/*`（“增强工具”一节在 `EnhancedToolsSection.tsx`）；页面内写入队列在 `client/settings/document.ts`：开关与逐项保存写成 `SettingsChange`（在当下的快照上计算，含依赖当前值的派生），编辑器类写操作数组（按显示的 revision）；插件经 `src/client/index.tsx` 注入 `readSettings`，只给目录、文案、服务说明（fetch `SERVICE_NOTES`）与按目录键注册的附加编辑器（fetch `LocalExtras`） | core `client-settings`、`client-optin`、`client-catalog`、`client-fields`；两侧 `client-settings`；ui `client-settings-appearance`；e2e `enhanced-write-race`、`enhanced-settings` |
| 输入框菜单、首次启用提示、概览与预检 | ui `src/client/*`；分区契约在 core `client/section.ts`（`remoteServicesOff` 由 core `client/remote-services.ts` 算出） | ui `client-components`、`client-service`、`client-pure`；search `client-composition`；core `client-optin` |
| 界面文案 | 各包 `src/client/locales.ts`（zh 与 en 同键；键集的类型来源 search / fetch 取 `en`、ui 取 `zh`）；插件页标题与描述只在 `locale/{zh,en}.json` 的 `meta` | 各包 `client-locales`；`verify:package` 检查 `meta` |
| 给模型的消息 | Host 代码里的英文 `WebError` 文案：传输与 MCP 在各能力的 `http.ts`，search 的畸形响应在 `src/search/adapter-result.ts`，fetch 的逐页失败在 `src/remote/page.ts`；增强工具的拒绝与提示在 `<pkg>/src/tools/` 与 core 工具部件（执行层原句里的 “connection” 保留）；core 的服务模块不写措辞 | 断言该消息的测试；规则见 [功能设计 · 错误与上游说明](design.md#错误与上游说明) 与 [增强工具的错误](design.md#增强工具的错误) |
| 样式 | 各包的 `*.module.css`；两个插件的 `client/settings/Settings.module.css` 保持逐字一致；只用 DSH 的 `--dsw-*` 变量，窄屏用 container query；输入框按钮不设断点，跟随输入栏的 `--dsh-composer-model-*-display` 收起 | ui `client-settings-appearance`、`client-components`；改观感后看 e2e 截图 |
| 身份（包名、行 id、provider id、增强工具名） | 只在 core `shared/ids.ts`；profile 的 patch 同步 | profile `profile`；e2e |
| profile 组合 | `packages/profile/cordis.patch.yml`（`web` 行两个字段一起写） | profile `profile`；e2e |
| 构建与打包 | `build/*`、`scripts/*`、各包 `package.json` | `check`；改到产物形状时跑 e2e |

设置文档的版本规则：新增可选字段不提升版本；不兼容的变化提升 `CURRENT_SETTINGS_VERSION`，并在 `SETTINGS_MIGRATIONS` 加一个 N→N+1 的纯函数步骤和它的测试。不为 0.1.x 的格式写迁移（[功能设计 · 配置文档](design.md#配置文档)）。

触碰 profile 的 patch、provider 或增强工具的注册与可见性、插件页相关的 `package.json` 字段或 locale、浏览器面、DSH 基线时，必须跑 e2e。

## 新增后端

设置页、菜单、自定义连接的格式列表和列出工具都由目录驱动，新增后端不改页面代码，也不改 profile、`web` 行、Seat、Planner 或增强工具的定义；新行为只能进 Planner（选哪个后端）或某个后端（怎么取），不能注册第二个 provider。

### 远程服务（adapter）

服务的协议（请求、信封、字段与语义）只写在 core `host/providers/<服务>.ts`，每个能力一个命名导出的 `AdapterWire`（`<服务>Search`、`<服务>Fetch`）。另一侧已有该服务时在同一模块里加导出；两个 wire 各自是独立的对象字面量，不合成服务对象、不在模块顶层执行工厂——否则只用一侧的插件会把另一侧的解析打进产物。

1. **目录**：在插件 `src/catalog.ts` 加一条 Descriptor（`label`、`kind: 'adapter'`、`remote`、`optIn: true`（远程服务缺省停用）、`endpoint`、`homepage`、`access`、`options`，需要时加 `use`（见[在列出工具里出现](#在列出工具里出现)）；search 另有 `freshness`），位置即显示顺序；把键加进 `ADAPTER_KEYS`。keyless 不接受的参数写 `keyless: false`，只接受部分枚举值写 `keyless: [...]`；只写核实过的访问方式。fetch 的服务端超时类参数上限留在 `TIMEOUT_MS` 之内。
2. **wire**：在 core 模块导出 `request` / `parse`（目录标为 keyless 时声明为 `KeylessWire<…>` 并提供 `keyless: 'rest'` 或一个 `McpRoute`），在 `host/index.ts` 加命名导出。请求用 `postJson` / `getJson` 与 `bearer` / `apiKeyHeader`，URL 原样发送。`parse` 不抛、不写措辞：
   - search 返回未规范化的 `SearchRow`（`providers/search.ts` 的 `envelope` / `rowsAt` / `mapRows`），畸形响应返回 `invalid` 与一个 `SearchInvalidReason`，新形状在这个闭合集合里加一项；
   - fetch 返回 `PageOutcome`：服务报告目标状态与最终 URL 时用 `reportedTarget`，对单个 URL 的失败给出目标 HTTP 状态时用 `statusPage`，服务的失败文字放进失败分支的 `detail`，形状不符一律 `invalid`；不从文字标签猜状态码。解析要有界：先限长，再逐行推进，不对整段正文跑多行正则。
3. **绑定**：search 在 `src/search/adapters/index.ts` 的 `ADAPTER_WIRES` 登记 `<键>: mapWire(<服务>Search, searchSources)`，新 reason 的文案写进 `src/search/adapter-result.ts` 的 `INVALID_DETAIL`；fetch 在 `src/remote/adapters/index.ts` 直接登记 `<键>: <服务>Fetch`。两处都用 `satisfies` 按目录事实检查，目录标为 keyless 而缺 keyless 路由即编译失败。
4. **文案**：`client/settings/model.ts` 的 `OPTION_COPY`（fetch 另有 `SERVICE_NOTES`：只写核实过的缓存与保留说明）与 `locales.ts` 的对应键；“查询 / URL 会发送给 <服务>”由 core 按 `remote: true` 自动显示。
5. **测试**：search 在 `adapters.spec.ts`（MCP 路由在 `mcp.spec.ts`）经 `ADAPTER_WIRES` 同时覆盖 wire 与 `searchSources`，新服务的畸形响应在 `adapter-result.spec.ts` 的表里加一行；fetch 在 `adapter-<键>.spec.ts` 直接导入 core 的 `<服务>Fetch`。都用本地 HTTP 服务充当远程 API，覆盖请求形状、响应映射、keyless 不发送密钥、错误改写（服务给了说明时断言“短消息 + `<label> responded (untrusted): …`”，没有说明时断言消息逐字不变）。传输边界（重定向拒绝、字节上限、截止时间、取消、凭据缺失与非法）只在 core 与执行层各测一次，不在 adapter 测试里复制。

### native 后端

| 插件 | 要碰的位置 |
| --- | --- |
| search | `src/backends/<键>.ts`（实例化 DSH 导出的 provider 类，凭据用 core `nativeAuth`，包装用 `nativeBackend`）；`NATIVE_KEYS`；`backends/native.ts` 的 `createNativeBackend`；`settings/resolve.ts` 的 native 分支 |
| fetch | `src/backends/<键>.ts`；`NATIVE_KEYS`；`backends/native.ts` 的 `createNativeFetchBackend`（目前只有一项，加第二项时改为按键选择） |

测试只测凭据与端点解析、错误改写（`native.spec.ts`：真实 provider 加本地 HTTP 服务，断言短消息 + `DeepSeek responded (untrusted): <第一段>`，含本次凭据的说明被扣下）。

### model 协议

给 search 的 `model` 后端加一种线上协议：

1. `src/catalog.ts` 的 `MODEL_PROTOCOLS` 加一项：键（自定义连接的 `protocol` 值）、`label`、`use`（该协议的固定模型连接在列出工具里的用途）、`options`，厂商规定至多设一个的参数对写进 `exclusive`。参数名跨协议唯一：同名参数必须是同一个规则对象，因为 `session-model` 接受并集 `MODEL_OPTIONS`（它的展开列表要加上新协议）。缺省值写进 `MODEL_DEFAULTS`，只按厂商当前标准写。
2. `src/model/types.ts` 的 `ModelOptions` 加上新参数（`model-protocols.spec.ts` 有它与 `MODEL_OPTIONS` 的类型级相等断言）。
3. `src/model/protocols.ts` 的 `modelUrl`、`modelRequest`（先写缺省，再按 `optionalFields` 只发设置了的参数）、`parseModelResponse`（回答原样拼接，来源只取协议的结构化字段，形状不对返回 `invalid`）各加一个分支；`switch` 穷尽，漏写即编译失败。
4. 要让跟随会话模型认它：`src/model/route.ts` 的 `protocolOf` 加上 DSH 路由配置里的 `api` 名；只对 DeepSeek 有意义的值写进 `src/model/deepseek.ts`，不在别处按 provider 分支。
5. 浏览器：`client/settings/CustomConnections.tsx` 的 `notes`（指向协议说明的 locale 键），`client/settings/model.ts` 的 `MODEL_COPY`、`PROTOCOL_HINTS`（`Record<ModelProtocol, …>`）与 `VALUE_LABELS`，以及 `locales.ts` 的对应键。设置文法、格式列表与按协议分组的参数（`protocolGroups`）由 `MODEL_PROTOCOLS` 驱动。
6. 测试：`model-protocols.spec.ts`（请求形状、缺省、解析与畸形响应）；`model-execute.spec.ts` 用本地 HTTP 服务假扮该 API（鉴权头、缺 key 不发请求、拒绝重定向、取消）；`settings.spec.ts`；跟随时加 `model-route.spec.ts`。夹具照官方文档构造，从不向真实服务发请求。

### 在列出工具里出现

新连接进入列出工具不需要另写代码：只要它在对话的 provider 列表里（运维启用之后新建的对话），条目的 id、名称与就绪状态就来自设置与 `describe`，能力事实来自能力的 `listing`：

- **用途**：取目录的 `use`；自定义连接取它所选 adapter 或 model 协议的 `use`。只在会改变 Agent 选择时写（专门的索引、回答型的后端），普通网页搜索不写；它是模型面的英文短语，至多 8 个词，只出现在列出结果里，不进工具定义。
- **接收方**：按后端种类得出：`local` 是本机，跟随会话模型是会话模型背后的服务，其余是目录里的服务名；运维端点不同于目录端点时取它的主机名。
- **实时性**（search）：按目录的 `freshness` 与连接的访问方式判断，与 Seat 路径同一规则。
- 新的后端种类要在 `listing` 里加一个分支，并在列出文本的测试里加一行。

### 新的鉴权方式

上游说明与诊断的去敏只认得交给它的凭据（core `host/redaction.ts`）。加新的请求头或令牌种类时，把这次请求实际发送的凭据放进 `Upstream.matcher`（`secretMatcher([凭据])`；adapter 在 `runAdapter`，model 后端在 `src/model/execute.ts`）；`native` 经调用级的 `nativeAuth(ctx, ref, secrets)` 记录交给 DSH 的凭据。漏交的凭据不会被去除。adapter 的服务解析结果也在 `runAdapter` 返回前去敏，不能只处理原始 JSON 的字符串值：OpenAlex 等协议会把属性名还原成正文。回归测试应经真实执行层覆盖这种形状。后端不自己拼上游文字，附带说明由 core 统一生成。

## 测试约定

- **在接缝处用真实组合**：插件注册在真实 `WebRuntime` 里；profile 的 patch 用真实的 include 补丁算法（`@deepseek-ai/cordis-plugin-include`）叠加到 base 的 web 行上；会话行为在 `dsh-agent-loop-testkit` 与 `dsh-session-projection` 组装的真实 Agent 上测，`agent.spec.ts` 用真实的 Web preset 检查工具隐藏；fetch 的 `local` 用本地 HTTP 服务、本地代理和可替换的 DNS 查询（`AddressLookup`）。组合测试可以导入另一个包的 `src` 来测真实接缝（如 ui × search）。
- **只 mock 网络与时钟**：远程 API 用本地 HTTP 服务代替，超时用假时钟；不 mock core、DSH 服务或我们自己的模块，不嗅探 DSH 的私有内部。
- **failing-first**：每个 bug 修复先写一个在修复前失败的测试。
- **注入要在嵌套 fiber 下验证**：服务挂在访问方的祖先作用域上（测试常把它们挂在根上）时，Cordis 不检查访问方是否声明了注入，从根发起的调用也绕过运行时作用域的访问检查；真实 DSH 里运行时服务、插件行与传输各在 loader 的非根 fiber 下，漏声明的注入会让每次调用失败。验证 Remote 这类服务访问时，把运行时服务、插件行与调用方（`typertGateway` 的传输）都放进嵌套插件，并断言 Host 日志里没有错误（core `nested-remote.spec.ts`）。
- **不在运行的会话**：挂真实的 `dsh-session-persistence-jsonl`，`flush` 会话后 dispose Agent，断言读写之后 `agents.get` 仍为空、没有新的 `agent/created`（core `remote.spec.ts`）；被叫起后的行为用 `agents.resume` 以同一 id 恢复，经 `agent/created` / `agent/request` 的捕获与实际请求的去向检查，不手工读选择（search `cold-host.spec.ts`）。
- **增强工具**：经真实 `WebRuntime` 与能力执行显式调用，上游用本地 HTTP 服务假扮；输出与真实 tool-web 同输入的文本与 meta 逐字节对照，参数错误与 tool-web 的原消息对照（升级 DSH 时据此发现漂移）；真实 Agent（`dsh-agent-loop-testkit` 加真实 Web preset 接缝，core 夹具 `shipped-preset.ts`）上检查 standard、minimal 与 PTC 的工具表；新建判断与空记录用真实的 Settings 行与 `sessionController`（core 夹具 `web-settings.ts`）；可见性的时序用 deferred promise 制造，不用 sleep。不打开开关的 core 测试用 `inertEnhanced`，一旦构建或列出工具就失败。
- **凭据边界**：凭据解析器抛出的异常（普通 Error 与伪装成合法码的 `WebError`，也包括没有真实取消却报 `WEB_ABORTED` 的）带着假密钥，断言它不出现在工具结果、结构化错误与日志里；真实取消仍为 `WEB_ABORTED`。新的凭据来源要在两侧 `enhanced-credentials` 加一例。
- **设置页的连续写入**：用 deferred promise 卡住前一次写入，断言之后的开关在前一次落定后的文档上计算并保存、页面没读到的外部修改仍被拒；依赖当前值的派生（如 keyless 保留的参数）在排队期间变化时取新值。
- **浏览器面**：测试文件第一行写 `// @vitest-environment jsdom`，渲染真实的 DSH 界面原语（`dsh-client-ui-primitives` 经 `server.deps.inline` 内联）。测试与构建共用 `build/plugins.ts` 的 `standardDecorators()`（降级 `@Remote`）与 `cssModules()`。

### 测试环境的两处补丁

- **`primitivesStub()`**（`build/plugins.ts`，只在 `vitest.config.ts` 里用）：发布的 `dsh-client-ui-primitives` 引用了它没有声明、本仓库也没装的实现库（shiki、katex、micromark、simple-icons、clsx…）。只有解析不到的库换成惰性存根，能解析的一律用真的；`clsx` 给一个真实的最小实现，保证 `className` 仍是字符串；顺带去掉指向不存在文件的 sourcemap 注释。
- **`zustand`、`immer` 是根 devDependencies**：发布的 `dsh-client-store` 在运行时导入它们却没有声明依赖。插件产物不受影响：`dsh-client-store` 是平台模块，浏览器里由 DSH 提供。

两处都不要在没核对 DSH 发布包的情况下删除；升级基线时复查。

**测试只从仓库依赖导入 DSH 包**，不读本机全局安装的 DSH（CI 上没有它）。真实 PTC 运行时（`dsh-fs-local`、`dsh-subprocess-local`、`dsh-sandbox-local`、`dsh-sandbox-policy`、`dsh-ptc-runtime-node`）、JSONL 会话持久化（`dsh-session-persistence-jsonl`）与默认模型（`dsh-agent-default-model`）因此是根 devDependencies，版本走 catalog。它们带来的 `node-pty` 用自带的预编译二进制，`pnpm-workspace.yaml` 的 `allowBuilds` 把它和 `dsh-subprocess-local` 的安装脚本关掉（与 `koffi` 相同），否则全新安装会因未登记的构建脚本失败。

### 产物的 tree-shaking

两侧 Host 产物各自只含本侧的服务解析，这一点不在 `check` 里自动检查。改服务模块的组织方式（合并两侧 wire、在模块顶层执行代码、改构建配置）后，构建并在两侧的 `lib/index.js` 里确认只属于另一侧解析的字符串不出现、本侧的出现。把它做成 `scripts` 里的检查是[候选事项](plan.md#候选与待定)。

## 端到端测试

规格覆盖矩阵与 harness 的模块职责见[代码结构 · 端到端目录](code-structure.md#端到端目录)。

### 运行与环境变量

`pnpm run test:e2e` 先构建，再按 `vitest.e2e.config.ts` 执行 `e2e/**/*.e2e.ts`：规格文件串行（`fileParallelism: false`），worker 带 `--no-global-search-paths`，用例超时 120 s、钩子 600 s。全局准备会清空 `.e2e/run` 与 `.e2e/artifacts`，所以**同一时间只能有一个 e2e 进程**。

| 变量 | 作用 |
| --- | --- |
| `DSH_E2E_INSTALL` | 指向已有的 DSH 安装目录（其 `@deepseek-ai/dsh` 版本必须等于 catalog 版本），不再下载 |
| `DSH_E2E_CHROMIUM` | Chromium / Chrome 可执行文件；缺省依次尝试 `/usr/bin/chromium`、`/usr/bin/chromium-browser`、`/usr/bin/google-chrome` |
| `DSH_E2E_REVIEW_NAME` | 评审截图与证据 JSON 的归档子目录（`.e2e/review/<名字>/`，不随 global setup 清空）；缺省 `2026-10-22-m5`。重拍时换一个名字，避免覆盖已有证据 |
| `CI` | 设置时缺少浏览器直接失败，而不是跳过 GUI 规格 |

### 隔离与 harness

`e2e/global-setup.ts` 为整次运行建一个隔离的世界：

1. 把 HOME、DSH_HOME、XDG_*（含 `XDG_RUNTIME_DIR`）、TMPDIR、DSH_AGENTS_HOME、DSH_BUNDLED_SKILL_DIR、COREPACK_HOME、PNPM_HOME、npm 缓存全部指向 `.e2e/run` 下的子目录；清除 `DSH_*`、`DEEPSEEK_*`、`VITEST*`、`NODE_OPTIONS`、`NODE_PATH`、`NODE_ENV`，保留代理与 registry 设置，关闭遥测；
2. 按 `pnpm-workspace.yaml` catalog 的 `@deepseek-ai/dsh-web` 版本安装 DSH 到 `.e2e/dsh-<version>`（先装进 `.partial` 再改名，中断不留半个安装），之后复用；
3. 用 pnpm 打包全部可发布包到 `.e2e/run/tarballs`；
4. 用真实插件管理器（`dsh plugin --profile web add`）安装 profile，两个插件与 ui 经 profile 的 pnpm `overrides` 指向本次的 tarball。

### 写规格的约定

- 远程抓取与模型搜索的 e2e 从不向真实服务发请求：实际调用只发往回环假服务；内置远程连接只检查可选性与就绪状态；测试凭据用 `describe` 检查（不读回），结束时删除。要让 Agent 真正调用增强工具时，用回环的假模型 API 驱动。
- 远程服务缺省停用：用到它们的规格先在设置里显式启用。增强工具只出现在打开开关之后新建的对话里，规格要先开开关再建对话。
- 会建会话、写草稿、写用户层或多次重启 GUI 的规格用 `isolatedContext(inject('e2e'))`（`harness/environment.ts`）拿独立 home 并自己 `addPlugins`；改了共享状态（用户层、密钥、模型记忆）的规格在 `afterAll` 里恢复。
- 定位一律用各包 `en` 字典的值、角色与可访问名称，不写死文字；中文界面用 Playwright 的 `zh-CN` context，不写持久语言设置。输入框菜单按能力分页，先用 `openConnectionTab` 切到目标能力，它返回该能力的面板（`tabpanel`）。
- 需要 Host 启动时诊断的规格，在 `bootHost` 的 `prepare` 回调里接日志；要测 base profile 时先 `createBaseProfile`，再把 profile 名传给 `addPlugins` 与 `bootHost`。
- 进程内 Host（`bootHost`）没有 CLI，harness 自己提供 `dsh-cmdline` 的“应用就绪”源：按公开的 `onReady` 契约，启动完成后通知已登记的监听者，之后登记的立即回调。DSH 的 HMR 初始重载占着 Settings 的独占队列等这个信号，不通知时 Settings 写入一直排队；不要把它换成空实现。
- `bootHost` 的 `dispose` 先 await 公开的 `hmr.runExclusive(async () => {})` 作为屏障，再处置根 fiber：DSH rc.2 的 HMR 公开队列在一次调用被拒后可能仍在用根，直接处置会挂住（原生 Web profile、不装本仓库插件时同样复现）。不要去掉这道屏障，也不要改用超时或 sleep。
- 子 Agent 会话：用回环模型让父 Agent 调 preset 的 `subagent` / `subagent_fork`，等 `subagents.waitForChildren` 收尾；Web 里经父会话的子 Agent 列表打开子会话，不在运行的子会话由父 Agent 的 `send_message` 再叫起（`subagent-selection.e2e.ts` 与它的 fixture）。
- 驱动真实 Agent 调用工具时用 `startAgentModelApi`：回环的 Messages SSE 第一步发出给定的工具调用，之后给出回答；只看请求的规格用 `startTextModelApi`。评审用的截图经 `harness/review.ts` 另存到 `.e2e/review/<日期-主题>/`，不被全局准备清空。要拍运行中的工具行时把 Work details 切到 Compact（DSH 缺省的 Detailed 平铺运行中的工具、没有分组标题），用传输闸门（deferred promise）停在运行中；要拍首次启用提示时 `openApp` 的第三个参数传 `'keep'`（不自动关掉它）。
- 截图在断言之前保存。产物都在 `.e2e/artifacts`：`web.log`、`<name>.png`、`<spec>-failure.json` / `.png` / `.aria.txt`、`fetch-remote-wire-*.json`、`search-model-wire-*.json`、`search-model-host.log` 等。

### 常见失败与排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| Chromium 启动失败，提示 SingletonSocket / socket 路径过长 | Linux 的 Unix socket 路径上限 108 字节，仓库路径较长时 `.e2e/run` 下的任何目录都放不下 | `openApp` 给 Chromium 一个 `/tmp/dsh-e2e-*` 短临时目录作 `TMPDIR`，浏览器关闭时删除；仍报错时检查是否有别的代码改了 Chromium 的 `TMPDIR` |
| 进程内 Host 加载了工作区的插件而不是 profile 里装的 | pnpm 的 vitest shim 把工作区放进 `NODE_PATH`，Node 的全局查找路径让它优先 | 全局准备删除 `NODE_PATH`、worker 带 `--no-global-search-paths`；自己起子进程也加上，不要绕开 harness 直接调 vitest 二进制 |
| GUI 规格偶发找不到元素、工作区选择器被打断、会话草稿串了，或目录选择框的 Edit path 超时 | 共用 home 的规格会恢复彼此的草稿与布局；同一 home 多次重启 GUI 留下状态 | 改用 `isolatedContext` 的独立 home；不要在共享 harness 里再加 locator handler（Playwright 在 handler 内不运行其他 handler，会与欢迎对话框冲突） |
| `DSH_E2E_INSTALL=… holds no @deepseek-ai/dsh` 或 “has DSH x; the e2e suite targets y” | 指定的安装不存在或版本不符 | 指向正确版本，或取消该变量 |
| `dsh web printed no launch URL in 90 s` | GUI 没起来 | 看 `.e2e/artifacts/web.log` |
| 无外网时 pnpm 命令挂起不返回 | 本机 pnpm 与根 `packageManager` 的版本不同时，pnpm 会去下载指定版本；`pnpm install` 还要访问 registry | 设 `npm_config_manage_package_manager_versions=false`，安装用 `pnpm install --offline`（依赖已在 store 里时） |
| 本地 GUI 规格全被跳过 | 找不到浏览器且没设 `CI` | 设置 `DSH_E2E_CHROMIUM` |

## DSH 基线升级

每一项对应代码里对 DSH 的一处依赖。

1. **版本**：改 `pnpm-workspace.yaml` 的 catalog（全部 `@deepseek-ai/dsh-*`、`cordis*`、`schemastery`，以及匹配的 `dsh-agent-loop-testkit`），再改四个可发布包的 `engines.dsh` 与 `@deepseek-ai/dsh-*` peer 范围（`verify-packages` 检查它们一致）；同步 AGENTS.md 与 README 里的目标范围。
2. **base 组合**：对照新版 base bundle 的 `cordis.patch.yml` 更新 `packages/profile/tests/profile.spec.ts` 的 `BASE` 行。
3. **native 行**：search `deepseek-messages` 对照 `web-search-deepseek`（`DeepSeekSearchProvider` 的选项、`DEEPSEEK_SEARCH_BASE_URL`、`recordRequest`），`deepseek-search-api` 与 fetch `deepseek-fetch-api` 对照 `web-deepseek-api`（`count`、`originalQuestion`、`baseURL`），以及共用的凭据回调（`apiKeyEnv`、`resolveApiKey`、`resolveAccountToken`；core `nativeAuth`）；目录的端点与参数规则跟着改。核对 DSH 错误消息的布局：`restateNative` 只取第一个空行之前的上游报告，布局变了要改这条规则与两侧 `native.spec.ts`。
4. **`HttpFetchProvider`**：构造签名 `new HttpFetchProvider(settings, resolve)` 与 `HttpFetchResolver` 的约定、对 IP 字面量与代理的处理、默认上限与 User-Agent（fetch `DEFAULT_LOCAL_SETTINGS` 是原生行的副本）、它抛出的 `WebError` 码。
5. **`ipaddr.js`**：catalog 版本与新版 `web-fetch-http` 的依赖一致；`src/local/rules.ts` 的非公网范围表与该版本 `range()` 对齐。
6. **preset 与工具可见性**：tool-web 仍由 agent preset 挂在 Agent 作用域的祖先上（minimal 没有它），Host 行注册的全局工具仍进入每个 preset 与 base；`tools.get` 仍返回遮罩后的视图；`tools.register` 返回的 disposer 与它的 effect 归注册方；`tools.restrict({ deny })` 只接受已注册的名字（被别人遮住的也接受）、未注册时同步抛错；`tools/change` 仍同步通知、组装仍在 `agent/request` 之前；Native 模式的工具增删 developer 消息与 PTC 的 SDK；工具定义的 `timeoutMs`、`isConcurrencySafe`、开放的参数根对象、`exec.agent` / `exec.signal`，以及已注销工具的 `UNKNOWN_TOOL`。`agent/request`、`agent/created`（串行等待监听器后才开始模型循环）、`agent/disposed` 事件，`currentInitiator()`、`agents.withInitiator` 的嵌套语义与 `agents.list()` 不变（两侧 `agent.spec.ts` 与可见性测试会发现）。
7. **tool-web 的导出与复制的逻辑**：增强工具原样导入的 `formatSearchOutput` / `formatFetchOutput`、`searchMetaFromValue` / `fetchMetaFromValue`、`parseFetchArgs` 与 `WEB_SEARCH_MAX_QUERIES`、`WEB_SEARCH_MAX_RESULTS`、`DEFAULT_FETCH_MAX_OUTPUT_CHARS` 的签名与格式；两侧参数与输出 schema 的字面量对照原生工具。search 的 `src/tools/queries.ts` 复制自 tool-web 的 `src/search.ts`（`parseSearchArgs` 的措辞、`runSearchQueries`、`mergeSearchResults`、`projectSource`）与 dsh-web 的 `capSources`，文件头写明来源版本，要对照新版逐段更新；`tools-search.spec.ts` 的逐字节对照与参数错误对照（`invalid arguments: ` 加 tool-web 原消息）会报漂移，fetch 的参数错误由 `tools-fetch.spec.ts` 对照 `parseFetchArgs`。
8. **Session header、会话来源与新建判断**：core `sessionOrigin` 与 `isNewConversation` 用的 Session 公开字段（`header.origin`、`header.parentSession`、`header.isSeeded`、`firstLiveSeq`、`firstLifecycleSeq`）仍公开、未弃用；子 Agent 的会话头仍带 `origin: 'subagent'`（DSH `subagent` 包的 `childSessionMeta`）、用户 fork 仍不带，DSH 判断子 Agent 路由归属仍首先看它（session-controller 的 `hasApiSessionSubagentOwner`）；新建判断的语义仍与 DSH `tool-subagent` 的 `selectForSession` 一致；`sessionController.create` 在 `agent/created` 之前写入事件的时机；`sessionPersistence.stat` 仍只读会话头、不存在时返回 `undefined`。core `session-origin.spec.ts`、`row-visibility.spec.ts`（真实 `sessionController` 与 JSONL 恢复）、`remote.spec.ts` 与 e2e `subagent-selection` 会发现变化。
9. **Settings 投影**：Host 侧 `settings.describe()` 里 `ns = web` 的值、`settings/document-updated` 事件、`settings.configure`；浏览器侧 `configForms`（`get` / `whileServed`）、`describe()` 的 `secrets`、`pluginNavigation`、各槽位名；输入栏在控件一行放不下时设置的 `--dsh-composer-model-text-display` / `--dsh-composer-model-icon-display`（输入框按钮随它收起，e2e `screenshots` 的宽度扫描会发现变化），以及菜单用到的 `SegmentedTabs`。
10. **浏览器壳**：`build/platform.ts` 的平台模块表对照 DSH 的 `packages/client/web/src/platform.ts`；CSS Modules 的注入方式对照 DSH 的客户端构建。
11. **测试补丁**：复查 `primitivesStub` 与 `zustand` / `immer` 是否仍需要。
12. **跟随会话模型的耦合**（search `src/model/route.ts`、`deepseek.ts`；core `host/model.ts`）：
    - `llm-deepseek` / `-api-key` / `-account` 的配置字段 `baseURL`、`apiKeyEnv`，端点缺省（`DEEPSEEK_BASE_URL` → `https://api.deepseek.com/anthropic`）与 key 缺省（`DEEPSEEK_API_KEY`）在本地复刻；两条路由仍走 Messages，账号路由不回退 API key；
    - `llm-pi-ai` 的 `api`（我们认 `anthropic-messages`、`openai-responses`、`openai-completions`）、`baseURL`、`apiKeyEnv`、`headers`、`models`（替换目录）、`modelOverrides` 的语义；
    - `listConfigurableProviders()` 条目的 `provider`、`settingsNs`、`settingsPath`、`defaultBaseURL`、`baseURLEnv`、`nativeAuth.env` / `oauth`；
    - `modelSelection` 投影的 `pending`、`session.requestContext()` / `requestHeader()` 的语义（`nextModel` / `requestModel`），测试里 `installModelSelection` 的用法；账号服务 `resolveToken` 的放行规则；
    - DeepSeek 接受的 Messages 工具版本与 thinking：`deepseek.ts` 的 `DEEPSEEK_MESSAGES` 与 `DeepSeekSearchProvider` 的缺省一致。

    `model-route.spec.ts` 用夹具测这些规则，e2e `search-model` 的 pi-ai 与 DeepSeek 用例用真实 DSH，二者一起能发现字段变化。
13. **e2e 积木**：`e2e/harness/host.ts` 用到的 `dsh-app-boot`、`dsh-cmdline`、`dsh-launch-environment` 导出，其中 `provideCmdline` 的 `ready.onReady` 契约（harness 按它实现应用就绪源，HMR 的初始重载等它；契约变了 Settings 写入会一直排队）；`createBaseProfile` 用的 `initProfile` 与 `DEFAULT_PROFILE_BUNDLES`；`hmr.runExclusive` 的公开语义，并确认新版 DSH 在“调用被拒后立即 dispose”时是否仍会挂住、`bootHost.dispose` 前的空事务屏障是否还需要（去掉后跑 `search-model` 与 `fetch-remote` 规格即可发现）；`fixtures/host-plane.yml` 里的行名，首次启动的对话框（`browser.ts` 的 locator handler），界面的可访问名称。
14. `pnpm run check` 与 `pnpm run test:e2e` 都通过后，在 CHANGELOG 记下基线变化。

## 发布与 CI

四个可发布包（profile、search、fetch、ui）同一节奏发布；core 是 private，不发布。

**升级兼容只对上一个已发布版本**：升级路径、兼容代码与升级测试（单元与 e2e）只覆盖从上一个已发布版本升到本版本；更早版本的兼容不再新增，已有的兼容代码在[候选](plan.md#候选与待定)里排期移除。发布前按这一点核对 CHANGELOG 里的 Breaking 说明与 design 的升级一节。

1. 提升要发布的包的版本；profile 的版本决定标签，只要有包要发，profile 也要提升（它精确锁定其余三个包）。
2. 把 CHANGELOG 的 “Unreleased” 改成 `## v<profile 版本> (<日期>)`，其下是各包的版本小节；同步各包 README。这一节就是 GitHub Release 的正文（`node scripts/release-notes.ts v<版本>` 可预览）。
3. 本地 `pnpm run check` 与 `pnpm run test:e2e`。
4. 先推送 main，等 `ci` 通过，再打 `v<profile 版本>` 标签并推送。e2e 只在本地跑（第 3 步），`ci` 与 `publish` 都不跑。

npm 只能给已经存在的包配置可信发布（trusted publishing），所以**新包的第一个版本手动发布**：在要打标签的提交上 `pnpm run build`，进包目录 `pnpm pack`（只有 pnpm 会改写 `workspace:` / `catalog:` 范围），再用 `npm publish <tarball> --access public` 发布；然后在该包的 npm 设置里添加 trusted publisher：GitHub Actions，仓库 `Yurzi/dsh-tool-web-enhanced`，工作流 `publish.yml`，不设 environment。之后再推标签，`publish` 会跳过已在 registry 上的版本。手动发布的版本没有 provenance。

`verify-packages` 用 pnpm 打包每个可发布包并检查：清单里没有残留 `workspace:` / `catalog:`；所有包的 `engines.dsh` 相同，`@deepseek-ai/dsh-*` peer 与之一致；插件没有 `dependencies`，Host 产物只导入 Node 内置与已声明为 peer 的 `@deepseek-ai/*`；profile 依赖的版本等于本次工作区里的版本；`repository.url` 与根 `package.json` 相同、`repository.directory` 是包所在目录（provenance 发布时 npm 会比对这个地址）；导出目标、bundle patch、图标与 `locale/{en,zh}.json` 的 `meta` 都在包里；最后跑 `publint --strict`。

| 工作流 | 触发 | 内容 |
| --- | --- | --- |
| `ci.yml` | push 到 main、PR | `check`：Node 22.19.0 与 24 上 `pnpm install --frozen-lockfile && pnpm run check`。不跑 e2e：它要安装真实 DSH 与 Chromium、跑十几分钟，截图类规格对时序敏感，只在本地开发与发布前运行 |
| `publish.yml` | `v*` 标签 | `publish`：核对标签等于 `packages/profile/package.json` 的版本、CHANGELOG 有这个标签的小节，跑 `check`，再 `pnpm --recursive publish --access public --no-git-checks --provenance`（npm trusted publishing，OIDC，不用 token）；registry 上已有的版本跳过。通过后 `release`（只有它有 `contents: write`）：用 `scripts/release-notes.ts` 取出该小节，创建同名 GitHub Release，标签带 `-` 时标为 prerelease；Release 已存在则跳过 |

## 文档维护

每个事实只写在一处，其他文档用相对链接引用。

| 文档 | 管什么 | 什么变化时改 |
| --- | --- | --- |
| [architecture.md](architecture.md) | 由什么组成、怎么连起来、为什么这样分：边界、包与依赖、组合、运行时结构、浏览器面结构、构建形态、[安全架构](architecture.md#安全架构) | **架构变化**：包划分、依赖方向、管线、信任边界与不变量 |
| [design.md](design.md) | 用户与运维能做什么、产品行为：连接与目录、会话选择、配置文档、各后端行为、错误与上游说明、升级、已知限制 | **行为变化**：模型可见的行为、设置字段、界面能力、错误规则 |
| [code-structure.md](code-structure.md) | 当前代码：布局、模块职责、导出、测试清单、产物路径与形态 | **结构变化**：文件与模块的增删、职责、导出、测试文件、产物形态 |
| development.md（本文） | 开发流程：命令、改动对照、测试与 e2e、基线升级、发布 | **流程变化**：命令、环境变量、测试约定、harness、发布 |
| [plan.md](plan.md) | 里程碑、接下来、候选与扩展原则 | **计划变化**：里程碑完成或推迟、新增或放弃候选 |

另外：

- `CHANGELOG.md` 记发布说明（用户可见的变化，按包分节，未发布的在 “Unreleased”）；各包 README 是 npm 上的简介，行为变化影响到它时同步。
- `AGENTS.md` 是给 agent 的英文摘要（布局、命令、不变量、约定），不变量、布局或命令变化时一起改。
- docs/orchestration-prompt.md：维护者维护的多 agent 开发任务说明（每个阶段开始前由维护者重写）。
- 文案只改 `locales.ts` / `locale/*.json`，不必改文档，除非文档引用了原文。
- 只写当前状态，历史交给 git；有设计理由的，用一句“为什么”写在对应位置。引用别的文档用标题锚点链接，不用章节号。
- 发现代码与 architecture 的原则矛盾时，先提出，再决定改代码还是改原则。

# 代码结构（现状）

本文按 **包 → 入口 / 目录 → 模块** 的层级描述仓库里现在的代码是什么样子（as-built），面向要读代码、改代码的维护者。它与设计文档 [architecture.md](architecture.md) 互补：设计文档讲"为什么、应该怎样"，本文只讲"现在是什么"；两者不一致时以代码为准，并在第 11 节记录。开发流程见 [development.md](development.md)。

事实来源是工作区里的代码本身（2026-10-20 的工作树：search / fetch 0.2.0，profile / ui 0.1.0，DSH 基线 0.2.1-rc.2）。文中路径都相对仓库根目录；链接相对本文件。

## 1. 总览

### 1.1 仓库布局

~~~text
packages/
  profile/          dsh-tool-web-enhanced-profile  bundle：cordis.patch.yml、locale、icon、tests（无运行时代码）
  search-enhanced/  dsh-web-search-enhanced        web_search 插件：src/ tests/ locale/ icon.svg tsdown.config.ts
  fetch-enhanced/   dsh-web-fetch-enhanced         web_fetch 插件：同上
  ui/               dsh-tool-web-enhanced-ui       空 Host 面 + 浏览器面（webConnections、输入框菜单、首次启用提示、bundle 概览）
  core/             dsh-tool-web-enhanced-core     private，只有源码：src/shared、src/host、src/client 三个入口；tests
build/              tsdown 构建工厂、平台模块表、Rolldown/Vitest 共用插件、__PLUGIN_VERSION__ 声明
scripts/            workspace.ts（发现与打包）、verify-packages.ts（发布前检查）、clean.ts
e2e/                harness/（隔离环境、进程内 Host、dsh web、Playwright、导航、主题、升级、HTTP 靶机、远程抓取 API 靶机）、fixtures/、*.e2e.ts
docs/               architecture.md（设计）、development.md（流程）、code-structure.md（本文）、orchestration-prompt.md（当前里程碑（M4）的多 agent 任务说明）
~~~

根目录的配置：

| 文件 | 内容 |
| --- | --- |
| [package.json](../package.json) | 私有工作区根；脚本 `build`（递归构建 packages）、`typecheck`（`tsc -p tsconfig.json`）、`lint`（`oxlint --type-aware`）、`test`、`test:coverage`、`verify:package`、`check`（typecheck → lint → build → test → verify:package）、`test:e2e`；全部 DSH 包、React、zod、zustand、immer、jsdom、tsdown、vitest、playwright-core、publint 都是根 devDependencies |
| [pnpm-workspace.yaml](../pnpm-workspace.yaml) | `packages/*`；catalog 把所有 `@deepseek-ai/*` 钉在同一个发布版本（0.2.1-rc.2；cordis 4.0.5、schemastery 3.18.5、testkit 0.0.1-rc.1），React 18.3.1、zod 4.4.3、`ipaddr.js` ^2.5.0；`overrides` 把 zod 固定为一份；`minimumReleaseAgeExclude: '@deepseek-ai/*'` |
| [tsconfig.base.json](../tsconfig.base.json) / [tsconfig.json](../tsconfig.json) | 一次 `tsc` 覆盖 `packages/*/src`、`packages/*/tests`、`build`、`scripts`、`e2e` 和各 config；`noEmit`、`module: preserve` + `moduleResolution: bundler`、`allowImportingTsExtensions`（源码导入写 `.ts` 后缀）、`verbatimModuleSyntax`、`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` |
| [.oxlintrc.json](../.oxlintrc.json) | type-aware；`correctness` 报错、`suspicious` 警告；`import/no-cycle`、`typescript/no-floating-promises`、`react/rules-of-hooks` 为错误；忽略 `lib/`、`.e2e/` |
| [vitest.config.ts](../vitest.config.ts) / [vitest.e2e.config.ts](../vitest.e2e.config.ts) | 单元与组合测试 / 端到端测试，见第 9 节 |

### 1.2 包之间的依赖

~~~mermaid
flowchart TD
  profile["dsh-tool-web-enhanced-profile<br/>bundle：cordis.patch.yml"]
  search["dsh-web-search-enhanced<br/>Host lib/index.js · Client lib/client.cjs"]
  fetch["dsh-web-fetch-enhanced<br/>Host lib/index.js · Client lib/client.cjs"]
  ui["dsh-tool-web-enhanced-ui<br/>Host 空插件 · Client lib/client.cjs<br/>provide webConnections"]
  core["dsh-tool-web-enhanced-core（private）<br/>./shared ./host ./client"]
  dsh["DSH 安装：@deepseek-ai/*<br/>Host 侧为 peer；浏览器侧由壳的模块表提供"]
  profile -- "dependencies（workspace:*，打包时变精确版本）" --> search
  profile -- dependencies --> fetch
  profile -- dependencies --> ui
  search -. "可选注入 webConnections：注册菜单分区" .-> ui
  fetch -. "可选注入 webConnections" .-> ui
  core -. "构建时源码内联" .-> search
  core -. "构建时源码内联" .-> fetch
  core -. "构建时源码内联" .-> ui
  search -- peer --> dsh
  fetch -- peer --> dsh
  ui -- peer --> dsh
~~~

- 三个插件包的 `src` 互不导入（当前可用 grep 确认没有跨包导入）；它们之间唯一的运行时联系是浏览器服务 `webConnections`，类型来自 core 的 `./client`。测试例外：`search-enhanced/tests/client-composition.spec.tsx`、两侧的 `client-apply.spec.tsx`、`ui/tests/client-settings-appearance.spec.tsx`、`ui/tests/client-allowlist-disclosure.spec.tsx` 直接导入别的包的 `src`，做真实的组合测试。
- core 以 `dsh-tool-web-enhanced-core: workspace:*` 作为各包的 **devDependency**，`exports` 直接指向 `.ts` 源码；构建时被内联，发布包里没有它。
- profile 的 `dependencies` 只有本仓库的三个包；core 只是它的 devDependency（测试读 ids）。

### 1.3 产物

由 [build/tsdown.ts](../build/tsdown.ts) 生成（第 9.1 节）。下表的大小取自 2026-10-20 20:27 构建的 `lib/`（未压缩）：

| 包 | `lib/index.js`（Host，ESM） | `lib/client.cjs`（浏览器） | 说明 |
| --- | --- | --- | --- |
| search | ≈ 554 KB（553 975 B） | ≈ 190 KB（+ `.map` ≈ 323 KB） | Host 体积主要是内联的 zod v4（约 78 个模块）和 core |
| fetch | ≈ 590 KB（589 777 B） | ≈ 235 KB（+ `.map` ≈ 405 KB） | 另外内联了 `ipaddr.js`、core 的 MCP 客户端与 adapter 骨架；浏览器面多了远程服务与自定义连接的设置 |
| ui | ≈ 1 KB（933 B） | ≈ 66 KB（+ `.map` ≈ 89 KB） | Host 面只有 `name` 与空 `apply` |
| profile | — | — | 只发布 `cordis.patch.yml`、`locale/*.json`、`icon.svg`、README |

- **Host 产物**：ESM，`platform: node`、`target: node22`。外置的只有 Node 内置模块和 `@deepseek-ai/*`，其余（zod、ipaddr.js、core）一律内联，所以插件没有运行时 `dependencies`。当前产物实际导入的外部模块：
  - search：`dsh-credentials`、`dsh-launch-environment`、`dsh-scope`、`dsh-storage-domain`、`dsh-typert-protocol`（含 `/remote-info`）、`dsh-web`、`dsh-web-deepseek-api`、`dsh-web-search-deepseek`、`schemastery`；
  - fetch：`cordis`（`local/backend.ts` 的默认 logger 用 `new Context()`）、`dsh-credentials`、`dsh-launch-environment`、`dsh-scope`、`dsh-storage-domain`、`dsh-typert-protocol`、`dsh-web`、`dsh-web-deepseek-api`、`dsh-web-fetch-http`、`schemastery`，以及 `node:dns/promises`、`node:net`；
  - ui：无。
- **浏览器产物**：DSH 模块加载器格式，整个文件是 `window.__ModuleLoader__.load({ id: <包名>, factory: (require) => { … return module.exports } })`；扩展名 `.cjs` 是因为包是 `"type": "module"` 而产物是 CJS 形状。只有壳的平台模块外置（[build/platform.ts](../build/platform.ts)），当前产物实际 `require` 的是 `react`、`react/jsx-runtime`、`zod`（search、fetch）、`react-dom`（ui）、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-primitives`；其余 `@deepseek-ai/dsh-client-*` 在源码里只做类型导入，或经 `ctx` 上的服务使用。CSS Modules 编译进包，每个样式表注入一个 `<style data-plugin data-plugin-css>`。

### 1.4 运行时边界

| 边界 | 代码 | 约束 |
| --- | --- | --- |
| Host（Node，DSH Loader 加载的 Cordis 插件） | 各包 `src/index.ts` 及其导入：`core/src/host/**`；search 的 `src/{seat.ts,host,backends,search}`；fetch 的 `src/{host,backends,local,remote,prompt.ts}`；两侧的 `src/settings/**` | 只导入 Node 内置与 `@deepseek-ai/*`；出站只用全局 `fetch`（core 传输）或 DSH 官方 provider 类 |
| 浏览器（DSH Web 壳加载的 client 插件） | 各包 `src/client/**`、`core/src/client/**` | 只依赖平台模块与 `ctx` 服务；不读取密钥值；文案走 locale 字典 |
| 同构（两侧共用的纯代码） | `core/src/shared/**`；两侧的 `src/catalog.ts`、`src/contract.ts`、`src/settings/**`；fetch 的 `src/local/rules.ts`（白名单文法，设置页的逐行诊断也用它） | 不导入 Node、浏览器或 Host 专属模块；`core/src/shared/selection.ts` 导入的 `@deepseek-ai/dsh-typert-protocol` 与 zod 是两侧通用的包 |

## 2. packages/profile

**职责**：用户唯一要安装的 bundle。没有运行时代码，只用 patch 把两个插件和菜单行插进 profile，并在共享的 `web` 行里选中两个插件的 provider。

`package.json` 要点：`exports` 只有 `./cordis.patch.yml`、`./locale/*.json`、`./icon.svg`、`./package.json`；`dsh.bundle.patch = ./cordis.patch.yml`；`engines.dsh = >=0.2.1-rc.2 <0.3.0-0`；`dependencies` 是三个插件包的 `workspace:*`（pnpm 打包时改写为精确版本，verify-packages 检查它等于本次发布的版本）；没有 peer。

~~~text
packages/profile/
  cordis.patch.yml        三条 patch（见下）
  locale/en.json zh.json  只有 meta.title / meta.description（插件页读取）
  icon.svg  README.md  package.json
  tests/profile.spec.ts   patch 与 ids.ts 一致、命名规则、最终路由
~~~

[cordis.patch.yml](../packages/profile/cordis.patch.yml) 的三条：

1. `id: web` 的 `config` 同时写 `searchProvider: search-enhanced` 与 `fetchProvider: fetch-enhanced`（patch 整体替换 `config`，所以两个字段一起写）；
2. `web-search-deepseek` 设为 `disabled: true`（`web-deepseek-api` 与 `web-fetch-http` 保持挂载，作为手动退路）；
3. `insert` 三行：`web-search-enhanced` → `dsh-web-search-enhanced`、`web-fetch-enhanced` → `dsh-web-fetch-enhanced`、`tool-web-enhanced-ui` → `dsh-tool-web-enhanced-ui`。

`tests/profile.spec.ts` 用真实的 `applyEntryPatches`（`@deepseek-ai/cordis-plugin-include`）把 patch 叠加到写死的 base 四行（`BASE`，对应 dsh-base 0.2.1-rc.2 的 web 段）上，再用真实 `WebRuntime` 注册各行的桩 provider，断言 `web` 行、停用行、插入行、命名规则（行 id = 包名去掉 `dsh-`）和最终路由；行 id、包名、provider id 都从 core 的 `ids.ts` 读取。

## 3. packages/core

**职责**：两个插件共用的"选择范式"本身，以及菜单分区契约与设置页骨架。私有、只有源码，被各包构建时内联，因此**不持有模块级状态**（`src` 里没有顶层 `let` / `var`；有状态的对象都在安装时或组件工厂里创建）。

`package.json` 要点：`private: true`、`sideEffects: false`；`exports` 为 `./shared` → `src/shared/index.ts`、`./host` → `src/host/index.ts`、`./client` → `src/client/index.ts`；只有 devDependencies（类型检查与测试用的 DSH 包、React、zod）。

~~~text
packages/core/src/
  shared/   index.ts ids.ts connections.ts settings.ts selection.ts route.ts url.ts
  host/     index.ts capability.ts runtime.ts sessions.ts storage.ts pairings.ts plans.ts selectable.ts model.ts
            restriction.ts route.ts remote.ts settings-row.ts credentials.ts errors.ts native.ts transport.ts
            mcp.ts adapter.ts
  client/   index.ts section.ts use-observable.ts selection.ts route.ts pairings.ts credentials.ts command.ts
            settings/ document.ts sparse.ts secret-diagnostics.ts injected.ts fields.ts parts.tsx model.ts
                      connection-form.ts CredentialEditor.tsx OptionsEditor.tsx ServiceFields.tsx
                      ServicesSection.tsx DefaultsSection.tsx CustomConnections.tsx ConnectionEditor.tsx
                      PairingsSection.tsx ResetSection.tsx RouteNotice.tsx
packages/core/tests/   20 个 spec + fixtures/settings.ts
~~~

### 3.1 `./shared`（同构）

| 模块 | 导出 | 被谁用 | 关键不变量 |
| --- | --- | --- | --- |
| [ids.ts](../packages/core/src/shared/ids.ts) | `PROFILE_PACKAGE`、`SEARCH` / `FETCH`（`PluginIdentity`：`packageName`、`rowId`、`providerId`）、`UI`（`RowIdentity`）、`rowConfigKey(row)` → `<profile 包名>#<行 id>` | 所有包的 Host 与浏览器面、profile 测试、e2e harness | 标识只在这里定义一次；YAML patch 无法导入，由 profile 测试断言一致 |
| [connections.ts](../packages/core/src/shared/connections.ts) | `ConnectionId`、`BUILTIN_PREFIX` / `CUSTOM_PREFIX`、`CUSTOM_CONNECTION_ID`（`custom:` + 1–100 个 `[A-Za-z0-9._-]`）、`CREDENTIAL_REF`（`^[A-Za-z_][A-Za-z0-9_]*$`）、`AccessMode`（`keyless` / `api-key`）、`Access`（再加 `account`）、`BackendKind`、`OptionRule`、`AccessFacts`、`Descriptor`、`builtinId` / `builtinKey` / `isBuiltinId` / `isCustomId`、`defaultAccess`、`validateOptions`、`TEXT_MAX_LENGTH = 2000` | 两侧目录、`settings.ts`、设置页 | `OptionRule` 为 `enum` / `text`（先查 `maxLength` 再跑正则）/ `url` / `boolean` / `integer` / `list`；`keyless` 字段可在匿名访问时拒绝（`false`，`text` / `url` / `boolean` / `integer`）或收窄（`enum` 的子集）一个参数；未知参数一律报错 |
| [settings.ts](../packages/core/src/shared/settings.ts) | `CURRENT_SETTINGS_VERSION = 2`、`UNVERSIONED_SETTINGS_VERSION = 2`、`SETTINGS_FIELDS`、`SETTINGS_RESET_HINT`、`documentVersion`、`SETTINGS_MIGRATIONS`（空表）、`migrateDocument`、`documentSchema`、`builtinOverrideSchema`、`customConnectionSchema(adapterKeys)`、`resolveDocument`；类型 `ResolvedBase` / `ResolvedDocument` / `SettingsDescriptor` / `BuiltinOverride` / `CustomConnection<A>`（自定义连接的持久化形状，两侧的 `settings/types.ts` 用目录的 adapter 键实例化） | 两侧 `settings/resolve.ts`、core 的浏览器文档视图与设置页 | 文法见第 8.1 节；校验前先做有界遍历（`validateDocumentBounds`）；未知字段附带 Reset 提示；没有“是否允许自定义连接”的开关：`custom:*` 的 `adapter` 只能取目录的 adapter 键，目录没有 adapter 项时自然被拒 |
| [selection.ts](../packages/core/src/shared/selection.ts) | `Selection<O>`、`SELECTION_SOURCES`（`session` / `inherited` / `model` / `default`）、`Pairing`、`CONNECTION_STATUS`（`ready` / `disabled` / `needs-credential` / `unsupported`）、zod 片段（`sessionId`、`connectionId`、`connectionViewBase`、各请求与视图）、`selectionContract(spec)`、`ConnectionsRemoteMap` / `ConnectionsRemoteErrors` 类型（`<ns>/unavailable`、`<ns>/conflict`、`<ns>/invalid-settings`） | 两侧 `contract.ts`、core host 的 Remote 服务、浏览器 store | 请求与结果在两端都是严格对象；Remote 方法见第 8.7 节 |
| [route.ts](../packages/core/src/shared/route.ts) | `Route`（`unknown` / `this` / `auto` / `other`）、`WEB_ROW = 'web'`、`WEB_FIELD`、`WEB_ENV`（`DSH_WEB_SEARCH_PROVIDER` / `DSH_WEB_FETCH_PROVIDER`）、`routeOf(row, field, envProvider, providerId)`、`isRouted` | Host 的 `routeFacts`、浏览器的 `RouteStatus`、ui 概览 | 与 `WebRuntime` 一致：只有字段缺席才回退环境变量，`''` 也算已配置；读不到 `web` 行为 `unknown`，调用方按"未路由"处理 |
| [url.ts](../packages/core/src/shared/url.ts) | `isEndpoint`（http(s)、无凭据、无查询与片段）、`sourceUrl`、`MAX_SOURCE_URL_LENGTH = 8192` | 设置校验、search 来源规范化、设置页输入校验 | — |

`selectionContract({ namespace, packageName, options, extras })` 返回：`options`（严格对象）、`optionsChange`（其 partial）、`connectionView`（`connectionViewBase.extend(extras)`）、`selection`、`selectionView`、`selectionChange`（必须带 `connectionId` 或 `options` 之一），以及 `remoteInfo`（`createTypertRemoteInfo` 生成、可 `ctx.remote.$mount` 的客户端贡献）。五个方法都是 `invocation: direct`、严格 codec，类型符号为 `<Namespace>SelectionRequest`、`<Namespace>SelectionView` 等。

### 3.2 `./host`（只在 Host）

`index.ts` 把下列模块全部 `export *`。

**[capability.ts](../packages/core/src/host/capability.ts)**——插件交给 core 的全部差异。`Capability<S, O, V, T, Q, R>`（S 已解析设置、O 会话参数、V 不含密钥的连接视图、T 一次调用的执行目标、Q/R 原生请求/结果）的实际字段：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `identity` | `PluginIdentity` | 包名、行 id、provider id（来自 `ids.ts`） |
| `tool` | `'web_search' \| 'web_fetch'` | 关闭时要隐藏的工具 |
| `field` | `'searchProvider' \| 'fetchProvider'` | `web` 行里判断路由的字段 |
| `remoteNamespace` | `string` | `searchConnections` / `fetchConnections` |
| `storageDomain` | `string` | `web_search_enhanced` / `web_fetch_enhanced` |
| `contract` | `HostContract<O>` | 只需 `selectionChange` 的 zod schema |
| `optionsCodec` | `OptionsCodec<O, S>` | `initial(settings)`、`fromRecord(record, settings)`、`toRecord(partial)`；只编码会话参数，不含 `connectionId` / `revision` / `inherited` |
| `settings()` | `() => S` | 每次调用读当前运维设置；无效时抛给模型看的 `WebError` |
| `describe(settings, agent)` | `Promise<V[]>` | 连接状态，不含凭据引用 |
| `target(connection, options, call)` | `T` | core 复查可选性后，每次调用新建执行目标；不缓存 |
| `execute(target, request, call)` | `Promise<R>` | 执行 |
| `register(ctx, invoke)` | `void` | 注册唯一的原生 provider，`available()` 必须本地且恒真 |

另有 `CapabilitySettings`（`defaultConnection` + `connections: ReadonlyMap`）、`ConnectionOf<S>`、`CapabilityCall = { ctx, agent, signal }`（Agent 只来自 `currentInitiator()`，从不来自工具参数）、`CapabilityInvoke<Q, R>`。

**[runtime.ts](../packages/core/src/host/runtime.ts)**——`installCapability(ctx, capability)` 装配一切，返回只读的 `CapabilityRuntime<O> = { plan(agent?) }`：

1. 用 `capabilityErrors(packageName, '<kind> aborted')` 建错误工厂；建 `SessionStorage`、`Pairings`、`ToolRestriction`（`routed` = `routeFacts(...).kind === 'this'`，`selection` = `sessions.peek`）、`Sessions`、`Snapshots<Plan<O>>`；
2. `agent/request`：按 (Agent, turn, step) 捕获计划后再 `next()`；`agent/created`：以 turn = step = -1 捕获一次；`agent/disposed`：忘记快照并撤销限制。捕获 = `sessions.current(agent)`（可被 signal 取消）→ `restriction.sync` → `planFor(selection)`；异常只记日志，得到 `failed` 计划；
3. `ctx.inject(['sessionController', 'typert'])` 后用 `createConnectionsService` 挂 Remote；
4. `plan(agent)`：插件已释放 → `failed`；有 Agent → 取它本步的快照（没捕获过为 `undefined`）；没有 Agent → 按当前 `defaultConnection` 与 `optionsCodec.initial` 现算；
5. `capability.register(ctx, invoke)`；`invoke` 的判定顺序见第 7.1 节的管线图。

**会话与存储**：

| 模块 | 导出 | 关键行为 |
| --- | --- | --- |
| [sessions.ts](../packages/core/src/host/sessions.ts) | `Sessions`、`CurrentSelection`、`SessionChange`、`SelectionConflict` | 同一会话的读写经 `exclusive` 排队；`current` 会落盘（revision 0 的记录也写，便于 fork 复制），`peek` 只读不建记录；fork（`parentSession` 且 `isSeeded`）先解析父会话，再复制为 revision 0 + `inherited: true`；未选择时按"模型记忆（`null` = 关闭）→ `defaultConnection`"解析，记忆指向不可选的连接时跳过；`change` 在 `table.update` 里比较 revision（不符抛 `SelectionConflict`）、revision + 1、立即 `restriction.sync`，只在改了 `connectionId` 时写模型记忆，记忆写失败只记日志 |
| [storage.ts](../packages/core/src/host/storage.ts) | `StoredSelection`、`selectionDomain(name)`、`openDomain`、`SessionStorage`、`DomainAccess` | 域定义见第 8.5 节；懒打开，`storageDomain` facility 更换后下次读取重开，打开失败下次可重试；插件释放时关闭 |
| [pairings.ts](../packages/core/src/host/pairings.ts) | `Pairings` | `get` / `set` / `list` / `forget`，键为 `JSON.stringify([provider, model])` |
| [plans.ts](../packages/core/src/host/plans.ts) | `Plan<O>`（`off` / `failed { error }` / `ready { connectionId, options }`）、`planFor`、`Snapshots` | 只冻结连接 id 与会话参数（`structuredClone`）；`Snapshots` 以 `WeakMap<Agent>` 存 (turn, step)，同一步的并发捕获共享一次，只有 `failed` 计划可在同一步重试 |
| [selectable.ts](../packages/core/src/host/selectable.ts) | `ConnectionBase`、`Selectable<C>`、`isSelectable` | 存在、未停用、不是 `model`；模型记忆、Remote `set`、每次调用、fetch 的白名单提示都只用它 |
| [model.ts](../packages/core/src/host/model.ts) | `SessionModel`、`ACCOUNT_PROVIDER = 'deepseek-account'`、`nextModel`、`requestModel` | `nextModel`：`sessionProjections` 的 `modelSelection.pending` → 上次请求头 → Agent 选项；`requestModel`：当前请求上下文（只用于账号鉴权） |

**路由与限制**：

| 模块 | 导出 | 关键行为 |
| --- | --- | --- |
| [route.ts](../packages/core/src/host/route.ts) | `providerView(providerId, field)`、`routeFacts(ctx, field, providerId)`、`WebField` | 只读 `settings.describe()` 里 `ns = web` 的公开值和 `process.env` 的 `DSH_WEB_*_PROVIDER`，交给 `routeOf`；不嗅探 Loader 树 |
| [restriction.ts](../packages/core/src/host/restriction.ts) | `ToolRestriction`、`RestrictionOptions` | 每个实例只管自己装的限制；`sync(agent, connectionId)`：选择非 `null` 或未路由时撤销，否则在 Agent 自己的视图（`agent.ctx.get('tools')` + `scopeOf(agent.ctx)`）里确有该工具时才 `tools.restrict({ deny: [tool] })`；`settings/document-updated` 且 `ns = web` 时对已知 Agent 重算（路由离开时不读存储，直接撤销）；释放后 `active = false`，不再安装 |

**Remote 与设置行**：

- [remote.ts](../packages/core/src/host/remote.ts)：`createConnectionsService(ctx, { namespace, contract, sessions, pairings, providerView })` 在函数体内声明 `class Service extends TypertRemoteService`，方法带 `@Remote`（`get` / `set` 声明 `resources: { session }`，按被寻址的会话授权），每次安装一个新类。请求先用 zod 解析，失败报 `gateway/bad-request`；`set` 的连接不可选报 `<ns>/unavailable`（详情含 `connectionId`），`SelectionConflict` 映射为 `<ns>/conflict`；会话经 `ctx.sessionController.resolveAgent` 找到 Agent。五个方法都包在 `boundary(method, run)` 里：`remoteErrorOf(error)` 认得的错误（上面几种与 sessionController 给出的）原样抛出；`InvalidSettingsError` 改抛 `<ns>/invalid-settings`（“the row settings are invalid; fix them on the settings page”，详情为空，不记 warn）；其余用 `ctx.logger.warn('<ns>/<method> request failed: %s', error)` 记下，改抛 `gateway/internal`（“connection request failed; retry or check the Host logs”，详情为空）。
- [settings-row.ts](../packages/core/src/host/settings-row.ts)：`settingsRow({ identity, capabilityLabel, retiredFields, secretFields, resolve })` → `{ Config, apply }`。`Config` 是 schemastery 对象，`SETTINGS_FIELDS` 与退役字段都声明为 `z.any().volatile()`（`secretFields` 另加 `role('secret')`），校验全部交给 `resolve`。`apply(ctx, config, install)`：启动时校验一次（无效只记日志，插件照常激活）；挂 `internal/config` 钩子，对本 fiber 的候选配置先 `resolve`，失败即拒绝写入；调用 `settings.configure({ auto: false }, ctx.fiber)`；再把"每次调用都重新 `resolve`、失败时抛 `InvalidSettingsError`（`WebError` 子类，码 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`，消息 `<cap> settings are invalid; ask the user to fix them on the settings page`）"的 `settings()` 闭包交给 `install`。

**凭据、错误与传输**：

| 模块 | 导出 | 关键行为 |
| --- | --- | --- |
| [credentials.ts](../packages/core/src/host/credentials.ts) | `resolveApiKey`、`nativeAuth`、`credentialReadiness`、`accountTokenFor` | 见第 8.6 节 |
| [errors.ts](../packages/core/src/host/errors.ts) | `CapabilityErrorCode`（只含 DSH 已有的 `WEB_*` 码）、`OnDiagnostic`、`capabilityErrors(prefix, abortedMessage)` → `{ error, aborted, abortable, throwIfAborted }` | 消息形如 `<包名>: <简短英文提示>`；诊断（cause）只经 `OnDiagnostic` 进日志，不挂在给模型的错误上 |
| [native.ts](../packages/core/src/host/native.ts) | `restateNative(messages, prefix)`、`nativeBackend(upstream, invoke, restate, onDiagnostic)` | 原生 provider 的错误只按已知码换成能力自己的固定消息，未知码一律 `WEB_PROVIDER_ERROR` |
| [transport.ts](../packages/core/src/host/transport.ts) | `createTransport(errors, { timeoutMs, maxResponseBytes, messages })` → `{ withDeadline, send, discard, readText, readJson, requestJson, invalidResponse }`；`HttpRequest`、`Upstream`、`TransportMessages` | 全局 `fetch` + `redirect: 'error'`；一个截止时间覆盖鉴权、握手与读正文；先看 Content-Length 再在流上计数；401/403 按访问方式给不同提示，402、429 与其他状态各有提示；不重试 |
| [mcp.ts](../packages/core/src/host/mcp.ts) | `createMcpClient(transport, errors, { clientInfo, messages })` → `McpClient { callTool(call, signal, upstream) }`；`McpToolCall`、`McpToolResult`、`McpMessages`（`toolFailed(label)`、`serverError`）、`toolTexts`、`toolJson` | 经传输的 `send` 发一次 `tools/call`；`handshake` 时先 `initialize`（协议版本 `2025-06-18`，`clientInfo` 由能力给出）与 `notifications/initialized`，会话 id 与协议版本只在这一次调用内有效；JSON 回复按 id 匹配（含批量）；SSE 逐字符扫描、遇 CR / LF 结束一行（CR 之后的 LF 跨分块也只跳过一次），空行结束一个事件，匹配到 id 即停读，最后一个没有空行的事件也接受；`isError` → `WEB_PROVIDER_ERROR` + `toolFailed(label)`，JSON-RPC 错误 → `serverError` |
| [adapter.ts](../packages/core/src/host/adapter.ts) | `Auth`、`McpRoute`、`AdapterWire`、`KeylessBound`、`AdapterTarget`、`adapterTarget`、`AdapterIO`、`runAdapter`、`postJson`、`getJson`、`bearer`、`apiKeyHeader`、`isRecord` | 两侧远程后端共用的请求/解析线（architecture 6.7）。`adapterTarget(connection, catalogEndpoint)` 让 keyless 总是发往目录端点、不带凭据引用。`runAdapter` 在 `withDeadline` 内：keyless → `'rest'` 用 keyless 身份发 `request`，或经 `mcp.callTool` 调 MCP 路由，不读凭据；api-key → `credential(ref)`（可被取消）去首尾空白，为空报 `credentialMissing(ref)`、含 `[\x20-\x7e]` 以外的字符报 `credentialInvalid(ref)`（都是 `WEB_PROVIDER_CREDENTIAL_MISSING`，不发请求、不进诊断），再 `requestJson` → `parse`；不改写非 `WebError`。请求辅助：`postJson(url, headers, body)`；`getJson(url, query, headers?)` 在内部构造 URL 并写入查询参数（两者的 `url` 都是字符串） |

### 3.3 `./client`（只在浏览器）

**分区契约 [section.ts](../packages/core/src/client/section.ts)**（只有类型），并用 `declare module '@deepseek-ai/cordis'` 给 `Context` 加上 `webConnections: WebConnectionsService`：

| 类型 | 字段 |
| --- | --- |
| `SelectionState<V>` | `view`（首次读取成功前为 `undefined`）、`saving`、`readFailure: 'invalid-settings' \| 'failed' \| undefined` |
| `SelectionStore<V>` | `source(sessionId)`（稳定的 `ObservableSnapshot`）、`load(sessionId, modelKey?)`、`set(sessionId, { connectionId?, options? })` → `WriteResult` |
| `RouteStore` | `source: ObservableSnapshot<Route>` |
| `ConnectionText` | `label`、`caption?`、`reason?` |
| `CapabilityName` | `'search' \| 'fetch'` |
| `ConnectionSection` | `capability`、`order`、`title()`、`selection`、`describe(connection)`、`sourceText(view)`、`writeFailureText(error)`、`Options?`（`ComponentType<{ sessionId }>`）、`settings: ObservableSnapshot<(() => void) \| undefined>`；路由事实不在分区里，经 `registerRoute` 单独提供 |
| `WebConnectionsService` | `registerRoute(capability, route)` → 注销函数（路由事实，与分区无关）；`routes: ObservableSnapshot<ReadonlyMap<CapabilityName, Route>>`（没有条目 = 没有运行中的插件提供它）；`register(section)` → 注销函数；`sections: ObservableSnapshot<readonly ConnectionSection[]>`（按 `order` 排序） |

**状态源**（都是"有观察者才读 Host、用 epoch 丢弃过期回答"的可观察快照）：

| 模块 | 导出 | 关键行为 |
| --- | --- | --- |
| [use-observable.ts](../packages/core/src/client/use-observable.ts) | `useObservable(source)` | `useSyncExternalStore`，每个 source 只订阅一次 |
| [selection.ts](../packages/core/src/client/selection.ts) | `ConnectionSelectionStore<V>`（实现 `SelectionStore`，另有 `refresh`、`current`、`invalidate`）、`SelectionRemote`、`CapabilitySelectionUpdate` | 每会话一个条目；`load` 只在缺失、过期或会话模型（`modelKey`）变化时读；并发读合并；读取失败时按错误码记 `readFailure`（`<ns>/invalid-settings` → `'invalid-settings'`，其余 `'failed'`）；`set` 以视图里的 revision 作 `expectedRevision`，被拒后重读；`invalidate` 让被观察的会话立即重读；写入成功后调用构造时传入的 `changed`（两侧用它刷新模型记忆） |
| [route.ts](../packages/core/src/client/route.ts) | `RouteStatus(webForm, field)`（`attach(remote)`、`refresh()`）、`clientRoute`、`WebSelection`、`ProviderRemote` | `configForms.get('web')` 的快照 + `<ns>/provider` 的两个事实，交给 `routeOf`；只在路由真的变化时发布 |
| [pairings.ts](../packages/core/src/client/pairings.ts) | `PairingsStatus`（`loading` / `ready` / `failed`；`refresh`、`forget`、`invalidate`） | 经 `<ns>/pairings`、`<ns>/forgetPairing` |
| [credentials.ts](../packages/core/src/client/credentials.ts) | `CredentialStatus<S>(settings, describer, refs)` → `configured` / `missing` / `unknown` | 只调 `remote.credentials.describe(refs)`，从不读值；设置无效时不查询 |

**命令 [command.ts](../packages/core/src/client/command.ts)**：`selectionCommand(store, spec)` 生成 `popupSelect` 形式的 `CommandContribution`。选项 id 固定为 `off` 与 `connection:<id>`（`parseSelectionCommandOption` 先认这两种，能力的选项组不能遮蔽它们），只列 `ready` 的连接；读取失败（含设置无效）时报 `readFailed` 文案；能力可经 `spec.options`（`choices` / `parse` / `isCurrent`）追加自己的选项组；选中当前值时不写；写入失败抛 `writeFailureText`。文案经 `spec.t` 与 `spec.keys`（`CommandCopyKey` → 插件的 locale 键）。

**设置文档 `settings/`**：

| 模块 | 导出 | 关键行为 |
| --- | --- | --- |
| [document.ts](../packages/core/src/client/settings/document.ts) | `effectiveDocument`、`editableSettings`、`settingsOperations`、`useSettingsDocument`、`SettingsDocumentView` | 用 `ConfigForm` 快照原始的 `base` / `user` 两层深合并（保留未知与危险键，交给共享校验器）；`editableSettings` 迁移并校验，得 `ready`（含 `needsWriteback`：可写且版本较旧）或 `invalid { diagnostic }`；`settingsOperations` 对"写入后的完整候选文档"校验，含 `set` 而候选没有 `version` 时补写 `version: 2`，失败抛 `SettingsValidationError`；`useSettingsDocument` 返回 `{ view, write, migrationError }`，对每个 revision 至多写回一次迁移结果 |
| [sparse.ts](../packages/core/src/client/settings/sparse.ts) | `createSparseSettings({ version, fields })` → `{ documentVersion, sparseSettingOperations, resetSettingsOperations }`；`SettingsLayers` | 只写与下层（或目录缺省 `fallback`）不同的部分，回到继承值时 `unset` 并修剪空对象；版本不是当前版本时拒绝普通编辑；Reset = 对用户层每个顶层键 `unset` |
| [secret-diagnostics.ts](../packages/core/src/client/settings/secret-diagnostics.ts) | `withRetiredSecretDiagnostics(form, describe, ns, retiredFields, format)`、`SettingsDocumentSnapshot` | 包一层 `ConfigForm`：`configForms.describe()` 报告某个退役的密钥字段已设置时，给快照加 `diagnostic`（密钥值被遮蔽，页面不猜它在哪一层） |
| [injected.ts](../packages/core/src/client/settings/injected.ts) | `SettingsPageInjected<S>` | 设置页从插槽拿到的注入：`hooks { settings, credentials, route, pairings }`、`mutate(ops, revision)`、`saveCredential(ref, value)`、`refreshPairings`、`forgetPairing` |
| [fields.ts](../packages/core/src/client/settings/fields.ts) | `OptionField`（可选 `hint`：字段下方的说明，经 `aria-describedby` 关联）、`FieldTexts`、`fieldText`、`isValidText`、`fieldValue`、`applyFields` | 编辑器文本 ↔ 存储值；空文本表示缺省；整数只接受规范的十进制写法（无前导零、无 `-0`、无指数）且须是安全整数 |
| [model.ts](../packages/core/src/client/settings/model.ts) | `SettingsCatalog`、`AdapterKeyOf<T>`、`CatalogSettings`、`Choice`、`OptionCopy`（`label`、可选 `placeholder` 与 `hint`）/ `OptionCopyTable`、`catalogEntry`、`adapterKeys`、`builtinOverride`、`customConnections`、`builtinAccess`、`builtinCredential`（`{ ref, catalogRef }`）、`credentialRefs`、`connectionChoices`、`connectionName`、`catalogFields`、`keylessRejected` | 页面从“已校验的文档 + 能力目录”推导的只读事实，一律按目录键，新目录项不用改页面代码；`catalogFields(rules, access, copy)` 跳过 `list`，keyless 时去掉 `keyless: false` 的参数、收窄枚举，并报告 `restricted`；`keylessRejected` 用同一规则（`keylessScope`）列出已存参数里 keyless 不接受的部分，切到 keyless 时一并清掉 |
| [connection-form.ts](../packages/core/src/client/settings/connection-form.ts) | `createConnectionForm({ catalog, optionCopy })` → `{ adapters, formFields, needsTrust, destination, buildConnection }`；`ConnectionForm`、`FormError`、`BuildResult`、`emptyForm`、`formOf`、`suggestCredentialRef` | 目录的 adapter 项就是可选格式；参数按 api-key 规则；端点或 `url` 参数不同于目录端点时 `needsTrust`，没有同意就报 `trust`；`destination(form)`（格式、端点与 `url` 参数）是同意绑定的对象；保留已有连接的 `disabled` |
| [parts.tsx](../packages/core/src/client/settings/parts.tsx) | `createSettingsParts({ classes, keys })` → `{ Section, SettingRow, SelectMenu, ErrorText, ConfirmRow, useWrite }`；`classNames`、`applyOps`、`SettingsValidationError`、`SettingsDoc`、`WriteSettings`、`WriteState`、`SelectOption` | `useWrite` 统一记录一次写入的忙碌态与错误（被拒 / 校验失败 / 传输失败三种文案） |

`index.ts` 只导出插件实际调用的部分：上面的状态源、命令、`createSparseSettings`、`createSettingsParts` 与几个部件、各 `create*Section` / `createCredentialEditor` / `createOptionsEditor` / `createRouteNotice` 工厂与它们的文案键类型、`builtinOverride`、`catalogFields`、`connectionChoices`、`connectionName`、`credentialRefs`、文档视图与 `withRetiredSecretDiagnostics`；字段辅助、表单与编辑器、其余目录辅助只在模块内部使用（测试从模块文件直接导入）。

**设置页骨架的组件工厂**。core 不带词典和样式；每个工厂在插件模块加载时调用一次，注入：`classes`（插件的 CSS Modules 类名表）、`keys`（core 定义的文案键 → 插件 `LocaleKey` 的映射表）、`parts`（上面的共享部件）、`sparse`（插件用 `createSparseSettings` 建的实例），以及能力特有的数据与回调；组件渲染时再接收 `t`。

| 工厂 | 额外注入 | 产出 |
| --- | --- | --- |
| `createCredentialEditor` | — | 只写的密钥输入：值经 `saveCredential` 进 DSH Credentials |
| `createOptionsEditor` | `valueLabel` | `{ OptionFields, OptionsForm }`：逐项自动保存的参数表单；枚举与 boolean 都是带“默认”项的菜单（boolean 为默认 / 开 / 关，默认 = unset）；文案键 `OptionsCopyKey` |
| `createServicesSection` | `CredentialEditor`、`optionsEditor`、`catalog`、`optionCopy(key)`，可选 `label(key, t)`、`notes`（每个目录键一条说明的文案键）、`summaries`（按目录键覆盖行副标题的访问摘要）、`extras`（按目录键注册的 `ExtraEditor { options, Editor }`，`options` 是它接管、通用表单不再显示的参数） | 目录驱动的内置连接列表：每项的启用开关、状态点（只反映配置）、访问方式切换（目录同时有 keyless 与 API key 时）、凭据名称（`ServiceFields` 的 `CredentialRefField`，清空回到目录名）与只写的密钥、获取密钥的链接、`url` 参数与信任开关（`UrlOptionField`）、其余参数的自动保存表单；行的副标题只显示访问方式摘要，远程项的 `services.remoteNotice` 只在展开面板里出现一次；切到 keyless 时同一次写入 unset `keylessRejected` 的参数。写入规则见 architecture 9.1 |
| `createServiceFields`（由上面的工厂内部调用） | — | `CredentialRefField`；`UrlOptionField`：同意绑定到地址，已信任 A 改成 B 时开关显示为关、不写入并显示 `services.trustUnsaved`；关闭生效中的信任时一次写入清掉该连接所有非官方 `url` 参数并写 `trustedEndpoint: false`（下层也有非官方值时在用户层写官方值）；清空地址即回到官方值 |
| `createDefaultsSection` | — | 默认连接选择 + render-prop `children({ disabled, save })`，放能力自己的默认项 |
| `createCustomConnectionsSection` | `CredentialEditor`、`optionsEditor`、`catalog`、`optionCopy`、`defaultConnection`（目录缺省） | 自定义连接列表与编辑器（`createConnectionEditor` 建在 `createConnectionForm` 上）；目录没有 adapter 项时不渲染。每行写明 `services.remoteNotice`，name 为目录服务名，端点不是目录端点时附主机名。编辑器记住打开时的 layers 与 revision，同意绑定到 `destination`（编辑已信任且目的地未变的连接时保持已同意），可选的密钥在连接保存后写入 Credentials；只有删除的 id 正是 `defaultConnection` 时才在同一次写入里复原默认 |
| `createPairingsSection` | `formatConnectionName` | 模型记忆列表与逐条清除 |
| `createResetSection` | — | 确认后执行 `resetSettingsOperations` |
| `createRouteNotice` | 可选 `other(route, t)` | 路由不是 `this` 时的提示 |


## 4. packages/search-enhanced

**职责**：注册 `ctx.web` 的 search provider `search-enhanced`（行 `web-search-enhanced`），按会话选择在 8 个内置连接与运维自定义连接之间切换。包里只保留 search 特有的部分：目录、各 adapter 的请求与解析、来源规范化、`native` 后端、实时性（freshness）、`settings/resolve.ts` 与把 core 组装成 search 能力的 `src/host/`；其余来自 core。

`package.json` 要点：

- `exports`：`.` → `lib/index.js`（Host），`./client` → `lib/client.cjs`，另有 `./locale/*.json`、`./icon.svg`、`./package.json`；`files` 只含 `lib/index.js`、`lib/client.cjs(.map)`、locale、icon、README；`sideEffects: false`。
- `dsh.client`：`platform: web`，`inject` 为浏览器面需要壳先加载的 DSH 客户端包：`dsh-client-locale`、`dsh-client-ui-renderer`、`dsh-client-ui-settings`、`dsh-client-ui-plugin-manager`、`dsh-api-remotes`、`dsh-client-ui-commands`、`dsh-client-ui-conversation`、`dsh-client-ui-session`。
- `peerDependencies`（DSH 包的范围都等于 `engines.dsh`；`cordis` 为 `~4.0.5`，`schemastery` 为 `^3.18.5`，React `^18.2.0`），按用途分三类：
  - Host 运行时导入（出现在 `lib/index.js`）：`dsh-credentials`、`dsh-launch-environment`、`dsh-scope`、`dsh-storage-domain`、`dsh-typert-protocol`、`dsh-web`、`dsh-web-deepseek-api`、`dsh-web-search-deepseek`、`schemastery`；
  - Host 只做类型 / 服务增强：`cordis`、`dsh-agent`、`dsh-api-session-controller`、`dsh-session`、`dsh-settings`、`dsh-tools`；
  - 浏览器面，`peerDependenciesMeta` 标为 optional：`dsh-api-remotes`、`dsh-client-locale`、`dsh-client-store`、`dsh-client-ui-*`（commands、conversation、plugin-manager、primitives、renderer、session、settings、slots）、`dsh-deepseek-account`、`react`、`react-dom`。
- 没有 `dependencies`；core 与 zod 是 devDependency，构建时内联。

~~~text
packages/search-enhanced/src/
  index.ts            Cordis 插件入口：name、inject ['web']、Config、apply
  seat.ts             createSearchSeat
  contract.ts         selectionContract('searchConnections') + Remote 类型增强
  catalog.ts          CATALOG（8 项）、FRESHNESS、NATIVE_KEYS、ADAPTER_KEYS、honorsFreshness、DEFAULT_CONNECTION
  settings/           resolve.ts retired.ts types.ts version.ts
  host/               runtime.ts connections.ts options.ts remote.ts
  backends/           common.ts native.ts deepseek-messages.ts deepseek-search-api.ts
  search/             execute.ts http.ts sources.ts errors.ts
    adapters/         types.ts index.ts tool-rows.ts exa.ts firecrawl.ts tavily.ts tinyfish.ts openalex.ts semanticscholar.ts
  client/             index.tsx command.ts connections.ts credentials.ts injected.ts locales.ts pairings.ts
                      route.ts section.ts Section.module.css selection.ts css-modules.d.ts
    settings/         SettingsPage.tsx model.ts CustomConnections.tsx DefaultsSection.tsx ServicesSection.tsx
                      PairingsSection.tsx OptionsEditor.tsx CredentialEditor.tsx parts.tsx sparse.ts Settings.module.css
packages/search-enhanced/tests/   21 个 spec + fixtures/core-host.ts、fixtures/unified-settings.yml
~~~

### 4.1 Host：入口、目录、设置

| 模块 | 导出 / 内容 | 被谁用 | 关键不变量 |
| --- | --- | --- | --- |
| [index.ts](../packages/search-enhanced/src/index.ts) | `name = SEARCH.rowId`、`inject = ['web']`、`Config`（`settingsRow` 生成，`secretFields: ['apiKey']`）、`apply(ctx, config)` → `row.apply(ctx, config, installSearch)`；再导出 `resolveSettings` | DSH Loader | 设置无效也照常激活 |
| [catalog.ts](../packages/search-enhanced/src/catalog.ts) | `CATALOG`（`SearchDescriptor` = `Descriptor` + `endpoint` + `freshness: AccessMode[]`），顺序即显示顺序 | Host、设置页、测试 | `satisfies Record<string, SearchDescriptor>`；`NATIVE_KEYS` / `ADAPTER_KEYS` 写死 |
| [contract.ts](../packages/search-enhanced/src/contract.ts) | `contract = selectionContract({ namespace: 'searchConnections', options: { freshness }, extras: { freshness: z.boolean() } })`、`searchOptions`、视图类型；增强 `TypertRemoteMap`、`TypertRemoteNamespaceMap`、`RemoteErrorDetailsMap` | Host Remote、浏览器 store | 两端解析同一份 schema |
| [settings/resolve.ts](../packages/search-enhanced/src/settings/resolve.ts) | `resolveSettings(document)` → `ResolvedSettings`（`ResolvedDocument<{ freshness }, Connection>`）；`Connection` = `NativeConnection { native }` \| `AdapterConnection { adapter, endpoint }` | Host（经 `settingsRow`）、浏览器（设置页、凭据状态） | 纯函数；`resolveDocument({ defaults: { freshness 缺省 auto }, retiredFields })` 之上派生连接形状；目录不能含 `local` |
| `settings/retired.ts` | `RETIRED_FIELDS`（15 个 0.1.x 顶层字段，第 8.2 节） | `index.ts`、浏览器 | 只为让 Settings 暴露它们以便诊断与 Reset |
| `settings/types.ts`、`version.ts` | `SearchSettings`（文档的 TS 形状）、`CustomConnection`（core 的 `CustomConnection<AdapterKey>`）、`CURRENT_CONFIG_VERSION` | 浏览器面 | — |

目录（`builtin:<键>`，默认连接 `builtin:deepseek-messages`）：

| 键 | kind | 端点 | 访问方式 | 参数（`OptionRule`） | 实时性 |
| --- | --- | --- | --- | --- | --- |
| `deepseek-messages` | native | `https://api.deepseek.com/anthropic/v1` | API key `DEEPSEEK_API_KEY` 或 DeepSeek 账号 | `baseURL`（url）、`model`、`apiVersion`（text）、`maxTokens`、`maxUses`（integer ≥ 1） | 不支持 |
| `deepseek-search-api` | native | `https://api.deepseek.com/v1/tools` | 同上 | `baseURL`、`count`（1–50）、`sendOriginalQuestion`（boolean） | 不支持 |
| `exa` | adapter | `https://api.exa.ai/search` | keyless（MCP）/ `EXA_API_KEY` | `type`（enum，keyless 不可用） | 仅 api-key |
| `firecrawl` | adapter | `https://api.firecrawl.dev/v2/search` | keyless（REST）/ `FIRECRAWL_API_KEY` | `country`、`location`、`safe` | keyless 与 api-key |
| `tavily` | adapter | `https://api.tavily.com/search` | keyless（REST + `x-tavily-access-mode`）/ `TAVILY_API_KEY` | `search_depth`、`topic` | 不支持 |
| `tinyfish` | adapter | `https://api.search.tinyfish.ai` | keyless（MCP）/ `TINYFISH_API_KEY` | `location`、`language`、`purpose`、`domain_type`（keyless 只允许 web / news） | 不支持 |
| `openalex` | adapter | `https://api.openalex.org/works` | keyless（REST）/ `OPENALEX_API_KEY` | `sort`、`filter`、`is_oa`、`mailto` | 不支持 |
| `semanticscholar` | adapter | `https://api.semanticscholar.org/graph/v1/paper/search` | 只有 `SEMANTIC_SCHOLAR_API_KEY` | `year`、`fieldsOfStudy`、`publicationTypes` | 不支持 |

### 4.2 Host：能力装配

| 模块 | 导出 | 关键行为 |
| --- | --- | --- |
| [host/runtime.ts](../packages/search-enhanced/src/host/runtime.ts) | `searchCapability(ctx, settings)`、`installSearch(ctx, settings)` | `target`：adapter 连接 → `{ kind: 'adapter', connection, freshness }`；native → `{ kind: 'native', provider: createNativeBackend(...) }`（每次新建）。`execute` → `executeSearch`，凭据由 `resolveApiKey` 提供。`register` → `scope.web.registerSearchProvider(createSearchSeat(...))` |
| [seat.ts](../packages/search-enhanced/src/seat.ts) | `createSearchSeat(id, select)` | `available: () => true`；`search` 转给 `select()` 的结果 |
| [host/connections.ts](../packages/search-enhanced/src/host/connections.ts) | `describeConnections(ctx, settings, agent)` | keyless → `ready` / `disabled`；其余用 core 的 `credentialReadiness`（native 的端点取 `options.baseURL` 或目录端点，用于账号令牌判断）；视图带 `freshness`（该 adapter 在当前访问方式下是否支持） |
| [host/options.ts](../packages/search-enhanced/src/host/options.ts) | `optionsCodec`、`SearchOptions = { freshness }` | 记录里保留前身的扁平 `freshness` 字段；缺席时补当前 `defaults.freshness` |
| `host/remote.ts` | `SearchConnectionsService` 类型与 `Context.searchConnections` 增强 | 只有类型 |

### 4.3 Host：后端与执行

- [search/execute.ts](../packages/search-enhanced/src/search/execute.ts)：`executeSearch(target, request, deps, signal)`。native 目标直接调 provider 再 `normalizeResult`（不套本插件的截止时间，原生 provider 自管传输与上限）；adapter 目标交给 core 的 `runAdapter`，目标由 `adapterTarget(connection, 目录端点)` 构造（keyless 总是目录端点，api-key 用连接的端点，自定义连接可不同），输入带上只在当前访问方式支持时生效的实时性。凭据缺失与非法的文案在这里给出（“no API key is stored for <ref>…”“the API key stored for <ref> is malformed…”）。非 `WebError` 的异常进诊断日志，统一改写为 `WEB_PROVIDER_ERROR`；已取消时优先报 `WEB_ABORTED`。
- [search/http.ts](../packages/search-enhanced/src/search/http.ts)：用 core 的 `createTransport` 建 search 的传输（`MAX_RESPONSE_BYTES = 2 MiB`、`TIMEOUT_MS = 90 000`，“2 MiB”“90 s”由常量生成）与 MCP 客户端（`createMcpClient`，`clientInfo` 为包名与 `__PLUGIN_VERSION__`，`toolFailed` 为 “<label> could not complete the search…”）。
- [search/sources.ts](../packages/search-enhanced/src/search/sources.ts)：不可信行 → DSH 来源。`SourceList` 按规范化 href 去重（只补首次缺的字段），标题至多 1000 字符、摘要至多 `MAX_SNIPPET_LENGTH = 4000`，日期只接受 ISO 形式；`normalizeResult` 对 native 与 adapter 结果一视同仁；另有 `collect`、`firstSourceUrl`、`authors`、`summary` 等辅助。
- `search/errors.ts`：`searchErrors = capabilityErrors(SEARCH.packageName, 'search aborted')` 与 `SearchErrorCode`。
- [search/adapters/types.ts](../packages/search-enhanced/src/search/adapters/types.ts)：`SearchInput`、`Adapter = AdapterWire<SearchInput, WebSearchSource[]>`、`McpRoute`、`AdapterFor<K> = KeylessBound<…>`（目录标为 keyless 的项缺 keyless 路由即编译失败），以及 search 自己的辅助 `count`、`rowsAt`、`envelope`；`Auth` 与请求辅助来自 core。`tool-rows.ts` 的 `toolRows` 从 MCP 结果里读出搜索行（`structuredContent` 或 JSON 文本），Exa 与 Tinyfish 的 keyless 路由用它。`adapters/index.ts` 的 `ADAPTER_WIRES satisfies { [K in AdapterKey]: AdapterFor<K> }` 绑定目录与实现。
- 六个 adapter：`exa`（REST 带 `contents.text.maxCharacters`，按实时性加 `maxAgeHours`；keyless 走 `https://mcp.exa.ai/mcp` 的 `web_search_exa`，需握手，工具文本有长度与行数预算）、`firecrawl`（v2，实时性用 `scrapeOptions.maxAge`，keyless 同一 REST）、`tavily`（keyless 加 `x-tavily-access-mode: keyless`）、`tinyfish`（REST GET；keyless 走 `https://agent.tinyfish.ai/mcp` 的 `search`，免握手）、`openalex`（GET，缺省 `mailto`，从倒排索引有界地重建摘要）、`semanticscholar`（GET，只有 api-key）。
- 原生后端 `backends/`：`common.ts` 定义 `NATIVE_MESSAGES`（6 个码的固定提示）、`restateNativeError` 与包装函数 `nativeBackend`（core `nativeBackend` + `normalizeResult`）；`deepseek-messages.ts` 用 `DeepSeekSearchProvider`（选项每次调用经 getter 读：`nativeAuth`、`baseURL` 缺省取启动环境的 `DEEPSEEK_SEARCH_BASE_URL` 否则 DSH 默认、`model` / `apiVersion` / `maxTokens` / `maxUses` 缺省用 DSH 常量；`recordRequest` 把请求追加到发起会话的 `web/deepseek-search-llm-request`）；`deepseek-search-api.ts` 用 `DeepSeekSearchApiProvider`（`count` 缺省 DSH 常量；除非 `sendOriginalQuestion: false`，把会话里最近一条用户消息作为 `originalQuestion`）；`native.ts` 的 `createNativeBackend(ctx, key, overrides)` 按键二选一。

### 4.4 浏览器面

[client/index.tsx](../packages/search-enhanced/src/client/index.tsx) 的 `inject` 为 `['connection', 'slots', 'locale', 'configForms', 'remote', 'remote.credentials']`，`apply` 依次：

1. 注册字典 `NS = 'web-search-enhanced'`；`settings` = `withRetiredSecretDiagnostics(configForms.get(SEARCH.rowId), …)`（用于退役的 `apiKey`）；
2. 可选注入 `pluginNavigation`：提供"打开设置"= `openBundle(PROFILE_PACKAGE)`（rc.2 只公开 `openBundle`）；
3. `await ctx.remote.$mount(contract.remoteInfo)`，再注入 `remote.searchConnections`，在其中创建 `CredentialStatus`、`SearchRouteStatus`（`attach(remote)`）、`PairingsStatus`、`SearchSelectionStore`（写入后刷新模型记忆）；
4. `configForms.whileServed([rowId])` 期间向 `plugins.row.config` 注册 `SettingsPage`，键 `rowConfigKey(SEARCH)`，`inject: () => page`（`SettingsPageInjected`）；
5. 可选注入 `webConnections`：`showSelector !== false` 时注册 `searchSection`（order 10），随设置变化注册 / 注销；
6. 可选注入 `commandUi`：注册 `/setup-search`；
7. 行设置变化、`settings/document-updated`、`credentials/reference-updated`、`connection.generation` 变化时统一 `invalidate`：选择、凭据、模型记忆、路由一起重读。

| 模块 | 导出 | 说明 |
| --- | --- | --- |
| `section.ts` + `Section.module.css` | `searchSection(selection, settings, t)` | `Options` 组件：所选连接支持实时性时用界面原语 `SegmentedControl` 显示实时性选择，写 `{ options: { freshness } }`；不支持时说明会被忽略。样式只用 `--dsw-*` 变量 |
| `command.ts` | `SEARCH_COMMAND = 'setup-search'`、`searchCommand`、`parseCommandOption` | core `selectionCommand` + 实时性选项组（id `freshness:<mode>`，只在所选连接支持时出现） |
| `connections.ts` | `describe`、`sourceText`、`freshnessLabel`、`listText`（按 `list.locale` 用 `Intl.ListFormat` 拼接列表，用于实时性支持的服务列表与退役密钥的字段列表）、`pickerGroups`（隐藏 `disabled`）、`writeFailureText`（按 `searchConnections/conflict` / `unavailable`） | 本地化连接文字：就绪连接的说明行是访问方式摘要（native 与 adapter 都有；`access.keyless` 为 “No key needed / 无需密钥”），远程连接再加 “· the query is sent to <name>”（`status.remoteReady`，与 fetch 一致）；未就绪原因是短句（“Needs an API key”“Needs a DeepSeek account or API key”） |
| `selection.ts` / `route.ts` / `pairings.ts` / `credentials.ts` / `injected.ts` | core 类的薄子类或类型别名 | `CredentialStatus` 的 refs 来自 `resolveSettings` 的每个连接；文档无效时不查询 |
| `locales.ts` | `NS`、`en`、`zh`、`LocaleKey` | 第 8.8 节 |
| `settings/SettingsPage.tsx` | `SettingsPage` | `useSettingsDocument(snapshot, resolveSettings, mutate)`；无效文档只显示 `settings.unsupported` 提示 + Reset；有效时依次：介绍、路由提示（`deepseek-search-api` 有专门文案）、默认值、服务、自定义连接、模型记忆、Reset |
| `settings/model.ts` | `connectionChoices`、`connectionName`、`optionCopy`（每个目录项的参数文案）、`valueLabel` | core `model.ts` 的薄包装加 search 的文案表 |
| `settings/CustomConnections.tsx` | `createCustomConnectionsSection<SearchSettings, typeof CATALOG, LocaleKey>` | 表单与编辑器在 core（3.3） |
| `settings/DefaultsSection.tsx` | 包装 core 工厂 | 额外放 `defaults.freshness` 与 `showSelector` 两项 |
| `ServicesSection` / `PairingsSection` / `OptionsEditor` / `CredentialEditor` / `parts` / `sparse` | 用 search 的 CSS Modules 与键表调用 core 工厂 | `Settings.module.css` 与 fetch 的同名文件完全一致；等宽字体用 `--dsw-font-mono` |

## 5. packages/fetch-enhanced

**职责**：注册 provider `fetch-enhanced`（行 `web-fetch-enhanced`），按会话选择在 6 个内置连接与运维自定义连接之间切换：`builtin:local`（默认，原生等价的本机 HTTP(S) 抓取，可放行运维指定的非公网网段）、`builtin:deepseek-fetch-api`（native），以及四个远程 adapter（Exa、Firecrawl、Tavily、Tinyfish）。没有会话参数。

`package.json` 要点：`exports`、`files`、`dsh.client.inject` 与 search 相同；没有 `dependencies`；`ipaddr.js` 是 devDependency，构建时内联进 Host 产物。peer 分类：

- Host 运行时导入：`cordis`、`dsh-credentials`、`dsh-launch-environment`、`dsh-scope`、`dsh-storage-domain`、`dsh-typert-protocol`、`dsh-web`、`dsh-web-deepseek-api`、`dsh-web-fetch-http`、`schemastery`（`dsh-scope` 与 `schemastery` 来自内联的 core；verify-packages 检查 Host 产物导入的每个 `@deepseek-ai` 包都已声明为 peer）；
- Host 只做类型 / 服务增强：`dsh-agent`、`dsh-api-session-controller`、`dsh-session`、`dsh-settings`、`dsh-tools`，以及 optional 的 `dsh-system-prompt`（白名单提示经可选注入 `systemPrompt`）；
- 浏览器面（optional）：与 search 相同的 `dsh-api-remotes`、`dsh-client-*`、`dsh-deepseek-account`、`react`、`react-dom`。

~~~text
packages/fetch-enhanced/src/
  index.ts            Cordis 插件入口（secretFields 为空）
  contract.ts         selectionContract('fetchConnections', options {}, extras {})
  catalog.ts          CATALOG（6 项）、FetchDescriptor、NATIVE_KEYS、ADAPTER_KEYS、DEFAULT_CONNECTION、DEFAULT_LOCAL_SETTINGS、
                      ALLOWLIST_MAX_ENTRIES、USER_AGENT_PATTERN、MAX_TIMER_DELAY_MS
  prompt.ts           allowlistNotice、registerAllowlistNotice
  settings/           resolve.ts retired.ts types.ts version.ts
  host/               runtime.ts connections.ts options.ts remote.ts
  local/              backend.ts rules.ts address-policy.ts resolver.ts
  backends/           common.ts native.ts deepseek-fetch-api.ts
  remote/             types.ts page.ts errors.ts http.ts execute.ts
    adapters/         index.ts exa.ts firecrawl.ts tavily.ts tinyfish.ts
  client/             index.tsx command.ts connections.ts allowlist-lines.ts injected.ts locales.ts route.ts
                      section.ts selection.ts css-modules.d.ts
    settings/         SettingsPage.tsx model.ts LocalExtras.tsx AllowlistEditor.tsx Allowlist.module.css
                      CustomConnections.tsx DefaultsSection.tsx ServicesSection.tsx PairingsSection.tsx
                      OptionsEditor.tsx CredentialEditor.tsx parts.tsx sparse.ts Settings.module.css
packages/fetch-enhanced/tests/   26 个 spec + fixtures/（composition-host.ts、credentials.ts、http.ts、page.ts、unified-settings.yml）
~~~

### 5.1 Host：入口、目录、设置、装配

| 模块 | 导出 | 关键不变量 |
| --- | --- | --- |
| [index.ts](../packages/fetch-enhanced/src/index.ts) | `name`、`inject = ['web']`、`Config`、`apply` → `row.apply(ctx, config, installFetch)` | 与 search 同形 |
| [catalog.ts](../packages/fetch-enhanced/src/catalog.ts) | `CATALOG`（`FetchDescriptor`：`local` 没有端点，`native` 与 `adapter` 必须有 `endpoint`），顺序即显示顺序；`NATIVE_KEYS`、`ADAPTER_KEYS`、`isCatalogKey`。Tinyfish 的 `ttl` 上限是 `MAX_INT32`（服务没有文档化的上限），`MAX_TIMER_DELAY_MS` 也由它定义。`DEFAULT_LOCAL_SETTINGS` 是原生 `web-fetch-http` 默认值的副本（空白名单、DSH 的 User-Agent、5 000 000 字节、100 000 字符、30 000 ms、5 跳） | 同构：不能导入原生行的 Host 模块；服务端超时参数的上限留在远程截止时间之内 |
| [settings/resolve.ts](../packages/fetch-enhanced/src/settings/resolve.ts) | `resolveSettings` | `resolveDocument({ defaults: strictObject({}) })` 之后按目录项的 `kind` 派生连接：`local` 的参数补上默认值并逐条用 `parseCidr` / `parseHostnameRule` 检查（错误点名第几条）；`native` → `NativeConnection { native, access: 'api-key' }`；`adapter`（内置或自定义）→ `AdapterConnection { adapter, endpoint, access, credentialRef }`。不按键名写死 |
| `settings/types.ts` | `LocalSettings`、`FetchSettings`（`connections` 容纳 `BuiltinOverride \| CustomConnection`）、`CustomConnection`（core 的 `CustomConnection<AdapterKey>`）、`LocalConnection` / `NativeConnection` / `AdapterConnection`、`ResolvedSettings` | — |
| `settings/retired.ts` | `RETIRED_FIELDS`（9 个） | 第 8.2 节 |
| [host/runtime.ts](../packages/fetch-enhanced/src/host/runtime.ts) | `fetchCapability`、`installFetch`（返回 `CapabilityRuntime` 并注册白名单提示） | `target` 是一个 `WebFetchProvider`：`local` → `createLocalBackend(() => connection.options)`，`native` → `createNativeFetchBackend`，`adapter` → `createRemoteBackend(connection, { credential: resolveApiKey, onDiagnostic })`（诊断写 debug 日志，格式 `'%s: fetch failed: %s'`，与 search 相同）；`execute` = `provider.fetch`；`register` 直接 `registerFetchProvider({ id, available: () => true, fetch: invoke })` |
| `host/connections.ts` | `describeConnections` | keyless（`local` 与 keyless 的 adapter）→ `ready` / `disabled`；api-key 的 adapter 用 `credentialReadiness`（不传端点，没有账号路由）；native 用 `credentialReadiness` 并带上 `baseURL` 或目录端点 |
| `host/options.ts` | `optionsCodec`（三个方法都返回 `{}`）、`FetchOptions` | 历史记录里的多余字段被忽略 |
| [prompt.ts](../packages/fetch-enhanced/src/prompt.ts) | `allowlistNotice(rules)`、`registerAllowlistNotice(ctx, runtime, settings)` | 系统提示运行时上下文 `web-fetch-enhanced:allowlist`，排在 `SANDBOX_POLICY` 之后；只在 `routeFacts` 为 `this`、计划为 `ready`、连接可选且是 `local`、`allowCidrs` 非空时给文本；规则先规范化去重，总长预算 2000 字符，超出时改为计数摘要加部分示例 |

### 5.2 Host：`local` 与 native

| 模块 | 导出 | 关键不变量 |
| --- | --- | --- |
| [local/backend.ts](../packages/fetch-enhanced/src/local/backend.ts) | `createLocalBackend(read, logger)` | 每次调用读当前设置、新建 `AddressPolicy` 与 `HttpFetchProvider(settings, resolver)`；先用 `assertLiteralAllowed` 检查 IP 字面量（官方传输会把它判为公网的字面量直接交给代理，且把 `[::7f00:1]` 这类判为公网）；官方抛出的 `WebError` 原样透传，白名单拒绝用本插件的 `WEB_BLOCKED_URL`，其他异常改写为 `WEB_PROVIDER_ERROR` |
| [local/rules.ts](../packages/fetch-enhanced/src/local/rules.ts) | `parseCidr`、`parseHostnameRule`、`cidrWarnings`、`matchesCidr`、`normalizeHost`、`stripIpv6Brackets`、`describeProblem` 与类型 | 同构；Host 校验与设置页逐行诊断共用 |
| [local/address-policy.ts](../packages/fetch-enhanced/src/local/address-policy.ts) | `AddressPolicy`、`isPublicAddress`、`AllowlistRules` | 公网单播总放行；IPv4-mapped / IPv4-compatible 按内嵌 IPv4 判断；非公网必须落在某条 CIDR 内，有主机名规则时主机名还要匹配（`*.example.com` 只匹配子域） |
| [local/resolver.ts](../packages/fetch-enhanced/src/local/resolver.ts) | `resolveAllowedAddresses(hostname, signal, policy, lookup?)`、`AddressLookup`、`ValidatedAddress` | 一次解析、整组校验，任一不合规即拒绝；检查 RFC 6052 前缀与 `ipv4only.arpa` 发现的 NAT64；传输随后固定连接到这组地址 |
| `backends/` | `common.ts`（`NATIVE_MESSAGES` 三个码、`restateNativeError`、`nativeBackend`）、`deepseek-fetch-api.ts`（`DeepSeekFetchApiProvider`，选项 getter：`nativeAuth` + `baseURL` 缺省 `DEEPSEEK_WEB_API_BASE_URL`）、`native.ts`（`createNativeFetchBackend`，目前直接返回唯一的一项） | 原生行为不变，只改写错误消息 |

### 5.3 Host：远程 adapter（`src/remote/`）

| 模块 | 导出 | 关键行为 |
| --- | --- | --- |
| [remote/types.ts](../packages/fetch-enhanced/src/remote/types.ts) | `FetchInput { url, options }`、`FetchWire = AdapterWire<FetchInput, PageOutcome>`、`FetchWireFor<K>`（`KeylessBound`） | URL 原样；参数已按访问方式校验 |
| [remote/page.ts](../packages/fetch-enhanced/src/remote/page.ts) | `MAX_BODY_CHARS = 100 000`、`ReportedTarget`、`Page { content, target, truncated }`、`reportedTarget(statusCode, url, requested)`、`statusPage(target)`、`PageFailure`、`PageOutcome`、`pageFailure(label, failure)`、`fetchResult(page, request)` | 映射规则见 architecture 6.6：`reportedTarget` 只认 100–599 的整数，最终 URL 经 `sourceUrl`；`fetchResult` 正文固定为 text，缺目标时合成 200 与请求的 URL，超过 100 000 字符截断（不切开代理对）并 `truncated: true`；`pageFailure` 用连接 label 与固定文案，不含服务原文 |
| [remote/errors.ts](../packages/fetch-enhanced/src/remote/errors.ts) | `fetchErrors = capabilityErrors(FETCH.packageName, 'fetch aborted')`、`fetchError` | — |
| [remote/http.ts](../packages/fetch-enhanced/src/remote/http.ts) | `MAX_RESPONSE_BYTES = 5 000 000`、`TIMEOUT_MS = 120 000`、`transport`、`mcp` | fetch 的传输文案（“5 MB”“120 s”由常量生成）；MCP 客户端的 `clientInfo` 为包名与 `__PLUGIN_VERSION__`，`toolFailed` 为 “<label> could not read the page; retry later or choose another fetch connection” |
| [remote/execute.ts](../packages/fetch-enhanced/src/remote/execute.ts) | `createRemoteBackend(connection, deps)`、`RemoteDeps` | 返回 `WebFetchProvider`（`available` 恒真）；`fetch`：先查取消，`runAdapter(…, ADAPTER_WIRES[connection.adapter], adapterTarget(connection, 目录端点), { url, options })`；`failure` → `pageFailure(connection.label, …)`，`page` → `fetchResult`；非 `WebError` 先进诊断，再改写为 “fetch failed; check the connection settings or choose another connection”；已取消时优先报 `WEB_ABORTED` |
| [remote/adapters/index.ts](../packages/fetch-enhanced/src/remote/adapters/index.ts) | `ADAPTER_WIRES = { exa, firecrawl, tavily, tinyfish } satisfies { [K in AdapterKey]: FetchWireFor<K> }` | 目录与实现绑定；缺一项或 keyless 项缺路由即编译失败 |

四个 adapter（请求体都是先展开参数、再写固定字段）：

| 文件 | 请求 | keyless | 解析 |
| --- | --- | --- | --- |
| `exa.ts` | `postJson(endpoint, apiKeyHeader)`，体 `{ ...options, urls: [url], text: { maxCharacters: MAX_BODY_CHARS } }` | MCP `https://mcp.exa.ai/mcp`、`web_fetch_exa`、握手，参数 `{ urls: [url], maxCharacters }` | REST：`statuses[0]` 为 error 时，整数 `httpStatusCode` → `statusPage`，`CRAWL_TIMEOUT` / `CRAWL_LIVECRAWL_TIMEOUT` → `timeout`，其余 `failed`；`results[0].text`，长度 ≥ 预算即 `truncated`。MCP：`_meta['ai.exa/rateLimited']` → `rate-limited`；至多 100 个 text 块、512 × 1024 个字符（超出为 `invalid`）；只在前 8192 个字符内剥元数据头；“No content found…” → `empty` |
| `firecrawl.ts` | `postJson(endpoint, bearer)`，体 `{ ...options, url, formats: ['markdown'] }` | `'rest'` | `success !== true` → `failed`；`data.markdown` 加 `reportedTarget(metadata.statusCode, metadata.url)`；正文为空而目标非 2xx → `statusPage`，否则 `empty` |
| `tavily.ts` | `postJson(endpoint, bearer 或 x-tavily-access-mode: keyless)`，体 `{ ...options, urls: [url], include_images: false }` | `'rest'` | `failed_results` 非空或没有结果 → `failed`；`results[0].raw_content`，空 → `empty` |
| `tinyfish.ts` | `postJson(endpoint, apiKeyHeader)`，体 `{ ...options, urls: [url], format: 'markdown' }` | 无（目录 `keyless: false`） | `errors[0]` 带整数 `status` → `statusPage`，否则按 `error` 映射（`timeout`、`content_too_large`、`invalid_url` / `invalid_redirect_url`、`empty_content`，其余 `failed`）；成功取 `results[0].text`，URL 取 `final_url`，状态合成 200 |

形状不符合服务文档时一律 `invalid`。

### 5.4 浏览器面

[client/index.tsx](../packages/fetch-enhanced/src/client/index.tsx) 与 search 同构（同样的 `inject` 列表与步骤），差别：`settings` 直接是 `configForms.get(FETCH.rowId)`（没有密钥类退役字段，不包 `withRetiredSecretDiagnostics`）；直接使用 core 的 `CredentialStatus` / `PairingsStatus`；分区 order 20 且没有 `Options`；命令是 `/setup-fetch`。注入 `webConnections` 后先 `registerRoute('fetch', route)`，与跟随 `showSelector` 的分区注册互相独立。

| 模块 | 说明 |
| --- | --- |
| `section.ts`、`command.ts`（`FETCH_COMMAND = 'setup-fetch'`）、`route.ts`（`FetchRouteStatus`）、`selection.ts`、`injected.ts` | 与 search 对应模块同职 |
| `connections.ts` | `connectionLabel`（未改名的 `local` 本地化为 `connection.local`）、`describe`：可用的远程连接说明写成“<访问方式> · the URL is sent to <name>”（`status.remoteReady`），`local` 为“直接 HTTP 访问”；缺凭据时 native 提示账号或 API key，adapter 只提示 API key |
| `allowlist-lines.ts` | `readAllowlist(field, text)`（逐物理行给出问题、可一键套用的修正、重复行、提醒；全部有效时给出 `values`）、`replaceLine`、`appendLine` |
| `settings/SettingsPage.tsx` | 无效文档显示 `settings.unsupported` 文案 + Reset；有效时：介绍、路由提示、默认值、服务、自定义连接、模型记忆、Reset |
| `settings/model.ts` | `credentialRefs`、`catalogLabel`、`connectionChoices`、`connectionName`、`optionCopy`（每个目录项的参数文案）、`SERVICE_NOTES`（四个远程服务的缓存与保留说明）、`valueLabel` |
| `settings/ServicesSection.tsx` | core 的 `createServicesSection`，`notes: SERVICE_NOTES`、`summaries: { local: 'access.local' }`（`local` 的行副标题写“直接 HTTP 访问”）、`extras: { local: localExtras }` |
| `settings/LocalExtras.tsx` | `localExtras`：接管 `allowCidrs`、`allowHostnames`、`userAgent`，渲染 `AllowlistEditor` 与 User-Agent 编辑器（空串是有效值，可一键恢复默认） |
| `settings/CustomConnections.tsx` | `createCustomConnectionsSection<FetchSettings, typeof CATALOG, LocaleKey>`，格式为四个远程 adapter |
| `settings/AllowlistEditor.tsx` + `Allowlist.module.css` | 草稿只在本地；点“保存”时用**一次**写入同时 `set` `allowCidrs` 与 `allowHostnames`，带打开草稿时的 revision；外部推送只刷新未修改的编辑器。保存 / 放弃用界面原语 `Button`，两个文本框按行对齐，等宽字体用 `--dsw-font-mono` |
| `settings/DefaultsSection.tsx` | 默认连接（含自定义连接）+ `showSelector` |

## 6. packages/ui

**职责**：浏览器面的产品层：提供 `webConnections` 服务、两个能力共用的输入框连接菜单、首次启用提示与 bundle 概览（含升级预检）。它不依赖任何插件行，任一、两个或都不启用时都正常。

`package.json` 要点：`exports` / `files` 同插件；`dsh.client.inject` 与插件相同但没有 `dsh-client-ui-commands`；peer 只有 `cordis`（必需）与浏览器面的 `dsh-api-remotes`、`dsh-client-*`、React（均 optional）。

~~~text
packages/ui/src/
  index.ts                      Host 面：name = UI.rowId，apply() {}
  client/
    index.tsx                   inject ['slots', 'locale', 'configForms']；提供服务、注册三个插槽
    service.ts                  createWebConnectionsService、installWebConnectionsService
    ComposerConnectionMenu.tsx  输入框按钮与菜单 + ComposerConnectionMenu.module.css
    ProfileDetailSection.tsx    bundle 概览与预检 + ProfileDetailSection.module.css
    ActivationPrompt.tsx        首次启用提示（含预检）
    preflight.ts disabled.ts    纯函数
    locales.ts css-modules.d.ts
packages/ui/tests/              7 个 spec
~~~

| 模块 | 导出 | 关键行为 |
| --- | --- | --- |
| [client/index.tsx](../packages/ui/src/client/index.tsx) | `inject`、`apply` | `installWebConnectionsService`（`ctx.provide('webConnections')`）；用 `configForms.whileServed` 分别跟踪 search、fetch 与原生 `web-search-deepseek` 行是否在服务；可选注入 `pluginNavigation`；注册 `conversation.input.right`（id `tool-web-enhanced-ui`，order 20）、`plugins.bundle.activation`（键 `PROFILE_PACKAGE`）、`plugins.detail.section`（id `tool-web-enhanced-ui-overview`） |
| [client/service.ts](../packages/ui/src/client/service.ts) | `createWebConnectionsService()` | 分区注册表 = `Set` + 快照 store，发布时按 `order` 排序；路由事实另有一张表：`registerRoute` 订阅插件的 `RouteStore`，任一变化都重新发布 `routes`（`Map<CapabilityName, Route>`）；注销按条目身份删除并退订，幂等 |
| [client/ComposerConnectionMenu.tsx](../packages/ui/src/client/ComposerConnectionMenu.tsx) | `ComposerConnectionMenu`、`modelKeyOf` | 没有分区时不渲染；按钮按 `order` 显示每个分区的状态（连接名，或“已关闭”“读取失败”“设置无效”“连接已移除”“正在加载”），以“·”分隔；某侧需要处理（读取失败、设置无效、所选连接被移除或未就绪、路由不是 `this`）时带警示点，可访问名称与 title 用 `button.side` / `button.sideAttention` 逐侧描述；≤460px 隐藏文字、警示点移到地球图标（search 右上、fetch 右下），≤380px 只剩图标；分区读取结果为 `invalid-settings` 时显示 `menu.invalidSettings` 与设置入口、不提供重试；各分区的路由提示取 `routeFor(section.capability, routes, webConfig)`；挂载、打开和会话模型（`useProjection('modelSelection')` 的 `next`）变化时对每个分区 `load(sessionId, modelKey)`；分区是手风琴：至多一个展开，每次打开菜单展开第一个，点已展开的标题收起，→ 展开本分区并收起其他、← 收起本分区，展开或列表加载完时把选中行滚动到可见处；连接行下的说明用 `--dsw-alias-label-secondary` 12px（浅色下对比度 ≥ 4.5，外观测试有断言）；选择经 `section.selection.set`，失败用 Toast 显示 `writeFailureText`；底部用 `checkDisabledCapabilities` 说明停用的能力；面板经 portal 渲染，位置由 `useMenuPosition` 测量锚点与对话区计算 |
| [client/ProfileDetailSection.tsx](../packages/ui/src/client/ProfileDetailSection.tsx) | `ProfileDetailSection` | 只对 profile bundle 渲染；两张能力卡（有效 / 下层 / 用户层的 provider；路由徽标取 `routeFor(capability, routes, web 行的值)`：有插件提供的路由事实就用它，与分区是否注册无关，否则按 `web` 行的值；行停用取自 `subject.pkg.rows`，停用时徽标说明行已停用）；预检结果与"移除遗留设置"：确认后 `webConfigForm.mutate(buildUnsetOps(...), revision)` |
| [client/preflight.ts](../packages/ui/src/client/preflight.ts) | `checkUpgradePreflight({ user, nativeSearchServed })`、`buildUnsetOps`、`NATIVE_SEARCH_PROVIDERS`、`NATIVE_FETCH_PROVIDERS`、`NATIVE_SEARCH_ROW` | 用户层字段是原生 / API provider → `user-override`；是别的 id → `legacy-remnant`（两者都可修复）；原生行在服务 → `native-search-conflict`（只说明） |
| [client/disabled.ts](../packages/ui/src/client/disabled.ts) | `routeFor`、`checkDisabledCapabilities`（`routes` 必填）、`isCapabilityRowDisabled` | `routeFor`：`routes` 里有该能力就用它，否则 `routeOf(webConfig, field, null, providerId)`（插件未运行，没有环境变量事实）；菜单：路由为 `this` 而该行未被服务；概览：bundle 行表里 `enabled: false` |
| [client/ActivationPrompt.tsx](../packages/ui/src/client/ActivationPrompt.tsx) | `ActivationPrompt` | 由 `index.tsx` 的 `ActivationSlot` 注入 `web` 行的 `ConfigForm` 与原生搜索行是否在服务；对用户层跑 `checkUpgradePreflight`，没有问题时显示 `activation.body`，有问题时显示 `activation.preflight`；按钮仍是“稍后”与“打开设置”（详情页），自己不写任何东西 |

## 7. 数据流

### 7.1 请求管线（Host）

~~~mermaid
flowchart TD
  TOOL["dsh-tool-web：web_search / web_fetch"] --> WEB["ctx.web（WebRuntime）<br/>按 web 行选中 provider"]
  WEB --> SEAT["Seat：search 为 createSearchSeat，fetch 为对象字面量<br/>available() 恒为 true"]
  SEAT --> INV["installCapability 的 invoke<br/>agent = agents.currentInitiator()"]
  INV --> PLAN{"plan(agent)"}
  PLAN -- "undefined（未捕获）" --> E0["WEB_PROVIDER_ERROR"]
  PLAN -- failed --> E1["plan.error"]
  PLAN -- off --> E2["WEB_PROVIDER_UNAVAILABLE"]
  PLAN -- "ready { connectionId, options }" --> SELQ{"settings().connections.get(id)<br/>isSelectable？"}
  SELQ -- 否 --> E3["WEB_PROVIDER_CONFIGURED_UNAVAILABLE"]
  SELQ -- 是 --> TGT["capability.target(connection, options, call)<br/>每次新建"]
  TGT --> EXE["capability.execute(target, request, call)"]
  EXE --> A["adapter：search executeSearch / fetch createRemoteBackend<br/>→ core runAdapter（adapterTarget、凭据校验）→ ADAPTER_WIRES<br/>→ core transport / MCP callTool（全局 fetch，redirect: error）"]
  A --> PG["fetch：PageOutcome → pageFailure(label) 或 fetchResult（text、兼容 200、截断）"]
  EXE --> N["native：DSH 导出的 provider 类<br/>→ restateNative 改写错误"]
  EXE --> L["fetch local：HttpFetchProvider<br/>+ resolveAllowedAddresses / AddressPolicy"]
~~~

计划的来源（每步冻结）：

~~~mermaid
flowchart LR
  REQ["agent/request（turn, step）<br/>agent/created（-1, -1）"] --> SNAP["Snapshots.capture"]
  SNAP --> CUR["Sessions.current(agent)<br/>记录 → fork 继承 → 模型记忆 → defaultConnection"]
  CUR --> STORE[("storage-domain<br/>selections / pairings")]
  CUR --> SYNC["ToolRestriction.sync<br/>null 且已路由 → tools.restrict(deny)"]
  SYNC --> PF["planFor(selection)"]
  PF --> SNAP
  REMOTE["Remote：searchConnections/set、fetchConnections/set"] --> CHG["Sessions.change（revision 比较）"]
  CHG --> STORE
  CHG --> SYNC
  WEBDOC["settings/document-updated（ns = web）"] --> RE["ToolRestriction 对已知 Agent 重算"]
~~~

### 7.2 浏览器

~~~mermaid
flowchart LR
  CF["configForms.get(rowId)"] --> SETS["settings（ConfigForm）"]
  CFW["configForms.get('web')"] --> RS["RouteStatus"]
  RNS["remote.searchConnections / fetchConnections<br/>get · set · provider · pairings · forgetPairing"] --> SEL["ConnectionSelectionStore"]
  RNS --> RS
  RNS --> PS["PairingsStatus"]
  RC["remote.credentials：describe / set"] --> CS["CredentialStatus"]
  SETS --> CS
  SEL --> SEC["ConnectionSection"]
  SEC -- "webConnections.register" --> SVC["ui：WebConnectionsService"]
  RS -- "webConnections.registerRoute（与分区无关）" --> SVC
  SVC --> MENU["conversation.input.right<br/>ComposerConnectionMenu"]
  SVC --> OV["plugins.detail.section<br/>ProfileDetailSection"]
  SEL --> CMD["commandUi：/setup-search、/setup-fetch"]
  SETS --> PAGE["plugins.row.config：SettingsPage<br/>（whileServed 期间）"]
  CS --> PAGE
  RS --> PAGE
  PS --> PAGE
  EV["settings/document-updated · credentials/reference-updated · connection.generation"] -. invalidate .-> SEL
  EV -. invalidate .-> CS
  EV -. invalidate .-> PS
  EV -. refresh .-> RS
~~~

菜单、命令与设置页读写同一个 `ConnectionSelectionStore`，任一处写入，其他处立即看到。

## 8. 配置与状态

| 位置 | 内容 | 谁写 | 代码 |
| --- | --- | --- | --- |
| `web` 行 | `searchProvider` / `fetchProvider` | profile patch；ui 概览在用户确认后只 `unset` 用户层的这两个字段 | `packages/profile/cordis.patch.yml`、`ui/src/client/preflight.ts` |
| `web-search-enhanced` / `web-fetch-enhanced` 行 | 统一设置文档（8.1） | 各插件设置页（稀疏写入，`mutate(ops, revision)`） | `core/src/shared/settings.ts`、两侧 `settings/resolve.ts` |
| storage-domain `web_search_enhanced` / `web_fetch_enhanced` | 会话选择与模型记忆（8.5） | Host 的 `Sessions` / `Pairings` | `core/src/host/{storage,sessions,pairings}.ts` |
| DSH Credentials | API 密钥（8.6） | 设置页经 `remote.credentials.set` | `core/src/client/settings/CredentialEditor.tsx`、`core/src/host/credentials.ts` |

### 8.1 统一设置文档

两行共用一份文法（`documentSchema` + `resolveDocument`），Host 与浏览器调用同一个纯函数（各插件的 `resolveSettings`）。所有字段可选，缺省由目录给出。

| 字段 | 形状 | 缺省 | 规则 |
| --- | --- | --- | --- |
| `version` | 字面量 `2` | 省略即按 2 读 | 其他值见 8.3 |
| `defaultConnection` | 字符串，≤ 200 | search `builtin:deepseek-messages`；fetch `builtin:local` | 必须是解析后存在的连接（允许指向已停用的连接，不会悄悄换成别的）；可以是 `custom:*` |
| `showSelector` | boolean | `true` | `false` 时插件不向 `webConnections` 注册分区 |
| `defaults` | 能力给的严格对象 | search `{ freshness: 'auto' }`；fetch `{}` | search 只接受 `freshness: auto \| fresh \| realtime`；fetch 只接受空对象 |
| `connections` | 记录，键 ≤ 200 字符，≤ 200 条 | `{}` | 键为 `builtin:<目录键>`（覆盖）或 `custom:<名字>`（新建） |

内置连接的覆盖（`builtinOverrideSchema`，严格对象）：`label`（1–200 字符）、`disabled`、`access`（`keyless` / `api-key`，必须是目录允许的）、`credentialRef`（符合 `CREDENTIAL_REF`，目录没有 API key 访问方式时拒绝）、`trustedEndpoint`、`options`（按目录 `OptionRule` 校验，未知参数拒绝；keyless 访问可再拒绝或收窄参数；`url` 类参数不同于目录端点时必须 `trustedEndpoint: true`）。

自定义连接（`customConnectionSchema(adapterKeys)`，两侧都有；目录没有 adapter 项时 `custom:*` 按未知连接 id 拒绝）：`kind: 'adapter'`（只接受这一种）、`adapter`（目录里的 adapter 键：search 六项，fetch 四项）、`label`（必填）、`credentialRef`（必填，总是 api-key）、`endpoint`（可选；不同于该 adapter 的官方端点时必须 `trustedEndpoint: true`）、`trustedEndpoint`、`disabled`、`options`。

在解析之前，`validateDocumentBounds` 先有界地遍历整份文档：字符串与键至多 2000 字符，数组与对象至多 200 项，深度至多 20，总节点至多 100 000，任意层级出现 `__proto__` / `constructor` / `prototype` 键即拒绝。错误消息点名字段路径（`invalid <cap> settings: connections.builtin:exa.options: …`），未知字段与未知连接附带 `SETTINGS_RESET_HINT`。

search 一侧的例子：

~~~yaml
version: 2
defaultConnection: custom:team-tavily
showSelector: true
defaults:
  freshness: fresh
connections:
  builtin:exa:
    access: api-key                 # 改用个人 key；缺省 credentialRef 为 EXA_API_KEY
  builtin:deepseek-messages:
    options: { model: deepseek-chat, maxUses: 3 }
  builtin:semanticscholar:
    disabled: true
  custom:team-tavily:
    kind: adapter
    adapter: tavily
    label: Team Tavily
    credentialRef: TEAM_TAVILY_KEY
    endpoint: https://tavily.example.internal/search
    trustedEndpoint: true
    options: { topic: news }
~~~

fetch 一侧的例子：

~~~yaml
version: 2
defaultConnection: builtin:local
connections:
  builtin:local:
    label: Intranet fetch
    options:
      allowCidrs: [10.0.0.0/8, 198.18.0.0/15]
      allowHostnames: ['*.corp.example']
      userAgent: ''                 # 空串是有效值：发出空的 User-Agent
      timeoutMs: 15000
  builtin:deepseek-fetch-api:
    credentialRef: DEEPSEEK_API_KEY
    trustedEndpoint: true
    options: { baseURL: https://deepseek-proxy.example.internal/v1/tools }
  builtin:exa:
    access: api-key                 # maxAgeHours / livecrawlTimeout 只在 API key 下可用
    options: { maxAgeHours: 24 }
  custom:team-firecrawl:
    kind: adapter
    adapter: firecrawl
    label: Team Firecrawl
    credentialRef: TEAM_FIRECRAWL_KEY
    endpoint: https://firecrawl.example.internal/v2/scrape
    trustedEndpoint: true
~~~

校验发生在三处：Host 启动时一次（无效只记日志）；Loader `internal/config` 钩子在写入前（非法候选不落盘）；每次调用经 `settings()`（无效报 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`）。浏览器在显示编辑器前（`editableSettings`）和每次写入前对完整候选文档（`settingsOperations`）各校验一次。

### 8.2 退役字段

| 插件 | `RETIRED_FIELDS` |
| --- | --- |
| search | `providerId`、`freshness`、`modelMode`、`protocol`、`baseURL`、`model`、`fallbackModel`、`apiKey`、`apiKeyEnv`、`apiVersion`、`toolIdentifier`、`maxTokens`、`maxUses`、`chatSearchMode`、`searchContextSize` |
| fetch | `schemaVersion`、`providerId`、`allowCidrs`、`allowHostnames`、`userAgent`、`maxResponseBytes`、`maxBodyChars`、`timeoutMs`、`maxRedirects` |

处理方式：

- `settingsRow` 把它们与当前字段一起声明进 `Config`（search 的 `apiKey` 带 `role('secret')`），只为让 Settings 暴露它们；
- `resolveDocument` 把文档顶层的未知键报为 `<字段> is a 0.1.x setting this release does not read; remove it or use Reset`；Host 不读、不迁移、不改写；
- 设置页对无效文档只显示提示和 Reset；Reset 对用户层每个顶层键执行 `unset`，不动 Credentials；
- 被遮蔽的密钥字段（search 的 `apiKey`）页面看不出它在哪一层，`withRetiredSecretDiagnostics` 只把"已设置"作为诊断显示（`settings.retiredSecret`），提示手工删除。

### 8.3 版本与迁移管线

~~~mermaid
flowchart LR
  DOC["原始文档"] --> B["validateDocumentBounds"]
  B --> V{"documentVersion"}
  V -- "invalid（非对象 / 非正整数）" --> X1["报错"]
  V -- "newer" --> X2["报错：升级插件"]
  V -- "current（含省略 version）" --> C["structuredClone"]
  V -- "older" --> M["SETTINGS_MIGRATIONS.steps：N → N+1<br/>（当前为空表，缺步骤即报错并提示 Reset）"]
  M --> C
  C --> P["documentSchema 严格解析 → 逐连接 resolve"]
~~~

- `migrateDocument` 在内存里执行，Host 从不写回；
- 浏览器 `editableSettings` 对可写的旧版本文档给出 `needsWriteback`，`useSettingsDocument` 先锁定编辑，用"替换整个用户层"的操作把迁移结果按 revision 写回一次；失败显示 `migrationError`，同一 revision 不再重试；
- 写入只要含 `set` 就顺带写 `version: 2`（`sparseSettingOperations` 与 `settingsOperations` 各自保证）；纯 `unset`（含 Reset）不写；版本不是当前版本时，普通的稀疏编辑被拒绝，只允许 Reset。

### 8.4 设置在两侧的入口

| | Host | 浏览器 |
| --- | --- | --- |
| 读取 | `settingsRow` 的 `read(config)`：取每个 volatile 字段的当前值 | `ConfigForm` 快照的 `base` / `user` 两层，经 `effectiveDocument` 深合并 |
| 校验 | `resolveSettings` | 同一个 `resolveSettings` |
| 写入 | 不写 | `settings.mutate(ops, revision)`，`ops` 来自 `createSparseSettings` 或白名单编辑器 |

### 8.5 storage-domain

`selectionDomain(name)`（`defineDomain({ name, version: 1, tables })`）：

| 表 | 键 | 值 | 说明 |
| --- | --- | --- | --- |
| `selections` | 会话 id | `{ connectionId: string \| null, revision: int ≥ 0, inherited?: boolean, …能力字段 }`（loose 对象） | core 拥有前三个字段；search 另有扁平的 `freshness?`（与前身 0.1.x 相同），fetch 没有额外字段 |
| `pairings` | `JSON.stringify([provider, model])` | `{ connectionId: string \| null }`（严格对象） | 模型记忆；`null` 记住"关闭" |

域名：search `web_search_enhanced`（沿用前身，旧记录照常可读）、fetch `web_fetch_enhanced`。

### 8.6 DSH Credentials 的使用

设置里只存凭据引用（`credentialRef`），密钥只在 DSH Credentials。

| 位置 | 函数 | 行为 |
| --- | --- | --- |
| Host，两侧的 adapter | `resolveApiKey(ctx, ref)`，经 core `runAdapter` 调用 | `credentials.resolve(credentialRef(ref))`；没有 Credentials 服务或没有值时为 `undefined`，**不回退环境变量**；每次调用解析，不缓存；keyless 路由不调用。`runAdapter` 去首尾空白后要求只含可见 ASCII 与空格，否则报 `WEB_PROVIDER_CREDENTIAL_MISSING`，不发请求、不进诊断 |
| Host，native 后端 | `nativeAuth(ctx, ref)` | 交给 DSH provider 的 `apiKeyEnv` / `resolveApiKey` / `resolveAccountToken`：有 Credentials 服务时只用它；**只有 Credentials 服务不存在时**才像原生行一样读启动环境（`launchEnvironmentOf(ctx)`）；账号令牌只在本次请求路由是 `deepseek-account` 时提供（`accountTokenFor`） |
| Host，连接状态 | `credentialReadiness(ctx, agent, { endpoint, credentialRef })` | 下一次请求的模型是 `deepseek-account` 且能取到令牌 → `account` + `ready`；否则 `credentials.describe` 的 `configured` → `ready` / `needs-credential`；不读值 |
| 浏览器 | `CredentialStatus`、`CredentialEditor` | 只调 `remote.credentials.describe(refs)` 与 `set(ref, value)`；`credentials/reference-updated` 事件触发重读 |

### 8.7 Remote 命名空间与方法

命名空间：search `searchConnections`、fetch `fetchConnections`。契约由各自 `contract.ts` 调用 `selectionContract` 生成，Host 服务由 `createConnectionsService` 生成，浏览器经 `ctx.remote.$mount(contract.remoteInfo)` 后以 `remote.<ns>` 使用。

| 方法 | 请求 | 结果 | 错误 |
| --- | --- | --- | --- |
| `<ns>/get` | `{ sessionId }` | `SelectionView` = `{ selection: { connectionId, revision, options }, source, connections: ConnectionView[] }` | `gateway/bad-request`；会话解析失败时原样交出 sessionController 的 `RemoteError` |
| `<ns>/set` | `{ sessionId, connectionId?, options?, expectedRevision }`（`connectionId` 与 `options` 至少其一；`null` = 关闭） | `SelectionView`（`source: 'session'`） | `<ns>/unavailable { connectionId }`、`<ns>/conflict`、`gateway/bad-request` |
| `<ns>/provider` | `{}` | `{ providerId, envProvider }` | `gateway/bad-request` |
| `<ns>/pairings` | `{}` | `{ pairings: [{ provider, model, connectionId }] }` | `gateway/bad-request` |
| `<ns>/forgetPairing` | `{ provider, model }` | 同上（清除后的列表） | `gateway/bad-request` |

行设置无效时 `get` / `set` 报 `<ns>/invalid-settings`（固定消息、空详情）。五个方法的其余异常（存储失败等）一律 `gateway/internal`，消息 “connection request failed; retry or check the Host logs”，原始异常只进 Host 日志。

`ConnectionView`：`id`、`label`、`kind`（`native` / `adapter` / `model` / `local`）、`remote`、`access`（`keyless` / `api-key` / `account`）、`status`、`detail?`；search 另有 `freshness: boolean`。视图不含 `credentialRef`。

### 8.8 locale 字典

| 包 | 文件 | 命名空间（= 行 id） | 键集合的来源 | 键数（约） | 键前缀 |
| --- | --- | --- | --- | --- | --- |
| search | `src/client/locales.ts` | `web-search-enhanced` | `en`（`LocaleKey = keyof typeof en`，`zh: Record<LocaleKey, string>`） | 189 | `list.*`、`option.*`、`editor.*`、`services.*`、`value.*`、`defaults.*`、`credential.*`、`settings.*`、`pairings.*`、`draft.*`、`custom.*`、`command.*`、`status.*`、`options.*`、`source.*`、`selector.*`、`route.*`、`reset.*`、`write.*`、`freshness.*`、`access.*` 等 |
| fetch | `src/client/locales.ts` | `web-fetch-enhanced` | `en`（同上） | 194 | `allowlist.*`、`services.*`（含 `services.note.*`）、`credential.*`、`option.*`、`settings.*`、`pairings.*`、`defaults.*`、`custom.*`、`editor.*`、`draft.*`、`value.*`、`command.*`、`status.*`、`options.*`、`source.*`、`reset.*`、`access.*`、`write.*`、`route.*` 等 |
| ui | `src/client/locales.ts` | `tool-web-enhanced-ui` | `zh`（`en satisfies Record<LocaleKey, string>`） | 52 | `button.*`、`menu.*`、`activation.*`、`overview.*`、`preflight.*`、`disabled.*` |

- 每个 `locales.ts` 都用 `declare module '@deepseek-ai/dsh-client-ui-slots'` 把命名空间登记进 `LocaleNamespaceMap`，`apply` 里 `ctx.locale.register(NS, { zh, en })`，插槽注册时带 `locale: NS`，组件拿到的 `t` 因此有键类型。
- core 不带词典：它的组件用插件注入的键表（第 3.3 节）。
- `locale/{en,zh}.json` 只有插件页读取的 `meta.title` / `meta.description`（verify-packages 检查）。
- 每个包的 `client-locales.spec.ts` 检查 zh / en 键与插值参数成对。

## 9. 构建与测试基础设施

### 9.1 `build/tsdown.ts`：一个构建工厂

每个插件的 `tsdown.config.ts` 只有 `export default pluginBuild(import.meta.url)`。[pluginBuild](../build/tsdown.ts) 读包的 `package.json`：

| 构建 | 入口 → 输出 | 关键配置 |
| --- | --- | --- |
| Host（总有） | `src/index.ts` → `lib/index.js` | ESM、`platform: node`、`target: node22`；`deps.neverBundle` = Node 内置或 `@deepseek-ai/*`，其余 `alwaysBundle`；`define __PLUGIN_VERSION__` = 清单版本；插件 `standardDecorators()` |
| Client（清单有 `exports['./client']` 时） | `src/client/index.tsx` → `lib/client.cjs` + sourcemap | CJS、`platform: browser`、`target: es2024`；只有 `isPlatformModule` 外置；解析条件按 `NODE_ENV` 选 `development` / `production` 再加 `browser`、`import`…；`define` `process.env.NODE_ENV`、`import.meta.env`、`__PLUGIN_VERSION__`；插件 `cssModules(<包名>)`；`banner` / `intro` / `footer` 把模块包进 `window.__ModuleLoader__.load({ id, factory })` |

包的 `build` 脚本是 `node ../../scripts/clean.ts && tsdown`（先清 `lib`）。`build/globals.d.ts` 声明 `__PLUGIN_VERSION__`（两侧 MCP 客户端的 `clientInfo` 使用）。

### 9.2 `build/platform.ts`：平台模块表

`PLATFORM_MODULES` 是 DSH Web 壳通过模块表共享给每个 client bundle 的模块：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`；`isPlatformModule(specifier)` 判断精确匹配。

### 9.3 `build/plugins.ts`：构建与 Vitest 共用的插件

| 插件 | 用途 |
| --- | --- |
| `standardDecorators()` | 只对含行首装饰器（如 `@Remote(`）的 `.ts(x)` 源码（不在 node_modules）用 TypeScript `transpileModule`（ES2022）降级；OXC 不降级装饰器、Node 也不执行它们。core 的 `remote.ts` 在各插件构建与 Vitest 里都走这条路 |
| `cssModules(pluginId)` | 把 `*.module.css` 解析为虚拟模块（后缀 `.mjs`，避免进 bundler 自己的 CSS 管线），用 lightningcss 编译（类名 `[hash]_[local]`、压缩），导出类名表，并在有 `document` 时追加一个 `<style data-plugin="<包名>" data-plugin-css="<包名>/<相对路径>">`（同一标签只插一次） |
| `primitivesStub()` | 只用于测试：已发布的 `dsh-client-ui-primitives` 引用了没有声明也没有安装的实现库（shiki、katex、micromark、simple-icons、clsx…）。只有解析不到的库被换成惰性 Proxy 存根，按导入方的具名导入生成导出；`clsx` 给一个真实的最小实现；同时去掉该库指向不存在 sourcemap 的注释 |

### 9.4 `scripts/`

- [workspace.ts](../scripts/workspace.ts)：`repo`、`Manifest`、`publishablePackages()`（`packages/` 下非 private 的包，即 profile、search、fetch、ui）、`pack(pkg, destination, env)`（`pnpm --config.ignore-scripts=true pack`，与 `pnpm publish` 一样改写 `workspace:` / `catalog:`）。verify-packages 与 e2e 共用。
- [clean.ts](../scripts/clean.ts)：删除当前目录下的 `lib`（或参数给出的目录），拒绝绝对路径和 `..`。
- [verify-packages.ts](../scripts/verify-packages.ts)：打包每个可发布包（要求已构建）后逐项检查：

| # | 检查 | 适用 |
| --- | --- | --- |
| 1 | `dependencies` / `peerDependencies` 里不残留 `workspace:` / `catalog:` | 全部 |
| 2 | 有 `engines.dsh`，且所有包的值相同 | 全部 |
| 3 | 每个 `@deepseek-ai/dsh-*` peer 的范围等于 `engines.dsh` | 全部 |
| 4 | `exports` 的非通配目标都在包里；`icon` 在包里 | 全部 |
| 5 | `locale/en.json`、`locale/zh.json` 在包里且有 `meta.title` 与 `meta.description` | 全部 |
| 6 | bundle patch 在包里；每个 `dependencies` 的版本等于本工作区要发布的版本 | profile（有 `dsh.bundle`） |
| 7 | 没有 `dependencies`；`main`（Host 产物）的每个 `import` / `export from` / 动态 `import()` 只能是 Node 内置或 `@deepseek-ai/*`，且每个导入的 `@deepseek-ai` 包都已声明为 peer | 插件（search、fetch、ui） |
| 8 | `publint --strict --pack pnpm` | 全部 |

### 9.5 Vitest（单元与组合测试）

[vitest.config.ts](../vitest.config.ts)：`define __PLUGIN_VERSION__ = '0.0.0-test'`；插件 `standardDecorators()`、`cssModules('test')`、`primitivesStub()`；收集 `packages/*/tests/**/*.spec.{ts,tsx}`；`server.deps.inline: ['@deepseek-ai/dsh-client-ui-primitives']`（让真实原语经过上面的存根插件）；覆盖率 v8，范围 `packages/*/src`。默认 Node 环境，浏览器面的测试文件首行写 `// @vitest-environment jsdom`，用 `@testing-library/react` 渲染。`zustand`、`immer` 是根 devDependencies，因为 `dsh-client-store` 运行时导入它们却没有声明。会话层面的测试用 `@deepseek-ai/dsh-agent-loop-testkit` 与 `dsh-session-projection` 组装真实 Agent。

测试文件清单。包一栏的数字是 vitest 实际运行的测试数（`it.each` 展开后）；文件后括号里是 `it` / `test` 声明处的个数（`it.each` 计一处）。2026-10-20 最近一次 `pnpm run check`：75 个文件、1300 个测试全部通过。

| 包 | 文件（声明数） | 覆盖 |
| --- | --- | --- |
| core（20 个，198） | `adapter`（14）、`client-capability`（4）、`client-catalog`（9）、`client-document`（7）、`client-fields`（5）、`client-migration`（3）、`client-selection-types`（1）、`client-selection`（2）、`client-settings`（25）、`client-sparse`（6）、`mcp`（17）、`native`（3）、`plans`（2）、`remote`（11）、`restriction`（6）、`sessions`（1）、`settings-grammar`（10）、`settings-migration`（9）、`snapshots`（2）、`storage`（1） | 文法与退役字段、版本识别与注入的迁移步骤、有界校验；adapter 执行骨架（keyless 不读不发凭据、缺失与非法密钥不发请求、API 重定向、取消与共享截止时间、`adapterTarget`）；MCP 客户端（握手、JSON 与 SSE、混用换行的逐分块切分、线性扫描量、字节上限）；Remote 边界的脱敏、契约内错误与 `invalid-settings`；浏览器 store 的 `readFailure`；目录驱动的设置事实、自定义连接表单与信任、服务列表与自定义连接区的写入；计划冻结与每次调用复查；快照共享与失败重试；fork 继承；路由驱动的限制重算、释放后不安装；存储重开；原生错误改写；浏览器文档视图、稀疏写入、迁移写回；夹具 `fixtures/settings.ts` 是两个最小目录 |
| search（21 个，421） | `adapters`（26）、`agent`（6）、`catalog`（10）、`client-apply`（9）、`client-command`（9）、`client-composition`（8）、`client-locales`（5）、`client-route`（9）、`client-section`（4）、`client-selection`（10）、`client-settings-model`（3）、`client-settings`（28）、`client-sparse`（7）、`contract`（6）、`host`（13）、`mcp`（6）、`native`（14）、`plugin`（12）、`selections`（11）、`settings`（23）、`transport`（16） | adapter 请求 / 响应 / keyless 路由（本地 HTTP 服务充当远程 API）；MCP 结果的行解析（`toolRows`、Exa 文本块）；传输的重定向拒绝、上限、截止时间、取消；native 凭据与错误改写；设置解析；真实 Settings 下的退役字段与路由；真实 Host 的 Remote；会话语义；真实 Web preset Agent 上的工具隐藏；浏览器 apply、命令、与 ui 的真实组合（含路由事实独立注册）、设置页。`fixtures/core-host.ts` 用 core 拼出 search 参数的会话对象；`fixtures/unified-settings.yml` 是设置样例 |
| fetch（26 个，602） | `adapter-exa`（21）、`adapter-firecrawl`（12）、`adapter-tavily`（11）、`adapter-tinyfish`（12）、`agent`（8）、`catalog`（3）、`client-allowlist-lines`（9）、`client-allowlist`（15）、`client-apply`（9）、`client-command`（6）、`client-locales`（7）、`client-route`（4）、`client-selection`（10）、`client-settings`（25）、`composition`（3）、`host`（13）、`local-provider`（12）、`native`（15）、`plugin`（13）、`prompt`（9）、`proxy`（3）、`remote-execute`（18）、`remote-page`（8）、`resolver`（15）、`rules`（16）、`settings`（22） | 白名单文法与地址判断、整组 DNS 校验与 NAT64（可替换的 lookup）、本地代理、官方传输上的 local；提示文本与预算；native；四个 adapter 的请求形状与解析映射（传输边界不在这里重测）；页面映射（兼容 200、目标状态、截断）；用真实 `http.ts` 的远程执行（凭据、重定向、120 s、字节上限、取消、文案）；远程与 local 的组合（URL 原样转发、设置热生效、keyless 用目录端点）；设置（含自定义连接）；seat 与路由；真实 Host 的 Remote 与每步冻结；真实 Agent；设置页与白名单编辑器 |
| ui（7 个，71） | `client-allowlist-disclosure`（1）、`client-components`（35）、`client-locales`（3）、`client-pure`（15）、`client-service`（5）、`client-settings-appearance`（6）、`plugin`（1） | 菜单（手风琴、选中行可见、按钮逐侧状态与警示点、设置无效提示）/ 首次启用提示（含预检）/ 概览、预检与停用判断纯函数（`routeFor`）、服务注册表（分区与路由事实）、两个插件设置页的外观回归（含菜单说明行的对比度） |
| profile（1 个，8） | `profile`（6） | 第 2 节 |

### 9.6 e2e harness

[vitest.e2e.config.ts](../vitest.e2e.config.ts)：收集 `e2e/**/*.e2e.ts`；`globalSetup: e2e/global-setup.ts`；`fileParallelism: false`（规格共用一个 profile）；`execArgv: ['--no-global-search-paths']`；`testTimeout` 120 s、`hookTimeout` 600 s。`pnpm run test:e2e` 先构建再运行。

[global-setup.ts](../e2e/global-setup.ts)：删除 `NODE_PATH`；清空 `.e2e/run` 与 `.e2e/artifacts`；`isolatedEnvironment()` → `ensureDsh()` → `packWorkspace()` → `addPlugins(e2e, [profile], 其余 tarball 作为 overrides)`；经 `project.provide('e2e', …)` 交给各规格（`inject('e2e')` 读取 `E2EContext { install, cli, env, tarballs }`）。

| 模块 | 导出 | 作用 |
| --- | --- | --- |
| [harness/environment.ts](../e2e/harness/environment.ts) | `workspace`、`run`、`artifacts`、`PROFILE = 'web'`、`DSH_VERSION`（取自 catalog 的 `@deepseek-ai/dsh-web`）、`isolatedEnvironment`、`ensureDsh`、`packWorkspace`、`dsh`、`profileDir`、`addPlugins`、`composedRows`、`enterIsolatedEnvironment`、`profilePatchPath` | 去掉 `DSH_*`、`DEEPSEEK_*`、`VITEST*`、`NODE_OPTIONS`、`NODE_PATH`、`NODE_ENV`；把 HOME、DSH_HOME、XDG_*、TMPDIR、DSH_AGENTS_HOME、PNPM_HOME、npm 缓存等全部指向 `.e2e/run`；DSH 按版本装在 `.e2e/dsh-<version>`（先装到 `.partial` 再改名；`DSH_E2E_INSTALL` 可指向现有安装）；`addPlugins` 先用 `--dump-config` 建 profile，再把 overrides 写进 profile 的 `pnpm-workspace.yaml`，用 `dsh plugin --profile web add … --store-dir <run>/pnpm-store --ignore-scripts` 安装；`composedRows` 解析 `--dump-config`（可叠加 `--patch`） |
| [harness/host.ts](../e2e/harness/host.ts) | `bootHost(e2e, overlays)` → `{ ctx, web, dispose }` | 按 CLI 的步骤用已安装的 `@deepseek-ai/dsh-app-boot` 在进程内启动 Host（`loadProfile`、`createRuntimeResolution`、`readProfilePatches`、`boot`，并提供 `profileContext`、启动环境快照、`PluginPackages`、`cmdline`）；总是叠加 `fixtures/host-plane.yml`，不绑定端口 |
| [harness/web.ts](../e2e/harness/web.ts) | `startWeb(e2e, overlays)` → `{ url, stop }` | 在空闲的 127.0.0.1 端口跑 `dsh web --no-open`（从不用 3080），等待带 token 的启动 URL（90 s），日志写 `.e2e/artifacts/web.log`；停止时 SIGTERM，10 s 后 SIGKILL |
| [harness/browser.ts](../e2e/harness/browser.ts) | `chromiumPath`、`browserRequired`（设置了 `CI`）、`openApp(url)`、`recordBrowserFailure`、`App` | `playwright-core` 无头 Chromium（`DSH_E2E_CHROMIUM` 或常见系统路径），视口 1280 × 900、`en-US`；自动关掉首次运行的对话框与本包的首次启用提示；收集 console 错误；截图到 `.e2e/artifacts`；GUI 规格失败时 `recordBrowserFailure` 写 `<name>.json`、整页截图，以及可访问性快照 `<name>.aria.txt` |
| [harness/navigation.ts](../e2e/harness/navigation.ts) | `openBundle`、`openSearchSettings`、`openFetchSettings`、`newSession`、`expandConnectionSection`、`openConnections` | 只经公开 UI 导航（角色与可访问名称，文案缺省取自各包的 `en` 字典，`openConnections` 可传入 zh 文案）；`expandConnectionSection` 显式展开目标分区，并断言菜单里只有一个分区展开（手风琴） |
| [harness/theme.ts](../e2e/harness/theme.ts) | `setTheme`、`expectTheme`、`Scheme`、`ThemePreference` | 经 DSH 设置对话框的外观选项切换浅色 / 深色（持久化的设置，不只改 media query），返回原来的选择以便恢复 |
| [harness/upgrade.ts](../e2e/harness/upgrade.ts) | `upgradeEnvironment`、`installPredecessors`、`installCoexistencePatch`、`createLegacyOffSession`、`installUpgradeProfile` | 给破坏性场景一个独立的 home；安装前身 `dsh-web-search-enhanced@0.1.10`、`dsh-web-fetch-enhanced@0.1.0`（或 `DSH_E2E_PREDECESSOR_*` 指向的已构建 checkout，必须是真实的前身 bundle）；写入共存模式的用户层；在独立进程里建一个"关闭搜索"的旧会话 |
| [harness/http.ts](../e2e/harness/http.ts) | `startFetchTarget()` | 本机回环 HTTP 靶机，记录每个请求的 User-Agent |
| [harness/remote-fetch-api.ts](../e2e/harness/remote-fetch-api.ts) | `startRemoteFetchApi(response)` → `{ url, requests, respondWith, close }`、`RemoteFetchRequest`、`RemoteFetchResponse` | 只监听回环的假远程服务：记录每个请求的方法、原始路径、请求头与请求体，回复可替换；用它充当自定义 Firecrawl 连接的端点，真实服务从不收到请求 |

### 9.7 e2e 规格

2026-10-20 的最终全套：14 个规格文件、85 个用例全部通过（Vitest 用时 572.5 s），截图 98 张（矩阵 36、窄输入栏按钮 360 宽补充 2、界面评审补充 25、行为与升级场景 35）；证据在 `.e2e/review/2026-10-20-final-3/`。

| 规格 | 是否需要浏览器 | 覆盖点 |
| --- | --- | --- |
| `profile` | 否 | 安装：bundle 层被选中、插件装在其下；组合：`--dump-config` 里 `web` 行、停用的 `web-search-deepseek`、插入的三行；进程内 Host：web_search / web_fetch 路由到两个插件（fetch 为原生 public-only）；分别停用 search、fetch、两者：菜单行仍在，被停用的能力报 `WEB_PROVIDER_CONFIGURED_MISSING`，另一个能力照常（search `WEB_PROVIDER_CREDENTIAL_MISSING`、fetch `WEB_BLOCKED_URL`） |
| `fetch-allowlist` | 否 | 有无 `fetch-allow-loopback.yml` 两种：放行时能抓取靶机并发出配置的 User-Agent、系统提示含白名单说明；不放行时 `WEB_BLOCKED_URL` 且靶机未被访问；`web_fetch` 路由给原生 `http` 时不加提示 |
| `plugins-page` | 是 | 插件页列出 bundle（自己的标题）、两个插件行与菜单行；无浏览器错误 |
| `settings-page` | 是 | fetch 白名单编辑器逐行诊断无效 CIDR、只在显式保存时写入；search 行设置页稀疏保存并清除默认连接 |
| `composer-menu` | 是（独立 home） | 在菜单里把搜索设为关闭：选择持久化，真实 Web preset 的 `web_search` 被隐藏，恢复后回来（独立 home） |
| `fetch-menu` | 是（独立 home） | 在第二个分区选 DeepSeek Fetch API 并持久化为会话选择；关闭抓取不影响搜索，再恢复 Local HTTP（独立 home） |
| `menu-rows-off` | 是 | search、fetch、两者分别停用：菜单只剩可用分区，两者都停用时没有按钮，概览说明不可用的能力 |
| `ui-row-off` | 是（独立 home） | 叠加 `disable-ui.yml` 与 `command-defaults.yml`：ui 行停用时两个插件的设置页仍能从插件页打开；没有输入框按钮时 `/setup-search`、`/setup-fetch` 的选择能持久化并恢复 |
| `remote-fetch-api` | 否 | 回环假服务本身：记录方法、原始路径、请求头与请求体而不访问目标 URL；可替换回复并保留全部请求 |
| `fetch-remote` | 否（独立 home） | 真实 Host 上的远程抓取：自定义 `custom:e2e-firecrawl`（`trustedEndpoint: true`，端点为回环假服务，测试专用凭据）把编码过的回环 URL 与私网 `http://10.0.0.1/x` 原样转发，请求为 `POST /v2/scrape`、Bearer、体 `{ url, formats: ['markdown'] }`，结果映射为 text、200；同一 URL 交给 `local` 时报 `WEB_BLOCKED_URL` 且假服务没有多收到请求；凭据只用 `describe` 检查，结束时删除 |
| `fetch-remote-ui` | 是（独立 home） | 菜单里 keyless 的远程服务可选、Tinyfish 缺密钥时不可选并能导航到设置；选 keyless Firecrawl 并持久化，只改变下一步的计划（通过 local 白名单的系统上下文观察）；Tinyfish 只写的密钥录入；经行设置页保存一个已信任的自定义连接，冷启动 Host 后仍在。内置远程服务只检查可选性与就绪状态，不对它们发起抓取 |
| `upgrade` | 是（独立 home） | 前身 0.1.x（共存模式、两侧已保存设置、关闭搜索的会话）→ 移除 → 安装 profile：组合与用户层不变；Host 对两侧报 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`，启动日志点名 `providerId` / `allowCidrs` 且不改写，Remote 返回 `<ns>/invalid-settings`，两个菜单分区显示“设置无效”与设置入口而不是重试；概览的三类预检提示，取消不写、确认后才修复路由；两个设置页显示无效与 Reset，Reset 后恢复默认；旧会话的关闭保留 |
| `review-settings-visuals` | 是（独立 home） | 界面评审的补充截图：1280 × 浅 / 深色 × 自定义连接列表、新建自定义连接表单（含信任确认）、Firecrawl 个人密钥与三态参数 On、Tavily 面板、Tinyfish 面板、中文设置页、中文菜单、search 实时性（SegmentedControl），另加 390 浅色下的表单、Firecrawl 与中文菜单三个点位；截图 `review-fetch-<view>-<width>-<scheme>.png`（表单另有 `-trust`）；自定义连接指向回环假服务，结束时断言它没有收到任何请求，并恢复主题与 profile patch |
| `screenshots` | 是 | 1280 / 768 / 390 × 浅 / 深色 × search 设置页 / fetch 设置页 / 菜单 / 概览 / fetch 远程服务设置（展开 Firecrawl）/ fetch 远程连接菜单（Exa、Firecrawl、Tavily 可选，Tinyfish 缺密钥），截图 `.e2e/artifacts/<view>-<width>-<scheme>.png`；390 宽的菜单再缩到 360 宽补拍 `composer-menu-360-<scheme>`，并断言按钮的可访问名称不变；软断言概览标题对比度 ≥ 4.5、运行中的能力不被报告为停用、菜单里两个分区标题都在可见区域内；整个矩阵无浏览器错误 |

GUI 规格在找不到 Chromium 且未设置 `CI` 时跳过。

### 9.8 e2e fixtures

| 文件 | 内容 |
| --- | --- |
| `host-plane.yml` | 进程内 Host 用：停用 `web-startup`、`webserver`、`web-runtime`、`modules`，并把 `connection` 行的 `inject` / `config` 清空，保证不绑定端口 |
| `disable-search.yml` / `disable-fetch.yml` / `disable-ui.yml` | 停用对应的插件行或 ui 行 |
| `command-defaults.yml` | search 的 `defaultConnection: builtin:openalex`（keyless 且就绪），让命令往返不依赖凭据 |
| `remote-fetch.ts` | `remoteFetchFixture`（连接 id、label、凭据名与测试密钥、编码过的请求 URL、正文）、`customFetchDocument(endpoint)`（指向回环端点、已信任的自定义 Firecrawl 连接）、`firecrawlResponse(url)` |
| `fetch-allow-loopback.yml` | 整行替换 fetch 配置：`builtin:local` 放行 `127.0.0.1/32`、User-Agent `wfe-e2e/1.0` |
| `fetch-native-route.yml` | `web` 行：`searchProvider: search-enhanced`、`fetchProvider: http` |
| `upgrade-coexist.yml` | 前身共存模式的用户层：重新启用 `web-search-deepseek`、两侧的 0.1.x 配置、`web` 行 `enhanced-search` / `http` |
| `upgrade-fetch-route.yml` | 升级后的临时路由：两个字段都指向本插件 |
| `upgrade-legacy-session.ts` | 在独立进程里用前身的域声明写入一个关闭搜索的会话记录 |

## 10. 约定与不变量在代码中的落点

逐条对应 [AGENTS.md](../AGENTS.md) 的 Invariants。

| 不变量 | 代码落点 | 守护（测试 / 检查） |
| --- | --- | --- |
| 标识只在 `ids.ts` 定义一次；行 id = 包名去掉 `dsh-`；Cordis 插件名 = 行 id；两族命名 | `core/src/shared/ids.ts`；各包 `index.ts` 的 `name = <ID>.rowId` | `profile.spec.ts`（"names every row it inserts after its package"、路由断言）；e2e `profile` |
| profile 一起写 `web` 的两个字段；仓库里别处不写 `web` 行；切换后端不碰它 | `profile/cordis.patch.yml`；后端切换只写 storage-domain；唯一的另一处是 ui 概览在确认后 `unset` 用户层字段（`preflight.ts` `buildUnsetOps`） | `profile.spec.ts`；`ui/tests/client-components.spec.tsx`（ProfileDetailSection）；e2e `upgrade` |
| 每个插件只注册一个 provider | `Capability.register`：search `createSearchSeat` + `registerSearchProvider`，fetch `registerFetchProvider`；新后端只进目录与 `target` | 两侧 `plugin.spec.ts`（seat）；e2e `profile` |
| Host 产物自包含：运行时只导入 Node 内置与 `@deepseek-ai/*`，没有 `dependencies` | `build/tsdown.ts` 的 `neverBundle` / `alwaysBundle` | `scripts/verify-packages.ts` 第 7 项（含"导入的 DSH 包必须是 peer"） |
| search 与 fetch 互不导入；共享代码进 core；core 无模块级状态 | core 的有状态对象都在 `installCapability` / `createConnectionsService`（每次安装一个新类）/ 组件工厂里创建 | 没有专门的自动检查，靠评审；当前 `src` 无跨包导入、core 无顶层 `let` / `var` |
| `available()` 不做 I/O | 两个 seat 都是 `() => true`；`createLocalBackend` 同样 | fetch `local-provider.spec.ts`、`native.spec.ts`；两侧 `plugin.spec.ts` |
| 带凭据的请求 `redirect: 'error'` | `core/src/host/transport.ts` `send`（两侧 adapter 的 REST 与 MCP 都经它） | core `adapter.spec.ts`（"rejects API redirects without visiting the target or exposing the key"）；search `transport.spec.ts`；fetch `remote-execute.spec.ts` |
| 密钥只在 DSH Credentials，设置只存 `credentialRef`；密钥值在发请求前校验 | `CredentialEditor` → `remote.credentials.set`；`resolveApiKey`；`nativeAuth`（仅 Credentials 服务不存在时回退启动环境，与原生行一致）；`runAdapter` 的 api-key 分支（去首尾空白，只接受可见 ASCII 与空格） | 两侧 `client-settings.spec.tsx`（"keeps keys in Credentials…"、"saves a key through Credentials only…"）；两侧 `native.spec.ts`（"treats the credential service as authoritative"）；core `adapter.spec.ts`（"rejects malformed … credentials before request construction, network or diagnostics"） |
| keyless 从不读、发或回退到密钥；keyless 永远发往目录端点 | core `runAdapter` 的 keyless 分支不调用 `credential`；`adapterTarget` 把 keyless 目标改写为目录端点；`Auth { kind: 'keyless' }` 不带头 | core `adapter.spec.ts`（"never resolves or sends credentials on the keyless %s route"、"does not fall back to credentials…"、"binds keyless access to the catalog endpoint…"）；search `adapters.spec.ts`；fetch `composition.spec.ts`（"uses the immutable %s keyless directory endpoint without secret headers"） |
| 不自动重试、不 fallback | 传输与执行层没有重试；默认连接不可选时报错，不选"唯一可用"的连接 | fetch `native.spec.ts`（"without API-key fallback or retry"）、`resolver.spec.ts`；search `selections.spec.ts`（"does not guess a sole available connection"）、两侧 `settings.spec.ts`（停用的默认连接不被替换） |
| 两侧一个选择范式；`null` = 关闭（Seat 报错 + `tools.restrict`） | `core/src/host/runtime.ts`、`sessions.ts`、`restriction.ts`；两侧只给 `Capability` 参数 | core `restriction.spec.ts`；两侧 `agent.spec.ts`、`host.spec.ts`；e2e `composer-menu`、`fetch-menu` |
| 只冻结"哪个连接"（与会话参数）；可选性每次调用按 `isSelectable` 判定；目标每次重建 | `plans.ts` `planFor` / `Snapshots`；`runtime.ts` `invoke`；`Capability.target` | core `plans.spec.ts`（"rechecks both newly enabled and newly disabled…"）、`snapshots.spec.ts`；search `host.spec.ts`（"freezes each step but reads tightened operational policy…"）；fetch `host.spec.ts` |
| 限制只在确认 `web` 行路由到本插件时安装 | `restriction.ts` `sync` 依赖 `routed()` = `routeFacts(...).kind === 'this'`；读不到为 `unknown` | core `restriction.spec.ts`；两侧 `host.spec.ts`（"does not assume a route when the public web settings row is absent"） |
| 一份设置文法、一个纯函数；自定义端点 / 非官方 `url` 参数需 `trustedEndpoint`；拒绝危险键；文本与条数有界 | `core/src/shared/settings.ts`；两侧 `settings/resolve.ts`；设置页的信任绑定在 `ServiceFields.tsx` 与 `ConnectionEditor.tsx` | core `settings-grammar.spec.ts`、`settings-migration.spec.ts`（bounded validation）；两侧 `settings.spec.ts`（危险键、端点信任） |
| 不读也不迁移 0.1.x 设置：Host 拒绝（插件照常激活）、设置页点名字段并提供 Reset；未来版本经 `migrateDocument` 的 N→N+1 表 | `settingsRow`；`RETIRED_FIELDS`；`SETTINGS_MIGRATIONS`（空）；`useSettingsDocument` | 两侧 `plugin.spec.ts`（退役字段、Reset）、`client-settings.spec.tsx`；core `client-migration.spec.tsx`；e2e `upgrade` |
| fetch：只有 `local` 检查目标地址；空白名单 = 原生 public-only；经代理的域名由代理解析 | `local/backend.ts`、`address-policy.ts`、`resolver.ts` | fetch `rules.spec.ts`、`resolver.spec.ts`、`proxy.spec.ts`、`local-provider.spec.ts`；e2e `fetch-allowlist`、`profile`（public-only） |
| 远程后端：服务负责目标访问策略；拒绝 API 重定向；保留取消；界面说明谁收到 URL；fetch 的远程结果按共同规则映射 | 没有地址检查，URL 原样进请求体；`services.remoteNotice` 文案（`Descriptor.remote` 驱动，自定义连接行也有）、fetch 菜单的 `status.remoteReady`；`remote/page.ts` 的 `fetchResult` / `statusPage` / `pageFailure` | search `transport.spec.ts`、`adapters.spec.ts`（取消）；fetch `native.spec.ts`、`remote-execute.spec.ts`（取消）、`remote-page.spec.ts`、`adapter-*.spec.ts`、`composition.spec.ts`（私网与 localhost URL 原样转发）；e2e `fetch-remote` |
| `native` 后端实例化 DSH 导出的 provider 类，只改写错误消息 | 两侧 `backends/*` + core `native.ts` | 两侧 `native.spec.ts`；core `native.spec.ts` |
| 自己的出站只用全局 `fetch` | `core/src/host/transport.ts`（没有自建 dispatcher） | search `transport.spec.ts`（真实 HTTP 边界） |
| 给模型的错误是 `WebError` + 已有的 `WEB_*` 码 + 简短英文，不含上游正文或密钥 | `CapabilityErrorCode`；`capabilityErrors`；`restateNative`；fetch `pageFailure`（连接 label + 固定文案）；诊断只进 `OnDiagnostic`；Remote 的 `boundary` 对浏览器同样只给固定消息 | 两侧 `native.spec.ts`（"without endpoint, upstream body, cause…"）；search `transport.spec.ts`；fetch `remote-execute.spec.ts`（"logs unknown failures and rewrites them to a fixed, secret-free WebError"）；core `remote.spec.ts` |
| 界面文字走各包 `src/client/locales.ts`（zh / en 同键）；`locale/*.json` 只放 `meta` | 第 8.8 节 | 各包 `client-locales.spec.ts`；verify-packages 第 5 项 |

## 11. 与设计文档的对照

路线图（M4–M6）、风险与已知限制只在 [architecture.md 第 13 节](architecture.md#13-路线图与扩展点) 与 [第 14 节](architecture.md#14-风险与已知限制) 维护，本文不重复。代码里为计划留的位置只有一处：`BackendKind` 与 `isSelectable` 已包含 `model`（search 的 `model` 连接，M4）；目录与设置校验目前不接受 `builtin:session-model` / `kind: model`。

整理本文时发现的不一致：

| 位置 | 现状 | 说明 |
| --- | --- | --- |
| locale 键集合的来源 | search、fetch 以 `en` 定义 `LocaleKey`（search `locales.ts` 的文件注释却说 zh 为主），ui 以 `zh` 定义 | 不影响“同键”约束，只是两种写法 |

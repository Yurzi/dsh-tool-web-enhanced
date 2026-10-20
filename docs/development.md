# 开发指南

本文讲怎么在这个仓库里干活：环境、命令、日常改动走哪些文件、测试怎么写、e2e 怎么跑和排查、怎么升级 DSH 基线与发布。设计与不变量见 [architecture.md](architecture.md)，文件级的现状结构见 [code-structure.md](code-structure.md)。

## 1. 环境

- Node `^22.19.0` 或 `>=24.0.0`（脚本直接用 Node 的类型剥离运行 `.ts`；CI 在 22.19.0 与 24 上各跑一遍 `check`）
- pnpm 12（版本见根 `package.json` 的 `packageManager`，当前 `pnpm@12.14.0`）
- e2e 另需 Chromium 或 Chrome（见第 8.2 节）；首次跑 e2e 需要网络（安装 DSH、前身包）

### 1.1 本地缓存目录约定

在仓库根执行任何 pnpm / npm 命令前，先把它们的家目录指到仓库里，免得读写你自己的 pnpm store、缓存和 XDG 状态：

~~~sh
export PNPM_HOME=$PWD/.pnpm-home \
  XDG_CACHE_HOME=$PWD/.xdg/cache \
  XDG_DATA_HOME=$PWD/.xdg/data \
  XDG_STATE_HOME=$PWD/.xdg/state \
  npm_config_cache=$PWD/.npm-cache
~~~

这些目录（`.pnpm-home/`、`.xdg/`、`.npm-cache/`、`.pnpm-store/`）都在 `.gitignore` 里。它们只管开发命令本身；e2e 另有一套更彻底的隔离（第 8.1 节），与这里的设置无关。

开发时不要碰你自己的 DSH home（`~/.dsh`）和正在运行的 GUI：单元测试只在内存里组装 DSH，e2e 在 `.e2e/run` 里建自己的世界，`dsh web` 只监听 127.0.0.1 上的随机端口。

## 2. 命令

| 命令 | 作用 |
| --- | --- |
| `pnpm install` | 安装依赖（CI 用 `--frozen-lockfile`）。新增依赖要先征得同意 |
| `pnpm run check` | 提交前必须通过，依次执行下面五步，任一步失败即停 |
| `pnpm run typecheck` | `tsc -p tsconfig.json`：覆盖 `packages/*/src`、`packages/*/tests`、`build`、`scripts`、`e2e` 与各处 `*.config.ts`；严格模式加 `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` |
| `pnpm run lint` | `oxlint --type-aware`（`.oxlintrc.json`：correctness 为错误；`no-floating-promises`、`import/no-cycle`、`rules-of-hooks` 等） |
| `pnpm run build` | 对 `packages/**` 中有 `build` 脚本的包（search、fetch、ui）先清 `lib/` 再 `tsdown`；profile 与 core 不构建 |
| `pnpm run test` | `vitest run`：全部单元与组合测试 |
| `pnpm run verify:package` | 打包并检查每个可发布包（第 10 节、architecture.md 第 12 节） |
| `pnpm exec vitest run packages/<pkg>/tests/<file>.spec.ts` | 单个测试文件；加 `-t '<用例名的一部分>'` 只跑匹配的用例 |
| `pnpm exec vitest packages/<pkg>/tests` | 监听模式 |
| `pnpm run test:coverage` | v8 覆盖率，范围 `packages/*/src/**`，输出 text-summary 与逐文件表 |
| `pnpm run test:e2e` | 先构建，再跑隔离的真实 DSH 端到端测试（不在 `check` 里） |
| `pnpm run build && pnpm exec vitest run --config vitest.e2e.config.ts e2e/<spec>.e2e.ts` | 单个 e2e 规格（全局准备仍会安装 DSH、打包全部包并装好 profile） |

## 3. 仓库结构概览

五个包加三个工具目录，详细到文件的说明见 [code-structure.md](code-structure.md)：

| 位置 | 包 | 一句话 |
| --- | --- | --- |
| `packages/profile` | `dsh-tool-web-enhanced-profile` | bundle：`cordis.patch.yml`、locale、icon，没有代码 |
| `packages/search-enhanced` | `dsh-web-search-enhanced` | search 插件：目录、adapter、MCP 客户端、native 后端、实时性、设置解析、Host 装配与浏览器面 |
| `packages/fetch-enhanced` | `dsh-web-fetch-enhanced` | fetch 插件：目录、`local`（白名单、解析器）、native 后端、白名单提示、设置解析、Host 装配与浏览器面 |
| `packages/ui` | `dsh-tool-web-enhanced-ui` | 空的 Host 面；浏览器面提供 `webConnections`、输入框菜单、首次启用提示、bundle 概览 |
| `packages/core` | `dsh-tool-web-enhanced-core`（private） | 源码级共享：`./shared`（同构）、`./host`（选择范式）、`./client`（分区契约与设置页骨架），构建时内联 |
| `build/` | — | 唯一的 tsdown 构建工厂、平台模块表、装饰器与 CSS Modules 插件、测试用的 `primitivesStub` |
| `scripts/` | — | 工作区发现与打包、发布前检查、清理 |
| `e2e/` | — | 隔离的真实 DSH 套件：`harness/`、`fixtures/`、`*.e2e.ts` |

每个包的测试在 `packages/<pkg>/tests/`，`vitest.config.ts` 收集 `packages/*/tests/**/*.spec.{ts,tsx}`。

## 4. 日常工作流

先判断改动属于哪一类，再动对应的文件与测试。行为变化一律同步文档（第 12 节）。

| 要改什么 | 改哪里 | 跑哪些测试 |
| --- | --- | --- |
| **设置格式**（文档字段、连接字段、预算、版本） | 文法与预算：`core/src/shared/settings.ts`；插件派生：`<pkg>/src/settings/resolve.ts`、`types.ts`、`retired.ts`；Host 行：`core/src/host/settings-row.ts`；浏览器：`core/src/client/settings/document.ts`、`sparse.ts` | core 的 `settings-grammar`、`settings-migration`、`client-document`、`client-sparse`、`client-migration`；插件的 `settings.spec.ts`、`client-settings.spec.tsx` |
| **目录**（连接项、参数规则、默认值） | `<pkg>/src/catalog.ts`（fetch 的 `DEFAULT_LOCAL_SETTINGS` 是原生行的副本）；文案在 `<pkg>/src/client/locales.ts` | 插件的 `catalog.spec.ts`、`settings.spec.ts`、`client-settings*.spec.tsx` |
| **后端** | 见第 5 节 | 插件的 `adapters` / `native` / `local-provider` / `transport` / `mcp` 等对应测试，加 `host.spec.ts` |
| **选择范式**（会话、计划、限制、Remote） | `core/src/host/*`；两个插件的能力装配在 `<pkg>/src/host/runtime.ts` | core 的 `sessions`、`plans`、`snapshots`、`restriction`、`storage`；两个插件的 `agent.spec.ts`、`host.spec.ts`（search 还有 `selections.spec.ts`）——两侧都要绿 |
| **文案** | 界面文字：各包 `src/client/locales.ts`（zh 与 en 同键；键集的类型来源目前 search / fetch 取自 `en`、ui 取自 `zh`，新增键两边都要加）；插件页的标题与描述：`locale/{zh,en}.json` 的 `meta`（只放这些）；给模型的消息：Host 代码里的英文 `WebError` 文案 | 各包 `client-locales.spec.ts`（键集一致）；`verify:package` 检查 `meta`；改了给模型的消息要更新断言它的测试 |
| **样式** | 各包的 `*.module.css`（插件 `client/settings/Settings.module.css`、fetch `Allowlist.module.css`、ui `ComposerConnectionMenu.module.css`、`ProfileDetailSection.module.css`）；只用 DSH 的 `--dsw-*` 变量；窄屏用 container query | ui 的 `client-settings-appearance.spec.tsx`、`client-components.spec.tsx`；改观感后跑 e2e `screenshots` 看截图 |
| **身份**（包名、行 id、provider id） | 只在 `core/src/shared/ids.ts`；profile 的 patch 要同步 | `packages/profile/tests/profile.spec.ts`；e2e `profile`、`plugins-page` |
| **profile 组合** | `packages/profile/cordis.patch.yml`（`web` 行两个字段必须一起写） | `profile.spec.ts`；必须跑 e2e |
| **构建 / 打包** | `build/*`、`scripts/*`、各包 `package.json` | `pnpm run check`（含 `verify:package`）；改到客户端产物或 Host 产物形状时跑 e2e |

改设置格式的规则：新增可选字段不提升版本；不兼容的变化要提升 `CURRENT_SETTINGS_VERSION`，并在 `SETTINGS_MIGRATIONS` 加一个 N→N+1 的纯函数迁移步骤和它的测试。不要为 0.1.x 的格式写迁移（architecture.md 8.2、8.3）。

触碰以下内容时必须跑 e2e：profile 的 patch、provider 注册、插件页相关的 package.json 字段或 locale、浏览器面、DSH 基线版本。

## 5. 新增一个后端

以 search 的 adapter 为例（其他种类的位置见下面的表与 architecture.md 第 7 节）：

1. 在 `src/catalog.ts` 加一条 Descriptor：`label`、`kind`、`remote`、`endpoint`、`homepage`、`access`（`keyless` / `apiKey.credentialRef` / `account`）、`freshness`（哪些访问方式支持实时性）、`options`（`OptionRule`）。位置就是显示顺序；
2. 把键加进 `ADAPTER_KEYS`；
3. 新建 `src/search/adapters/<键>.ts`，实现 `Adapter` 的 `request` / `parse`；目录标为 keyless 时必须提供 `keyless: 'rest'` 或一个 `McpRoute`，否则 `ADAPTER_WIRES` 的 `satisfies` 编译失败；
4. 在 `src/search/adapters/index.ts` 的 `ADAPTER_WIRES` 登记；
5. 文案：`src/client/locales.ts` 里的连接说明（远程服务写明查询会发给谁）、参数名、占位符、枚举值，zh 与 en 同键；
6. 测试（`tests/adapters.spec.ts` 一类）：用本地 HTTP 服务充当远程 API，覆盖请求形状与请求头、响应映射与来源过滤、API 重定向被拒且目标未被访问、取消、HTTP 错误与畸形响应的改写、keyless 不发送密钥；
7. 同步 architecture.md 6.4 的目录说明、search 的 README 与 CHANGELOG。

| 插件 · 种类 | 额外要碰的位置 |
| --- | --- |
| search · native | `src/backends/<键>.ts`（实例化上游类，凭据用 core 的 `nativeAuth`，包装用 `nativeBackend`）；`NATIVE_KEYS`；`backends/native.ts` 的 `createNativeBackend`；`settings/resolve.ts` 的 native 分支与 `NativeConnection['native']`。测试只测凭据与端点解析、错误改写（`native.spec.ts`） |
| fetch · native | `src/backends/<键>.ts`；`NATIVE_KEYS`；`backends/native.ts` 的 `createNativeFetchBackend`；`settings/types.ts` 的 `NativeConnection['native']`；浏览器面 `client/settings/ConnectionExtras.tsx` 与 `client/settings/model.ts` 里按 `deepseek-fetch-api` 写死的分支 |
| fetch · adapter | 还没有：需要先设计 fetch 的 adapter 接口与结果语义（architecture.md 6.6，M3） |

不需要改 profile、`web` 行、Seat、Planner 或输入框菜单。新行为只能进 Planner（选哪个后端）或某个后端（怎么取），不能注册第二个 provider。

## 6. 新增一个能力插件

现在 `ctx.web` 只有 search 与 fetch 两种能力，core 里的 `Capability.tool` / `field` 与浏览器的 `CapabilityName` 都是这两个值的封闭联合，ui 的概览与停用判断也按两者写死。所以新增第三种能力要从放宽这些类型开始；下面的清单以现有两个插件为模板：

1. **身份**：在 `core/src/shared/ids.ts` 加 `PluginIdentity`（npm 名 `dsh-web-<能力>-enhanced`，行 id 去掉 `dsh-`，provider id）；放宽 `Capability.tool` / `field`、`CapabilityName`、`WEB_FIELD` / `WEB_ENV`；
2. **包骨架**：`packages/<能力>-enhanced/`，`package.json` 照抄现有插件（`type: module`、`main`、`exports` 含 `./client`、`files`、`engines`、`dsh.client.inject`；`@deepseek-ai/*` 只放 peer 与 devDependencies，范围等于 `engines.dsh`；没有 `dependencies`；`dsh-tool-web-enhanced-core` 为 `workspace:*` devDependency），`tsdown.config.ts` 一行 `pluginBuild(import.meta.url)`，`locale/{zh,en}.json` 的 `meta`，`icon.svg`，README；
3. **目录与设置**：`src/catalog.ts`；`src/settings/resolve.ts` 建在 `resolveDocument` 上（`defaults` schema、默认连接、是否允许自定义连接）；`retired.ts`（新包可为空数组）；
4. **契约**：`src/contract.ts` 用 `selectionContract({ namespace, packageName, options, extras })`，并把 `ConnectionsRemoteMap` / `ConnectionsRemoteErrors` 合并进 DSH 的类型表；
5. **Host**：`src/host/options.ts`（`OptionsCodec`）、`connections.ts`（`describe`，用 `credentialReadiness`）、`runtime.ts`（`Capability` 对象 + `installCapability`）、`remote.ts`（服务类型声明）；`src/index.ts` 用 `settingsRow` 导出 `name`、`inject`、`Config`、`apply`；
6. **浏览器面**：`locales.ts`、`ConnectionSelectionStore`、`RouteStatus`、`PairingsStatus` / `CredentialStatus`、`ConnectionSection`（取一个新的 `order`）、`selectionCommand` 生成 `/setup-<能力>`、用 core 的组件工厂拼设置页；`src/client/index.tsx` 注册行设置页（`configForms.whileServed`）、可选注入 `webConnections`、命令；
7. **组合**：profile 的 `cordis.patch.yml` 插入行、`package.json` 的 `dependencies`；`profile.spec.ts` 的断言；如果新能力要写 `web` 行的新字段，profile 必须一次写全所有字段；
8. **ui**：概览卡片、停用判断与预检里加上新能力；
9. **测试**：插件的 `host.spec.ts`、`agent.spec.ts`（真实 Web preset）、`plugin.spec.ts`、客户端测试；e2e 的组合、菜单与截图；
10. **文档**：architecture.md（对位、命名表、6.3 的差异表）、code-structure.md、本文、README 与 CHANGELOG。

## 7. 测试约定

- **在接缝处用真实组合**：在真实 `WebRuntime` 里注册插件；profile 的 patch 用真实的 include 补丁算法（`@deepseek-ai/cordis-plugin-include`）叠加到 base 的 web 行上；会话行为在 `@deepseek-ai/dsh-agent-loop-testkit` 与 `@deepseek-ai/dsh-session-projection` 组装的真实 Agent 上测，`agent.spec.ts` 用真实的 Web preset 检查工具隐藏；fetch 的 `local` 用本地 HTTP 服务、本地代理和可替换的 DNS 查询函数（`AddressLookup`），不访问外网。
- **只 mock 网络与时钟**：远程 API 用本地 HTTP 服务代替，超时用假时钟；不 mock core、DSH 服务或我们自己的模块，不嗅探 DSH 的私有内部。
- **failing-first**：每个 bug 修复先写一个在修复前失败的测试，再改代码。
- **core 的回归保证**：search 迁移到 core 时只改了测试的导入、没改行为断言；改 core 时两侧插件的测试都必须保持通过。
- **jsdom 环境**：浏览器面的测试文件第一行写 `// @vitest-environment jsdom`，用 `@testing-library/react` 或 `react-dom/client` 渲染真实的 DSH 界面原语（`@deepseek-ai/dsh-client-ui-primitives` 经 `server.deps.inline` 内联）。
- **`primitivesStub()`**（`build/plugins.ts`，只在 `vitest.config.ts` 里用）：发布的 `dsh-client-ui-primitives` 引用了它没有声明、本仓库也没装的实现库（shiki、katex、micromark、simple-icons、clsx…）。只有解析不到的库被换成惰性存根，能解析的一律用真的；`clsx` 给一个真实的最小实现，保证 `className` 仍是字符串；顺带去掉它指向不存在文件的 sourcemap 注释。
- **`zustand`、`immer` 是根 devDependencies**：发布的 `dsh-client-store` 在运行时导入它们却没有声明依赖，测试里要由工作区提供。插件产物不受影响：`dsh-client-store` 是平台模块，浏览器里由 DSH 提供。
- 这两处补丁不要在没有核对 DSH 发布包的情况下删除；升级 DSH 基线时复查（第 9 节）。
- 测试同样用 `standardDecorators()` 降级 `@Remote`、用 `cssModules('test')` 编译样式，和构建走同一套插件。

## 8. 端到端测试

### 8.1 隔离的世界

`pnpm run test:e2e` 先构建，再执行 `vitest.e2e.config.ts`。全局准备（`e2e/global-setup.ts`）：

1. 清空 `.e2e/run` 与 `.e2e/artifacts`，把 HOME、DSH_HOME、XDG_*、TMPDIR、DSH_AGENTS_HOME、COREPACK_HOME、PNPM_HOME、npm 缓存全部指向 `.e2e/run` 下的子目录，并清除会泄漏开发者环境的变量（`DSH_*`、`DEEPSEEK_*`、`VITEST*`、`NODE_OPTIONS`、`NODE_PATH`、`NODE_ENV`），代理与 registry 设置保留；
2. 安装被测 DSH：版本取自 `pnpm-workspace.yaml` catalog 的 `@deepseek-ai/dsh-web`，装在 `.e2e/dsh-<version>`（先装进 `.partial` 暂存目录再改名，中断不会留下半个安装），之后复用；
3. 用 pnpm 打包所有可发布包到 `.e2e/run/tarballs`（与 `pnpm publish` 相同的改写，关闭生命周期脚本）；
4. 用 `dsh plugin --profile web add` 安装 profile 包，两个插件与 ui 经 profile 的 pnpm `overrides` 指向本次打包的 tarball。

进程内的 Host 由 `e2e/harness/host.ts` 按 CLI 的步骤启动（`@deepseek-ai/dsh-app-boot`），叠加 `fixtures/host-plane.yml` 去掉 GUI 相关的行，不绑定端口；GUI 由 `e2e/harness/web.ts` 启动 `dsh web`，监听 127.0.0.1 上 OS 分配的空闲端口，从不用 3080。规格文件串行执行（`fileParallelism: false`），默认共用一个 profile；会写会话草稿或要多次重启 GUI 的规格用 `upgradeEnvironment()` 在 `.e2e/run/upgrade-*` 下拿一个独立的 home。

### 8.2 环境变量

| 变量 | 作用 |
| --- | --- |
| `DSH_E2E_INSTALL` | 指向已有的 DSH 安装目录（其 `node_modules/@deepseek-ai/dsh` 的版本必须等于 catalog 版本），不再下载 |
| `DSH_E2E_CHROMIUM` | Chromium / Chrome 可执行文件；缺省依次尝试 `/usr/bin/chromium`、`/usr/bin/chromium-browser`、`/usr/bin/google-chrome` |
| `DSH_E2E_PREDECESSOR_SEARCH` | `upgrade` 用的 search 前身 checkout（必须是已构建的 `dsh-web-search-enhanced@0.1.10`）；缺省从 npm 安装该版本 |
| `DSH_E2E_PREDECESSOR_FETCH` | `upgrade` 用的 fetch 前身 checkout（必须是已构建的 `dsh-web-fetch-enhanced@0.1.0`）；缺省从 npm 安装该版本 |
| `CI` | 设置时缺少浏览器直接失败，而不是跳过 GUI 规格 |

前身变量在进入隔离环境之前读取；显式给出但无效的路径（空串、没有 `package.json`、名字或版本不对、没构建）直接报错，不会悄悄改走 npm。CI 用 `pnpm exec playwright-core install chromium` 装浏览器并把路径交给 `DSH_E2E_CHROMIUM`。

### 8.3 规格与覆盖点

| 规格 | 需要浏览器 | 覆盖 |
| --- | --- | --- |
| `profile` | 否 | 安装后 bundle 层被选中、插件装在它下面；组合（`--dump-config`）：`web` 行两个字段、停用 `web-search-deepseek`、插入三行；进程内 Host 的路由：search 落到本插件（无密钥时 `WEB_PROVIDER_CREDENTIAL_MISSING`），fetch 落到本插件并保持 public-only（`WEB_BLOCKED_URL`）；search、fetch、两者分别停用时菜单行照常、被停用的能力报 `WEB_PROVIDER_CONFIGURED_MISSING` |
| `fetch-allowlist` | 否 | 用 `--patch` 放行 `127.0.0.1/32` 后真实 Host 能抓取本地 HTTP 服务、发出配置的 User-Agent、系统提示含白名单说明；无覆盖时 `WEB_BLOCKED_URL`；`web_fetch` 路由给原生 `http` 时不加提示 |
| `plugins-page` | 是 | 插件页显示 bundle 自己的标题、两个插件行与菜单行；无浏览器错误 |
| `settings-page` | 是 | fetch 白名单编辑器逐行诊断无效 CIDR，只在点“保存”时一次写入两个数组；search 行设置页稀疏保存并清除默认连接。结束时恢复用户层文件 |
| `composer-menu` | 是（独立 home） | 在菜单里关闭搜索：选择持久化，真实 Web preset 的 `web_search` 被隐藏，恢复后回来 |
| `fetch-menu` | 是（独立 home） | 在菜单第二个分区选 DeepSeek Fetch API 并持久化为会话选择；关闭抓取不影响搜索，再恢复 Local HTTP。结束时清掉测试写入的密钥与模型记忆 |
| `menu-rows-off` | 是 | search、fetch、两者分别停用：菜单只剩可用的分区（两者都停用时没有按钮），bundle 概览说明不可用的能力 |
| `upgrade` | 是（独立 home） | 真实前身 0.1.x bundle（共存模式、两侧已保存设置、关闭搜索的会话）→ 移除 → 安装 profile；组合与用户层文件不变；Host 拒绝旧配置且日志点名字段；概览修复取消不写、确认才写；两个设置页显示无效提示，Reset 后行配置为空；冷启动后旧会话的关闭保留、新会话用默认连接 |
| `screenshots` | 是 | 1280 / 768 / 390 三种宽度 × 浅色 / 深色 × search 设置页 / fetch 设置页 / 菜单 / 概览；断言概览健康（含标题对比度 ≥ 4.5、运行中的能力不被报告为停用）、菜单里两个分区标题都可见、浏览器无错误 |

### 8.4 截图与证据

都在 `.e2e/artifacts`（CI 无论成败都上传为 `e2e-artifacts`）：

- `web.log`：`dsh web` 的输出；
- `<view>-<width>-<scheme>.png`：`screenshots` 的矩阵（截图在断言之前保存，回归时也留证据）；
- `upgrade-*.png`、`upgrade-*.json`、`upgrade-*.log`、`upgrade-old-composed.yml`：升级场景各阶段的截图、安装的前身清单、旧组合、无效配置时的 Host 日志、控制台错误；
- `<spec>-failure.json` / `.png`：GUI 规格失败时记录的 URL、控制台错误、可访问性快照与整页截图。

### 8.5 常见失败与排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| Chromium 启动失败，提示 SingletonSocket / socket 路径过长 | Linux 的 Unix socket 路径上限 108 字节；升级场景的 home 嵌套很深 | `openApp` 已把 Chromium 的 `TMPDIR` 设为 `.e2e/run`；如果仓库本身的路径就很长，把 checkout 移到更短的路径 |
| 进程内 Host 加载了工作区里的新插件，而不是 profile 里装的版本；`upgrade` 报前身 “was not selected as a predecessor bundle” | pnpm 的 vitest shim 把工作区的 `.pnpm/node_modules` 放进 `NODE_PATH`，Node 的全局查找路径让它优先 | 全局准备删除 `NODE_PATH`，隔离环境过滤它，`vitest.e2e.config.ts` 的 `execArgv: ['--no-global-search-paths']`，前身会话的子进程也带同一参数。自己起子进程时同样加上，不要绕开 harness 直接调 vitest 二进制 |
| GUI 规格偶发找不到元素、工作区选择器被打断、会话草稿串了 | 共用 home 的规格会恢复彼此持久化的输入框草稿与布局 | 会建会话、写草稿或多次重启 GUI 的规格用 `upgradeEnvironment(inject('e2e'))` 拿独立 home 并自己 `addPlugins`；改了共享状态的规格（用户层、密钥、模型记忆）在 `afterAll` 里恢复 |
| 打包前身 checkout 时 pnpm 去下载另一个 pnpm，或因 `packageManager` 不匹配而失败 | 前身的 `packageManager` 字段触发 pnpm 的版本管理 | harness 用 `--config.manage-package-manager-versions=false --config.package-manager-strict=false --config.ignore-scripts=true` 打包；手工打包时照做 |
| `DSH_E2E_INSTALL=… holds no @deepseek-ai/dsh` 或 “has DSH x; the e2e suite targets y” | 指定的安装不存在或版本与 catalog 不符 | 指向正确版本的安装，或取消该变量让套件自己安装 |
| `dsh web printed no launch URL in 90 s` | GUI 没起来 | 看 `.e2e/artifacts/web.log` |
| 本地 GUI 规格全被跳过 | 找不到浏览器且没有设置 `CI` | 设置 `DSH_E2E_CHROMIUM` |

## 9. 升级 DSH 基线

1. **版本**：改 `pnpm-workspace.yaml` 的 catalog（全部 `@deepseek-ai/dsh-*`、`cordis*`、`schemastery`，以及匹配的 `dsh-agent-loop-testkit`），再改四个可发布包的 `engines.dsh` 与 `@deepseek-ai/dsh-*` peer 范围（verify-packages 检查它们一致）；同步 AGENTS.md 与 README 里的目标范围。
2. **base 组合**：对照新版 `packages/bundle/base/cordis.patch.yml` 更新 `packages/profile/tests/profile.spec.ts` 的 `BASE` 行。
3. **native 行**：对照新版 `web-search-deepseek` 的选项解析检查 `deepseek-messages`（导出的默认常量、`DEEPSEEK_SEARCH_BASE_URL`、`recordRequest`），对照 `web-deepseek-api` 检查 `deepseek-search-api`（`count`、`originalQuestion`）与 fetch 的 `deepseek-fetch-api`（`baseURL`），以及三者共用的凭据回调（`apiKeyEnv`、`resolveApiKey`、`resolveAccountToken`，见 core `nativeAuth`）；目录里的端点与参数规则跟着改。
4. **`HttpFetchProvider`**：构造签名 `new HttpFetchProvider(settings, resolve)` 与 `HttpFetchResolver(hostname, signal)` 的约定（返回已验证的地址组、用信号区分取消）、对 IP 字面量与代理的处理（`requestOnce`）、默认上限与 User-Agent（`src/catalog.ts` 的 `DEFAULT_LOCAL_SETTINGS` 是副本）、它抛出的 `WebError` 码。
5. **`ipaddr.js`**：catalog 版本与新版 `web-fetch-http` 的依赖一致；`src/local/rules.ts` 的非公网范围表与该版本 `range()` 的非 unicast 范围对齐。
6. **preset 与限制**：tool-web 仍由 agent preset 挂在 Agent 作用域的祖先上，`tools.get(tool, scope)` 与 `tools.restrict({ deny })` 的行为不变；`agent/request` / `agent/created` / `agent/disposed` 事件与 `currentInitiator()` 不变（两个插件的 `agent.spec.ts` 会发现）。
7. **Settings 投影**：Host 侧 `settings.describe()` 里 `ns = web` 的值、`settings/document-updated` 事件、`settings.configure`；浏览器侧 `configForms.get` / `whileServed` / `describe()` 的 `secrets`、`pluginNavigation`（是否仍只有 `openBundle`）、各槽位名。
8. **浏览器壳**：`build/platform.ts` 对照 DSH 的 `packages/client/web/src/platform.ts`；CSS Modules 的注入方式对照 DSH 的 `tsdown.client.ts`。
9. **测试补丁**：复查 `primitivesStub` 与 `zustand` / `immer` 是否仍需要。
10. **e2e 积木**：`e2e/harness/host.ts` 用到的 `dsh-app-boot` 导出、`fixtures/host-plane.yml` 里的行名、首次启动的对话框（`browser.ts` 的 locator handler）。
11. `pnpm run check` 与 `pnpm run test:e2e` 都通过后，在 CHANGELOG 记下基线变化。

## 10. 发布

四个可发布包（profile、search、fetch、ui）同一节奏发布（release train）；core 是 private，不发布。

1. 提升需要发布的包的版本；profile 的版本决定标签，只要任何一个包要发，profile 也要提升（它精确锁定其余三个包）；
2. 把 CHANGELOG 的 “Unreleased” 整理成各包的版本小节，同步 README；
3. 本地 `pnpm run check` 与 `pnpm run test:e2e`；
4. 打 `v<profile 版本>` 标签并推送。`publish.yml` 先核对标签与 `packages/profile/package.json` 的版本一致，再跑 `pnpm run check`，最后执行 `pnpm --recursive publish --access public --no-git-checks --provenance`（npm trusted publishing，OIDC 认证，不用 token）；registry 上已有的版本会被跳过。

打包时 profile 的 `workspace:*` 依赖变为精确版本；`verify-packages` 保证它等于本次工作区里的版本，且清单里没有残留 `workspace:` / `catalog:`。

## 11. 持续集成

`ci.yml` 在 push 到 main 与 PR 上运行：`check` 任务在 Node 22.19.0 与 24 上 `pnpm install --frozen-lockfile && pnpm run check`；通过后 `e2e` 任务在 Node 24 上安装 Chromium 并跑 `pnpm run test:e2e`（缺浏览器即失败），上传 `.e2e/artifacts`。

## 12. 文档同步规则

| 改动 | 要更新的文档 |
| --- | --- |
| 行为变化（模型可见的行为、设置格式、安全策略、界面能力） | architecture.md 的对应节、受影响包的 README、CHANGELOG 的 “Unreleased” |
| 文件、模块或目录的增删与职责变化 | code-structure.md；涉及 core 入口时同时改 architecture.md 4.3 |
| 命令、环境变量、测试约定、e2e 规格、发布流程 | 本文；e2e 规格增删时更新 8.3 的表 |
| 包身份、目录项、默认值 | architecture.md（4.4、6.4、8.1）与 README |
| 里程碑完成或推迟 | architecture.md 第 13、14 节与状态标记 |
| 文案 | 只改 `locales.ts` / `locale/*.json`，不必改文档，除非文档里引用了原文 |

architecture.md 是设计文档：设计原则（目标与非目标、DSH 参照、组合方式、选择范式、槽位分工、安全不变量）不随实现随意改；发现代码与原则矛盾时，先在 PR 里提出，再决定改代码还是改原则。

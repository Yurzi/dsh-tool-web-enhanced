# 开发指南

## 环境

- Node ^22.19.0 或 >=24（脚本直接以 Node 的类型剥离运行 `.ts`）
- pnpm 12（版本见根 package.json 的 `packageManager`）
- e2e 需要 Chromium 或 Chrome：`DSH_E2E_CHROMIUM=/path/to/chromium`，否则依次尝试常见系统路径

## 命令

| 命令 | 作用 |
| --- | --- |
| `pnpm install` | 安装依赖 |
| `pnpm run check` | typecheck → lint → build → test → verify:package；提交前必须通过 |
| `pnpm run build` | 构建所有插件包（`lib/`） |
| `pnpm exec vitest run packages/<pkg>/tests/<file>.spec.ts` | 单个测试文件 |
| `pnpm run test:coverage` | 覆盖率 |
| `pnpm run verify:package` | 打包并检查每个可发布包，见 [architecture.md 第 12 节](architecture.md#12-构建测试与发布-已实现) |
| `pnpm run test:e2e` | 隔离的真实 DSH 端到端测试 |

## 仓库结构

~~~text
packages/
  profile/          dsh-tool-web-enhanced-profile   bundle：cordis.patch.yml、locale、icon（无代码）
  search-enhanced/  dsh-web-search-enhanced         search 插件：src/ tests/ locale/ icon.svg
  fetch-enhanced/   dsh-web-fetch-enhanced          fetch 插件：同上
  ui/               dsh-tool-web-enhanced-ui        共用的输入框连接菜单（M0 为空的 Host 面）
  core/             dsh-tool-web-enhanced-core      private，源码级共享，构建时内联
build/              tsdown 构建工厂、平台模块表、装饰器与 CSS Modules 插件
scripts/            workspace.ts（发现与打包）、verify-packages.ts、clean.ts
e2e/                harness/（隔离环境、Host 启动、dsh web、浏览器）、fixtures/、*.e2e.ts
docs/               architecture.md、development.md
~~~

## 端到端测试

`pnpm run test:e2e` 先构建，再执行 `vitest.e2e.config.ts`：

1. 清空 `.e2e/run`，把 HOME、DSH_HOME、XDG、TMPDIR、npm/pnpm 缓存全部指向其中，并清除 `DSH_*`、`DEEPSEEK_*`、`NODE_OPTIONS` 等会泄漏开发者环境的变量；
2. 安装被测 DSH（版本取自 `pnpm-workspace.yaml` catalog 的 `@deepseek-ai/dsh-web`），缓存在 `.e2e/dsh-<version>`；`DSH_E2E_INSTALL` 可指向已有安装；
3. 用 pnpm 打包所有可发布包到 `.e2e/run/tarballs`；
4. 用 `dsh plugin --profile web add` 安装 profile 包，两个插件依赖经 profile 的 pnpm `overrides` 指向本次打包的 tarball（它们尚未发布）。

它从不读写你自己的 DSH home、profile 或正在运行的 GUI；`dsh web` 只监听 127.0.0.1 上的随机端口。截图和日志在 `.e2e/artifacts`。首次运行需要网络（安装 DSH）。

触碰以下内容时必须跑 e2e：profile 的 patch、provider 注册、插件页相关的 package.json 字段或 locale、浏览器面、DSH 基线版本。

## 升级 DSH 基线

1. 改 `pnpm-workspace.yaml` 的 catalog 版本，以及三个包的 `engines.dsh` 与 `@deepseek-ai/dsh-*` peer 范围（verify-packages 会检查它们一致）；
2. 对照新版 `packages/bundle/base/cordis.patch.yml` 更新 `packages/profile/tests/profile.spec.ts` 里的 `BASE` 行；
3. 对照新版 `web-search-deepseek` 的 `resolveOptions` 检查 `deepseek-messages` 后端；
4. `pnpm run check` 与 `pnpm run test:e2e`。

## 发布

三个包同一节奏发布：提升需要发布的包版本，profile 的 `workspace:*` 依赖在打包时变为精确版本；打 `v<profile 版本>` 标签，CI 执行 `pnpm -r publish`（已存在的版本跳过）。

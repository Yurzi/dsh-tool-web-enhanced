# dsh-tool-web-enhanced

增强 DeepSeek Harness 的 `web_search` 与 `web_fetch`：搜索和抓取各有多个后端，可以分别切换；模型看到的仍是 DSH 原生的两个工具。

```sh
dsh plugin --profile <profile> add dsh-tool-web-enhanced-profile
```

| 包 | 作用 |
| --- | --- |
| [dsh-tool-web-enhanced-profile](packages/profile/README.md) | 要安装的 bundle：挂载下面三个包，并在 `web` 行选中两个插件的 provider |
| [dsh-web-search-enhanced](packages/search-enhanced/README.md) | `web_search` 的 provider `search-enhanced`，内部切换搜索后端 |
| [dsh-web-fetch-enhanced](packages/fetch-enhanced/README.md) | `web_fetch` 的 provider `fetch-enhanced`，内部切换抓取后端 |
| [dsh-tool-web-enhanced-ui](packages/ui/README.md) | 输入框里两个能力共用的连接菜单、首次启用提示和插件页上的组合包概览（路由状态与升级检查） |

两个插件用同一种方式切换后端：运维在插件设置里定义可用的连接，每个会话从中选一个（或关闭）。

搜索有 9 个内置连接：原生 DeepSeek Messages / Search API，Exa、Firecrawl、Tavily、Tinyfish、OpenAlex、Semantic Scholar，以及跟随会话模型的模型搜索；抓取有 6 个：本机 HTTP(S)（可配置内网白名单）、DeepSeek Fetch API，以及 Exa、Firecrawl、Tavily、Tinyfish 远程读取服务。两侧都可以添加自定义连接（search 另可添加固定模型的模型搜索）。每个会话可以分别选择搜索与抓取连接或关闭。后续计划见[计划与路线图](docs/plan.md)。

从 dsh-web-search-enhanced / dsh-web-fetch-enhanced 0.1.x 升级：先移除这两个插件，再安装 profile。0.1.x 的行配置不再被读取——设置页会点名旧字段并提供“恢复默认”；会话的连接选择与模型记忆保留。详见[功能设计 · 从 0.1.x 升级](docs/design.md#从-01x-升级)。

- [架构](docs/architecture.md)：组成、组合与运行时结构、安全边界
- [功能设计](docs/design.md)：连接、会话选择、配置、各后端的行为、错误
- [开发流程](docs/development.md)：环境、命令、测试与 e2e、发布
- [代码结构](docs/code-structure.md)：目录、模块与测试清单
- [计划与路线图](docs/plan.md)

MIT © Yurzi

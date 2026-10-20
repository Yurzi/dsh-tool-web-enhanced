# dsh-tool-web-enhanced

增强 DeepSeek Harness 的 `web_search` 与 `web_fetch`：搜索和抓取各有多个后端，可以分别切换；模型看到的仍是 DSH 原生的两个工具。

```sh
dsh plugin --profile <profile> add dsh-tool-web-enhanced-profile
```

| 包 | 作用 |
| --- | --- |
| [dsh-tool-web-enhanced-profile](packages/profile/README.md) | 要安装的 bundle：挂载下面两个插件，并在 `web` 行选中它们 |
| [dsh-web-search-enhanced](packages/search-enhanced/README.md) | `web_search` 的 provider `search-enhanced`，内部切换搜索后端 |
| [dsh-web-fetch-enhanced](packages/fetch-enhanced/README.md) | `web_fetch` 的 provider `fetch-enhanced`，内部切换抓取后端 |
| [dsh-tool-web-enhanced-ui](packages/ui/README.md) | 输入框里两个能力共用的连接菜单、首次启用提示和插件页上的组合包概览（路由状态与升级检查） |

两个插件用同一种方式切换后端：运维在插件设置里定义可用的连接，每个会话从中选一个（或关闭）。

**状态：M0–M2 已完成。** 搜索有 8 个内置连接（原生 DeepSeek Messages / Search API，以及 Exa、Firecrawl、Tavily、Tinyfish、OpenAlex、Semantic Scholar）；抓取有本机 HTTP(S)（可配置内网白名单）与 DeepSeek Fetch API。每个会话可以分别选择搜索与抓取连接或关闭；M3 及以后的内容见[路线图](docs/architecture.md#13-路线图与扩展点)。

从 dsh-web-search-enhanced / dsh-web-fetch-enhanced 0.1.x 升级：先移除这两个插件，再安装 profile。0.1.x 的行配置不再被读取——设置页会点名旧字段并提供“恢复默认”；会话的连接选择与模型记忆保留。详见[架构文档第 11 节](docs/architecture.md#11-从-01x-升级)。

- [架构（设计）](docs/architecture.md)
- [代码结构（现状）](docs/code-structure.md)
- [开发指南](docs/development.md)

MIT © Yurzi

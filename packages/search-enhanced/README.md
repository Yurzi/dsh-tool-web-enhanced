# dsh-web-search-enhanced

Search half of [dsh-tool-web-enhanced-profile](../profile/README.md).
**Install the profile, not this package**: the profile mounts this package as
row `web-search-enhanced` and selects its provider in the shared `web` row.

| | |
| --- | --- |
| Row id | `web-search-enhanced` |
| Provider id in `ctx.web` | `search-enhanced` |
| Model surface | DSH's own `web_search` (tool-web), unchanged |
| Per conversation | one connection or Off, from the composer menu or `/setup-search` |
| Settings | row settings page on the Plugins page (`plugins.row.config`) |

## What it does

Choose a search connection per conversation from the composer menu or
`/setup-search`; Off hides `web_search` from that conversation's Agent from
the next model request step. Operators decide which connections exist: DSH's
own DeepSeek search (the default) and DeepSeek Search API, the conversation's
own model (`builtin:session-model`), Exa, Firecrawl, Tavily, Tinyfish,
OpenAlex and Semantic Scholar, plus custom adapter connections and fixed-model
connections over Anthropic Messages, OpenAI Responses or OpenAI Chat
Completions. Native connections keep the behaviour of DSH's own providers;
only their error messages are restated.

- **Where the query goes.** Every connection sends the query to the service
  named in its label (a model connection: to the model's provider). Model
  search is billed per search by that provider, on top of the tokens it uses.
- **Credentials.** Keys live in DSH Credentials; settings store only the
  reference name. Adapter and model API keys are validated before requests;
  native providers retain DSH's credential handling.
- **Results and errors.** Sources must be http(s) URLs without user
  information. Errors are a short message of this plugin with a `WEB_*` code,
  optionally followed by the service's own explanation marked
  `(untrusted)`; there is no retry and no fallback. This request's API key or
  account token is kept out of what the model sees (withheld from error text,
  replaced by `[redacted]` in successful responses and parsed adapter results,
  including OpenAlex inverted abstracts), with one known gap; see
  [known limitations](../../docs/design.md#已知限制).

For the catalog, model-search options, settings grammar and error behavior,
see [Functional design](../../docs/design.md): [connections](../../docs/design.md#连接与目录),
[session selection](../../docs/design.md#会话选择), [settings document](../../docs/design.md#配置文档),
[model backend](../../docs/design.md#model-后端) and [errors](../../docs/design.md#错误与上游说明).

## Upgrading from 0.1.x

Versions up to 0.1.x were a standalone bundle that took the native
`deepseek-official` seat. From 0.2.0 this package is a plain plugin of the
profile bundle: remove the 0.1.x bundles, then install the profile. Upgrading
this package alone removes its row.

0.1.x settings are not read or migrated. Calls fail with
`WEB_PROVIDER_CONFIGURED_UNAVAILABLE` and a fixed message asking the user to
repair the settings. Field diagnostics are available in the settings page and
Host log. Press **Restore default settings** (Reset) on the settings page, or
delete the fields by hand, then set up your connections again. Stored
conversation choices and model memories are kept. Details:
[upgrading from 0.1.x](../../docs/design.md#从-01x-升级).

Architecture: [docs/architecture.md](../../docs/architecture.md).

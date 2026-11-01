# dsh-web-search-enhanced

Search half of [dsh-tool-web-enhanced-profile](../profile/README.md).
**Install the profile, not this package**: the profile mounts this package as
row `web-search-enhanced` and selects its provider in the shared `web` row.

| | |
| --- | --- |
| Row id | `web-search-enhanced` |
| Provider id in `ctx.web` | `search-enhanced` |
| Model surface | DSH's own `web_search` (tool-web), unchanged; with the row's Enhanced tools switch on, also `web_search_enhanced` and `list_web_search_providers` |
| Per conversation | one connection or Off, from the composer menu or the Host command `/setup-search` (Web GUI and dsh-TUI) |
| Settings | row settings page on the Plugins page (`plugins.row.config`) |

## What it does

Choose a search connection per conversation from the composer menu or
`/setup-search`; Off hides `web_search` from that conversation's Agent from
the next model request step. Operators decide which connections exist: DSH's
own DeepSeek search (the default) and DeepSeek Search API, the conversation's
own model (`builtin:session-model`), Exa, Firecrawl, Tavily, Tinyfish,
AnySearch, OpenAlex and Semantic Scholar, plus custom adapter connections and fixed-model
connections over Anthropic Messages, OpenAI Responses, OpenAI Chat
Completions or Codex Alpha Search. Native connections keep the behaviour of DSH's own providers;
only their error messages are restated.

- **Remote services start off.** DeepSeek Search API, Exa, Firecrawl, Tavily,
  Tinyfish, AnySearch, OpenAlex and Semantic Scholar must be turned on in the row
  settings before a conversation can choose them; turning one on agrees that
  queries go to it. DeepSeek Messages (the default) and the conversation model
  stay on; custom connections are on when created. When every remote service
  is off, the composer menu says more services can be turned on in settings.
- **AnySearch takes a personal API key only** (`ANYSEARCH_API_KEY`, the same
  credential name as AnySearch's own plugin): the service has an anonymous
  tier, but this plugin does not use it. Its connection options are a region
  (`zone`: `cn` or `intl`) and a preferred language (`language`, such as
  `zh-CN` or `en`). Do not install it together with `@anysearch/anysearch-dsh`:
  that bundle's profile layer writes both fields of the `web` row as
  `anysearch`, so routing leaves this plugin.
- **`/setup-search`.** A Host command, so it works in the Web GUI and in
  dsh-TUI. `off`, a connection id or `freshness auto|fresh|realtime` change
  the choice from the next model request; dsh-TUI completes these arguments.
  Without arguments the Web GUI opens the chooser, and dsh-TUI prints the
  current choice, routing and the enabled connections (0.16.1 shows only the
  start of that, as a one-line notice). Its description and output are
  English.
- **Enhanced tools (optional).** With the row's Enhanced tools switch on (off
  by default; turning it on agrees that the query goes to the service the
  Agent picks), the Agent also gets `web_search_enhanced` (`queries` plus a
  required `provider`, a connection id) and `list_web_search_providers`. They
  are registered only while the `web` row routes search to this plugin, and
  only conversations started afterwards get them, limited to the connections
  enabled when the conversation started. An explicit call never changes the
  conversation's choice or model memory, is refused when the conversation
  turned search off, and runs through the same execution layer; a backend
  failure tells the Agent to pick another provider.

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
[model backend](../../docs/design.md#model-后端), [enhanced tools](../../docs/design.md#增强工具) and [errors](../../docs/design.md#错误与上游说明).

## Codex Alpha Search

Create a fixed custom model connection with protocol `codex-alpha`. Set an
explicit search model such as `gpt-5.6-luna`, an API base URL such as
`https://gateway.example/v1`, a DSH Credentials reference, and
`trustedEndpoint: true`. The request appends `/alpha/search` to the base URL;
do not include that suffix in the configured endpoint. `maxTokens` defaults
to `2048` and is sent as `max_output_tokens`.

Alpha is an independent JSON protocol, not OpenAI Responses. Its `output`
becomes answer text and its structured `results` become normalized sources;
complete private citation markers and their associated `wordlim` labels are
removed in a linear scan. Unterminated markers and all remaining text, including
whitespace and empty strings, are preserved. The final parsed answer is screened
again for this request's credential. It uses the existing bounded transport,
redaction, cancellation and error handling, without retry or fallback.
It never follows or automatically maps the conversation model, borrows an
OpenAI Provider sign-in, or changes the default connection. Choose the new
connection from the menu or `/setup-search`. Fetch routing and local CIDR
allowlists remain unchanged. See the [configuration example](../../docs/design.md#codex-alpha-固定模型连接).

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

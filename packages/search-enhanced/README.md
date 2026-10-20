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

## How a connection is chosen

Each conversation uses one connection, frozen for each model request step.
A conversation that never chose one uses, in order: the parent conversation's
choice (forks), the connection last chosen for the same model (model memory),
then `defaultConnection`. The composer menu says which of these applies; the
settings page lists every model memory and can clear each one. A memory that
points to a deleted or disabled connection is skipped.

Off makes `web_search` fail for that conversation and hides the tool from its
Agent from the next request step, as long as the `web` row routes search to
this plugin. Whether a connection is enabled, and its endpoint, access, key
reference and options, are read again on every call. Changing only freshness
also counts as a choice (the conversation then keeps its current connection)
but does not update model memory.

## Connections

| Id | Kind | Access | Notes |
| --- | --- | --- | --- |
| `builtin:deepseek-messages` | native | API key `DEEPSEEK_API_KEY` or DeepSeek account | Default. DSH's own DeepSeek search; options `baseURL`, `model`, `apiVersion`, `maxTokens`, `maxUses` |
| `builtin:deepseek-search-api` | native | API key `DEEPSEEK_API_KEY` or DeepSeek account | DSH's DeepSeek Search API provider; options `baseURL`, `count` (1–50), `sendOriginalQuestion` |
| `builtin:exa` | adapter | keyless (hosted MCP) or `EXA_API_KEY` | option `type` (API key only); honors freshness with an API key |
| `builtin:firecrawl` | adapter | keyless or `FIRECRAWL_API_KEY` | options `country`, `location`, `safe`; honors freshness |
| `builtin:tavily` | adapter | keyless or `TAVILY_API_KEY` | options `search_depth`, `topic` |
| `builtin:tinyfish` | adapter | keyless (hosted MCP) or `TINYFISH_API_KEY` | options `location`, `language`, `purpose`, `domain_type` |
| `builtin:openalex` | adapter | keyless or `OPENALEX_API_KEY` | options `sort`, `filter`, `is_oa`, `mailto` |
| `builtin:semanticscholar` | adapter | `SEMANTIC_SCHOLAR_API_KEY` | options `year`, `fieldsOfStudy`, `publicationTypes` |

Every connection sends the query to the service named in its label. Keys live
in DSH Credentials; settings store only the reference name. Native connections
keep the behaviour of DSH's own providers; only their error messages are
restated. Adapters use one bounded transport (redirects refused, 2 MiB, 90 s),
and sources from every connection are reduced to public http(s) URLs. An API
key containing a line break or another control character is refused before
any request.

## Settings

Search and fetch use the same settings document. Everything is optional;
omitted values come from the catalog.

```yaml
version: 2                 # optional; only 2 is accepted
defaultConnection: builtin:exa
showSelector: true         # false removes the composer section; /setup-search still works
defaults:
  freshness: auto          # auto | fresh | realtime; default for new conversations
connections:
  builtin:exa:
    access: api-key
    credentialRef: EXA_API_KEY
  builtin:deepseek-messages:
    options: { baseURL: https://example.internal/anthropic/v1 }
    trustedEndpoint: true  # required when baseURL differs from the official endpoint
  custom:team-tavily:
    kind: adapter
    label: Team Tavily
    adapter: tavily
    credentialRef: TEAM_TAVILY_KEY
    endpoint: https://tavily.example.internal/search
    trustedEndpoint: true  # required when endpoint differs from the official one
```

- Built-in connections accept sparse overrides: `label`, `disabled`,
  `credentialRef`, `access` (`keyless` only where the service has a keyless
  route), `trustedEndpoint` and `options`. Adapter endpoints cannot be
  changed; a native `baseURL` can, with `trustedEndpoint: true`.
- The settings page edits all of this per connection: the credential name
  (leave it empty for the catalog's name), the key, the options, and for
  `baseURL` an "I trust this address" switch. The trust applies to the
  address you confirmed; changing it asks again, and turning the switch off
  returns to the official endpoint. Switching a service back to keyless
  removes the options its keyless route does not accept.
- Custom connections are `custom:<name>` with `kind: adapter`, always use an
  API key (`credentialRef` is required), and need `trustedEndpoint: true`
  for a non-official endpoint. The settings page shows which service receives
  the query, and removing a custom connection resets `defaultConnection` only
  when it named that connection.
- Validation is strict and names the offending field: unknown fields and
  connection ids, unsafe keys (`__proto__`, `constructor`, `prototype`),
  overlong text and more than 200 connections are rejected before anything is
  saved. Model connections (`builtin:session-model`, `kind: model`) are
  planned for a later release and are rejected like any unknown value.
- An omitted `version` always reads as 2. Later formats will be upgraded by
  the settings page, never silently by the Host.

## Upgrading from 0.1.x

Versions up to 0.1.x were a standalone bundle that took the native
`deepseek-official` seat. From 0.2.0 this package is a plain plugin of the
profile bundle: remove the 0.1.x bundles, then install the profile. Upgrading
this package alone removes its row.

- **0.1.x settings are not read.** The settings format was redesigned:
  `freshness` moved to `defaults.freshness`, and `providerId`, top-level
  `freshness` and the 0.0.x fields (`modelMode`, `protocol`, `baseURL`,
  `model`, `fallbackModel`, `apiKey`, `apiKeyEnv`, `apiVersion`,
  `toolIdentifier`, `maxTokens`, `maxUses`, `chatSearchMode`,
  `searchContextSize`) are rejected, as are `builtin:deepseek` (use
  `builtin:deepseek-search-api`) and `kind: structured` (use
  `kind: adapter`). The plugin still loads, but searches fail with
  `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` and a message naming the fields, and
  the settings page says the settings can't be read. Press **Restore default
  settings** (Reset) on the settings page, or delete the fields by hand, then
  set up your connections again. A stored `apiKey` is hidden from the page;
  remove it by hand.
- Stored conversation choices and model memories are kept: a conversation you
  turned search off in stays off.
- The bundle overview on the Plugins page flags `web` overrides left by the
  0.1.x coexistence mode and can remove them after you confirm.
- "The only usable connection" is no longer picked automatically; a
  conversation without a choice uses model memory or `defaultConnection`.

Design: [docs/architecture.md](../../docs/architecture.md).

# dsh-web-fetch-enhanced

Fetch half of [dsh-tool-web-enhanced-profile](../profile/README.md).
**Install the profile, not this package**: the profile mounts this package as
row `web-fetch-enhanced` and selects its provider in the shared `web` row.

| | |
| --- | --- |
| Row id | `web-fetch-enhanced` |
| Provider id in `ctx.web` | `fetch-enhanced` |
| Model surface | DSH's own `web_fetch` (tool-web), unchanged |
| Per conversation | one connection or Off, from the composer menu or `/setup-fetch` |
| Settings | row settings page on the Plugins page (`plugins.row.config`) |

## How a connection is chosen

Fetch works exactly like [search](../search-enhanced/README.md#how-a-connection-is-chosen).
Each conversation uses one connection, frozen for each model request step.
A conversation that never chose one uses, in order: the parent conversation's
choice (forks), the connection last chosen for the same model (model memory),
then `defaultConnection`. The composer menu says which of these applies; the
settings page lists every model memory and can clear each one.

Off makes `web_fetch` fail for that conversation and hides the tool from its
Agent from the next request step, as long as the `web` row routes fetch to
this plugin. Whether a connection is enabled, and all of its options (the
allowlist included), are read again on every call, so changes in the settings
apply to the next fetch.

## Connections

| Id | Kind | Access | Notes |
| --- | --- | --- | --- |
| `builtin:local` | local | none | Default. Fetches from this machine with DSH's own HTTP(S) transport; same as native public-only fetch until you add an allowlist |
| `builtin:deepseek-fetch-api` | native | API key `DEEPSEEK_API_KEY` or DeepSeek account | DSH's DeepSeek Fetch API provider. Option `baseURL` |
| `builtin:exa` | adapter | keyless (Exa's hosted MCP tool) or `EXA_API_KEY` | Options `maxAgeHours`, `livecrawlTimeout` (API key only) |
| `builtin:firecrawl` | adapter | keyless or `FIRECRAWL_API_KEY` | Options `onlyMainContent`, `maxAge` (ms), `storeInCache`, `timeout` (1 000–110 000 ms), `waitFor` (ms), `proxy` |
| `builtin:tavily` | adapter | keyless or `TAVILY_API_KEY` | Options `extract_depth`, `format`, `timeout` (1–60 s) |
| `builtin:tinyfish` | adapter | `TINYFISH_API_KEY` only | Options `ttl` (s), `per_url_timeout_ms` |

Native connections keep the behaviour of DSH's own provider (credential and
endpoint resolution as on the native `web-deepseek-api` row); only their
error messages are restated. Keys live in DSH Credentials; settings store only
the reference name, and each built-in connection can use another name.

## Remote connections: who receives the URL

Every connection except `builtin:local` sends the URL to a service, exactly as
requested, and **the service decides which pages it can reach**; this plugin
does not check the target address (only `builtin:local` does). The composer
menu shows "the URL is sent to <service>", and the settings page repeats it
next to each service and each custom connection, together with what the
service's published terms say about caching and retention:

- **Exa**: without a key, requests go through Exa's hosted MCP service and
  include this plugin's name and version; content may come from Exa's cache.
- **Firecrawl**: by default it may return a copy cached up to 2 days ago and
  stores results in its cache and index; set `storeInCache: false` to avoid
  that.
- **Tavily**: it states zero data retention, but its privacy policy says data
  is kept as long as needed to provide the service.
- **Tinyfish**: it may return a cached copy, and its terms allow it to use the
  data to improve and train its models.
- **DeepSeek Fetch API**: the URL is sent to DeepSeek.

How results look to the model:

- The body is the service's Markdown or plain text, never HTML. The title is
  not added.
- When the service does not report the target's status, the result says
  `HTTP 200` for the requested URL: the service retrieved the page, which is
  not the same as this machine seeing a 200. Firecrawl's reported status and
  final URL, and Tinyfish's final URL, are used as given.
- When the service reports that the target answered with an error status (for
  example 404), the result has that status and an empty body, as with DSH's
  own fetcher. Other failures are errors (`WEB_FETCH_TIMEOUT`,
  `WEB_FETCH_TOO_LARGE`, `WEB_INVALID_URL` or `WEB_PROVIDER_ERROR`) whose
  short message names the connection and never repeats the service's text.
- Bodies are capped at 100 000 characters and marked truncated; Exa is asked
  for at most 100 000 characters, and a body that fills that budget is marked
  truncated as well.
- Remote calls refuse redirects of the API request, read at most 5 MB and
  stop after 120 s. A key containing a line break or another control
  character is refused before any request.

Limits:

- Tinyfish has no keyless route: an anonymous fetch route is not documented.
- Exa's keyless route cannot use `maxAgeHours` or `livecrawlTimeout`;
  switching Exa back to keyless on the settings page removes them.
- Behaviour that the services do not document (for example Firecrawl may
  answer a target 404 with an HTTP 500) surfaces as `WEB_PROVIDER_ERROR`.

## Custom connections

A custom connection is another configuration of one of the four remote
services, for example a self-hosted or proxied endpoint:

```yaml
connections:
  custom:team-firecrawl:
    kind: adapter
    adapter: firecrawl              # exa | firecrawl | tavily | tinyfish
    label: Team Firecrawl
    credentialRef: TEAM_FIRECRAWL_KEY
    endpoint: https://firecrawl.example.internal/v2/scrape
    trustedEndpoint: true           # required when endpoint differs from the official one
    options: { storeInCache: false }
```

Custom connections always use a personal key (`credentialRef` is required)
and can be the `defaultConnection`. The settings page adds and edits them; its
trust checkbox applies to the destination you confirmed, so changing the
format, endpoint or a URL option asks again.

## The local allowlist

`builtin:local` only reaches public addresses unless the operator allows
more:

- `allowCidrs`: non-public IPv4/IPv6 ranges that may be reached. Empty (the
  default) means public-only, exactly like the native fetcher.
- `allowHostnames`: optional. When set, only URLs whose hostname matches one
  of these may use the ranges above. `*.example.com` matches subdomains, not
  `example.com` itself.

Direct requests resolve the hostname once, check every address in the answer
(and the IPv4 address behind an active NAT64 prefix), refuse the request if
any is not allowed, and connect only to the checked addresses. IP literals are
checked before the request starts. **Hostnames reached through a proxy are
resolved by the proxy; these rules cannot limit where they reach.** That is
how DSH's own fetcher works, and the settings page says so next to the editor.

URL rules, same-origin redirects (each hop checked again), the proxy and the
size and time limits are those of DSH's `HttpFetchProvider`; its errors reach
the model unchanged. A request refused by the allowlist fails with
`WEB_BLOCKED_URL`.

When the current step uses `builtin:local`, `allowCidrs` is not empty and
the `web` row routes fetch to this plugin, the model is told which ranges
(and hostnames) the operator allowed. Otherwise nothing is added.

The settings page edits the two lists as text, one rule per line. Each line
is checked as you type (syntax, suggested fixes, duplicates, and warnings for
very broad ranges, loopback, cloud metadata and public ranges); both lists are
saved together only when you press **Save access rules**. Other fields save
when you finish editing them.

## Settings

Both plugins use the same settings document. Everything is optional; omitted
values come from the catalog.

```yaml
version: 2                         # optional; only 2 is accepted
defaultConnection: builtin:local   # must name an existing connection
showSelector: true                 # false removes the composer section; /setup-fetch still works
connections:
  builtin:local:
    options:
      allowCidrs: [10.0.0.0/8, fd00::/8]
      allowHostnames: ['*.corp.example']
      userAgent: my-agent/1.0      # an empty string sends an empty header
      maxResponseBytes: 5000000
      maxBodyChars: 100000
      timeoutMs: 30000
      maxRedirects: 5
  builtin:deepseek-fetch-api:
    credentialRef: DEEPSEEK_API_KEY
    options: { baseURL: https://deepseek-proxy.example.internal/v1/tools }
    trustedEndpoint: true          # required when baseURL differs from the official endpoint
  builtin:firecrawl:
    access: api-key                # default is keyless; uses FIRECRAWL_API_KEY
    options: { maxAge: 0 }
```

- Built-in connections accept sparse overrides: `label`, `disabled`,
  `access` (`keyless` only where the service has a keyless route),
  `credentialRef` (only where an API key is used), `trustedEndpoint` and
  `options`. Adapter endpoints cannot be changed; use a custom connection.
  On the settings page, the trust switch for `baseURL` applies to the address
  you confirmed: turning it off returns to the official endpoint.
- `builtin:local` options default to the native `web-fetch-http` row: no
  allowlist, DSH's default User-Agent, 5 000 000 bytes, 100 000 characters,
  30 s, 5 redirects. Each allowlist holds at most 200 rules.
- Fetch has no per-conversation options, so `defaults` is omitted.
- Validation is strict and names the offending field: unknown fields and
  connection ids, unsafe keys (`__proto__`, `constructor`, `prototype`),
  invalid rules and overlong text are rejected before anything is saved.
- An omitted `version` always reads as 2. Later formats will be upgraded by
  the settings page, never silently by the Host.

## Upgrading from 0.1.x

Versions up to 0.1.x were a standalone bundle that took the native `http`
seat. From 0.2.0 this package is a plain plugin of the profile bundle: remove
the 0.1.x bundles, then install the profile. Upgrading this package alone
removes its row.

**0.1.x settings are not migrated.** The old top-level fields
(`schemaVersion`, `providerId`, `allowCidrs`, `allowHostnames`,
`userAgent`, `maxResponseBytes`, `maxBodyChars`, `timeoutMs`,
`maxRedirects`) are rejected. The plugin still loads, but fetches fail with
`WEB_PROVIDER_CONFIGURED_UNAVAILABLE` and a message naming the fields, and
the settings page says the settings can't be read. Press **Restore default
settings** (Reset) on the settings page, or delete the fields by hand, then enter your
allowlist again under `builtin:local`. Nothing is rewritten until you do.

The bundle overview on the Plugins page flags `web` overrides left by the
0.1.x coexistence mode (such as `fetchProvider: http`) and can remove them
after you confirm.

Design: [docs/architecture.md](../../docs/architecture.md).

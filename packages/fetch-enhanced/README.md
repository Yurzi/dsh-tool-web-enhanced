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
| `builtin:deepseek-fetch-api` | native | API key `DEEPSEEK_API_KEY` or DeepSeek account | DSH's DeepSeek Fetch API provider. The URL is sent to DeepSeek, and DeepSeek decides which pages it can reach. Option `baseURL` |

Native connections keep the behaviour of DSH's own provider (credential and
endpoint resolution as on the native `web-deepseek-api` row); only their
error messages are restated. Keys live in DSH Credentials; settings store only
the reference name. Custom fetch connections are not supported in this release.

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
```

- Built-in connections accept sparse overrides: `label`, `disabled`,
  `credentialRef` (only where an API key is used), `trustedEndpoint` and
  `options`.
- `builtin:local` options default to the native `web-fetch-http` row: no
  allowlist, DSH's default User-Agent, 5 000 000 bytes, 100 000 characters,
  30 s, 5 redirects. Each allowlist holds at most 200 rules.
- Fetch has no per-conversation options, so `defaults` is omitted.
- Validation is strict and names the offending field: unknown fields and
  connection ids (including any `custom:*`), unsafe keys (`__proto__`,
  `constructor`, `prototype`), invalid rules and overlong text are rejected
  before anything is saved.
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
the settings page shows "Invalid settings". Press **Restore default settings**
(Reset) on the settings page, or delete the fields by hand, then enter your
allowlist again under `builtin:local`. Nothing is rewritten until you do.

The bundle overview on the Plugins page flags `web` overrides left by the
0.1.x coexistence mode (such as `fetchProvider: http`) and can remove them
after you confirm.

Design: [docs/architecture.md](../../docs/architecture.md).

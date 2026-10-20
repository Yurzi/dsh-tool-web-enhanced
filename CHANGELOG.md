# Changelog

## Unreleased

### dsh-tool-web-enhanced-profile 0.1.0

- New bundle. Selects `search-enhanced` and `fetch-enhanced` in the shared `web` row (both fields), disables the native `web-search-deepseek` row, and mounts the two plugins and the menu row below.
- No changes to the patch since the first preview; the Plugins-page description now covers switchable fetch connections.

### dsh-tool-web-enhanced-ui 0.1.0

- New package, mounted by the profile as row `tool-web-enhanced-ui`. The Host face is empty; the row exists so DSH loads the browser face. Independent of both plugin rows.
- Browser face: the `webConnections` service that plugins register their menu sections into, and one composer button whose menu lists each section's connections, an Off row, where the current choice comes from (this conversation, the parent conversation, model memory, or the default), loading and failure states, and a notice when the `web` row routes the capability elsewhere.
- Two sections: search and fetch. The first section is expanded and the others are collapsed; every section heading shows "title · current connection · source". Section headings stay at the top while the menu scrolls, and the settings link stays at the bottom.
- Activation prompt for the profile bundle.
- Bundle overview on the Plugins page: whether each capability is routed to this profile, whether its plugin row is disabled, and an upgrade preflight for leftovers of 0.1.x (user-layer `web` overrides, coexistence-mode provider ids, a re-enabled `web-search-deepseek` row). "Remove leftover settings" removes the user-layer `web` fields only after confirmation and appears only next to the leftovers it can fix; nothing is rewritten silently.
- With a plugin row disabled (search, fetch or both), its section disappears and the menu and overview say the capability is unavailable; with no sections, the button is hidden.
- Appearance: the overview has no outer frame, status badges match DSH's "● Running" style, and the text avoids internal terms.

### dsh-web-search-enhanced 0.2.0

- **Breaking:** no longer a bundle; install `dsh-tool-web-enhanced-profile`. Upgrading this package alone removes its row from the profile.
- **Breaking:** registers the provider `search-enhanced` instead of taking the native `deepseek-official` seat.
- **Breaking:** the settings format is redesigned and 0.1.x settings are not read. The document is `{ version: 2, defaultConnection, showSelector, defaults: { freshness }, connections }`, the same grammar as the fetch row. Retired top-level fields (`providerId`, top-level `freshness`, and the 0.0.x fields `modelMode`, `protocol`, `baseURL`, `model`, `fallbackModel`, `apiKey`, `apiKeyEnv`, `apiVersion`, `toolIdentifier`, `maxTokens`, `maxUses`, `chatSearchMode`, `searchContextSize`) are rejected with an error naming the field. The plugin still loads; searches fail with `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` until the settings are fixed. The settings page shows "Invalid settings" and a Reset button; a stored `apiKey` is hidden from the page and must be removed by hand.
- **Breaking:** `builtin:deepseek`, `builtin:session-model`, `kind: model` and `kind: structured` are no longer accepted; use `builtin:deepseek-search-api` and `kind: adapter`.
- Stored conversation choices and model memories from 0.1.x keep working; the storage format is unchanged.
- Session connections: each conversation chooses a connection or Off; the choice is frozen per model request step, forks inherit it, and whether the connection is still enabled, along with its endpoint, key reference and options, is read on every call.
- Model memory is visible and clearable: choosing a connection remembers it for the conversation's model, the composer shows when a choice came from memory, and the settings page lists every memory with a clear button.
- Eight built-in connections: native `deepseek-messages` (default, same as native DeepSeek search) and `deepseek-search-api`; adapters Exa, Firecrawl, Tavily, Tinyfish, OpenAlex and Semantic Scholar (keyless where the service allows it; Exa and Tinyfish keyless go through their hosted MCP tools). Operators can add custom adapter connections.
- Off hides `web_search` from that conversation's Agent from the next request step, while the `web` row routes search to this plugin; calls that still arrive get an error. When the `web` row changes, conversations already seen by the plugin are rechecked at once.
- Row settings page on the Plugins page: default connection, built-in services (enable, access, key, options), custom connections, keys, model memory, route notice, Reset. Writes are sparse and validated before they are saved.
- `/setup-search` command to choose or turn off the conversation's connection and set freshness; it works with or without the composer menu (`showSelector: false` hides only the menu section).
- The native `baseURL` can be overridden like on the native row, but only together with `trustedEndpoint: true`.
- Not in this release: model connections and "follow the session model", and the 0.1 fallback to "the only usable connection".

### dsh-web-fetch-enhanced 0.2.0

- **Breaking:** no longer a bundle; install `dsh-tool-web-enhanced-profile`. Upgrading this package alone removes its row from the profile.
- **Breaking:** registers the provider `fetch-enhanced` instead of taking the native `http` seat.
- **Breaking:** the settings format is redesigned and 0.1.x settings are not read or migrated. The allowlist, User-Agent and limits are now options of the `builtin:local` connection. Retired top-level fields (`schemaVersion`, `providerId`, `allowCidrs`, `allowHostnames`, `userAgent`, `maxResponseBytes`, `maxBodyChars`, `timeoutMs`, `maxRedirects`) are rejected with an error naming the field. The plugin still loads; fetches fail with `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` until the settings are fixed. The settings page shows "Invalid settings" and a Reset button; after Reset, re-enter the allowlist on the settings page.
- Switchable fetch connections, the same way search works: each conversation chooses a connection or Off from the composer menu or `/setup-fetch`; the choice is frozen per model request step, forks inherit it, model memory is visible and clearable, and Off hides `web_fetch` from that conversation's Agent while the `web` row routes fetch to this plugin.
- Two built-in connections: `builtin:local` (default; DSH's own HTTP(S) transport, same as native public-only fetch) and `builtin:deepseek-fetch-api` (DSH's DeepSeek Fetch API provider; API key `DEEPSEEK_API_KEY` or DeepSeek account; `baseURL` override needs `trustedEndpoint: true`; error messages restated). Custom fetch connections are not supported in this release.
- `builtin:local` options: `allowCidrs` and `allowHostnames` (operator allowlist for non-public addresses; empty means public-only), `userAgent` (an empty value sends an empty header), `maxResponseBytes`, `maxBodyChars`, `timeoutMs`, `maxRedirects`. Defaults equal the native `web-fetch-http` row. Direct requests check the whole DNS answer set and NAT64 and pin the connection; IP literals are checked before the transport sees them. Errors from DSH's transport reach the model unchanged; only allowlist refusals use this plugin's wording. Hostnames reached through a proxy are resolved by the proxy, and the rules cannot limit them.
- When this step uses `builtin:local` with a non-empty allowlist and the `web` row routes fetch to this plugin, the model is told which ranges the operator allowed.
- Row settings page on the Plugins page: default connection, connections (enable, key, options), an allowlist editor that checks each line (syntax, suggested fixes, duplicates, warnings for broad, loopback, metadata and public ranges) and saves both lists together only when you press Save, model memory, route notice, Reset. Other fields save sparsely when you finish editing.

### dsh-tool-web-enhanced-core (private, not published)

- `./shared`: connection grammar and option rules (`validateOptions`), the route check both faces use (`routeOf`), URL checks, the per-Session selection vocabulary and the `selectionContract` Remote factory (`<ns>/get`, `set`, `provider`, `pairings`, `forgetPairing`), and `settings`: the settings document grammar both rows use (`resolveDocument`), version detection (`documentVersion`; an omitted `version` always reads as 2, and from version 3 on hand-written documents must state it) and the future migration pipeline (`migrateDocument`, empty today).
- `./host`: the selection paradigm both plugins install with `installCapability(ctx, capability)`: per-Session selections (queueing, revisions, fork inheritance, model memory, resolution order and source), per-step plans that freeze only the connection id and session options, route-guarded tool restriction, the Remote service factory, route detection, credential resolution and the bounded HTTP transport.
- `./client`: the browser section contract (`ConnectionSection`, `SelectionStore`, `RouteStore`, `WebConnectionsService`) with `useObservable`, and the shared browser parts: `ConnectionSelectionStore`, `RouteStatus`, `PairingsStatus`, `CredentialStatus`, sparse writes, the `/setup-*` command factory, the settings document view (`effectiveDocument`, validation and revision-fenced writeback) and the settings page skeleton.

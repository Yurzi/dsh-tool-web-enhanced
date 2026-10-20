# dsh-tool-web-enhanced-core

Shared building blocks of the dsh-tool-web-enhanced plugins. **Private and
source-only**: never published, never installed. Each plugin's build inlines
the parts it imports, so the shipped plugins carry no runtime dependency on it.

| Entry | Runs in | Contents |
| --- | --- | --- |
| `./shared` | Host and browser | `ids`: package, row and provider ids. `connections`: connection ids, credential references, access modes, `Descriptor`, `OptionRule` and `validateOptions`. `settings`: the settings document both rows use (`documentSchema`, `resolveDocument`), version detection (`documentVersion`) and the N→N+1 migration pipeline (`migrateDocument`, empty today). `route`: `routeOf`, the `web` row check both faces use (only an absent field falls back to the environment variable, as in `WebRuntime`). `url`: endpoint and source URL checks. `selection`: the per-Session selection vocabulary and `selectionContract`, which builds a capability's `<ns>/get`, `set`, `provider`, `pairings` and `forgetPairing` Remote contract. A custom connection may use any adapter entry of the capability's catalog (`CustomConnection`) |
| `./host` | Host | `Capability` (everything a plugin supplies) and `installCapability`, which installs the single provider, per-Session selections (`Sessions`: queueing, revisions, fork inheritance, model memory, resolution order), per-step plans (`planFor`, `Snapshots`; only the connection id and session options are frozen), `isSelectable`, the route-guarded `ToolRestriction`, the Remote service factory (`createConnectionsService`; errors outside the contract become `gateway/internal` with a fixed message and are logged on the Host), route detection (`routeFacts`), credential resolution, `capabilityErrors`, the bounded HTTP transport (`createTransport`), the MCP client (`createMcpClient`) and the adapter wire both plugins' remote backends implement (`AdapterWire`, `runAdapter`, `adapterTarget`: keyless never reads a key and always uses the catalog endpoint; API keys are checked before any request) |
| `./client` | browser | the composer section contract (`ConnectionSection`, `SelectionStore`, `RouteStore`, `WebConnectionsService` with route facts registered apart from sections, `Context.webConnections`) and `useObservable`; `ConnectionSelectionStore`, `RouteStatus`, `PairingsStatus`, `CredentialStatus`; `selectionCommand` for `/setup-<capability>`; sparse writes (`createSparseSettings`), the settings document view (`effectiveDocument`, `useSettingsDocument`) and the catalog-driven settings page skeleton (`create*Section` factories: services with credential names and endpoint trust, custom connections, extra editors registered by catalog key). Components take their text from the plugin's `t` and key table; core ships no dictionary |

A plugin supplies only its catalog, backends, settings resolver (built on
`resolveDocument`) and capability parameters; see
[docs/architecture.md](../../docs/architecture.md), sections 4.3, 6 and 8.
Nothing here may import a plugin package or hold module-level state: each
plugin inlines its own copy.

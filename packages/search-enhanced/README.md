# dsh-web-search-enhanced

Search half of [dsh-tool-web-enhanced-profile](../profile/README.md).
**Install the profile, not this package**: the profile mounts this package as
row `web-search-enhanced` and selects its provider in the shared `web` row.

| | |
| --- | --- |
| Row id | `web-search-enhanced` |
| Provider id in `ctx.web` | `search-enhanced` |
| Model surface | DSH's own `web_search` (tool-web), unchanged |
| Backends (M0) | `deepseek-messages` — native DeepSeek search, parity default |

Versions up to 0.1.x were a standalone bundle that took the native
`deepseek-official` seat. From 0.2.0 this package is a plain plugin of the
profile bundle; see the [upgrade notes](../../docs/architecture.md).

Design: [docs/architecture.md](../../docs/architecture.md).

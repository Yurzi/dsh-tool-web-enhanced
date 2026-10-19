# dsh-web-fetch-enhanced

Fetch half of [dsh-tool-web-enhanced-profile](../profile/README.md).
**Install the profile, not this package**: the profile mounts this package as
row `web-fetch-enhanced` and selects its provider in the shared `web` row.

| | |
| --- | --- |
| Row id | `web-fetch-enhanced` |
| Provider id in `ctx.web` | `fetch-enhanced` |
| Model surface | DSH's own `web_fetch` (tool-web), unchanged |
| Backends (M0) | `local` — DSH's official HTTP(S) transport, native public-only parity |

Version 0.1.x was a standalone bundle that took the native `http` seat. From
0.2.0 this package is a plain plugin of the profile bundle and selects backends
the way search does: operator-defined connections, one choice per Session. The
0.1 allowlist returns as the `builtin:local` connection's options (milestone M2).

Design: [docs/architecture.md](../../docs/architecture.md).

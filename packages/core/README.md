# dsh-tool-web-enhanced-core

Shared building blocks of the dsh-tool-web-enhanced plugins. **Private and
source-only**: never published, never installed. Each plugin's build inlines
the parts it imports, so the shipped plugins carry no runtime dependency on it.

| Entry | Runs in | Contents |
| --- | --- | --- |
| `./shared` | Host and browser | package, row and provider ids; grammars both faces enforce |

Planned entries carry the selection paradigm both plugins share — `./host`
(session selections, per-step plans, tool restriction, Remote factory,
credential resolution, bounded transport, route detection) and `./client`
(connection menu, `/setup-<capability>` command, settings page skeleton,
sparse writes, route notice). They move here from search when fetch becomes
their second user; see [docs/architecture.md](../../docs/architecture.md),
sections 4.3 and 6. Nothing here may import a plugin package or hold
module-level state: each plugin inlines its own copy.

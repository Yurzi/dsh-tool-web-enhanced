# dsh-tool-web-enhanced-ui

Shared composer connection menu of [dsh-tool-web-enhanced-profile](../profile/README.md).
**Install the profile, not this package**: the profile mounts it as row
`tool-web-enhanced-ui`.

| | |
| --- | --- |
| Row id | `tool-web-enhanced-ui` |
| Host face | empty — a row is what makes DSH load the browser face |
| Browser face | `webConnections` service, one composer button, activation prompt, bundle overview |
| Depends on the plugin rows | no — they register sections into it through optional injection |

Provides the shared connection menu, activation prompt and profile overview
without depending on either provider row:

- **Composer button and menu**: one section per running search or fetch
  plugin, to pick a connection or Off for the conversation.
- **Activation prompt**: shown once when the profile is enabled.
- **Bundle overview** on the profile's Plugins page: whether the `web` row
  routes each capability to this profile, whether a plugin row is disabled,
  and an upgrade check for 0.1.x leftovers.

The row stays healthy with either plugin row, both, or neither enabled; the
plugins' `/setup-*` commands and settings pages never depend on it.
Interaction behavior is specified in
[Session selection](../../docs/design.md#会话选择). Architecture:
[docs/architecture.md](../../docs/architecture.md#浏览器面).

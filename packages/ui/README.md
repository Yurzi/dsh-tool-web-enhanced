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

- **Composer button and menu**: one tab per running search or fetch plugin,
  to pick a connection or Off for the conversation. A panel lists the
  connections that are turned on (plus the conversation's own choice if it
  was turned off since), and, when all of that capability's remote services
  are off, a footer link saying more services can be turned on in settings.
  The button collapses to its globe together with DSH's model selector when
  the composer row is short of room. The Agent's enhanced-tool calls never
  show up here.
- **Activation prompt**: shown once when the profile is enabled; it also says
  remote services are off by default, unless the upgrade check found a
  problem, in which case it points to the overview instead.
- **Bundle overview** on the profile's Plugins page: whether the `web` row
  routes each capability to this profile, whether a plugin row is disabled,
  and an upgrade check for 0.1.x leftovers.

The row stays healthy with either plugin row, both, or neither enabled; the
plugins' `/setup-*` Host commands (with their Web choosers) and settings
pages never depend on it. The browser face is Web-only: in dsh-TUI the row
mounts and does nothing.
Interaction behavior is specified in
[Session selection](../../docs/design.md#会话选择). Architecture:
[docs/architecture.md](../../docs/architecture.md#浏览器面).

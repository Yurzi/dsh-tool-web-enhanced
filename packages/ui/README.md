# dsh-tool-web-enhanced-ui

Shared composer connection menu of [dsh-tool-web-enhanced-profile](../profile/README.md).
**Install the profile, not this package**: the profile mounts it as row
`tool-web-enhanced-ui`.

| | |
| --- | --- |
| Row id | `tool-web-enhanced-ui` |
| Host face | empty — a row is what makes DSH load the browser face |
| Browser face (M1) | `webConnections` service, one composer button, activation prompt, bundle overview |
| Depends on the plugin rows | no — they register sections into it through optional injection |

Status: M0 placeholder. The row mounts and stays healthy with either plugin
row, both, or neither enabled; the menu itself lands in M1.

Design: [docs/architecture.md](../../docs/architecture.md), section 9.

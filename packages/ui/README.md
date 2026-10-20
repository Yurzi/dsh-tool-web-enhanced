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

## What it shows

- **Composer button** (`conversation.input.right`): shows the conversation's
  search connection. Its menu lists each registered section (search, then
  fetch). The first section is expanded and the others are collapsed; each
  section heading shows "title · current connection · source" and stays at
  the top while the menu scrolls; the settings link stays at the bottom. A
  section shows the connections the Host reports (unavailable ones with the
  reason), Off, where the current choice comes from (this conversation, the
  parent conversation, model memory, or the default), the section's own
  options (search: freshness), and a link to the settings. It shows loading
  and failure states and a notice when the `web` row routes the capability to
  another provider.
- **Activation prompt** (`plugins.bundle.activation`): shown once when the
  profile is enabled; explains the button and opens the profile details.
- **Bundle overview** (`plugins.detail.section`): for each capability, whether
  the `web` row routes it to this profile and whether its plugin row is
  disabled; an upgrade check for 0.1.x leftovers (user-layer `web` overrides,
  coexistence-mode provider ids, a re-enabled `web-search-deepseek` row).
  "Remove leftover settings" appears only next to leftovers it can fix and
  removes the user-layer `web` fields only after you confirm; a re-enabled
  native row is only explained. Status badges follow DSH's own "● Running"
  style.

## When plugin rows are off

The row stays healthy with either plugin row, both, or neither enabled.
A disabled plugin's section disappears with it; with no sections left the
button is hidden, and the menu and the overview say which capability is
unavailable and that its row can be re-enabled on the Plugins page. Each plugin also
withdraws its section when its settings set `showSelector: false`. The
plugins' `/setup-*` commands and settings pages never depend on this row.

UI text lives in `src/client/locales.ts` (zh and en); `locale/*.json` holds
only the Plugins-page metadata.

Design: [docs/architecture.md](../../docs/architecture.md), section 9.

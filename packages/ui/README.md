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

- **Composer button** (`conversation.input.right`): shows the state of each
  registered section in menu order, for example "Exa · Local HTTP" (a
  connection name, or Off, Couldn't load, Invalid settings, Connection
  removed). A side that needs attention (load failure, invalid settings, a
  removed or unready connection, or the `web` row routing it elsewhere)
  gets a warning dot; the accessible name and tooltip read per side, such as
  "Search: Exa · Fetch: Local HTTP (needs attention)". In a narrow composer
  the text hides and the dots move onto the globe icon (search top right,
  fetch bottom right).
- **Menu**: one section per registered capability (search, then fetch). At
  most one section is expanded, and opening the menu expands the first one;
  clicking an expanded heading collapses it, → expands a section and
  collapses the others, ← collapses it, and the selected row is scrolled into
  view. Each heading shows "title · current connection · source" and stays at
  the top while the menu scrolls; the settings link stays at the bottom. A
  section shows the connections the Host reports (unavailable ones with the
  reason), Off, where the current choice comes from (this conversation, the
  parent conversation, the model's last choice, or the default connection),
  the section's own options (search: freshness), and a link to the settings.
  It shows a loading state and a "Couldn't load" row that reloads when
  clicked, says when a capability's settings are invalid and links to the
  settings instead, and shows a notice when the `web` row routes the
  capability to another provider.
- **Activation prompt** (`plugins.bundle.activation`): shown once when the
  profile is enabled; explains the button and opens the profile details. It
  runs the same upgrade check as the overview: when 0.1.x leftovers may keep
  web tools away from this bundle, it says so and points to the details. It
  never writes anything itself.
- **Bundle overview** (`plugins.detail.section`): for each capability, whether
  the `web` row routes it to this profile and whether its plugin row is
  disabled; an upgrade check for 0.1.x leftovers (user-layer `web` overrides,
  coexistence-mode provider ids, a re-enabled `web-search-deepseek` row).
  "Remove leftover settings" appears only next to leftovers it can fix and
  removes the user-layer `web` fields only after you confirm; a re-enabled
  native row is only explained. Status badges follow DSH's own "● Running"
  style. Overrides on the disabled native `web-search-deepseek` row (such
  as `baseURL` or `model`) are not visible to the browser and are not
  checked.

Routing comes from the plugins: each running plugin reports whether the `web`
row routes its capability to it, including the `DSH_WEB_SEARCH_PROVIDER` /
`DSH_WEB_FETCH_PROVIDER` environment variables, even when its menu section
is hidden with `showSelector: false`. For a plugin row that is not running,
the browser has no source for those variables and judges from the `web` row
alone.

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

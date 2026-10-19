# Changelog

## Unreleased

### dsh-tool-web-enhanced-profile 0.1.0

- New bundle. Selects `search-enhanced` and `fetch-enhanced` in the shared `web` row (both fields), disables the native `web-search-deepseek` row, and mounts the two plugins and the menu row below.

### dsh-tool-web-enhanced-ui 0.1.0

- New package, mounted by the profile as row `tool-web-enhanced-ui`. M0: empty Host face; the shared composer connection menu arrives in M1. Independent of both plugin rows.

### dsh-web-search-enhanced 0.2.0

- **Breaking:** no longer a bundle; install `dsh-tool-web-enhanced-profile`. Upgrading this package alone removes its row from the profile.
- **Breaking:** registers the provider `search-enhanced` instead of taking the native `deepseek-official` seat; `providerId` is retired.
- M0: one backend, `deepseek-messages`, equivalent to native DeepSeek search. Session-scoped connections return in M1.

### dsh-web-fetch-enhanced 0.2.0

- **Breaking:** no longer a bundle; install `dsh-tool-web-enhanced-profile`. Upgrading this package alone removes its row from the profile.
- **Breaking:** registers the provider `fetch-enhanced` instead of taking the native `http` seat; `providerId` is retired.
- M0: one backend, `local`, equivalent to native public-only fetch. Session-scoped connections (the search paradigm) and the 0.1 allowlist as `builtin:local` options return in M2.

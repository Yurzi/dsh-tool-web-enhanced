# AGENTS.md

DeepSeek Harness (DSH) plugin monorepo for **dsh-tool-web-enhanced-profile**: a code-free profile bundle that mounts two plugins and selects their `ctx.web` providers in the shared `web` row. The model keeps DSH's native `web_search`/`web_fetch` (tool-web); each plugin switches backends internally. Targets DSH `>=0.2.1-rc.2 <0.3.0-0`, Node `^22.19.0 || >=24.0.0`, pnpm 12. Design: [docs/architecture.md](docs/architecture.md) (Chinese). Workflow: [docs/development.md](docs/development.md).

## Layout

- `packages/profile` – `dsh-tool-web-enhanced-profile`: `cordis.patch.yml` (writes both `web` fields, disables `web-search-deepseek`, inserts the plugin rows and the menu row), locale, icon. No code.
- `packages/search-enhanced` – `dsh-web-search-enhanced`: row `web-search-enhanced`, provider `search-enhanced`.
- `packages/fetch-enhanced` – `dsh-web-fetch-enhanced`: row `web-fetch-enhanced`, provider `fetch-enhanced`.
- `packages/ui` – `dsh-tool-web-enhanced-ui`: row `tool-web-enhanced-ui`; empty Host face today, browser face (the `webConnections` service and the single composer connection menu) in M1. Plugins register sections into it through optional injection and keep their own `/setup-*` commands and row settings pages. It must never depend on a plugin row: it works with either, both, or neither plugin row enabled.
- `packages/core` – private, source-only shared code, inlined into each plugin at build time. `./shared` must stay isomorphic (no Node, browser, or Host imports).
- `build/` – one tsdown factory for every plugin, platform module table, decorator and CSS Modules plugins.
- `scripts/` – workspace discovery/packing, package verification, clean.
- `e2e/` – isolated real-DSH suite: `harness/` (environment, host boot, `dsh web`, Playwright), `fixtures/`, `*.e2e.ts`.

## Commands

- `pnpm install`
- `pnpm run check` – typecheck, type-aware oxlint, build, vitest, verify:package. Must pass before you finish.
- `pnpm run test:e2e` – run when touching the profile patch, provider registration, plugin-page metadata, browser faces, or the DSH baseline. Never touches the user's DSH home or running GUI.

Do not run state-changing git commands unless asked. Do not add dependencies without approval.

## Invariants

- Identities (package names, row ids, provider ids) are defined once in `packages/core/src/shared/ids.ts`; the profile test asserts the YAML patch matches them. Naming follows DSH: a row id is its npm name without the `dsh-` prefix (`dsh-tool-web-enhanced-ui` → `tool-web-enhanced-ui`), and the Cordis plugin name equals the row id. Provider plugins are the `web-*-enhanced` family; product-level packages (profile, ui, private core) are `tool-web-enhanced-*`.
- The profile writes **both** `web` fields together; nothing else in this repo writes the `web` row. Backend switching never touches it.
- Each plugin registers exactly one provider (its seat). New behaviour goes into the planner (which backend) or a backend (how), never a second registration.
- Plugins ship self-contained host bundles: runtime imports only Node built-ins and `@deepseek-ai/*`; no `dependencies`. `verify-packages` enforces it.
- search and fetch never import each other; shared code goes to core; core holds no module-level state.
- `available()` does no I/O. Credentialed requests use `redirect: 'error'`. Keys live only in DSH Credentials (settings store `credentialRef`). Keyless never reads, sends, or falls back to a key. No automatic retry or fallback.
- search and fetch share one selection paradigm: operator-defined connections in the row settings, a per-Session selection frozen per model request step, `null` = off (Seat error + `agent.ctx.tools.restrict`). Differences between the two are catalog data and capability parameters, never a second mechanism.
- fetch: only the `local` connection (DSH's `HttpFetchProvider` plus our injected resolver) checks target addresses; an empty allowlist equals native public-only, and proxied hostnames are resolved by the proxy, as upstream does. Remote backends follow DSH's own design: the service owns target access policy; we reject redirects of the API request, keep cancellation, and state in the UI who receives the URL. `native` backends instantiate DSH's exported provider classes and keep their behaviour; only their error messages are restated. Our own egress uses global `fetch` only.
- Model-facing errors are `WebError` with an existing `WEB_*` code and a short actionable English message; never upstream bodies or secrets. UI text goes through locale dictionaries (zh and en, same keys).

## Conventions

- Readable code over dense one-liners; small focused modules; JSDoc on exports only when it adds information.
- No over-defensive code: no error-swallowing try/catch, no shape-sniffing of private DSH internals, no `?.`/`??` piles for values that are always present, no timing-based correctness.
- Discriminated unions over bags of optional fields.
- Tests exercise behaviour at seams (real `WebRuntime`, real include patch algorithm, local HTTP servers, the real DSH in e2e). Mock only the network and the clock. Every bug fix gets a failing-first test.
- Keep docs in sync: behaviour changes update docs/architecture.md, the affected package README, and CHANGELOG.md.

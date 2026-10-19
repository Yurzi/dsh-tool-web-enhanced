# dsh-tool-web-enhanced-profile

A DeepSeek Harness **bundle** — the package users install. It carries no code:
its [`cordis.patch.yml`](cordis.patch.yml) mounts the two plugins it depends
on and selects their providers in the shared `web` row, the way
`@deepseek-ai/dsh-base` composes DSH's own web providers and
`@deepseek-ai/dsh-experimental-inspector-profile` composes its inspectors.

```sh
dsh plugin --profile <profile> add dsh-tool-web-enhanced-profile
```

| Row | Package | Provider in `ctx.web` |
| --- | --- | --- |
| `web` (patched) | `@deepseek-ai/dsh-web` | `searchProvider: search-enhanced`, `fetchProvider: fetch-enhanced` |
| `web-search-deepseek` | native | disabled — its role becomes a search backend |
| `web-search-enhanced` (inserted) | [dsh-web-search-enhanced](../search-enhanced/README.md) | `search-enhanced` |
| `web-fetch-enhanced` (inserted) | [dsh-web-fetch-enhanced](../fetch-enhanced/README.md) | `fetch-enhanced` |
| `tool-web-enhanced-ui` (inserted) | [dsh-tool-web-enhanced-ui](../ui/README.md) | — (browser-only composer menu) |

Remove dsh-web-search-enhanced 0.1.x and dsh-web-fetch-enhanced 0.1.x (the old
standalone bundles) before installing: they insert the same row ids.

Design: [docs/architecture.md](../../docs/architecture.md).

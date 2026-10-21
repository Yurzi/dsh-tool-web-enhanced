# dsh-tool-web-enhanced-core

Shared building blocks of the dsh-tool-web-enhanced plugins. **Private and
source-only**: never published, never installed. Each plugin's build inlines
the parts it imports, so the shipped plugins carry no runtime dependency on it.

Three source-only entry points separate isomorphic contracts (`./shared`),
Host execution (`./host`) and browser components (`./client`). See
[Architecture](../../docs/architecture.md#core-的三个入口) for boundaries and
[Code structure](../../docs/code-structure.md#core) for modules.

Adapter execution redacts both upstream JSON string values and parsed results;
this also covers service formats that turn JSON property names into text. Shared
option editors save exclusive-option conflict recovery as one validated write.

Nothing here may import a plugin package or hold module-level state: each
plugin inlines its own copy.

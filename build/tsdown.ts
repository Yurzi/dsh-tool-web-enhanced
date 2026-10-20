/**
 * One build definition for every plugin package. A package's tsdown.config.ts
 * is `export default pluginBuild(import.meta.url)`.
 *
 * - Host face: `lib/index.js`, ESM for the DSH Loader. Node built-ins and
 *   `@deepseek-ai/*` come from the DSH installation; everything else —
 *   including the workspace core package — is inlined, so a plugin ships with
 *   no runtime `dependencies`.
 * - Client face (only when the manifest exports `./client`): `lib/client.cjs`,
 *   one script registering a `factory(require)` with the DSH module loader.
 *   Only the shell's platform modules stay external.
 */
import { readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import type { UserConfig } from 'tsdown'
import { isPlatformModule } from './platform.ts'
import { cssModules, standardDecorators } from './plugins.ts'

interface Manifest {
  readonly name: string
  readonly version: string
  readonly exports?: Readonly<Record<string, unknown>>
}

const isHostExternal = (specifier: string): boolean => isBuiltin(specifier) || specifier.startsWith('@deepseek-ai/')

/**
 * @param configUrl - `import.meta.url` of the package's tsdown.config.ts.
 * @returns the host build, plus the client build when the package has a browser half.
 */
export function pluginBuild(configUrl: string): UserConfig[] {
  const manifest = JSON.parse(readFileSync(new URL('package.json', configUrl), 'utf8')) as Manifest
  const mode = process.env.NODE_ENV ?? 'production'

  const host: UserConfig = {
    name: manifest.name,
    entry: { index: 'src/index.ts' },
    outDir: 'lib', format: ['esm'], platform: 'node', target: 'node22', fixedExtension: false, dts: false, clean: false,
    deps: { neverBundle: isHostExternal, alwaysBundle: specifier => !isHostExternal(specifier) },
    define: { __PLUGIN_VERSION__: JSON.stringify(manifest.version) },
    plugins: [standardDecorators()],
  }
  if (manifest.exports?.['./client'] === undefined) return [host]

  const client: UserConfig = {
    name: `${manifest.name}/client`,
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib', format: ['cjs'], platform: 'browser', target: 'es2024', fixedExtension: false, dts: false, clean: false, sourcemap: true,
    deps: { neverBundle: isPlatformModule, alwaysBundle: specifier => !isPlatformModule(specifier), onlyBundle: false },
    inputOptions: { resolve: { conditionNames: [mode === 'development' ? 'development' : 'production', 'browser', 'import', 'module', 'default'] } },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
      'import.meta.env.MODE': JSON.stringify(mode),
      'import.meta.env': JSON.stringify({ MODE: mode }),
      __PLUGIN_VERSION__: JSON.stringify(manifest.version),
    },
    plugins: [cssModules(manifest.name)],
    outputOptions: {
      entryFileNames: 'client.cjs',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  }
  return [host, client]
}

/**
 * Bundler plugins shared by the package builds (tsdown/Rolldown) and the unit
 * tests (Vitest). Both accept the same Rollup-style plugin object.
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import { transform } from 'lightningcss'
import ts from 'typescript'

/** A decorator applied at the start of a line, such as `@Remote(...)`. */
const DECORATOR = /^\s*@[A-Za-z_$]/m

/**
 * Lower standard decorators (the DSH `@Remote` service API) with TypeScript.
 * OXC leaves them intact and Node does not run them yet; only files that
 * contain a decorator take this path.
 */
export function standardDecorators() {
  return {
    name: 'dsh-standard-decorators',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!/\.tsx?$/.test(id) || id.includes('/node_modules/') || !DECORATOR.test(code)) return null
      const output = ts.transpileModule(code, {
        fileName: id,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, sourceMap: true, verbatimModuleSyntax: true },
      })
      return { code: output.outputText, map: output.sourceMapText ?? null }
    },
  }
}

const CSS_MODULE_PREFIX = '\0dsh-css-module:'
/** The virtual id must not end in `.css`, or the bundler routes it to its own CSS pipeline. */
const CSS_MODULE_SUFFIX = '.mjs'

interface LoadContext { addWatchFile?(file: string): void }

/**
 * Compile `*.module.css` imports with lightningcss. The module exports its
 * hashed class map and, when a document exists, appends one
 * `<style data-plugin data-plugin-css>` tag per stylesheet, mirroring
 * deepseek-harness packages/client/tsdown.client.ts.
 * @param pluginId - package name stamped on the injected style tags.
 */
export function cssModules(pluginId: string) {
  return {
    name: 'dsh-css-modules',
    enforce: 'pre' as const,
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css') || importer === undefined) return null
      return CSS_MODULE_PREFIX + resolve(dirname(importer), source) + CSS_MODULE_SUFFIX
    },
    async load(this: LoadContext, id: string) {
      if (!id.startsWith(CSS_MODULE_PREFIX)) return null
      const file = id.slice(CSS_MODULE_PREFIX.length, -CSS_MODULE_SUFFIX.length)
      this.addWatchFile?.(file)
      const { code, exports } = transform({
        filename: file, code: await readFile(file), cssModules: { pattern: '[hash]_[local]' }, minify: true,
      })
      const classes = Object.fromEntries(Object.entries(exports ?? {}).map(([local, value]) => [local, value.name]))
      // Relative to the package, so two stylesheets with one basename never share a tag.
      const tag = JSON.stringify(`${pluginId}/${relative(process.cwd(), file)}`)
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(${tag}) + ']') === null) {`,
        "  const style = document.createElement('style');",
        `  style.dataset.plugin = ${JSON.stringify(pluginId)};`,
        `  style.dataset.pluginCss = ${tag};`,
        '  style.textContent = css;',
        '  document.head.appendChild(style);',
        '}',
        `export default ${JSON.stringify(classes)};`,
      ].join('\n')
    },
  }
}

const STUB_PREFIX = '\0dsh-primitives-stub:'
const PRIMITIVES_LIB = /dsh-client-ui-primitives[\\/]lib[\\/]/

/**
 * Test builds only. The published primitives library keeps bare imports of its
 * implementation libraries (shiki, katex, micromark, simple-icons, clsx, …),
 * which the DSH shell bundles but this repository does not install. Imports
 * that do not resolve become inert stubs exporting the names the library
 * imports; the tests never render the code paths that use them (code
 * highlighting, Markdown, site glyphs). Mirrors the predecessor's
 * scripts/client-build.ts.
 */
export function primitivesStub() {
  return {
    name: 'dsh-primitives-stub',
    enforce: 'pre' as const,
    resolveId(source: string, importer: string | undefined) {
      if (importer === undefined || !PRIMITIVES_LIB.test(importer) || source.startsWith('.') || source.startsWith('\0')) return null
      try {
        createRequire(importer).resolve(source)
        return null
      } catch {
        // Only an unresolvable library is stubbed; anything installed stays real.
        return `${STUB_PREFIX}${source}?${importer}`
      }
    },
    load(id: string) {
      if (!id.startsWith(STUB_PREFIX)) {
        // The published library references a source map it does not ship.
        return PRIMITIVES_LIB.test(id) && id.endsWith('.js')
          ? readFileSync(id, 'utf8').replace(/\n\/\/# sourceMappingURL=\S+\s*$/, '\n')
          : null
      }
      const [source, importer] = id.slice(STUB_PREFIX.length).split('?') as [string, string]
      // clsx builds class names the primitives render; a real tiny implementation keeps className a string.
      if (source === 'clsx') {
        return [
          'function clsx(...inputs) {',
          '  const out = [];',
          '  for (const input of inputs) {',
          "    if (!input) continue;",
          "    if (typeof input === 'string' || typeof input === 'number') out.push(String(input));",
          '    else if (Array.isArray(input)) { const nested = clsx(...input); if (nested) out.push(nested); }',
          "    else if (typeof input === 'object') for (const [key, value] of Object.entries(input)) if (value) out.push(key);",
          '  }',
          "  return out.join(' ');",
          '}',
          'export { clsx };',
          'export default clsx;',
        ].join('\n')
      }
      const quoted = source.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
      const names = new Set<string>()
      for (const match of readFileSync(importer, 'utf8').matchAll(new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${quoted}["']`, 'g'))) {
        for (const binding of match[1]!.split(',')) {
          const name = binding.trim().split(/\s+as\s+/)[0]
          if (name) names.add(name)
        }
      }
      return [
        "const stub = new Proxy(function () {}, { get: (_, key) => key === Symbol.toPrimitive ? () => '' : stub, apply: () => stub, construct: () => stub });",
        'export default stub;',
        ...[...names].map(name => `export const ${name} = stub;`),
      ].join('\n')
    },
  }
}

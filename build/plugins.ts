/**
 * Bundler plugins shared by the package builds (tsdown/Rolldown) and the unit
 * tests (Vitest). Both accept the same Rollup-style plugin object.
 */
import { readFile } from 'node:fs/promises'
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

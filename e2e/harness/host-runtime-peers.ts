import assert from 'node:assert/strict'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { isBuiltin, createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import ts from 'typescript'

/** The published RuntimeResolutionEntry fields consumed by this audit. */
export interface RuntimePackageTable {
  readonly localPackageNames: readonly string[]
  readonly entries: readonly { readonly name: string; readonly packageDir: string; readonly version: string | undefined }[]
}

interface Manifest {
  name: string
  version: string
  main?: string
  optionalDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

function ownerOf(file: string): { root: string; manifest: Manifest } {
  let root = dirname(file)
  while (true) {
    const manifest = join(root, 'package.json')
    if (existsSync(manifest)) {
      const value = JSON.parse(readFileSync(manifest, 'utf8')) as Manifest
      // Nested package.json files may declare only an ESM boundary, not a package owner.
      if (typeof value.name === 'string') return { root: realpathSync(root), manifest: value }
    }
    const parent = dirname(root)
    assert.notEqual(parent, root, `No owner of ${file}`)
    root = parent
  }
}

function isHostPeer(name: string): boolean {
  return name === '@deepseek-ai/cordis' || name.startsWith('@deepseek-ai/dsh-')
}

function assertVersion(name: string, version: string | undefined): void {
  if (name === '@deepseek-ai/cordis') assert.equal(version, '4.1.0')
  else if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, name === '@deepseek-ai/dsh-invariants' ? '0.1.7-rc.2' : '0.2.2-rc.1', name)
}

/** Emitted-JS probe plus the public boot table. Node require conditions may differ from ESM import conditions; dynamic expressions are not claimed exhausted. */
export function auditHostRuntime(directory: string, owners: readonly string[], resolution: RuntimePackageTable) {
  const table = new Map<string, string>()
  for (const entry of resolution.entries) {
    if (!isHostPeer(entry.name)) continue
    assertVersion(entry.name, entry.version)
    const path = realpathSync(entry.packageDir)
    const previous = table.get(entry.name)
    assert(previous === undefined || previous === path, `${entry.name} has conflicting public runtime selections`)
    table.set(entry.name, path)
  }
  const peers = new Map<string, string>()
  const visited = new Set<string>()
  const dynamicExpressions = new Set<string>()
  const conditionalExports = new Set<string>()
  const follow = (filename: string): void => {
    const file = realpathSync(filename)
    if (visited.has(file) || !/[.](?:cjs|mjs|js)$/u.test(file)) return
    visited.add(file)
    const { root, manifest } = ownerOf(file)
    if (isHostPeer(manifest.name)) {
      assertVersion(manifest.name, manifest.version)
      assert.equal(root, table.get(manifest.name), `${manifest.name} resolved outside the public Host selection from ${file}`)
      const previous = peers.get(manifest.name)
      assert(previous === undefined || previous === root, `${manifest.name} has multiple actual import identities`)
      peers.set(manifest.name, root)
    }
    const require = createRequire(file)
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS)
    const visit = (node: ts.Node): void => {
      let specifier: ts.Expression | undefined
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier
      else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
        specifier = node.arguments[0]
        if (specifier !== undefined && !ts.isStringLiteral(specifier)) dynamicExpressions.add(file)
      }
      if (specifier !== undefined && ts.isStringLiteral(specifier) && !isBuiltin(specifier.text)) {
        const name = specifier.text.startsWith('@') ? specifier.text.split('/').slice(0, 2).join('/') : specifier.text.split('/')[0]!
        let resolved: string | undefined
        try { resolved = require.resolve(specifier.text) } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' && !isHostPeer(name)) {
            conditionalExports.add(`${specifier.text} from ${file}: ERR_PACKAGE_PATH_NOT_EXPORTED`)
          } else {
            const optional = manifest.optionalDependencies?.[name] !== undefined || manifest.peerDependenciesMeta?.[name]?.optional === true
            if (!optional || !(error instanceof Error) || !('code' in error) || error.code !== 'MODULE_NOT_FOUND') throw error
          }
        }
        if (resolved !== undefined) follow(resolved)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  const require = createRequire(join(directory, 'package.json'))
  for (const owner of owners) {
    const selected = resolution.entries.find(entry => entry.name === owner)
    let packageDir: string
    if (selected === undefined) {
      // Public RuntimeResolution leaves direct profile packages to native Node lookup.
      assert(resolution.localPackageNames.includes(owner), `${owner} is absent from the public runtime table and local package names`)
      packageDir = dirname(require.resolve(owner + '/package.json'))
    } else packageDir = selected.packageDir
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as Manifest
    assert(manifest.main !== undefined, `${owner} must declare its emitted Host entry`)
    follow(join(packageDir, manifest.main))
  }
  assert(peers.has('@deepseek-ai/cordis'), 'The actual Host imports must include Cordis')
  return { peers: Object.fromEntries(peers), publicPackages: table.size, emittedFiles: visited.size, resolutionCondition: 'Node require.resolve; conditional ESM import exports may differ', dynamicExpressions: [...dynamicExpressions], unresolvedConditionalExports: [...conditionalExports] }
}

import assert from 'node:assert/strict'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

interface Manifest {
  name: string
  version: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

function packageRoot(entry: string, name: string): string {
  let root = dirname(entry)
  while (true) {
    const file = join(root, 'package.json')
    if (existsSync(file) && (JSON.parse(readFileSync(file, 'utf8')) as Manifest).name === name) return realpathSync(root)
    const parent = dirname(root)
    assert.notEqual(parent, root, `No manifest for ${name} from ${entry}`)
    root = parent
  }
}

function resolvePackage(require: NodeJS.Require, name: string): string {
  try { return require.resolve(name + '/package.json') } catch { return require.resolve(name) }
}

/** Audit the actual dependency/peer graph, not merely lockfile version labels. */
export function auditRuntimePeers(directory: string, owners: readonly string[]) {
  const initial = createRequire(join(directory, 'package.json'))
  const instances = new Map<string, Set<string>>()
  const visited = new Set<string>()
  const selectedBy = new Map<string, string>()
  const visit = (name: string, entry: string, declarer: string): void => {
    const root = packageRoot(entry, name)
    if (visited.has(root)) return
    visited.add(root)
    selectedBy.set(root, declarer)
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest
    const paths = instances.get(name) ?? new Set<string>()
    paths.add(root)
    instances.set(name, paths)
    if (name.startsWith('@deepseek-ai/dsh-')) {
      const expected = name === '@deepseek-ai/dsh-invariants' ? '0.1.7-rc.2' : '0.2.2-rc.1'
      assert.equal(manifest.version, expected, `${name} must use the published target (invariants is independently versioned)` )
    }
    if (name === '@deepseek-ai/cordis') assert.equal(manifest.version, '4.1.0')
    const require = createRequire(join(root, 'package.json'))
    for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
      if (dependency === '@deepseek-ai/cordis' || dependency.startsWith('@deepseek-ai/dsh-') || dependency === 'dsh-working-activity') {
        let resolved: string
        try { resolved = resolvePackage(require, dependency) } catch (error) {
          // Optional peers absent from this deployment are not runtime instances.
          if (manifest.peerDependenciesMeta?.[dependency]?.optional === true && error instanceof Error && 'code' in error && error.code === 'MODULE_NOT_FOUND') continue
          throw error
        }
        visit(dependency, resolved, root)
      }
    }
  }
  for (const owner of owners) visit(owner, resolvePackage(initial, owner), directory)
  for (const [name, paths] of instances) assert.equal(paths.size, 1, `${name} has multiple runtime identities: ${[...paths].map(path => `${path} (selected by ${selectedBy.get(path)})`).join(', ')}`)
  return Object.fromEntries([...instances].map(([name, paths]) => [name, [...paths][0]!]))
}

/**
 * The workspace's publishable packages and how to pack them exactly as
 * `pnpm publish` would: workspace and catalog ranges rewritten, lifecycle
 * scripts off. Shared by verify-packages and the e2e harness.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Repository root. */
export const repo = resolve(import.meta.dirname, '..')

export interface Manifest {
  readonly name: string
  readonly version: string
  readonly private?: boolean
  readonly main?: string
  readonly icon?: string
  readonly files?: readonly string[]
  readonly exports?: Readonly<Record<string, string>>
  readonly engines?: Readonly<Record<string, string>>
  readonly dependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly dsh?: { readonly bundle?: { readonly patch: string }; readonly client?: unknown }
}

export interface WorkspacePackage {
  readonly dir: string
  readonly manifest: Manifest
}

/** Every package under packages/ that is published. */
export function publishablePackages(): WorkspacePackage[] {
  const root = join(repo, 'packages')
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const dir = join(root, entry.name)
      return { dir, manifest: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest }
    })
    .filter(pkg => pkg.manifest.private !== true)
}

/**
 * Pack one package with pnpm. The package must already be built.
 * @param pkg - the package.
 * @param destination - directory receiving the tarball.
 * @param env - environment for pnpm; defaults to this process's.
 * @returns the tarball path.
 */
export function pack(pkg: WorkspacePackage, destination: string, env: NodeJS.ProcessEnv = process.env): string {
  execFileSync('pnpm', ['--config.ignore-scripts=true', 'pack', '--pack-destination', destination], { cwd: pkg.dir, env, stdio: 'ignore' })
  return join(destination, `${pkg.manifest.name.replace(/^@/, '').replace('/', '-')}-${pkg.manifest.version}.tgz`)
}

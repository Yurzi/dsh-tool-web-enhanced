/** Isolated predecessor installation and real storage-domain upgrade fixtures. */
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { inspect, promisify } from 'node:util'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { FETCH, PROFILE_PACKAGE, SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { type E2EContext, PROFILE, addPlugins, artifacts, dsh, profileDir, run } from './environment.ts'

const fixture = (name: string) => join(import.meta.dirname, '../fixtures', name)
// Capture launcher choices before enterIsolatedEnvironment removes DSH_* variables.
const predecessors = [
  { packageName: SEARCH.packageName, version: '0.1.10', checkout: process.env.DSH_E2E_PREDECESSOR_SEARCH, variable: 'DSH_E2E_PREDECESSOR_SEARCH' },
  { packageName: FETCH.packageName, version: '0.1.0', checkout: process.env.DSH_E2E_PREDECESSOR_FETCH, variable: 'DSH_E2E_PREDECESSOR_FETCH' },
] as const

interface LegacyManifest {
  readonly name: string
  readonly version: string
  readonly dsh?: { readonly bundle?: { readonly patch: string } }
}

interface UpgradeProfile {
  readonly patchPath: string
  readonly patches: unknown[]
  readonly layers: { readonly packageName: string; readonly packageDir: string }[]
  readonly skippedBundles: { readonly packageName: string; readonly reason: string }[]
}

function loadUpgradeProfile(e2e: E2EContext): UpgradeProfile {
  const anchor = join(e2e.install, 'node_modules/@deepseek-ai/dsh/package.json')
  const app = createRequire(anchor)('@deepseek-ai/dsh-app-boot') as {
    loadProfile(binName: string, name: string, anchor: string, home: string): UpgradeProfile
  }
  return app.loadProfile('web-enhanced-upgrade-e2e', PROFILE, anchor, e2e.env.DSH_HOME!)
}

function requirePredecessor(manifest: LegacyManifest, name: string, version: string, location: string): void {
  if (manifest.name !== name || manifest.version !== version || manifest.dsh?.bundle?.patch !== './cordis.patch.yml') {
    throw new Error(`${location} must be the real ${name}@${version} bundle; got ${JSON.stringify(manifest)}`)
  }
}

/** Give this destructive install/remove scenario its own home beneath the suite run. */
export function upgradeEnvironment(base: E2EContext): E2EContext {
  const directory = mkdtempSync(join(run, 'upgrade-'))
  const env = { ...base.env }
  for (const [name, value] of Object.entries(env)) {
    if (value !== run && !value.startsWith(`${run}${sep}`)) continue
    env[name] = join(directory, relative(run, value))
    mkdirSync(env[name], { recursive: true, mode: 0o700 })
  }
  return { ...base, env }
}

/** Install pinned 0.1.x releases, or pack explicitly selected prebuilt checkouts with scripts off. */
export function installPredecessors(e2e: E2EContext): void {
  const diagnosticKeys = /^(?:NODE_PATH|INIT_CWD|PWD|PNPM_PACKAGE_NAME|PNPM_SCRIPT_SRC_DIR|npm_package_json|npm_lifecycle_event|npm_execpath|npm_node_execpath|npm_config_(?:user_agent|global|prefix|recursive|workspace_dir|filter|dir))$/
  writeFileSync(join(artifacts, 'upgrade-package-context.json'), JSON.stringify(Object.fromEntries(Object.entries(e2e.env).filter(([key]) => diagnosticKeys.test(key))), null, 2))
  const destination = join(dirname(e2e.env.DSH_HOME!), 'tarballs')
  mkdirSync(destination, { recursive: true })
  const specs = predecessors.map(({ packageName, version, checkout, variable }) => {
    if (checkout === undefined) return `${packageName}@${version}`
    const directory = resolve(checkout)
    if (checkout === '' || !existsSync(join(directory, 'package.json'))) {
      throw new Error(`${variable}=${JSON.stringify(checkout)} must point to a predecessor checkout; unset it to install ${packageName}@${version} from the registry`)
    }
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name: string; version: string; main: string }
    if (manifest.name !== packageName || manifest.version !== version) throw new Error(`${directory} must contain ${packageName}@${version}`)
    if (!existsSync(join(directory, manifest.main))) throw new Error(`${packageName}@${version} must be built before the upgrade test`)
    // Pack prebuilt bytes with the suite's toolchain. A predecessor's packageManager
    // must not make pnpm download another pnpm into this throwaway home.
    execFileSync('pnpm', [
      '--config.ignore-scripts=true',
      '--config.manage-package-manager-versions=false',
      '--config.package-manager-strict=false',
      'pack', '--pack-destination', destination,
    ], {
      cwd: directory, env: e2e.env, stdio: 'inherit',
    })
    const tarball = join(destination, `${packageName}-${version}.tgz`)
    if (!existsSync(tarball)) throw new Error(`${tarball} was not produced by pnpm pack`)
    const packed = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' })) as LegacyManifest
    writeFileSync(join(artifacts, `upgrade-packed-${packageName}.json`), JSON.stringify(packed, null, 2))
    requirePredecessor(packed, packageName, version, tarball)
    return tarball
  })
  addPlugins(e2e, specs)
  const installed = predecessors.map(({ packageName, version }) => {
    const file = join(profileDir(e2e), 'node_modules', packageName, 'package.json')
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as LegacyManifest
    requirePredecessor(manifest, packageName, version, file)
    return { packageName, version, manifest }
  })
  const profile = loadUpgradeProfile(e2e)
  writeFileSync(join(artifacts, 'upgrade-predecessors.json'), JSON.stringify({ installed, layers: profile.layers.map(({ packageName, packageDir }) => ({ packageName, packageDir })), skippedBundles: profile.skippedBundles }, null, 2))
  writeFileSync(join(artifacts, 'upgrade-old-profile.json'), readFileSync(join(profileDir(e2e), 'package.json'), 'utf8'))
  writeFileSync(join(artifacts, 'upgrade-old-composed.yml'), dsh(e2e, ['--profile', PROFILE, '--dump-config']))
  for (const { packageName, version } of predecessors) {
    const layer = profile.layers.find(candidate => candidate.packageName === packageName)
    if (layer === undefined) throw new Error(`${packageName}@${version} was not selected as a predecessor bundle: ${JSON.stringify(profile.skippedBundles)}; see upgrade-predecessors.json`)
    const manifest = JSON.parse(readFileSync(join(layer.packageDir, 'package.json'), 'utf8')) as LegacyManifest
    requirePredecessor(manifest, packageName, version, layer.packageDir)
  }
}

/** Use the public launcher result, not a guessed settings filename or a permanent overlay. */
export function installCoexistencePatch(e2e: E2EContext): string {
  const profile = loadUpgradeProfile(e2e)
  if (profile.patches.length !== 0) throw new Error('the upgrade profile must start with an empty user layer')
  writeFileSync(profile.patchPath, readFileSync(fixture('upgrade-coexist.yml'), 'utf8'))
  return profile.patchPath
}

/** Old and new installs use the same hoisted URLs: isolate the old ESM cache in a child process. */
export async function createLegacyOffSession(e2e: E2EContext): Promise<SessionId> {
  const directory = dirname(e2e.env.DSH_HOME!)
  const contextFile = join(directory, 'legacy-context.json')
  const log = join(artifacts, 'upgrade-legacy-host.log')
  writeFileSync(contextFile, JSON.stringify(e2e))
  try {
    const result = await promisify(execFile)(process.execPath, [
      '--no-global-search-paths', fixture('upgrade-legacy-session.ts'), contextFile,
    ], { cwd: run, env: e2e.env, timeout: 120_000 })
    writeFileSync(log, result.stderr)
    return (JSON.parse(result.stdout) as { sessionId: SessionId }).sessionId
  } catch (error) {
    writeFileSync(log, inspect(error))
    throw error
  }
}

/** Remove the old bundle layers before adding the new profile's same-id rows. */
export function installUpgradeProfile(e2e: E2EContext): void {
  dsh(e2e, ['plugin', '--profile', PROFILE, 'remove', SEARCH.packageName, FETCH.packageName, '--store-dir', join(run, 'pnpm-store'), '--ignore-scripts'])
  const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
  if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
  addPlugins(e2e, [profile], plugins)
}

/**
 * The isolated world an end-to-end run happens in.
 *
 * Everything DSH, npm, or pnpm writes during a run — the DSH home with its
 * profiles, credentials and sessions, the OS home, XDG directories, caches,
 * the pnpm store, temp files — lives under `.e2e/run`, wiped at the start of
 * every run. A run never reads or changes the developer's own DSH home,
 * profiles, credentials, or a GUI they already have open.
 *
 * The DSH CLI under test is installed once per version under
 * `.e2e/dsh-<version>` and reused afterwards; `DSH_E2E_INSTALL` points at an
 * existing install instead.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { parse, parseDocument, type ScalarTag } from 'yaml'
import { pack, publishablePackages, repo } from '../../scripts/workspace.ts'

/** Scratch space for runs, ignored by git. */
export const workspace = join(repo, '.e2e')

/** This run's isolated world; recreated by the global setup. */
export const run = join(workspace, 'run')

/** Screenshots and logs worth keeping after a run. */
export const artifacts = join(workspace, 'artifacts')

/** The profile every run installs into: the shipped Web template. */
export const PROFILE = 'web'

/** The DSH release under test: the one the unit tests compile against (pnpm-workspace.yaml catalog). */
export const DSH_VERSION = (parse(readFileSync(join(repo, 'pnpm-workspace.yaml'), 'utf8')) as { catalog: Record<string, string> })
  .catalog['@deepseek-ai/dsh-web']!

/** What the global setup hands every e2e test file. */
export interface E2EContext {
  /** Directory whose `node_modules` holds `@deepseek-ai/dsh` and its packages. */
  readonly install: string
  /** The `dsh` executable. */
  readonly cli: string
  /** Environment for every DSH process and for the in-process host boot. */
  readonly env: Record<string, string>
  /** Packed tarball of every publishable package, by package name. */
  readonly tarballs: Record<string, string>
}

declare module 'vitest' {
  export interface ProvidedContext {
    e2e: E2EContext
  }
}

/**
 * Variables that would hide a composition mistake (a pinned provider), change
 * behaviour (a real DeepSeek key), or point DSH at the developer's own world.
 * NODE_PATH would also let the Vitest shim's workspace plugins shadow real
 * profile installs; workers additionally disable Node's global search paths.
 * Proxy and registry settings are kept: pnpm needs them to reach the registry.
 */
const LEAKY = /^(DSH_|DEEPSEEK_|VITEST|NODE_OPTIONS$|NODE_PATH$|NODE_ENV$)/

/**
 * Build the run's environment and create its directories.
 * @returns the current environment, scrubbed, with every home, cache, and temp directory inside `.e2e/run`.
 */
export function isolatedEnvironment(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !LEAKY.test(name)) env[name] = value
  }
  const dirs = {
    HOME: 'os-home', // npm, pnpm, and git read ~/.npmrc, ~/.gitconfig, ...
    DSH_HOME: 'home', // profiles, settings, credentials, sessions
    XDG_CACHE_HOME: 'cache',
    XDG_CONFIG_HOME: 'config',
    XDG_DATA_HOME: 'data',
    XDG_STATE_HOME: 'state',
    XDG_RUNTIME_DIR: 'runtime', // pnpm keeps its store operation locks here
    TMPDIR: 'tmp',
    DSH_AGENTS_HOME: 'agents', // user-level AGENTS.md and agent presets
    DSH_BUNDLED_SKILL_DIR: 'skills',
    COREPACK_HOME: 'corepack',
    PNPM_HOME: 'pnpm-home',
    npm_config_cache: 'npm-cache',
  }
  for (const [name, dir] of Object.entries(dirs)) {
    env[name] = join(run, dir)
    mkdirSync(env[name], { recursive: true, mode: 0o700 })
  }
  env.DSH_TELEMETRY_DISABLED = '1'
  return env
}

/**
 * Make sure the DSH CLI under test is installed. A fresh install goes to a
 * staging directory first, so an interrupted run never leaves a half install
 * that later runs would trust.
 * @param env - the run's environment, so npm caches inside the run.
 * @returns the install directory.
 */
export function ensureDsh(env: Record<string, string>): string {
  const install = process.env.DSH_E2E_INSTALL ?? join(workspace, `dsh-${DSH_VERSION}`)
  const manifest = (dir: string) => join(dir, 'node_modules/@deepseek-ai/dsh/package.json')
  if (!existsSync(manifest(install))) {
    if (process.env.DSH_E2E_INSTALL !== undefined) throw new Error(`DSH_E2E_INSTALL=${install} holds no @deepseek-ai/dsh`)
    const staging = `${install}.partial`
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })
    execFileSync('npm', ['install', '--prefix', staging, '--no-audit', '--no-fund', `@deepseek-ai/dsh@${DSH_VERSION}`], { env, stdio: 'inherit' })
    renameSync(staging, install)
  }
  const { version } = JSON.parse(readFileSync(manifest(install), 'utf8')) as { version: string }
  if (version !== DSH_VERSION) throw new Error(`${install} has DSH ${version}; the e2e suite targets ${DSH_VERSION}`)
  return install
}

/**
 * Pack every publishable package exactly as `pnpm publish` would.
 * @param env - the run's environment.
 * @returns tarball paths by package name.
 */
export function packWorkspace(env: Record<string, string>): Record<string, string> {
  const destination = join(run, 'tarballs')
  mkdirSync(destination, { recursive: true })
  return Object.fromEntries(publishablePackages().map(pkg => [pkg.manifest.name, pack(pkg, destination, env)]))
}

/**
 * Run the DSH CLI inside the isolated world.
 * @param e2e - the run's install and environment.
 * @param args - CLI arguments.
 * @returns standard output.
 */
export function dsh(e2e: Pick<E2EContext, 'cli' | 'env'>, args: readonly string[]): string {
  return execFileSync(e2e.cli, args, { cwd: run, env: e2e.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** Directory of the isolated profile. */
export const profileDir = (e2e: Pick<E2EContext, 'env'>) => join(e2e.env.DSH_HOME!, 'profiles', PROFILE)

/**
 * Install packages into the isolated profile with the real plugin manager.
 * `overrides` maps package names to local tarballs, so a bundle's
 * dependencies on not-yet-published workspace packages resolve to this run's
 * packs instead of the registry.
 * @param e2e - the run's install and environment.
 * @param specs - install specs.
 * @param overrides - package name → tarball, written to the profile's pnpm-workspace.yaml.
 */
export function addPlugins(e2e: Pick<E2EContext, 'cli' | 'env'>, specs: readonly string[], overrides: Record<string, string> = {}): void {
  // The first command against a profile creates it from the shipped template.
  dsh(e2e, ['--profile', PROFILE, '--dump-config'])
  if (Object.keys(overrides).length > 0) {
    const file = join(profileDir(e2e), 'pnpm-workspace.yaml')
    const document = parseDocument(readFileSync(file, 'utf8'))
    for (const [name, tarball] of Object.entries(overrides)) document.setIn(['overrides', name], `file:${tarball}`)
    writeFileSync(file, String(document))
  }
  // `--profile` must precede the arguments forwarded to pnpm. The store lives
  // inside the run, and removing a package later needs the same `--store-dir`.
  dsh(e2e, ['plugin', '--profile', PROFILE, 'add', ...specs, '--store-dir', join(run, 'pnpm-store'), '--ignore-scripts'])
}

/** One row of a composed entry list. */
export interface ComposedRow {
  readonly id: string
  readonly name?: string
  readonly disabled?: boolean
  readonly config?: Record<string, unknown>
}

/** Loader expressions stay opaque: these tests only read literal rows. */
const jsExpression: ScalarTag = { tag: 'tag:yaml.org,2002:js', resolve: source => ({ js: source }) }

/**
 * The profile as DSH composes it: base bundle, plugin bundles, the user
 * layer the settings pages write, then any extra overlays.
 * @param e2e - the run's install and environment.
 * @param overlays - patch files applied like `dsh --patch`.
 * @returns the top-level rows of `dsh --profile web --dump-config`.
 */
export function composedRows(e2e: Pick<E2EContext, 'cli' | 'env'>, overlays: readonly string[] = []): ComposedRow[] {
  const args = ['--profile', PROFILE, ...overlays.flatMap(file => ['--patch', file]), '--dump-config']
  return parse(dsh(e2e, args), { customTags: [jsExpression] }) as ComposedRow[]
}

/**
 * Make this test process look like the isolated world, for code that reads
 * `process.env` directly (the in-process host boot).
 * @param env - the run's environment.
 */
export function enterIsolatedEnvironment(env: Record<string, string>): void {
  for (const name of Object.keys(process.env)) if (!(name in env)) delete process.env[name]
  Object.assign(process.env, env)
}

/** Resolve the user patch through DSH's public profile loader, never a guessed filename. */
export function profilePatchPath(e2e: E2EContext): string {
  const anchor = join(e2e.install, 'node_modules/@deepseek-ai/dsh/package.json')
  const app = createRequire(anchor)('@deepseek-ai/dsh-app-boot') as {
    loadProfile(binName: string, name: string, anchor: string, home: string): { patchPath: string }
  }
  return app.loadProfile('web-enhanced-e2e', PROFILE, anchor, e2e.env.DSH_HOME!).patchPath
}

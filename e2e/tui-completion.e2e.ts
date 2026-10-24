import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse, stringify } from 'yaml'
import { pathToFileURL } from 'node:url'
import type {} from '@deepseek-ai/dsh-commands'
import { PROFILE_PACKAGE } from 'dsh-tool-web-enhanced-core/shared'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import { addPlugins, artifacts, createBaseProfile, enterIsolatedEnvironment, isolatedContext, profileDir } from './harness/environment.ts'
import { bootHost } from './harness/host.ts'
import { startTerminal } from './harness/terminal.ts'
import { startTextModelApi } from './harness/model-api.ts'
import { reviewDirectory } from './harness/review.ts'

const e2e = isolatedContext(inject('e2e'))
const tuiRoot = realpathSync(join(import.meta.dirname, '../node_modules/@deepseek-harness-tui/dsh-tui'))
const fixture = (name: string) => join(import.meta.dirname, 'fixtures', name)
const settings = fixture('setup-command-connections.yml')

describe('Published dsh-TUI with the installed enhanced web profile', () => {
  let terminal: ReturnType<typeof startTerminal> | undefined
  let model: Awaited<ReturnType<typeof startTextModelApi>> | undefined
  beforeAll(async () => {
    model = await startTextModelApi('TUI loopback model; commands must not invoke this.')
    e2e.env.DEEPSEEK_BASE_URL = model.url
    const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
    if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
    addPlugins(e2e, [profile], plugins)
    // Reuse the approved installed devDependency, never install a second TUI or touch a user profile.
    const scope = join(profileDir(e2e), 'node_modules/@deepseek-harness-tui')
    mkdirSync(scope, { recursive: true })
    symlinkSync(tuiRoot, join(scope, 'dsh-tui'), 'dir')
    const file = join(profileDir(e2e), 'package.json')
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as { dependencies: Record<string, string>; dsh: { profile: { bundles: string[] } } }
    manifest.dependencies['@deepseek-harness-tui/dsh-tui'] = 'file:' + tuiRoot
    manifest.dsh.profile.bundles.unshift('@deepseek-harness-tui/dsh-tui')
    writeFileSync(file, JSON.stringify(manifest, null, 2))
    // The launcher owns a separate TUI-only profile over dsh-base, as in a real installation.
    const tuiProfile = 'dsh-tui'
    createBaseProfile(e2e, tuiProfile)
    addPlugins(e2e, [profile], plugins, tuiProfile)
    const tuiDirectory = profileDir(e2e, tuiProfile)
    const tuiScope = join(tuiDirectory, 'node_modules/@deepseek-harness-tui')
    mkdirSync(tuiScope, { recursive: true })
    symlinkSync(tuiRoot, join(tuiScope, 'dsh-tui'), 'dir')
    const tuiManifestPath = join(tuiDirectory, 'package.json')
    const tuiManifest = JSON.parse(readFileSync(tuiManifestPath, 'utf8')) as typeof manifest
    tuiManifest.dependencies['@deepseek-harness-tui/dsh-tui'] = 'file:' + tuiRoot
    tuiManifest.dsh.profile.bundles = ['@deepseek-ai/dsh-base', '@deepseek-harness-tui/dsh-tui', PROFILE_PACKAGE]
    writeFileSync(tuiManifestPath, JSON.stringify(tuiManifest, null, 2))
    const userPatch = join(tuiDirectory, 'cordis.patch.yml')
    const existing = parse(readFileSync(userPatch, 'utf8')) as unknown[] | null
    const additions = [settings, fixture('tui-pty.yml')].flatMap(path => parse(readFileSync(path, 'utf8')) as unknown[])
    writeFileSync(userPatch, stringify([...(existing ?? []), ...additions]))
    e2e.env.PATH = dirname(e2e.cli) + ':' + e2e.env.PATH
    // The launchpad checks npm for updates; route that probe to loopback too.
    e2e.env.NPM_CONFIG_REGISTRY = model.url
    e2e.env.npm_config_registry = model.url
    enterIsolatedEnvironment(e2e.env)
  })
  afterEach(async () => {
    if (terminal !== undefined) { await terminal.close(); terminal = undefined }
  })
  afterAll(async () => {
    if (terminal !== undefined) await terminal.close()
    if (model !== undefined) await model.close()
  })

  it('registers both completion trees in the real TUI service and executes through Host CommandRuntime', async () => {
    // The public service entry omits the declared host facade re-export; use the same explicit accessor as TUI Channel.
    const { getHostCommandTrees } = await import(pathToFileURL(join(tuiRoot, 'lib/types/dsh-adapter/command-trees.js')).href) as {
      getHostCommandTrees: (runtime: unknown) => { children(path: readonly string[]): readonly { name: string; description: string }[] } | undefined
    }
    const host = await bootHost(e2e, [settings, fixture('tui-web-composition.yml'), fixture('disable-tui-frontend.yml')])
    try {
      const trees = getHostCommandTrees(host.ctx.get('tuiCommandTrees'))
      if (trees === undefined) throw new Error('the TUI bundle did not provide command trees')
      expect(trees.children(['setup-search'])).toEqual(expect.arrayContaining([
        { name: 'off', description: 'Turn web search off for this session' },
        { name: 'builtin:openalex', description: 'OpenAlex' },
        { name: 'custom:MyEngine', description: 'My Engine' },
        { name: 'freshness', description: 'Content freshness, for connections that apply it' },
      ]))
      expect(trees.children(['setup-search', 'freshness'])).toEqual([
        { name: 'auto', description: 'Auto' }, { name: 'fresh', description: 'Within 24 hours' }, { name: 'realtime', description: 'Live' },
      ])
      expect(trees.children(['setup-fetch'])).toEqual(expect.arrayContaining([
        { name: 'off', description: 'Turn web fetch off for this session' }, { name: 'builtin:local', description: 'Local HTTP' },
      ]))
      expect(trees.children(['setup-fetch', 'freshness'])).toEqual([])
      const { sessionId } = await host.ctx.sessionController.create({ cwd: e2e.env.DSH_HOME! })
      const result = await host.ctx.sessionController.resolveAgent(sessionId)
      if ('error' in result) throw result.error
      const output: Record<string, unknown> = {}
      for (const kind of ['search', 'fetch']) {
        expect(host.ctx.commands.list(result.agent).map(command => command.name)).toContain('setup-' + kind)
        output[kind] = await host.ctx.commands.execute(result.agent, '/setup-' + kind, [], new AbortController().signal)
        expect(await host.ctx.commands.execute(result.agent, '/setup-' + kind + ' off', [], new AbortController().signal)).toMatchObject({ result: { kind: 'success', text: 'Web ' + kind + ' is off for this session from the next model request.' } })
      }
      mkdirSync(reviewDirectory, { recursive: true })
      const evidence = { search: trees.children(['setup-search']), freshness: trees.children(['setup-search', 'freshness']), fetch: trees.children(['setup-fetch']), output }
      for (const directory of [artifacts, reviewDirectory]) writeFileSync(join(directory, 'm6-tui-service-evidence.json'), JSON.stringify(evidence, null, 2))
    } finally { await host.dispose() }
  })

  async function openTerminal(artifactName: string) {
    const active = startTerminal(e2e, [join(tuiRoot, 'bin/dsh-tui.js')], process.execPath, artifactName)
    terminal = active
    await active.waitFor('Welcome to dsh-TUI')
    active.write('\u001b')
    await active.waitFor('Setup skipped')
    return active
  }

  it('inserts the original uppercase connection id through real PTY completion and executes it', async () => {
    const active = await openTerminal('m6-tui-completion')
    active.write('/setup-search ')
    await active.waitFor('Turn web search off for this session')
    active.write('custom:')
    await active.waitFor('custom:MyEngine')
    // Tab inserts the contributed name, then Enter executes the completed argument.
    active.write('\t\r')
    // Incremental terminal frames repaint only changed cells; the Host test owns exact full wording.
    await active.waitFor('Now using My Engine (custom:MyEngine)')
    await active.close()
    terminal = undefined
  })

  it('shows the bare setup command output in a separate real PTY without editing an existing draft', async () => {
    const active = await openTerminal('m6-tui-command-output')
    active.write('/setup-search')
    await active.waitFor('setup-search')
    // Separate the control key from text so TUI does not classify the batch as a multiline paste.
    active.write('\r')
    await active.waitFor('Connections (')
    await active.waitFor('Routing: web_search')
    // TUI's generic command toast is capped; the real service evidence retains the full connection listing.
    await active.waitFor('My Engine (custom:MyEngine)')
    await active.close()
    terminal = undefined
  })
})

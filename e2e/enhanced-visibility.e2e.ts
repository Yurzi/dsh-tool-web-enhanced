import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { FETCH, PROFILE_PACKAGE, SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { beforeAll, describe, expect, inject, it } from 'vitest'
import { isolatedContext, addPlugins, artifacts, createBaseProfile, enterIsolatedEnvironment } from './harness/environment.ts'
import { bootHost, type Host } from './harness/host.ts'

const e2e = isolatedContext(inject('e2e'))
const require = createRequire(join(e2e.install, 'node_modules/@deepseek-ai/dsh/package.json'))
const { SessionId: sessionId } = require('@deepseek-ai/dsh-session') as { SessionId: typeof SessionId }
const enhanced = [SEARCH.tools.action, SEARCH.tools.list, FETCH.tools.action, FETCH.tools.list]
const fixture = (name: string) => join(import.meta.dirname, 'fixtures', name)
const progress = (step: string) => { appendFileSync(join(artifacts, 'enhanced-visibility-steps.log'), step + '\n') }

function names(host: Host, agent: Agent) {
  return host.ctx.tools.schemas(agent).map(tool => tool.name).filter(name => enhanced.includes(name)).toSorted()
}

async function prepareRequest(host: Host, agent: Agent): Promise<void> {
  progress('prepare start ' + agent.id)
  await host.ctx.waterfall('agent/request', { agent, turn: 1, step: 0, signal: new AbortController().signal } as never,
    (async () => ({ provider: 'e2e', model: 'e2e' })) as never)
  progress('prepare done ' + agent.id)
}

async function create(host: Host, preset?: string) {
  progress('create start ' + String(preset))
  const handle = await host.ctx.agents.create({
    sessionId: sessionId(randomUUID()),
    meta: { cwd: e2e.env.DSH_HOME! },
    ...(preset === undefined ? {} : {
      meta: { cwd: e2e.env.DSH_HOME!, agentPreset: preset },
      setup: async (scope: Agent['ctx']) => { await host.ctx.agentPresets.mount(scope, preset) },
    }),
  })
  progress('create done ' + handle.agent.id)
  return handle
}

describe('Enhanced tools in real shipped compositions', () => {
  beforeAll(() => {
    const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
    if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
    progress('install web profile')
    addPlugins(e2e, [profile], plugins)
    progress('initialize base profile')
    createBaseProfile(e2e, 'base')
    addPlugins(e2e, [profile], plugins, 'base')
    progress('both profiles installed')
    enterIsolatedEnvironment(e2e.env)
  })

  it.each(['standard', 'cordis', 'ptc', 'minimal'])('offers both pairs to a new %s conversation but not one started before opt-in', async preset => {
    progress('boot ' + preset)
    const host = await bootHost(e2e)
    progress('booted ' + preset)
    try {
      const old = await create(host, preset)
      try {
        expect(names(host, old.agent)).toEqual([])
        progress('enable search ' + preset)
        await host.ctx.settings.update(SEARCH.rowId, { enhancedTools: true })
        progress('enable fetch ' + preset)
        await host.ctx.settings.update(FETCH.rowId, { enhancedTools: true })
        progress('enabled both ' + preset)
        const fresh = await create(host, preset)
        try {
          // Request assembly awaits the same selection preparation as the normal loop.
          await prepareRequest(host, fresh.agent)
          expect(names(host, fresh.agent)).toEqual([...enhanced].toSorted())
          await prepareRequest(host, old.agent)
          expect(names(host, old.agent)).toEqual([])
          const assembly = await host.ctx.systemPrompt.assemble({ scope: fresh.agent })
          if (preset === 'ptc') {
            expect(assembly.tools.map(tool => tool.name)).toEqual(['run_code'])
            const sdk = assembly.sections.find(section => section.name === 'tools:sdk')
            expect(sdk).toBeDefined()
            for (const name of enhanced) expect(sdk!.text).toContain(name)
          } else {
            expect(assembly.tools.map(tool => tool.name)).toEqual(expect.arrayContaining(enhanced))
          }
          if (preset === 'minimal') expect(host.ctx.tools.get('web_search', fresh.agent)).toBeUndefined()
          await host.ctx.settings.update(SEARCH.rowId, { enhancedTools: false })
          expect(names(host, fresh.agent)).toEqual([FETCH.tools.action, FETCH.tools.list].toSorted())
        } finally {
          progress('dispose fresh ' + preset)
          await fresh.dispose()
          progress('disposed fresh ' + preset)
        }
      } finally {
        progress('dispose old ' + preset)
        await old.dispose()
        progress('disposed old ' + preset)
      }
    } finally {
      await host.ctx.settings.update(SEARCH.rowId, { enhancedTools: false })
      await host.ctx.settings.update(FETCH.rowId, { enhancedTools: false })
      await host.dispose()
    }
  })

  it('offers both pairs to a new base conversation, but not an older one, without a Web preset', async () => {
    const host = await bootHost(e2e, [], () => {}, 'base')
    try {
      const old = await create(host)
      try {
        expect(names(host, old.agent)).toEqual([])
        await host.ctx.settings.update(SEARCH.rowId, { enhancedTools: true })
        await host.ctx.settings.update(FETCH.rowId, { enhancedTools: true })
        const fresh = await create(host)
        try {
          await prepareRequest(host, fresh.agent)
          await prepareRequest(host, old.agent)
          expect(names(host, fresh.agent)).toEqual([...enhanced].toSorted())
          expect(names(host, old.agent)).toEqual([])
        } finally { await fresh.dispose() }
      } finally { await old.dispose() }
    } finally {
      await host.ctx.settings.update(SEARCH.rowId, { enhancedTools: false })
      await host.ctx.settings.update(FETCH.rowId, { enhancedTools: false })
      await host.dispose()
    }
  })

  it.each([SEARCH, FETCH])('disabling $rowId removes only its own enhanced pair', async disabled => {
    const overlay = disabled === SEARCH ? 'disable-search.yml' : 'disable-fetch.yml'
    const remaining = disabled === SEARCH ? FETCH : SEARCH
    const host = await bootHost(e2e, [fixture('enhanced-tools.yml'), fixture(overlay)])
    try {
      const handle = await create(host, 'standard')
      try {
        await prepareRequest(host, handle.agent)
        expect(names(host, handle.agent)).toEqual([remaining.tools.action, remaining.tools.list].toSorted())
      } finally { await handle.dispose() }
    } finally { await host.dispose() }
  })

  it('does not expose fetch enhanced tools when fetch-native-route selects HTTP', async () => {
    const host = await bootHost(e2e, [fixture('enhanced-tools.yml'), fixture('fetch-native-route.yml')])
    try {
      const handle = await create(host, 'standard')
      try {
        await prepareRequest(host, handle.agent)
        expect(names(host, handle.agent)).toEqual([SEARCH.tools.action, SEARCH.tools.list].toSorted())
        expect(host.ctx.tools.get('web_fetch', handle.agent)).toBeDefined()
      } finally { await handle.dispose() }
    } finally { await host.dispose() }
  })
})

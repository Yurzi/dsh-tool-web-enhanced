import { join } from 'node:path'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, inject, it } from 'vitest'
import { composedRows, enterIsolatedEnvironment } from './harness/environment.ts'
import { bootHost, type Host } from './harness/host.ts'
import { startFetchTarget } from './harness/http.ts'

const e2e = inject('e2e')
const fixture = (name: string) => join(import.meta.dirname, 'fixtures', name)
const notice = 'authorized web_fetch to reach non-public addresses within [127.0.0.1/32]'

describe('Fetch local allowlist in the real Host', () => {
  it.each([false, true])('enforces loopback authorization and prompt context (override: %s)', async allowed => {
    enterIsolatedEnvironment(e2e.env)
    const overlays = allowed ? [fixture('fetch-allow-loopback.yml')] : []
    if (allowed) expect(composedRows(e2e, overlays).find(row => row.id === 'web-fetch-enhanced')?.config).toEqual({
      version: 2, defaultConnection: 'builtin:local', connections: { 'builtin:local': { options: { allowCidrs: ['127.0.0.1/32'], userAgent: 'wfe-e2e/1.0' } } },
    })
    const target = await startFetchTarget()
    let host: Host | undefined
    try {
      host = await bootHost(e2e, overlays)
      const request = host.web.fetch({ url: target.url }, AbortSignal.timeout(15_000))
      if (allowed) {
        expect(await request).toMatchObject({ statusCode: 200, body: { kind: 'text', content: 'web-fetch-enhanced loopback fixture' } })
        expect(target.userAgents).toEqual(['wfe-e2e/1.0'])
      } else {
        await expect(request).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
        expect(target.userAgents).toEqual([])
      }
      const runtime = (await host.ctx.systemPrompt.assemble()).contexts.map(context => context.text).join('\n')
      if (allowed) expect(runtime).toContain(notice)
      else expect(runtime).not.toContain('authorized web_fetch to reach non-public addresses')
    } finally {
      try {
        await host?.dispose()
      } finally {
        await target.close()
      }
    }
  })

  it('does not advertise the allowlist when web_fetch routes to native HTTP', async () => {
    enterIsolatedEnvironment(e2e.env)
    const host = await bootHost(e2e, [fixture('fetch-allow-loopback.yml'), fixture('fetch-native-route.yml')])
    try {
      const runtime = (await host.ctx.systemPrompt.assemble()).contexts.map(context => context.text).join('\n')
      expect(runtime).not.toContain('authorized web_fetch to reach non-public addresses')
    } finally {
      await host.dispose()
    }
  })
})

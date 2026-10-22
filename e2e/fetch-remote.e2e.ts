import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { credentialRef } from '@deepseek-ai/dsh-credentials'
import { FETCH, PROFILE_PACKAGE } from 'dsh-tool-web-enhanced-core/shared'
import { stringify } from 'yaml'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { customFetchDocument, firecrawlResponse, remoteFetchFixture } from './fixtures/remote-fetch.ts'
import { isolatedContext, addPlugins, artifacts, enterIsolatedEnvironment } from './harness/environment.ts'
import { bootHost } from './harness/host.ts'
import { startRemoteFetchApi } from './harness/remote-fetch-api.ts'

const e2e = isolatedContext(inject('e2e'))
const require = createRequire(join(e2e.install, 'node_modules/@deepseek-ai/dsh/package.json'))
const key = (require('@deepseek-ai/dsh-credentials') as { credentialRef: typeof credentialRef }).credentialRef(remoteFetchFixture.credentialRef)

describe('Remote fetch in the real Host', () => {
  let api: Awaited<ReturnType<typeof startRemoteFetchApi>>
  let overlay: string

  beforeAll(async () => {
    const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
    if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
    addPlugins(e2e, [profile], plugins)
    api = await startRemoteFetchApi(firecrawlResponse())
    overlay = join(dirname(e2e.env.DSH_HOME!), 'remote-fetch.yml')
    writeFileSync(overlay, stringify([{ id: FETCH.rowId, config: customFetchDocument(new URL('v2/scrape', api.url).href) }]))
  })

  afterAll(async () => {
    if (api !== undefined) await api.close()
  })

  it.each([remoteFetchFixture.requestedUrl, 'http://10.0.0.1/x'])('forwards %s unchanged to the trusted service while local blocks it', async url => {
    enterIsolatedEnvironment(e2e.env)
    const start = api.requests.length
    api.respondWith(firecrawlResponse(url))
    const remote = await bootHost(e2e, [overlay])
    try {
      await remote.ctx.credentials.set(key, remoteFetchFixture.key)
      expect(await remote.ctx.credentials.describe(key)).toMatchObject({ configured: true })
      const result = await remote.web.fetch({ url }, AbortSignal.timeout(15_000))
      expect(result).toEqual({
        url, statusCode: 200,
        body: { kind: 'text', content: remoteFetchFixture.content }, truncated: false,
      })
      expect(api.requests).toHaveLength(start + 1)
      expect(api.requests[start]).toMatchObject({
        method: 'POST', path: '/v2/scrape',
        headers: { authorization: 'Bearer ' + remoteFetchFixture.key, 'content-type': 'application/json' },
      })
      expect(JSON.parse(api.requests[start]!.body)).toEqual({ url, formats: ['markdown'] })
      expect(api.requests[start]!.headers).not.toHaveProperty('x-api-key')
      writeFileSync(join(artifacts, 'fetch-remote-wire-' + start + '.json'), JSON.stringify({ request: api.requests[start], result }, null, 2))
    } finally {
      try {
        await remote.ctx.credentials.unset(key)
      } finally {
        await remote.dispose()
      }
    }

    const local = await bootHost(e2e)
    try {
      await expect(local.web.fetch({ url }, AbortSignal.timeout(15_000))).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
      expect(api.requests).toHaveLength(start + 1)
    } finally {
      await local.dispose()
    }
  })
})

import { describe, expect, it, vi } from 'vitest'
import { anysearchFetch, runAdapter, type OnDiagnostic } from 'dsh-tool-web-enhanced-core/host'
import { fetchErrors } from '../src/remote/errors.ts'
import { mcp, transport } from '../src/remote/http.ts'
import { createRemoteBackend } from '../src/remote/execute.ts'
import { fetchResult, pageFailure } from '../src/remote/page.ts'
import { resolveSettings } from '../src/settings/resolve.ts'
import { json, readJson, serve } from './fixtures/http.ts'

const KEY = 'fixture-anysearch-key'
const INPUT = { url: 'http://localhost/private/%2F?q=raw#fragment', options: {} }
const PREFIX = 'dsh-web-fetch-enhanced: '

async function direct(endpoint: string, onDiagnostic?: OnDiagnostic) {
  const outcome = await runAdapter({
    errors: fetchErrors, transport, mcp, credential: async () => KEY,
    credentialMissing: () => 'missing fixture key', credentialInvalid: () => 'invalid fixture key',
    onDiagnostic,
  }, anysearchFetch, { access: 'api-key', label: 'AnySearch', endpoint, credentialRef: 'ANYSEARCH_API_KEY' }, INPUT, undefined)
  if (outcome.kind === 'failure') throw pageFailure('AnySearch', outcome.failure, outcome.detail)
  return fetchResult(outcome.page, INPUT)
}

function backend(endpoint: string, key: string | undefined, label = 'AnySearch', onDiagnostic?: OnDiagnostic) {
  const settings = resolveSettings({ connections: {
    'custom:anysearch': { kind: 'adapter', adapter: 'anysearch', label, credentialRef: 'ANYSEARCH_API_KEY', endpoint, trustedEndpoint: true },
  } })
  const connection = settings.connections.get('custom:anysearch')
  if (connection === undefined || connection.kind !== 'adapter') throw new Error('expected AnySearch connection')
  return createRemoteBackend(connection, { credential: async () => key, ...(onDiagnostic === undefined ? {} : { onDiagnostic }) })
}

describe('AnySearch failure classification preserves trusted tags', () => {
  it.each([
    [422, 'as_sk_unsupported_abcdef', 'WEB_PROVIDER_ERROR', 'Team reader could not read the page; retry later or choose another fetch connection', true],
    [400, 'as_sk_unsupported_abcdef', 'WEB_PROVIDER_ERROR', 'Team reader failed (HTTP 400); retry later or choose another connection', true],
    [422, 'failure', 'WEB_UNSUPPORTED_CONTENT_TYPE', 'Team reader cannot read this content type (for example PDF or other binary files); try another fetch connection', false],
  ] as const)('keeps a classified backend error, not fetch failed, at HTTP %i with key %s', async (status, key, code, short, withheld) => {
    const endpoint = await serve((_request, response) => {
      response.statusCode = status
      json(response, { code: -1, error_code: 'extract_unsupported_content', message: 'Unsupported content type.' })
    })
    const onDiagnostic = vi.fn()
    const suffix = withheld
      ? "\n\nTeam reader's response was withheld because it contained this request's credential."
      : '\n\nTeam reader responded (untrusted): Unsupported content type.'
    await expect(backend(endpoint, key, 'Team reader', onDiagnostic).fetch(INPUT)).rejects.toMatchObject({ code, message: PREFIX + short + suffix })
    expect(onDiagnostic).not.toHaveBeenCalled()
  })

  it('keeps HTTP 402 content and diagnostics empty despite a credential collision with an error code', async () => {
    const endpoint = await serve((_request, response) => {
      response.statusCode = 402
      json(response, { code: -1, error_code: 'extract_unsupported_content', message: 'generated account password and api_key must be ignored' })
    })
    const onDiagnostic = vi.fn()
    await expect(backend(endpoint, 'as_sk_unsupported_abcdef', 'Team reader', onDiagnostic).fetch(INPUT)).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR', message: PREFIX + 'Team reader refused the request (HTTP 402); check account credit and API access',
    })
    expect(onDiagnostic).not.toHaveBeenCalled()
  })
})

describe('AnySearch extract through local HTTP and the real wire', () => {
  it('posts exactly the URL and maps successful text to the requested URL and compatible 200, without the title', async () => {
    const requests: { method: string | undefined; authorization: string | undefined; contentType: string | undefined; body: unknown }[] = []
    const endpoint = await serve((request, response) => {
      void readJson(request).then(body => {
        requests.push({ method: request.method, authorization: request.headers.authorization, contentType: request.headers['content-type'], body })
        json(response, { code: 0, data: { url: 'https://ignored.example/final', title: 'Not part of content', content: '# Page\nEvidence', statusCode: 404 } })
      })
    })
    const expected = { url: INPUT.url, statusCode: 200, body: { kind: 'text', content: '# Page\nEvidence' }, truncated: false }
    expect(await direct(endpoint)).toStrictEqual(expected)
    expect(await backend(endpoint, KEY).fetch(INPUT)).toStrictEqual(expected)
    expect(requests).toStrictEqual(Array.from({ length: 2 }, () => ({ method: 'POST', authorization: 'Bearer ' + KEY, contentType: 'application/json', body: { url: INPUT.url } })))
  })

  it.each([
    [400, 'invalid_extract_url', 'URL is invalid.', 'WEB_INVALID_URL', 'AnySearch refused the URL as invalid or not allowed; check the URL'],
    [422, 'extract_unsupported_content', 'Unsupported content type.', 'WEB_UNSUPPORTED_CONTENT_TYPE', 'AnySearch cannot read this content type (for example PDF or other binary files); try another fetch connection'],
    [422, undefined, 'Unable to extract content.', 'WEB_PROVIDER_ERROR', 'AnySearch could not read the page; retry later or choose another fetch connection'],
    [422, 'unknown', 'Unable to extract content.', 'WEB_PROVIDER_ERROR', 'AnySearch could not read the page; retry later or choose another fetch connection'],
    [401, undefined, 'Invalid API key.', 'WEB_PROVIDER_ERROR', 'AnySearch rejected the API key (HTTP 401); ask the user to check the key in connection settings'],
    [403, 'invalid_extract_url', 'Access denied.', 'WEB_PROVIDER_ERROR', 'AnySearch rejected the API key (HTTP 403); ask the user to check the key in connection settings'],
    [429, 'extract_timeout', 'Rate limit reached.', 'WEB_PROVIDER_ERROR', 'AnySearch is rate limiting requests (HTTP 429); retry later or choose another connection'],
    [400, undefined, 'Bad request.', 'WEB_PROVIDER_ERROR', 'AnySearch failed (HTTP 400); retry later or choose another connection'],
    [502, undefined, 'Origin unavailable.', 'WEB_PROVIDER_ERROR', 'AnySearch failed (HTTP 502); retry later or choose another connection'],
    [422, 'extract_target_blocked', 'Target is blocked.', 'WEB_BLOCKED_URL', 'AnySearch refused to read the URL because the service blocks this target; try another URL or fetch connection'],
    [422, 'extract_content_too_large', 'Content is too large.', 'WEB_FETCH_TOO_LARGE', 'the page is too large for AnySearch; fetch a more specific URL'],
    [422, 'extract_timeout', 'Extract timed out.', 'WEB_FETCH_TIMEOUT', 'AnySearch timed out reading the page; retry later or choose another fetch connection'],
    [422, 'extract_canceled', 'Extract was canceled.', 'WEB_PROVIDER_ERROR', 'AnySearch could not read the page; retry later or choose another fetch connection'],
  ] as const)('words HTTP %i / %s exactly with its WebError code', async (status, error_code, message, code, short) => {
    const endpoint = await serve((_request, response) => {
      response.statusCode = status
      json(response, { code: -1, message, error_code })
    })
    const label = 'Team reader'
    await expect(backend(endpoint, KEY, label).fetch(INPUT)).rejects.toMatchObject({ code, message: PREFIX + short.replaceAll('AnySearch', label) + '\n\n' + label + ' responded (untrusted): ' + message })
  })

  it.each([false, true])('never exposes or logs HTTP 402 generated credentials, even when our key is echoed (%s)', async echo => {
    const generated = { username: 'generated-user-unique', password: 'generated-password-unique', api_key: 'as_sk_generated_unique' }
    const endpoint = await serve((_request, response) => {
      response.statusCode = 402
      json(response, { code: -1, ...generated, message: JSON.stringify(generated) + (echo ? KEY : '') })
    })
    const onDiagnostic = vi.fn()
    const pending = direct(endpoint, onDiagnostic)
    await expect(pending).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: PREFIX + 'AnySearch refused the request (HTTP 402); check account credit and API access' })
    await expect(pending).rejects.not.toHaveProperty('cause')
    expect(onDiagnostic).not.toHaveBeenCalled()
  })

  it.each([400, 401, 422])('withholds a selected or generic explanation when any body field echoes this request key (HTTP %i)', async status => {
    const endpoint = await serve((_request, response) => {
      response.statusCode = status
      json(response, { code: -1, error_code: 'invalid_extract_url', message: 'Safe message.', credential_echo: KEY })
    })
    const short = status === 401
      ? 'AnySearch rejected the API key (HTTP 401); ask the user to check the key in connection settings'
      : 'AnySearch refused the URL as invalid or not allowed; check the URL'
    await expect(direct(endpoint)).rejects.toMatchObject({
      code: status === 401 ? 'WEB_PROVIDER_ERROR' : 'WEB_INVALID_URL',
      message: PREFIX + short + "\n\nAnySearch's response was withheld because it contained this request's credential.",
    })
  })

  it.each([undefined, '', '  '])('does not request extract without a personal key (%j)', async key => {
    let requests = 0
    const endpoint = await serve((_request, response) => { requests++; json(response, { code: 0, data: { content: 'unused' } }) })
    await expect(backend(endpoint, key).fetch(INPUT)).rejects.toMatchObject({
      code: 'WEB_PROVIDER_CREDENTIAL_MISSING',
      message: PREFIX + 'no API key is stored for ANYSEARCH_API_KEY; ask the user to add it in fetch connection settings (DSH Credentials) or choose another connection',
    })
    expect(requests).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { modelRequest, modelUrl, parseModelResponse } from '../src/model/protocols.ts'
import { resolveSettings } from '../src/settings/resolve.ts'
import { fixedRoute } from '../src/model/route.ts'

const route = {
  protocol: 'codex-alpha', dialect: 'standard', model: 'gpt-5.6-luna', baseURL: 'https://gateway.example/v1/',
  auth: { kind: 'api-key', credentialRef: 'ALPHA_KEY', source: 'credentials' },
} as const

describe('Codex Alpha protocol', () => {
  it('uses a distinct Alpha request, not Responses or Chat Completions', () => {
    expect(modelUrl('codex-alpha', route.baseURL + '//')).toBe('https://gateway.example/v1/alpha/search')
    const request = modelRequest(route, {}, 'original query', 'fixture-key')
    expect(request).toEqual({
      url: 'https://gateway.example/v1/alpha/search', method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', authorization: 'Bearer fixture-key' },
      body: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/u), model: 'gpt-5.6-luna',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'original query' }] }],
        commands: { search_query: [{ q: 'original query' }] },
        settings: { allowed_callers: ['direct'], external_web_access: true }, max_output_tokens: 2048,
      },
    })
    expect(modelRequest(route, { maxTokens: 1234 }, 'q', 'key').body).toMatchObject({ max_output_tokens: 1234 })
    expect(modelRequest(route, {}, 'original query', 'fixture-key').body).not.toEqual(request.body)
  })

  it('parses only structured sources and removes private citation markers', () => {
    expect(parseModelResponse('codex-alpha', {
      output: ' Answer citeturn0search0 [wordlim: 100] ',
      results: [{ url: 'https://a.test', title: 'A' }, null, 'ignored'],
    })).toEqual({ kind: 'answer', content: ' Answer  ', rows: [{ url: 'https://a.test', title: 'A' }] })
  })

  it.each([undefined, null, []])('accepts answer-only results (%j)', results => {
    expect(parseModelResponse('codex-alpha', { output: 'Answer', results })).toEqual({ kind: 'answer', content: 'Answer', rows: [] })
    expect(parseModelResponse('codex-alpha', { output: '', results })).toEqual({ kind: 'answer', content: '', rows: [] })
  })

  it.each(['    print("x")\n', '', '  \n  ', 'Aciteturn0search0 B', 'Aciteunfinished'])('preserves answer text apart from complete citations (%j)', output => {
    expect(parseModelResponse('codex-alpha', { output, results: [] })).toEqual({
      kind: 'answer', content: output.replace('citeturn0search0', ''), rows: [],
    })
  })

  it('handles repeated unclosed citation prefixes within a generous CPU budget', () => {
    const output = 'cite'.repeat(16_384)
    const start = performance.now()
    const result = parseModelResponse('codex-alpha', { output, results: [] })
    const elapsed = performance.now() - start
    expect(result).toEqual({ kind: 'answer', content: output, rows: [] })
    // This is a performance bound, not a timer used to synchronize behaviour.
    expect(elapsed).toBeLessThan(1000)
  })

  it.each([
    ['Aciteone\n [wordlim: 100]B', 'AB'],
    ['Aciteone  [wordlim: nope]B', 'A  [wordlim: nope]B'],
    ['Aciteone  BcitetwoC', 'A  BC'],
    ['Aciteone\n', 'A\n'],
  ])('removes only complete citation metadata (%j)', (output, content) => {
    expect(parseModelResponse('codex-alpha', { output })).toEqual({ kind: 'answer', content, rows: [] })
  })

  it.each([null, [], {}, { output: [] }, { output: 'Answer', results: {} }])('rejects incompatible payloads (%j)', payload => {
    expect(parseModelResponse('codex-alpha', payload)).toEqual({ kind: 'failure', failure: 'invalid' })
  })

  it('resolves a trusted fixed Alpha connection without changing defaults', () => {
    const settings = resolveSettings({ connections: { 'custom:alpha': {
      kind: 'model', protocol: 'codex-alpha', model: 'gpt-5.6-luna', label: 'Alpha',
      endpoint: route.baseURL, credentialRef: 'ALPHA_KEY', trustedEndpoint: true, options: { maxTokens: 1234 },
    } } })
    const connection = settings.connections.get('custom:alpha')
    expect(settings.defaultConnection).toBe('builtin:deepseek-messages')
    expect(connection).toMatchObject({ kind: 'model', disabled: false, options: { maxTokens: 1234 } })
    if (connection?.kind !== 'model' || connection.route.kind !== 'fixed') throw new Error('expected a fixed model connection')
    expect(fixedRoute(connection.route)).toEqual(route)
  })
})

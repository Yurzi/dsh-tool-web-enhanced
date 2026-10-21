import { describe, expect, expectTypeOf, it } from 'vitest'
import { MODEL_DEFAULTS, MODEL_OPTIONS, type ModelProtocol } from '../src/catalog.ts'
import { modelRequest, modelUrl, parseModelResponse } from '../src/model/protocols.ts'
import { anthropicSearchResponse } from './fixtures/anthropic-search.ts'
import type { ModelOptions, ModelRoute } from '../src/model/types.ts'

const key = 'fixture-key'
const route = (protocol: ModelProtocol): ModelRoute => ({
  protocol, dialect: 'standard', model: 'search-model', baseURL: 'https://api.example/v1/',
  auth: { kind: 'api-key', credentialRef: 'MODEL_KEY', source: 'credentials' },
})
const prompt = 'Perform a web search for the query: latest news'
const headers = { accept: 'application/json', 'content-type': 'application/json' }
const invalid = { kind: 'failure', failure: 'invalid' }

it('keeps model option keys synchronized with the catalog', () => {
  expectTypeOf<keyof ModelOptions>().toEqualTypeOf<keyof typeof MODEL_OPTIONS>()
})

describe('model request protocols', () => {
  it('preserves interior slash runs ending in a non-slash', () => {
    const base = 'https://api.example/' + '/'.repeat(32_000) + 'x'
    expect(modelUrl('openai-responses', base)).toBe(base + '/responses')
  })

  it.each(['anthropic-messages', 'openai-responses', 'openai-chat-completions'] as const)('uppercases userCountry on %s', protocol => {
    const body = modelRequest(route(protocol), { userCountry: 'gb' }, 'q', key).body
    expect(JSON.stringify(body)).toContain('"country":"GB"')
  })

  it.each(['anthropic-messages', 'openai-responses'] as const)('omits empty domain lists on %s', protocol => {
    expect(modelRequest(route(protocol), { allowedDomains: [], blockedDomains: [] }, 'q', key).body).toEqual(modelRequest(route(protocol), {}, 'q', key).body)
  })

  it.each(['web_search_20250305', 'web_search_20260209'] as const)('omits response_inclusion for %s', anthropicTool => {
    expect(modelRequest(route('anthropic-messages'), { anthropicTool, responseInclusion: 'excluded' }, 'q', key).body).toEqual(modelRequest(route('anthropic-messages'), { anthropicTool }, 'q', key).body)
  })
  it.each([
    ['anthropic-messages', 'https://api.example', 'https://api.example/v1/messages'],
    ['anthropic-messages', 'https://api.example/v1///', 'https://api.example/v1/messages'],
    ['anthropic-messages', 'https://api.example/anthropic/', 'https://api.example/anthropic/v1/messages'],
    ['anthropic-messages', 'https://v1.example/custom', 'https://v1.example/custom/v1/messages'],
    ['openai-responses', 'https://api.example/v1///', 'https://api.example/v1/responses'],
    ['openai-responses', 'https://api.example', 'https://api.example/responses'],
    ['openai-chat-completions', 'https://api.example/v1/', 'https://api.example/v1/chat/completions'],
  ] as const)('joins %s at %s', (protocol, baseURL, expected) => {
    expect(modelUrl(protocol, baseURL)).toBe(expected)
  })

  it('builds standard Messages with the latest tool and only the API-key header', () => {
    expect(modelRequest(route('anthropic-messages'), { maxTokens: 1234, maxUses: 3, searchContextSize: 'high' }, 'latest news', key)).toEqual({
      url: 'https://api.example/v1/messages', method: 'POST',
      headers: { ...headers, 'anthropic-version': '2023-06-01', 'x-api-key': 'fixture-key' },
      body: {
        model: 'search-model', max_tokens: 1234,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        tools: [{ type: MODEL_DEFAULTS.anthropicTool, name: 'web_search', max_uses: 3 }],
      },
    })
    expect(modelRequest(route('anthropic-messages'), {}, 'q', key).body).toMatchObject({ max_tokens: MODEL_DEFAULTS.maxTokens, tools: [{ type: MODEL_DEFAULTS.anthropicTool, name: 'web_search', max_uses: MODEL_DEFAULTS.maxUses }] })
  })

  it('uses DeepSeek-compatible defaults, explicit tool overrides, and exclusive account headers', () => {
    const deepseek = { ...route('anthropic-messages'), protocol: 'anthropic-messages', dialect: 'deepseek', auth: { kind: 'account' } } as const
    const credential = 'fixture-token'
    const request = modelRequest(deepseek, {}, 'q', credential)
    expect(request.headers).toEqual({ ...headers, 'anthropic-version': '2023-06-01', 'x-dsh-auth-token': 'fixture-token' })
    expect(request.body).toMatchObject({ thinking: { type: 'disabled' }, max_tokens: MODEL_DEFAULTS.maxTokens, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MODEL_DEFAULTS.maxUses }] })
    expect(modelRequest(deepseek, { anthropicTool: 'web_search_20260209' }, 'q', credential).body).toMatchObject({ thinking: { type: 'disabled' }, tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: MODEL_DEFAULTS.maxUses }] })
  })

  it('maps every Messages tool option while ignoring unrelated Session options', () => {
    const request = modelRequest(route('anthropic-messages'), {
      anthropicTool: 'web_search_20260318', maxUses: 7, allowedCallers: 'direct', responseInclusion: 'excluded',
      allowedDomains: ['example.com/blog'], userCity: 'San Francisco', userRegion: 'California', userCountry: 'US', userTimezone: 'America/Los_Angeles',
      responsesTool: 'web_search_preview', searchContextSize: 'low', externalWebAccess: false, returnTokenBudget: 'unlimited',
    }, 'q', key)
    expect(request.body).toEqual({ model: 'search-model', max_tokens: MODEL_DEFAULTS.maxTokens,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Perform a web search for the query: q' }] }],
      tools: [{ type: 'web_search_20260318', name: 'web_search', max_uses: 7, allowed_callers: ['direct'], response_inclusion: 'excluded', allowed_domains: ['example.com/blog'],
        user_location: { type: 'approximate', city: 'San Francisco', region: 'California', country: 'US', timezone: 'America/Los_Angeles' } }],
    })
    expect(modelRequest(route('anthropic-messages'), { blockedDomains: ['blocked.test'], allowedCallers: 'code_execution_20260120', responseInclusion: 'full' }, 'q', key).body).toMatchObject({ tools: [{ type: MODEL_DEFAULTS.anthropicTool, name: 'web_search', max_uses: 5, blocked_domains: ['blocked.test'], allowed_callers: ['code_execution_20260120'], response_inclusion: 'full' }] })
  })

  it('builds Responses with optional search and no default token limit', () => {
    expect(modelRequest(route('openai-responses'), {}, 'latest news', key)).toEqual({
      url: 'https://api.example/v1/responses', method: 'POST', headers: { ...headers, authorization: 'Bearer fixture-key' },
      body: {
        model: 'search-model', input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
        tools: [{ type: MODEL_DEFAULTS.responsesTool }], tool_choice: 'auto',
        include: ['web_search_call.action.sources'], store: false, stream: false,
      },
    })
  })

  it('maps every Responses tool option and keeps explicit false values', () => {
    expect(modelRequest(route('openai-responses'), {
      maxTokens: 2345, responsesTool: 'web_search_preview', searchContextSize: 'high', externalWebAccess: false, returnTokenBudget: 'unlimited',
      blockedDomains: ['blocked.test'], userCity: 'London', userRegion: 'England', userCountry: 'GB', userTimezone: 'Europe/London',
      anthropicTool: 'web_search_20250305', maxUses: 9, allowedCallers: 'direct', responseInclusion: 'excluded',
    }, 'latest news', key).body).toEqual({
      model: 'search-model', input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
      tools: [{ type: 'web_search_preview', search_context_size: 'high', external_web_access: false, return_token_budget: 'unlimited', filters: { blocked_domains: ['blocked.test'] },
        user_location: { type: 'approximate', city: 'London', region: 'England', country: 'GB', timezone: 'Europe/London' } }],
      tool_choice: 'auto', include: ['web_search_call.action.sources'], max_output_tokens: 2345, store: false, stream: false,
    })
    expect(modelRequest(route('openai-responses'), { allowedDomains: ['allowed.test'], blockedDomains: ['blocked.test'], externalWebAccess: true, returnTokenBudget: 'default' }, 'q', key).body).toMatchObject({ tools: [{ type: 'web_search', filters: { allowed_domains: ['allowed.test'], blocked_domains: ['blocked.test'] }, external_web_access: true, return_token_budget: 'default' }] })
  })

  it('builds Chat using max_completion_tokens and nested approximate location', () => {
    expect(modelRequest(route('openai-chat-completions'), { maxTokens: 3456, searchContextSize: 'low', userCountry: 'US', userCity: 'Boston', userRegion: 'Massachusetts', userTimezone: 'America/New_York', allowedDomains: ['ignored.test'], externalWebAccess: false, responsesTool: 'web_search_preview', maxUses: 9 }, 'latest news', key)).toEqual({
      url: 'https://api.example/v1/chat/completions', method: 'POST', headers: { ...headers, authorization: 'Bearer fixture-key' },
      body: { model: 'search-model', messages: [{ role: 'user', content: prompt }],
        web_search_options: { search_context_size: 'low', user_location: { type: 'approximate', approximate: { city: 'Boston', region: 'Massachusetts', country: 'US', timezone: 'America/New_York' } } },
        max_completion_tokens: 3456, stream: false },
    })
    expect(modelRequest(route('openai-chat-completions'), {}, 'q', key).body).toEqual({ model: 'search-model', messages: [{ role: 'user', content: 'Perform a web search for the query: q' }], web_search_options: {}, stream: false })
  })

  it.each(['anthropic-messages', 'openai-responses', 'openai-chat-completions'] as const)('emits only the supplied location fields on %s', protocol => {
    const request = modelRequest(route(protocol), { userCountry: 'GB' }, 'q', key)
    const body = request.body as Record<string, unknown>
    const expected = protocol === 'openai-chat-completions' ? { type: 'approximate', approximate: { country: 'GB' } } : { type: 'approximate', country: 'GB' }
    if (protocol === 'openai-chat-completions') expect(body.web_search_options).toEqual({ user_location: expected })
    else expect(body.tools).toEqual([expect.objectContaining({ user_location: expected })])
  })
})

describe('Messages model responses', () => {
  it('joins adjacent citation-split text from the official Anthropic example without a paragraph break', () => {
    expect(parseModelResponse('anthropic-messages', anthropicSearchResponse)).toMatchObject({ kind: 'answer', content: "I'll search for when Claude Shannon was born.\n\nBased on the search results, Claude Shannon was born on April 30, 1916, in Petoskey, Michigan" })
  })

  it('keeps citation sources when result blocks were excluded', () => {
    expect(parseModelResponse('anthropic-messages', { content: [{ type: 'text', text: 'A', citations: [
      { type: 'web_search_result_location', url: 'https://a.test', title: 'A', cited_text: 'x' },
      { type: 'other', url: 'https://ignored.test', title: 'not a search citation' },
    ] }] })).toEqual({ kind: 'answer', content: 'A', rows: [{ url: 'https://a.test', title: 'A', snippet: 'x' }] })
  })
  it('reads DeepSeek results without citations and preserves all text verbatim', () => {
    expect(parseModelResponse('anthropic-messages', { content: [
      { type: 'text', text: '  Searching  ', citations: null },
      { type: 'server_tool_use', name: 'web_search', caller: { type: 'direct' } },
      { type: 'web_search_tool_result', content: [
        { type: 'web_search_result', url: 'https://a.test', title: 'A', page_age: null },
        { type: 'web_search_result', url: 'https://b.test', title: 'B', page_age: '2026-01-02' },
      ] },
      { type: 'text', text: '  Answer\nwith whitespace  ', citations: null },
      { type: 'text', text: '   ' },
    ] })).toEqual({ kind: 'answer', rows: [
      { url: 'https://a.test', title: 'A', publishedAt: null, snippet: undefined },
      { url: 'https://b.test', title: 'B', publishedAt: '2026-01-02', snippet: undefined },
    ], content: '  Searching  \n\n  Answer\nwith whitespace     ' })
  })

  it('uses the first cited excerpt for matching results', () => {
    expect(parseModelResponse('anthropic-messages', { content: [
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://a.test', title: 'A' }] },
      { type: 'text', text: 'Answer', citations: [
        { type: 'web_search_result_location', url: 'https://a.test', cited_text: ' excerpt ' },
        { url: 'https://a.test', cited_text: 'second excerpt' },
      ] },
    ] })).toMatchObject({ kind: 'answer', rows: [expect.objectContaining({ url: 'https://a.test', title: 'A', snippet: 'excerpt' }), { url: 'https://a.test', title: undefined, snippet: ' excerpt ' }], content: 'Answer' })
  })

  it.each(['too_many_requests', 'max_uses_exceeded', 'unavailable', 'private-upstream-error'])('passes through answers after tool error %s', error_code => {
    expect(parseModelResponse('anthropic-messages', { content: [
      { type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code } },
      { type: 'text', text: 'Search failed; here is my answer.' },
    ] })).toEqual({ kind: 'answer', rows: [], content: 'Search failed; here is my answer.' })
  })

  it('keeps sources and text alongside a failed search tool', () => {
    expect(parseModelResponse('anthropic-messages', { content: [
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://a.test', title: 'A' }] },
      { type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'too_many_requests' } },
      { type: 'text', text: 'Partial results' },
    ] })).toMatchObject({ kind: 'answer', rows: [expect.objectContaining({ url: 'https://a.test', title: 'A' })], content: 'Partial results' })
  })

  it('accepts empty searches and answers with no search blocks', () => {
    expect(parseModelResponse('anthropic-messages', { content: [{ type: 'web_search_tool_result', content: [] }] })).toEqual({ kind: 'answer', rows: [], content: undefined })
    expect(parseModelResponse('anthropic-messages', { content: [{ type: 'text', text: 'I cannot search' }] })).toEqual({ kind: 'answer', rows: [], content: 'I cannot search' })
  })
})

describe('Responses model responses', () => {
  it('reads action sources and inline citations while preserving all message output_text', () => {
    expect(parseModelResponse('openai-responses', { output: [
      { type: 'web_search_call', status: 'completed', action: { sources: [{ type: 'url', url: 'https://a.test', title: 'A' }] } },
      { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'private reasoning' }] },
      { type: 'message', content: [
        { type: 'output_text', text: ' First ', annotations: [{ type: 'url_citation', url: 'https://b.test', title: 'B' }, { type: 'other', url: 'https://ignored.test' }] },
        { type: 'output_text', text: ' Second ', annotations: [] },
      ] },
      { type: 'message', content: [{ type: 'output_text', text: 'Third' }] },
    ] })).toEqual({ kind: 'answer', rows: [{ url: 'https://a.test', title: 'A' }, { url: 'https://b.test', title: 'B' }], content: ' First  Second \n\nThird' })
  })

  it.each([
    { type: 'search', queries: ['query', 'ws_call_id=fixture-call'] },
    { type: 'open_page', url: 'https://example.com#ws_call_id=fixture-call' },
  ])('does not turn DeepSeek action markers into sources: $type', action => {
    expect(parseModelResponse('openai-responses', { output: [
      { type: 'web_search_call', status: 'completed', action },
      { type: 'message', content: [{ type: 'output_text', text: 'Answer', annotations: [] }] },
    ] })).toEqual({ kind: 'answer', rows: [], content: 'Answer' })
  })

  it('passes through unsearched answers and answers after a failed call', () => {
    const message = { type: 'message', content: [{ type: 'output_text', text: 'Answer', annotations: [] }] }
    for (const output of [[message], [{ type: 'web_search_call', status: 'failed', error: 'private details' }, message]]) {
      expect(parseModelResponse('openai-responses', { output })).toEqual({ kind: 'answer', rows: [], content: 'Answer' })
    }
  })
})

describe('Chat model responses', () => {
  it('reads nested URL annotations and legacy top-level citations', () => {
    expect(parseModelResponse('openai-chat-completions', {
      choices: [{ message: { content: ' Answer ', annotations: [
        { type: 'url_citation', url_citation: { url: 'https://a.test', title: 'A' } },
        { type: 'other', url_citation: { url: 'https://ignored.test' } },
      ] } }], citations: ['https://b.test', { url: 'https://c.test', title: 'C' }],
    })).toEqual({ kind: 'answer', rows: [{ url: 'https://a.test', title: 'A' }, { url: 'https://b.test' }, { url: 'https://c.test', title: 'C' }], content: ' Answer ' })
  })

  it('concatenates adjacent text content blocks verbatim and reads only the first choice', () => {
    expect(parseModelResponse('openai-chat-completions', { choices: [
      { message: { content: [{ type: 'text', text: ' First ' }, { type: 'text', text: ' ' }, { type: 'text', text: 'Second' }] } },
      { message: { content: 'not the chosen answer' } },
    ] })).toEqual({ kind: 'answer', rows: [], content: ' First  Second' })
  })

  it('passes through the DeepSeek Chat shape without evidence of searching', () => {
    expect(parseModelResponse('openai-chat-completions', { choices: [{ index: 0, message: { role: 'assistant', content: 'I cannot perform a live web search', reasoning_content: 'not answer text' } }] })).toEqual({ kind: 'answer', rows: [], content: 'I cannot perform a live web search' })
  })

  it('distinguishes absent text from an empty or whitespace-only text block', () => {
    for (const content of [null, undefined]) expect(parseModelResponse('openai-chat-completions', { choices: [{ message: { content } }] })).toEqual({ kind: 'answer', rows: [], content: undefined })
    for (const content of ['', '  ']) expect(parseModelResponse('openai-chat-completions', { choices: [{ message: { content } }] })).toEqual({ kind: 'answer', rows: [], content })
  })
})

it.each(['anthropic-messages', 'openai-responses', 'openai-chat-completions'] as const)('adds a paragraph break only across non-text blocks on %s', protocol => {
  const type = protocol === 'openai-responses' ? 'output_text' : 'text'
  const content = [{ type, text: 'A' }, { type: 'code_execution_tool_result' }, { type, text: 'B' }, { type, text: 'C' }]
  const payload = protocol === 'anthropic-messages' ? { content } : protocol === 'openai-responses' ? { output: [{ type: 'message', content }] } : { choices: [{ message: { content } }] }
  expect(parseModelResponse(protocol, payload)).toEqual({ kind: 'answer', rows: [], content: 'A\n\nBC' })
})

describe('invalid model payloads', () => {
  it.each(['anthropic-messages', 'openai-responses', 'openai-chat-completions'] as const)('rejects malformed %s envelopes without throwing', protocol => {
    for (const payload of [null, undefined, false, 'secret upstream response', [], {}, { error: { message: 'private' } }]) expect(parseModelResponse(protocol, payload)).toEqual(invalid)
  })

  it.each([
    ['anthropic-messages', { content: {} }],
    ['anthropic-messages', { content: [{ type: 'web_search_tool_result', content: 'private error' }] }],
    ['anthropic-messages', { content: [{ type: 'text', text: 7 }] }],
    ['openai-responses', { output: {} }],
    ['openai-responses', { output: [{ type: 'message', content: {} }] }],
    ['openai-responses', { output: [{ type: 'message', content: [{ type: 'output_text', text: 7 }] }] }],
    ['openai-chat-completions', { choices: [] }],
    ['openai-chat-completions', { choices: [{ message: null }] }],
    ['openai-chat-completions', { choices: [{ message: { content: 7 } }] }],
  ] as const)('rejects malformed nested %s content', (protocol, payload) => {
    expect(parseModelResponse(protocol, payload)).toEqual(invalid)
  })
})

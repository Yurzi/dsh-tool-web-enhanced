import type { ModelProtocol } from '../../packages/search-enhanced/src/catalog.ts'

export const modelFixture = {
  connectionId: 'custom:e2e-model', label: 'E2E fixed model', model: 'e2e-search-model',
  credentialRef: 'E2E_MODEL_SEARCH_KEY', key: 'wse-e2e-model-never-real',
  query: 'model fixture 网页', content: '  Model answer with whitespace.\n\n' + '网页来源 😀 '.repeat(1400) + '\n  ',
  source: 'https://example.org/model-source',
} as const

export function modelDocument(endpoint: string, protocol: ModelProtocol = 'anthropic-messages') {
  return { version: 2, defaultConnection: modelFixture.connectionId, connections: {
    [modelFixture.connectionId]: {
      kind: 'model', protocol, model: modelFixture.model, label: modelFixture.label,
      endpoint, trustedEndpoint: true, credentialRef: modelFixture.credentialRef,
    },
  } }
}

export const piAiFixture = { provider: 'e2e-search-responses', model: modelFixture.model } as const

export function piAiRows(endpoint: string) {
  return [{ id: 'llm-pi-ai', config: { providers: { [piAiFixture.provider]: {
    displayName: 'E2E loopback Responses', api: 'openai-responses', baseURL: endpoint,
    apiKeyEnv: modelFixture.credentialRef, models: [{ id: piAiFixture.model }],
  } } } }]
}

export function messagesAnswer() {
  return { content: [
    { type: 'web_search_tool_result', content: [
      { type: 'web_search_result', url: modelFixture.source, title: ' Model source ', page_age: '2026-10-21' },
      { type: 'web_search_result', url: modelFixture.source, title: 'Duplicate' },
      { type: 'web_search_result', url: 'javascript:alert(1)', title: 'Rejected scheme' },
      { type: 'web_search_result', url: 'https://user:secret@example.org/private', title: 'Rejected credentials' },
    ] },
    { type: 'text', text: modelFixture.content, citations: [{ type: 'web_search_result_location', url: modelFixture.source, cited_text: '  source quote  ' }] },
  ] }
}

export function responsesAnswer() {
  return { output: [
    { type: 'web_search_call', status: 'completed', action: { sources: [
      { url: modelFixture.source, title: 'Model source' }, { url: 'file:///etc/passwd', title: 'Rejected' },
    ], url: 'https://example.org/not-a-source', queries: ['not a source'] } },
    { type: 'message', content: [{ type: 'output_text', text: modelFixture.content, annotations: [
      { type: 'url_citation', url: modelFixture.source, title: 'Duplicate' },
    ] }] },
  ] }
}

import { z } from 'zod'
import { resolveDocument } from '../../src/shared/settings.ts'

const local = { kind: 'local', label: 'Local', remote: false, access: { keyless: true, apiKey: false, account: false }, options: {} } as const
const adapter = { kind: 'adapter', label: 'Adapter', remote: true, access: { keyless: true, apiKey: { credentialRef: 'ADAPTER_KEY' }, account: false }, options: {}, endpoint: 'https://adapter.example/api' } as const

const modelOptions = { maxTokens: { kind: 'integer', min: 1, max: 32_000 } } as const
const protocols = {
  'anthropic-messages': { label: 'Messages', options: { ...modelOptions, maxUses: { kind: 'integer', min: 1, max: 10 } } },
  'openai-responses': { label: 'Responses', options: modelOptions },
} as const

export function resolveModelSettings(document: unknown = {}) {
  return resolveDocument({ document, catalog: { 'session-model': { kind: 'model', label: 'Session model', remote: true, access: { keyless: false, apiKey: false, account: false }, options: modelOptions } }, protocols, defaults: { schema: z.strictObject({}), defaultConnection: 'builtin:session-model' }, capabilityLabel: 'model-test' })
}

export function resolveTestSettings(document: unknown = {}) {
  return resolveDocument({ document, catalog: { local, adapter }, defaults: { schema: z.strictObject({ mode: z.enum(['auto', 'fresh']).default('auto') }), defaultConnection: 'builtin:local' }, capabilityLabel: 'test' })
}

export function resolveLocalSettings(document: unknown = {}) {
  return resolveDocument({ document, catalog: { local }, defaults: { schema: z.strictObject({}), defaultConnection: 'builtin:local' }, capabilityLabel: 'local-test' })
}

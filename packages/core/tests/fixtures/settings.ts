import { z } from 'zod'
import { resolveDocument } from '../../src/shared/settings.ts'

const local = { kind: 'local', label: 'Local', remote: false, access: { keyless: true, apiKey: false, account: false }, options: {} } as const
const adapter = { kind: 'adapter', label: 'Adapter', remote: true, access: { keyless: true, apiKey: { credentialRef: 'ADAPTER_KEY' }, account: false }, options: {}, endpoint: 'https://adapter.example/api' } as const

export function resolveTestSettings(document: unknown = {}) {
  return resolveDocument({ document, catalog: { local, adapter }, defaults: { schema: z.strictObject({ mode: z.enum(['auto', 'fresh']).default('auto') }), defaultConnection: 'builtin:local' }, capabilityLabel: 'test' })
}

export function resolveLocalSettings(document: unknown = {}) {
  return resolveDocument({ document, catalog: { local }, defaults: { schema: z.strictObject({}), defaultConnection: 'builtin:local' }, capabilityLabel: 'local-test' })
}

import { z } from 'zod'
import { RETIRED_FIELDS } from './retired.ts'
import { resolveDocument } from 'dsh-tool-web-enhanced-core/shared'
import { CATALOG, DEFAULT_CONNECTION, DEFAULT_LOCAL_SETTINGS, type AdapterKey, type NativeKey } from '../catalog.ts'
import { describeProblem, parseCidr, parseHostnameRule } from '../local/rules.ts'
import type { Connection, LocalSettings, ResolvedSettings } from './types.ts'
export type { AdapterConnection, Connection, CustomConnection, LocalConnection, LocalSettings, NativeConnection, ResolvedSettings } from './types.ts'

const localOptions = z.strictObject({
  allowCidrs: z.array(z.string()).default(() => []), allowHostnames: z.array(z.string()).default(() => []),
  userAgent: z.string().default(DEFAULT_LOCAL_SETTINGS.userAgent),
  maxResponseBytes: z.number().default(DEFAULT_LOCAL_SETTINGS.maxResponseBytes),
  maxBodyChars: z.number().default(DEFAULT_LOCAL_SETTINGS.maxBodyChars),
  timeoutMs: z.number().default(DEFAULT_LOCAL_SETTINGS.timeoutMs),
  maxRedirects: z.number().default(DEFAULT_LOCAL_SETTINGS.maxRedirects),
})


/** Pure sparse resolution shared by Host and browser. */
export function resolveSettings(document: unknown = {}): ResolvedSettings {
  const resolved = resolveDocument({ catalog: CATALOG, document, retiredFields: RETIRED_FIELDS, defaults: { schema: z.strictObject({}), defaultConnection: DEFAULT_CONNECTION }, capabilityLabel: 'fetch' })
  const connections = new Map<string, Connection>()
  for (const [id, connection] of resolved.connections) {
    const { catalogKey, ...base } = connection
    const path = 'connections.' + id
    if (base.kind === 'local') {
      const options: LocalSettings = localOptions.parse(base.options)
      options.allowCidrs.forEach((entry, index) => {
        const result = parseCidr(entry)
        if (!result.ok) invalidRule(path, 'allowCidrs', index, describeProblem(result.problem))
      })
      options.allowHostnames.forEach((entry, index) => {
        const result = parseHostnameRule(entry)
        if (!result.ok) invalidRule(path, 'allowHostnames', index, describeProblem(result.problem))
      })
      connections.set(id, { ...base, options })
    } else if (base.kind === 'native') {
      connections.set(id, { ...base, kind: 'native', native: catalogKey as NativeKey, access: 'api-key' })
    } else {
      connections.set(id, { ...base, kind: 'adapter', adapter: catalogKey as AdapterKey })
    }
  }
  return { ...resolved, connections }
}
function invalidRule(path: string, field: string, index: number, reason: string): never {
  throw new Error('invalid fetch settings: ' + path + '.options.' + field + ' entry ' + (index + 1) + ': ' + reason)
}

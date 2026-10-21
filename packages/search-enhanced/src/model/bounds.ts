import { CREDENTIAL_REF, isEndpoint, TEXT_MAX_LENGTH } from 'dsh-tool-web-enhanced-core/shared'

// Match the settings document grammar: at most 200 entries, model ids of 200
// characters, and TEXT_MAX_LENGTH for endpoints, credential refs and path keys.
export const ROUTE_ENTRIES_MAX = 200

export function routeModel(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\p{Cc}]/u.test(value)
}

export function routeEndpoint(value: unknown): value is string {
  return typeof value === 'string' && value.length <= TEXT_MAX_LENGTH && isEndpoint(value)
}

export function routeCredential(value: unknown): value is string {
  return typeof value === 'string' && value.length <= TEXT_MAX_LENGTH && CREDENTIAL_REF.test(value)
}

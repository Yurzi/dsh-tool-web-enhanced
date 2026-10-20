import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { WEB_ENV, WEB_ROW, routeOf, type ProviderView, type Route } from '../shared/index.ts'

export type WebField = 'searchProvider' | 'fetchProvider'
const environment = (field: WebField): string | null => process.env[field === 'searchProvider' ? WEB_ENV.search : WEB_ENV.fetch] ?? null

/** The Host-only facts; browsers combine these with their public web settings form. */
export function providerView(providerId: string, field: WebField): ProviderView {
  return { providerId, envProvider: environment(field) }
}

/** Judge routing only from the public settings projection; an absent row is unknown. */
export function routeFacts(ctx: Context, field: WebField, providerId: string): Route {
  const settings = ctx.get('settings')
  const descriptor = settings === undefined ? undefined : settings.describe().find(item => item.ns === WEB_ROW)
  const value = descriptor?.value
  const row = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  return routeOf(row, field, environment(field), providerId)
}

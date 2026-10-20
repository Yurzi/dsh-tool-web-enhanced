import type { Context, Fiber, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { SETTINGS_FIELDS } from '../shared/settings.ts'
import type { RowIdentity } from '../shared/ids.ts'
import { capabilityErrors } from './errors.ts'

export type VolatileSettings<V> = { [K in keyof V]-?: Volatile<V[K]> }

/** Keep invalid documents mounted for repair; validate candidates before persistence. */
export function settingsRow<V extends object, S>(options: {
  readonly identity: RowIdentity
  readonly capabilityLabel: string
  readonly retiredFields: readonly string[]
  readonly secretFields: readonly string[]
  readonly resolve: (document: unknown) => S
}) {
  const { identity, capabilityLabel, resolve } = options
  const fields = Object.fromEntries([...SETTINGS_FIELDS, ...options.retiredFields].map(field => [
    field, options.secretFields.includes(field) ? z.any().role('secret').volatile() : z.any().volatile(),
  ]))
  const Config = z.object(fields) as z<V, VolatileSettings<V>>
  const read = (config: VolatileSettings<V>): Record<string, unknown> => Object.fromEntries(Object.entries(config)
    .map(([key, value]) => [key, Object.hasOwn(fields, key) ? (value as Volatile<unknown>).get() : value])
    .filter(([, value]) => value !== undefined))
  const errors = capabilityErrors(identity.packageName)
  function apply(ctx: Context, config: VolatileSettings<V>, install: (ctx: Context, settings: () => S) => unknown): void {
    try {
      resolve(read(config))
    } catch (error) {
      ctx.logger.warn('%s: invalid initial ' + capabilityLabel + ' settings: %s', identity.rowId, error)
    }
    ctx.on('internal/config', function (this: Fiber, _raw, next) {
      const raw = next()
      if (this === ctx.fiber) resolve(read(Config(raw as V)))
      return raw
    })
    ctx.inject(['settings'], scope => {
      scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber))
    })
    install(ctx, () => {
      try {
        return resolve(read(config))
      } catch (error) {
        ctx.logger.warn('%s: invalid live ' + capabilityLabel + ' settings: %s', identity.rowId, error)
        throw errors.error('WEB_PROVIDER_CONFIGURED_UNAVAILABLE', capabilityLabel + ' settings are invalid; ask the user to fix them on the settings page')
      }
    })
  }
  return { Config, apply }
}

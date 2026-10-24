import type { Context } from '@deepseek-ai/cordis'
import { WebError } from '@deepseek-ai/dsh-web'
import type { ConnectionView } from '../shared/index.ts'
import type { Capability, CapabilitySettings, ConnectionOf, LabeledConnection } from './capability.ts'
import type { EnhancedAccess, Explicit, ExplicitCall, ProviderListing, ProviderReadiness, ReadyProviders, Rejection } from './enhanced.ts'
import type { CapabilityErrors } from './errors.ts'
import type { Plan } from './plans.ts'
import { isSelectable } from './selectable.ts'
import { nextModel } from './model.ts'

type ReadyPlan<O> = Extract<Plan<O>, { kind: 'ready' }>
type Prepared<S, O> = { readonly settings: S; readonly plan: ReadyPlan<O>; readonly ids: readonly string[] }
const rejected = (reason: Rejection): Explicit<never> => ({ kind: 'rejected', reason })

export function explicitAccess<S extends CapabilitySettings<LabeledConnection>, O extends Record<string, unknown>, V extends ConnectionView, T, Q, R>(
  ctx: Context, capability: Capability<S, O, V, T, Q, R>,
  runtime: {
    active(): boolean
    offered(): boolean
    plan(agent: ExplicitCall['agent']): Plan<O> | undefined
    providers(agent: ExplicitCall['agent']): Promise<readonly string[] | undefined>
  }, errors: CapabilityErrors, unavailable: () => WebError,
): EnhancedAccess<O, Q, R> {
  const availabilityError = () => errors.error('WEB_PROVIDER_ERROR', 'provider availability could not be read; retry the request')
  const diagnostic = () => { ctx.logger.warn('%s: provider availability could not be read', capability.identity.rowId) }

  function check(): Explicit<S> {
    if (!runtime.active()) return rejected({ kind: 'unavailable', error: unavailable() })
    let settings: S
    try { settings = capability.settings() } catch (error) {
      return rejected({ kind: 'unavailable', error: error instanceof WebError ? error : unavailable() })
    }
    if (!runtime.offered()) return rejected({ kind: 'withdrawn' })
    return { kind: 'done', value: settings }
  }

  async function prepare(call: ExplicitCall): Promise<Explicit<Prepared<S, O>>> {
    errors.throwIfAborted(call.signal)
    const checked = check()
    if (checked.kind === 'rejected') return checked
    const plan = runtime.plan(call.agent)
    if (plan === undefined) return rejected({ kind: 'unavailable', error: unavailable() })
    if (plan.kind === 'failed') return rejected({ kind: 'unavailable', error: plan.error })
    if (plan.kind === 'off') return rejected({ kind: 'off' })
    let ids: readonly string[] | undefined
    try {
      ids = await errors.abortable(runtime.providers(call.agent), call.signal)
    } catch {
      errors.throwIfAborted(call.signal)
      ctx.logger.warn('%s: conversation provider list could not be read', capability.identity.rowId)
      return rejected({ kind: 'unavailable', error: unavailable() })
    }
    errors.throwIfAborted(call.signal)
    const current = check()
    if (current.kind === 'rejected') return current
    if (ids === undefined) return rejected({ kind: 'withdrawn' })
    return { kind: 'done', value: { settings: current.value, plan, ids } }
  }

  async function views(prepared: Prepared<S, O>, call: ExplicitCall): Promise<Map<string, V>> {
    errors.throwIfAborted(call.signal)
    const connections = new Map<string, ConnectionOf<S>>()
    for (const id of prepared.ids) {
      const connection = prepared.settings.connections.get(id)
      if (connection !== undefined) connections.set(id, { ...connection, disabled: false } as ConnectionOf<S>)
    }
    try {
      const described = await errors.abortable(capability.describe({ ...prepared.settings, connections }, nextModel(ctx, call.agent)), call.signal)
      errors.throwIfAborted(call.signal)
      return new Map(described.map(view => [view.id, view]))
    } catch {
      errors.throwIfAborted(call.signal)
      diagnostic()
      throw availabilityError()
    }
  }

  function readiness(view: V | undefined): ProviderReadiness {
    if (view === undefined) throw availabilityError()
    switch (view.status) {
      case 'ready': return { status: 'ready' }
      case 'needs-credential': return { status: 'needs-credential', credential: view.access === 'account' ? 'account' : 'api-key' }
      case 'unsupported':
        if (view.reason !== undefined) return { status: 'unsupported', reason: view.reason }
        throw availabilityError()
      case 'disabled': throw availabilityError()
    }
  }

  async function readyPrepared(prepared: Prepared<S, O>, call: ExplicitCall): Promise<ReadyProviders> {
    try {
      const described = await views(prepared, call)
      errors.throwIfAborted(call.signal)
      return { kind: 'read', ids: prepared.ids.filter(id => prepared.settings.connections.has(id) && described.get(id)?.status === 'ready') }
    } catch {
      // Rejections and argument errors offer no readiness hints when the read failed or was cancelled.
      return { kind: 'unread' }
    }
  }

  return {
    async run(connectionId, request, call) {
      const result = await prepare(call)
      errors.throwIfAborted(call.signal)
      if (result.kind === 'rejected') return result
      const prepared = result.value
      const connection = prepared.settings.connections.get(connectionId)
      const refusal = !prepared.ids.includes(connectionId) ? 'unknown' : connection === undefined ? 'removed' : undefined
      if (refusal !== undefined) {
        const ready = await readyPrepared(prepared, call)
        errors.throwIfAborted(call.signal)
        return rejected({ kind: refusal, connectionId, ready })
      }
      return ctx.get('agents')!.withInitiator(call.agent, async () => {
        errors.throwIfAborted(call.signal)
        const execution = { ctx, agent: call.agent, signal: call.signal }
        const target = capability.target(connection as ConnectionOf<S>, prepared.plan.options, execution)
        return { kind: 'done' as const, value: await capability.execute(target, request, execution) }
      })
    },
    async list(call): Promise<Explicit<ProviderListing<O>>> {
      const result = await prepare(call)
      errors.throwIfAborted(call.signal)
      if (result.kind === 'rejected') return result
      const prepared = result.value
      const described = await views(prepared, call)
      errors.throwIfAborted(call.signal)
      try {
        const providers = prepared.ids.flatMap(id => {
          const connection = prepared.settings.connections.get(id)
          if (connection === undefined) return []
          const view = described.get(id)
          const state = readiness(view)
          return [{ id, name: view!.label, facts: capability.enhanced.listing(connection as ConnectionOf<S>, call), ...state }]
        })
        errors.throwIfAborted(call.signal)
        return { kind: 'done', value: {
          session: { connectionId: prepared.plan.connectionId, selectable: isSelectable(prepared.settings.connections.get(prepared.plan.connectionId)) },
          options: prepared.plan.options, providers,
        } }
      } catch {
        errors.throwIfAborted(call.signal)
        diagnostic()
        throw availabilityError()
      }
    },
    async ready(call) {
      try {
        const prepared = await prepare(call)
        errors.throwIfAborted(call.signal)
        return prepared.kind === 'rejected' ? { kind: 'unread' } : await readyPrepared(prepared.value, call)
      } catch {
        // The contract deliberately degrades every failure, including cancellation, to no hints.
        return { kind: 'unread' }
      }
    },
  }
}

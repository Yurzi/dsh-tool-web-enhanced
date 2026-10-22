import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { WebError } from '@deepseek-ai/dsh-web'
import type { ConnectionView } from '../shared/index.ts'
import type { Capability, CapabilityCall, CapabilitySettings, ConnectionOf } from './capability.ts'
import { capabilityErrors } from './errors.ts'
import { explicitAccess } from './explicit.ts'
import { isNewConversation, ProviderLists } from './provider-lists.ts'
import { Pairings } from './pairings.ts'
import { planFor, Snapshots, type Plan } from './plans.ts'
import { createConnectionsService } from './remote.ts'
import { ToolRestriction, type ProviderListRead } from './restriction.ts'
import { providerView, routeFacts } from './route.ts'
import { isSelectable } from './selectable.ts'
import { Sessions } from './sessions.ts'
import { SessionStorage } from './storage.ts'
import { InvalidSettingsError } from './settings-row.ts'

/** Read-only handles for capability-specific context (for example fetch's local allowlist notice). */
export interface CapabilityRuntime<O extends Record<string, unknown>> {
  plan(agent?: Agent): Plan<O> | undefined
}

/** Install the sole Seat, session lifecycle, route-guarded restrictions and Remote service. */
export function installCapability<S extends CapabilitySettings, O extends Record<string, unknown>, V extends ConnectionView, T, Q, R>(ctx: Context, capability: Capability<S, O, V, T, Q, R>): CapabilityRuntime<O> {
  const kind = capability.tool === 'web_search' ? 'search' : 'fetch'
  const errors = capabilityErrors(capability.identity.packageName, kind + ' aborted')
  const contextUnavailable = () => errors.error('WEB_PROVIDER_ERROR', 'the ' + kind + ' selection could not be read; retry the request')
  const invalid = () => errors.error('WEB_PROVIDER_CONFIGURED_UNAVAILABLE', 'the selected ' + kind + ' connection is unavailable; ask the user to enable it or choose another connection')
  const storage = new SessionStorage(ctx, capability.storageDomain, capability.optionsCodec, () => errors.error('WEB_PROVIDER_ERROR', kind + ' selection storage is unavailable; retry or ask the user to check the DSH storage backend'))
  const pairings = new Pairings(storage)
  const lists = new ProviderLists(storage)
  const snapshots = new Snapshots<Plan<O>>()
  const access = explicitAccess(ctx, capability, {
    active: () => restriction.active,
    offered: () => restriction.offered(),
    plan: agent => snapshots.get(agent),
    providers: agent => lists.read(agent),
  }, errors, contextUnavailable)
  const restriction: ToolRestriction = new ToolRestriction(ctx, {
    tool: capability.tool,
    routed: () => routeFacts(ctx, capability.field, capability.identity.providerId).kind === 'this',
    selection: async agent => (await sessions.peek(agent)).selection.connectionId,
    enhanced: {
      rowId: capability.identity.rowId, names: capability.enhanced.names,
      enabled: () => {
        try { return capability.settings().enhancedTools } catch (error) {
          if (error instanceof InvalidSettingsError) return false
          throw error
        }
      },
      tools: () => capability.enhanced.tools(access),
      providers: agent => lists.read(agent),
    },
  })
  const sessions = new Sessions(ctx, () => capability.settings(), storage, pairings, restriction, (settings, agent) => capability.describe(settings, agent))
  const capture = async (agent: Agent, signal?: AbortSignal): Promise<Plan<O>> => {
    const operation = restriction.begin(agent)
    try {
      const read = sessions.current(agent)
      const { selection } = signal === undefined ? await read : await errors.abortable(read, signal)
      if (!restriction.active) return { kind: 'failed', error: contextUnavailable() }
      let providers: ProviderListRead = { kind: 'unread' }
      if (restriction.registered && restriction.offered()) {
        try {
          providers = { kind: 'read', ids: await lists.read(agent) }
        } catch {
          ctx.logger.warn('%s: conversation provider list could not be read', capability.identity.rowId)
        }
      }
      restriction.captured(agent, operation, selection.connectionId, providers)
      return planFor(selection)
    } catch (error) {
      restriction.failed(agent, operation)
      ctx.logger.warn('%s: capturing %s selection failed: %s', capability.identity.rowId, kind, error)
      return { kind: 'failed', error: error instanceof WebError ? error : contextUnavailable() }
    }
  }
  ctx.on('agent/request', async ({ agent, turn, step, signal }, next) => {
    await snapshots.capture(agent, turn, step, () => capture(agent, signal))
    return next()
  })
  ctx.on('agent/created', async ({ agent }) => {
    restriction.created(agent)
    const initial = isNewConversation(agent.session)
      ? restriction.offered()
        ? [...capability.settings().connections.values()].filter(isSelectable).map(connection => connection.id)
        : []
      : undefined
    try {
      await lists.create(agent, initial)
    } catch {
      ctx.logger.warn('%s: conversation provider list could not be read', capability.identity.rowId)
    }
    await snapshots.capture(agent, -1, -1, () => capture(agent))
  })
  void restriction.start().catch(error => {
    ctx.logger.warn('%s: starting tool visibility failed: %s', capability.identity.rowId, error)
  })
  ctx.on('agent/disposed', ({ agent }) => { snapshots.forget(agent); restriction.forget(agent) })
  ctx.inject(['sessionController', 'typert'], scope => {
    createConnectionsService(scope, { namespace: capability.remoteNamespace, contract: capability.contract, sessions, pairings,
      providerView: () => providerView(capability.identity.providerId, capability.field) })
  })

  const plan = (agent?: Agent): Plan<O> | undefined => {
    if (!restriction.active) return { kind: 'failed', error: contextUnavailable() }
    if (agent !== undefined) return snapshots.get(agent)
    const current = capability.settings()
    return planFor({ connectionId: current.defaultConnection, revision: 0, options: capability.optionsCodec.initial(current) })
  }
  capability.register(ctx, async (request, signal) => {
    const agent = ctx.get('agents')?.currentInitiator()
    const selected = plan(agent)
    if (selected === undefined) throw contextUnavailable()
    switch (selected.kind) {
      case 'failed': throw selected.error
      case 'off': throw errors.error('WEB_PROVIDER_UNAVAILABLE', 'web ' + kind + ' is off for this session; the user can choose a connection in the composer or with /setup-' + kind)
      case 'ready': {
        const current = capability.settings().connections.get(selected.connectionId)
        if (!isSelectable(current)) throw invalid()
        const call: CapabilityCall = { ctx, agent, signal }
        const target = capability.target(current as ConnectionOf<S>, selected.options, call)
        return capability.execute(target, request, call)
      }
    }
  })
  return { plan }
}

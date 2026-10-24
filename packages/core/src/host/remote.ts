import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { Remote, RemoteError, remoteErrorOf, TypertRemoteService, type RemoteErrorCode } from '@deepseek-ai/dsh-typert-protocol'
import { selectionRequest, providerRequest, pairingsRequest, forgetPairingRequest,
  type ConnectionView, type SelectionRequest, type SelectionChange, type ProviderRequest, type ProviderView,
  type PairingsRequest, type ForgetPairingRequest, type PairingsView,
} from '../shared/index.ts'
import type { z } from 'zod'
import type { HostContract } from './capability.ts'
import type { Pairings } from './pairings.ts'
import { liveSession, type CurrentSelection, type SessionChange, type SessionTarget } from './sessions.ts'
import { writeSelection } from './selection-write.ts'
import { sessionOrigin } from './session-origin.ts'
import { InvalidSettingsError } from './settings-row.ts'

export type ConnectionsView<O, V> = CurrentSelection<O> & { readonly connections: V[] }
export interface ConnectionsService<O extends Record<string, unknown>, V> {
  get(request: SelectionRequest): Promise<ConnectionsView<O, V>>
  set(request: SelectionChange<O>): Promise<ConnectionsView<O, V>>
  provider(request: ProviderRequest): Promise<ProviderView>
  pairings(request: PairingsRequest): Promise<PairingsView>
  forgetPairing(request: ForgetPairingRequest): Promise<PairingsView>
}

export interface ConnectionsServiceOptions<O extends Record<string, unknown>, V extends ConnectionView> {
  readonly namespace: string
  readonly contract: HostContract<O>
  readonly sessions: {
    current(target: SessionTarget): Promise<CurrentSelection<O>>
    change(target: SessionTarget, change: SessionChange<O>, expectedRevision: number): Promise<CurrentSelection<O>>
    selectable(connectionId: string): boolean
    connections(target: SessionTarget): Promise<V[]>
  }
  readonly pairings: Pairings
  readonly providerView: () => ProviderView
}

/**
 * Each installation owns a freshly decorated service class. The capability
 * declares its namespace/error map in ./shared; this factory owns no global state.
 */
export function createConnectionsService<O extends Record<string, unknown>, V extends ConnectionView>(ctx: Context, spec: ConnectionsServiceOptions<O, V>): ConnectionsService<O, V> {
  const addressedSession = (request: { readonly sessionId: string }) => request.sessionId as SessionId
  const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
    const result = schema.safeParse(value)
    if (!result.success) throw new RemoteError('gateway/bad-request', 'invalid ' + spec.namespace + ' request', { issues: result.error.issues })
    return result.data
  }
  const boundary = async <T>(method: string, run: () => T | Promise<T>): Promise<T> => {
    try {
      return await run()
    } catch (error) {
      if (remoteErrorOf(error) !== undefined) throw error
      if (error instanceof InvalidSettingsError) {
        throw new RemoteError((spec.namespace + '/invalid-settings') as RemoteErrorCode, 'the row settings are invalid; fix them on the settings page', {})
      }
      ctx.logger.warn('%s/%s request failed: %s', spec.namespace, method, error)
      throw new RemoteError('gateway/internal', 'connection request failed; retry or check the Host logs', {})
    }
  }
  class Service extends TypertRemoteService {
    constructor() { super(ctx, spec.namespace) }

    @Remote({ resources: { session: addressedSession } })
    async get(request: SelectionRequest): Promise<ConnectionsView<O, V>> {
      return boundary('get', async () => {
        const { sessionId } = parse(selectionRequest, request)
        const target = await this.target(sessionId)
        return this.view(target, await spec.sessions.current(target))
      })
    }

    @Remote({ resources: { session: addressedSession } })
    async set(request: SelectionChange<O>): Promise<ConnectionsView<O, V>> {
      return boundary('set', async () => {
        const { sessionId, connectionId, options, expectedRevision } = parse(spec.contract.selectionChange, request)
        const target = await this.target(sessionId)
        const change = { ...options, ...(connectionId === undefined ? {} : { connectionId }) } as SessionChange<O>
        const result = await writeSelection(spec.sessions, target, change, expectedRevision)
        if (result.kind === 'unavailable') {
          throw new RemoteError((spec.namespace + '/unavailable') as RemoteErrorCode, 'the connection is missing, disabled or unsupported', { connectionId: result.connectionId })
        }
        if (result.kind === 'conflict') {
          throw new RemoteError((spec.namespace + '/conflict') as RemoteErrorCode, 'the selection changed elsewhere; re-read it and retry', {})
        }
        return this.view(target, result.current)
      })
    }

    @Remote
    async provider(request: ProviderRequest): Promise<ProviderView> {
      return boundary('provider', () => {
        parse(providerRequest, request)
        return spec.providerView()
      })
    }

    @Remote
    async pairings(request: PairingsRequest): Promise<PairingsView> {
      return boundary('pairings', async () => {
        parse(pairingsRequest, request)
        return { pairings: await spec.pairings.list() }
      })
    }

    @Remote
    async forgetPairing(request: ForgetPairingRequest): Promise<PairingsView> {
      return boundary('forgetPairing', async () => {
        const model = parse(forgetPairingRequest, request)
        await spec.pairings.forget(model)
        return { pairings: await spec.pairings.list() }
      })
    }

    private async target(sessionId: string): Promise<SessionTarget> {
      const id = sessionId as SessionId
      const agent = this.ctx.agents.get(id)
      if (agent !== undefined) return liveSession(agent)
      const persistence = this.ctx.get('sessionPersistence')
      if (persistence !== undefined) {
        const stored = await persistence.stat(id)
        if (stored !== undefined && sessionOrigin(stored.header).kind === 'subagent') {
          return { kind: 'cold', id, header: stored.header }
        }
      }
      const found = await this.ctx.sessionController.resolveAgent(id)
      if ('error' in found) throw found.error
      return liveSession(found.agent)
    }

    private async view(target: SessionTarget, current: CurrentSelection<O>): Promise<ConnectionsView<O, V>> {
      return { ...current, connections: await spec.sessions.connections(target) }
    }
  }
  return new Service()
}

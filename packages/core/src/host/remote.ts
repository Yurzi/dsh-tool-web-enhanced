import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
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
import { SelectionConflict, type CurrentSelection, type SessionChange } from './sessions.ts'
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
    current(agent: Agent): Promise<CurrentSelection<O>>
    change(agent: Agent, change: SessionChange<O>, expectedRevision: number): Promise<CurrentSelection<O>>
    selectable(connectionId: string): boolean
    connections(agent: Agent): Promise<V[]>
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
        const agent = await this.readableAgent(sessionId)
        return this.view(agent, await spec.sessions.current(agent))
      })
    }

    @Remote({ resources: { session: addressedSession } })
    async set(request: SelectionChange<O>): Promise<ConnectionsView<O, V>> {
      return boundary('set', async () => {
        const { sessionId, connectionId, options, expectedRevision } = parse(spec.contract.selectionChange, request)
        const agent = await this.agent(sessionId)
        if (typeof connectionId === 'string' && !spec.sessions.selectable(connectionId)) {
          // The capability contributes these names through ConnectionsRemoteErrors<NS>.
          throw new RemoteError((spec.namespace + '/unavailable') as RemoteErrorCode, 'the connection is missing, disabled or unsupported', { connectionId })
        }
        let current: CurrentSelection<O>
        try {
          const change = { ...options, ...(connectionId === undefined ? {} : { connectionId }) } as SessionChange<O>
          current = await spec.sessions.change(agent, change, expectedRevision)
        } catch (error) {
          if (error instanceof SelectionConflict) throw new RemoteError((spec.namespace + '/conflict') as RemoteErrorCode, 'the selection changed elsewhere; re-read it and retry', {})
          throw error
        }
        return this.view(agent, current)
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

    /**
     * Reads also reach a live child (spawn/fork) Agent, which the controller
     * reserves for subagent routing; anything else resolves or resumes as usual.
     */
    private async readableAgent(sessionId: string): Promise<Agent> {
      return this.ctx.agents.get(sessionId as SessionId) ?? this.agent(sessionId)
    }

    /** Ordinary Sessions only: writes to a child Session stay refused by the controller. */
    private async agent(sessionId: string): Promise<Agent> {
      const found = await this.ctx.sessionController.resolveAgent(sessionId as SessionId)
      if ('error' in found) throw found.error
      return found.agent
    }

    private async view(agent: Agent, current: CurrentSelection<O>): Promise<ConnectionsView<O, V>> {
      return { ...current, connections: await spec.sessions.connections(agent) }
    }
  }
  return new Service()
}

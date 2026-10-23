import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { ConnectionView, Selection, SelectionSource } from '../shared/index.ts'
import type { CapabilitySettings } from './capability.ts'
import { nextModel, type SessionModel } from './model.ts'
import { parentOf, sessionOrigin } from './session-origin.ts'
import type { Pairings } from './pairings.ts'
import type { ToolRestriction } from './restriction.ts'
import { isSelectable } from './selectable.ts'
import type { SessionStorage, StoredSelection } from './storage.ts'

/** A cold selection target has no running Agent and no known next-request model. */
export type SessionTarget =
  | { readonly kind: 'live'; readonly id: SessionId; readonly header: SessionHeader; readonly agent: Agent }
  | { readonly kind: 'cold'; readonly id: SessionId; readonly header: SessionHeader }

export function liveSession(agent: Agent): SessionTarget {
  return { kind: 'live', id: agent.session.id, header: agent.session.header, agent }
}

export interface CurrentSelection<O> { readonly selection: Selection<O>; readonly source: SelectionSource }
/** Option fields are flat here; the Remote boundary unwraps its options object. */
export type SessionChange<O> =
  | (Partial<O> & { readonly connectionId?: string | null })
  | { readonly connectionId: string | null }
export class SelectionConflict extends Error {
  constructor() { super('the selection changed since it was read') }
}
type Table = KvTable<string, StoredSelection>

export class Sessions<O extends Record<string, unknown>, S extends CapabilitySettings, V extends ConnectionView = ConnectionView> {
  constructor(
    private readonly ctx: Context,
    readonly settings: () => S,
    private readonly storage: SessionStorage<O, S>,
    private readonly pairings: Pairings,
    private readonly restriction: Pick<ToolRestriction, 'sync'>,
    private readonly describe: (settings: S, model: SessionModel | undefined) => Promise<V[]> = async () => [],
  ) {}

  current(target: SessionTarget): Promise<CurrentSelection<O>> {
    return this.exclusive(target.id, async () => this.read(target, await this.table()))
  }

  /** Resolve visibility without creating records or materializing inherited/default options. */
  peek(target: SessionTarget): Promise<CurrentSelection<O>> {
    return this.exclusive(target.id, async () => this.read(target, await this.table(), false))
  }

  change(target: SessionTarget, change: SessionChange<O>, expectedRevision: number): Promise<CurrentSelection<O>> {
    return this.exclusive(target.id, async () => {
      const table = await this.table()
      await this.read(target, table)
      const { connectionId, ...options } = change
      const record = this.storage.optionsCodec.toRecord(options as Partial<O>)
      const updated = await table.update(target.id, current => {
        if (current.revision !== expectedRevision) throw new SelectionConflict()
        return { ...current, ...record, ...(connectionId === undefined ? {} : { connectionId }), revision: current.revision + 1 }
      })
      // The selection is already durable: visibility must follow it even if the optional memory write fails.
      // A cold target can become live while its write waits in the selection queue.
      const agent = this.ctx.get('agents')?.get(target.id)
      if (agent !== undefined) this.restriction.sync(agent, updated.connectionId)
      if (connectionId !== undefined && sessionOrigin(target.header).kind !== 'subagent') {
        const model = this.model(target)
        if (model !== undefined) {
          const memory = await this.pairings.set(model, updated.connectionId).then(
            () => ({ kind: 'stored' as const }),
            (error: unknown) => ({ kind: 'failed' as const, error }),
          )
          // Memory is a convenience for future Sessions, not a second commit of this selection.
          if (memory.kind === 'failed') this.ctx.logger.warn('selection committed, but model memory could not be saved: %s', memory.error)
        }
      }
      return { selection: this.selectionOf(updated, this.settings()), source: 'session' }
    })
  }

  connections(target: SessionTarget): Promise<V[]> { return this.describe(this.settings(), this.model(target)) }

  selectable(connectionId: string): boolean { return isSelectable(this.settings().connections.get(connectionId)) }

  private model(target: SessionTarget): SessionModel | undefined {
    return target.kind === 'live' ? nextModel(this.ctx, target.agent) : undefined
  }

  private async table(): Promise<Table> { return (await this.storage.domain()).table('selections') }

  private exclusive<T>(id: string, work: () => Promise<T>): Promise<T> {
    return this.storage.exclusive(id, work)
  }

  private async read(target: SessionTarget, table: Table, persist = true): Promise<CurrentSelection<O>> {
    const settings = this.settings()
    const codec = this.storage.optionsCodec
    const id = target.id
    let stored = table.get(id)
    const origin = sessionOrigin(target.header)
    const parentSession = parentOf(origin)
    const seeded = parentSession !== undefined && origin.seeded
    let inherited = stored !== undefined && seeded && (stored.inherited ?? table.get(parentSession) !== undefined)
    if (stored === undefined && seeded) {
      const parentAgent = this.ctx.get('agents')?.get(parentSession)
      if (parentAgent !== undefined && persist) await this.current(liveSession(parentAgent))
      else await this.storage.settled(parentSession)
      const parent = table.get(parentSession)
      if (parent !== undefined) {
        stored = { ...parent, revision: 0, inherited: true }
        inherited = true
      }
    }
    if (stored !== undefined && (stored.revision > 0 || inherited)) {
      const next: StoredSelection = { ...stored, ...codec.toRecord(codec.fromRecord(stored, settings)), ...(seeded ? { inherited } : {}) }
      if (persist && !sameRecord(table.get(id), next)) await table.put(id, next)
      return { selection: this.selectionOf(next, settings), source: next.revision > 0 ? 'session' : 'inherited' }
    }
    const fallback = await this.defaultFor(target, settings)
    const options = stored === undefined ? codec.initial(settings) : codec.fromRecord(stored, settings)
    const next: StoredSelection = {
      ...codec.toRecord(options), connectionId: fallback.connectionId, revision: 0,
      ...(seeded ? { inherited: false } : {}),
    }
    if (persist && !sameRecord(stored, next)) await table.put(id, next)
    return { selection: this.selectionOf(next, settings), source: fallback.source }
  }

  private async defaultFor(target: SessionTarget, settings: S): Promise<{ connectionId: string | null; source: 'model' | 'default' }> {
    const model = this.model(target)
    const paired = model === undefined ? undefined : await this.pairings.get(model)
    if (paired === null) return { connectionId: null, source: 'model' }
    if (paired !== undefined && isSelectable(settings.connections.get(paired))) return { connectionId: paired, source: 'model' }
    return { connectionId: settings.defaultConnection, source: 'default' }
  }

  private selectionOf(stored: StoredSelection, settings: S): Selection<O> {
    return { connectionId: stored.connectionId, revision: stored.revision, options: this.storage.optionsCodec.fromRecord(stored, settings) }
  }
}

function sameRecord(left: StoredSelection | undefined, right: StoredSelection): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right)
}

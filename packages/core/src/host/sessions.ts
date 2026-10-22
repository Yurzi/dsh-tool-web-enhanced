import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { ConnectionView, Selection, SelectionSource } from '../shared/index.ts'
import type { CapabilitySettings } from './capability.ts'
import { nextModel } from './model.ts'
import type { Pairings } from './pairings.ts'
import type { ToolRestriction } from './restriction.ts'
import { isSelectable } from './selectable.ts'
import type { SessionStorage, StoredSelection } from './storage.ts'

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
    private readonly describe: (settings: S, agent: Agent) => Promise<V[]> = async () => [],
  ) {}

  current(agent: Agent): Promise<CurrentSelection<O>> {
    return this.exclusive(agent.session.id, async () => this.read(agent, await this.table()))
  }

  /** Resolve visibility without creating records or materializing inherited/default options. */
  peek(agent: Agent): Promise<CurrentSelection<O>> {
    return this.exclusive(agent.session.id, async () => this.read(agent, await this.table(), false))
  }

  change(agent: Agent, change: SessionChange<O>, expectedRevision: number): Promise<CurrentSelection<O>> {
    return this.exclusive(agent.session.id, async () => {
      const table = await this.table()
      await this.read(agent, table)
      const { connectionId, ...options } = change
      const record = this.storage.optionsCodec.toRecord(options as Partial<O>)
      const updated = await table.update(agent.session.id, current => {
        if (current.revision !== expectedRevision) throw new SelectionConflict()
        return { ...current, ...record, ...(connectionId === undefined ? {} : { connectionId }), revision: current.revision + 1 }
      })
      // The selection is already durable: visibility must follow it even if the optional memory write fails.
      this.restriction.sync(agent, updated.connectionId)
      if (connectionId !== undefined) {
        const model = nextModel(this.ctx, agent)
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

  connections(agent: Agent): Promise<V[]> { return this.describe(this.settings(), agent) }

  selectable(connectionId: string): boolean { return isSelectable(this.settings().connections.get(connectionId)) }

  private async table(): Promise<Table> { return (await this.storage.domain()).table('selections') }

  private exclusive<T>(id: string, work: () => Promise<T>): Promise<T> {
    return this.storage.exclusive(id, work)
  }

  private async read(agent: Agent, table: Table, persist = true): Promise<CurrentSelection<O>> {
    const settings = this.settings()
    const codec = this.storage.optionsCodec
    const id = agent.session.id
    let stored = table.get(id)
    const { parentSession, isSeeded } = agent.session.header
    const seeded = parentSession !== undefined && isSeeded
    let inherited = stored !== undefined && seeded && (stored.inherited ?? table.get(parentSession) !== undefined)
    if (stored === undefined && seeded) {
      const parentAgent = this.ctx.get('agents')?.get(parentSession)
      if (parentAgent !== undefined && persist) await this.current(parentAgent)
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
    const fallback = await this.defaultFor(agent, settings)
    const options = stored === undefined ? codec.initial(settings) : codec.fromRecord(stored, settings)
    const next: StoredSelection = {
      ...codec.toRecord(options), connectionId: fallback.connectionId, revision: 0,
      ...(seeded ? { inherited: false } : {}),
    }
    if (persist && !sameRecord(stored, next)) await table.put(id, next)
    return { selection: this.selectionOf(next, settings), source: fallback.source }
  }

  private async defaultFor(agent: Agent, settings: S): Promise<{ connectionId: string | null; source: 'model' | 'default' }> {
    const model = nextModel(this.ctx, agent)
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

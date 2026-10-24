import { createSnapshotStore, type ObservableSnapshot, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SelectionStore, SelectionState, WriteResult } from './section.ts'
import type { SelectionChange, SelectionView } from '../shared/selection.ts'

/** Capability callers keep their option type; the shared UI consumes SelectionStore. */
export interface CapabilitySelectionUpdate<V extends SelectionView> {
  readonly connectionId?: string | null
  readonly options?: Readonly<Partial<V['selection']['options']>>
}

export interface SelectionRemote<V extends SelectionView> {
  get(request: { sessionId: string }): Promise<RemoteResult<V>>
  set(request: SelectionChange<V['selection']['options']>): Promise<RemoteResult<V>>
}

interface Entry<V extends SelectionView> {
  readonly sessionId: string
  readonly store: SnapshotStore<SelectionState<V>>
  readonly source: ObservableSnapshot<SelectionState<V>>
  observers: number
  /** Whether the stored view may be outdated. */
  stale: boolean
  /** Session model the view was read for. */
  modelKey: string | undefined
  /** Bumped by every event that outdates an in-flight read. */
  epoch: number
  reading: Promise<void> | undefined
}

export class ConnectionSelectionStore<V extends SelectionView> implements SelectionStore<V> {
  private readonly entries = new Map<string, Entry<V>>()

  constructor(private readonly remote: SelectionRemote<V>, private readonly changed: () => void = () => {}) {}

  /** Stable observable of one session; the renderer caches its hook binding per source. */
  source(sessionId: string): ObservableSnapshot<SelectionState<V>> {
    return this.entry(sessionId).source
  }

  /**
   * Make sure the session's view is current, reading only when it is missing,
   * outdated, or was read for another session model.
   */
  load(sessionId: string, modelKey?: string): Promise<void> {
    const entry = this.entry(sessionId)
    if (modelKey !== undefined && modelKey !== entry.modelKey) {
      entry.modelKey = modelKey
      this.outdate(entry)
    }
    return entry.stale ? this.read(entry) : entry.reading ?? Promise.resolve()
  }

  /** Read the session again, joining a read already in flight. */
  refresh(sessionId: string): Promise<void> {
    return this.read(this.entry(sessionId))
  }

  /** The latest view of a session after making sure it is current. */
  async current(sessionId: string): Promise<SelectionState<V>> {
    await this.refresh(sessionId)
    return this.entry(sessionId).store.getSnapshot()
  }

  /**
   * Write a change against the revision the views show. The confirmed view
   * replaces the stored one; a refused write rereads so every view shows what
   * the Host holds now.
   */
  async set(sessionId: string, update: CapabilitySelectionUpdate<V>): Promise<WriteResult> {
    const entry = this.entry(sessionId)
    const { view } = entry.store.getSnapshot()
    if (view === undefined) throw new Error('connection selection has not been read yet')
    this.outdate(entry)
    const writeEpoch = entry.epoch
    let invalidated = false
    this.publish(entry, { saving: true })
    let result: Awaited<ReturnType<SelectionRemote<V>['set']>>
    try {
      result = await this.remote.set({ sessionId, ...update, expectedRevision: view.selection.revision })
    } finally {
      // Settings/model changes during a write still require a newer read.
      invalidated = entry.epoch !== writeEpoch
      this.outdate(entry)
      this.publish(entry, { saving: false })
    }
    if (result.ok) {
      entry.stale = invalidated
      this.publish(entry, { view: result.value, saving: false, readFailure: undefined })
      if (invalidated) await this.read(entry)
      this.changed()
      return { ok: true }
    }
    this.publish(entry, { saving: false })
    await this.read(entry)
    return result
  }

  /**
   * Settings, credentials, or the Host connection changed: observed sessions
   * read again, the others read on their next load.
   */
  invalidate(): void {
    for (const entry of this.entries.values()) this.reread(entry)
  }

  /**
   * The Session's selection changed without this store (its Host command ran):
   * its views read again, at once when observed, otherwise on their next load.
   * A read already in flight reads once more.
   */
  invalidateSession(sessionId: string): void {
    const entry = this.entries.get(sessionId)
    if (entry !== undefined) this.reread(entry)
  }

  private entry(sessionId: string): Entry<V> {
    const existing = this.entries.get(sessionId)
    if (existing !== undefined) return existing
    const store = createSnapshotStore<SelectionState<V>>({ view: undefined, saving: false, readFailure: undefined })
    const entry: Entry<V> = {
      sessionId, store, observers: 0, stale: true, modelKey: undefined, epoch: 0, reading: undefined,
      source: {
        getSnapshot: () => store.getSnapshot(),
        subscribe: (listener) => {
          entry.observers += 1
          const unsubscribe = store.subscribe(listener)
          return () => {
            entry.observers -= 1
            unsubscribe()
          }
        },
      },
    }
    this.entries.set(sessionId, entry)
    return entry
  }

  private reread(entry: Entry<V>): void {
    this.outdate(entry)
    if (entry.observers > 0) void this.read(entry)
  }

  private outdate(entry: Entry<V>): void {
    entry.stale = true
    entry.epoch += 1
  }

  private read(entry: Entry<V>): Promise<void> {
    entry.reading ??= this.fetch(entry).finally(() => { entry.reading = undefined })
    return entry.reading
  }

  /** Read until a result arrives that nothing outdated while it was in flight. */
  private async fetch(entry: Entry<V>): Promise<void> {
    for (;;) {
      const epoch = entry.epoch
      const result = await this.remote.get({ sessionId: entry.sessionId })
      if (epoch !== entry.epoch) continue
      entry.stale = false
      if (result.ok) {
        this.publish(entry, { view: result.value, readFailure: undefined })
      } else {
        const readFailure = result.error.code.endsWith('/invalid-settings') ? 'invalid-settings' : 'failed'
        this.publish(entry, { readFailure })
      }
      return
    }
  }

  private publish(entry: Entry<V>, patch: Partial<SelectionState<V>>): void {
    entry.store.set({ ...entry.store.getSnapshot(), ...patch })
  }
}

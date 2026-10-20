import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { Pairing, PairingsView } from '../shared/selection.ts'

export type PairingsState =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly pairings: Pairing[] }
  | { readonly state: 'failed'; readonly message: string }

export interface PairingsRemote {
  pairings(request: Record<string, never>): Promise<RemoteResult<PairingsView>>
  forgetPairing(request: { provider: string; model: string }): Promise<RemoteResult<PairingsView>>
}

export class PairingsStatus {
  readonly source: ObservableSnapshot<PairingsState>
  private readonly store = createSnapshotStore<PairingsState>({ state: 'loading' })
  private observers = 0
  private epoch = 0

  constructor(private readonly remote: PairingsRemote, private readonly forgetFailureText: () => string) {
    this.source = {
      getSnapshot: () => this.store.getSnapshot(),
      subscribe: listener => {
        const unsubscribe = this.store.subscribe(listener)
        this.observers += 1
        if (this.observers === 1) void this.refresh()
        return () => {
          this.observers -= 1
          if (this.observers === 0) this.epoch += 1
          unsubscribe()
        }
      },
    }
  }

  invalidate(): void {
    this.epoch += 1
    this.store.set({ state: 'loading' })
    if (this.observers > 0) void this.refresh()
  }

  async refresh(): Promise<void> {
    const epoch = ++this.epoch
    this.store.set({ state: 'loading' })
    const result = await this.remote.pairings({})
    if (epoch !== this.epoch) return
    this.store.set(result.ok ? { state: 'ready', pairings: result.value.pairings } : { state: 'failed', message: result.error.message })
  }

  async forget(provider: string, model: string): Promise<void> {
    const result = await this.remote.forgetPairing({ provider, model })
    if (!result.ok) throw new Error(this.forgetFailureText())
    await this.refresh()
  }
}

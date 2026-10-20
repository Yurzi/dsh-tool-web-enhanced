import type { CredentialInfo, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
export type CredentialStatusMap = Readonly<Record<string, 'configured' | 'missing' | 'unknown'>>

export interface CredentialDescriber {
  describe(refs: string[]): Promise<RemoteResult<Record<string, CredentialInfo>>>
}

export class CredentialStatus<S> {
  readonly source: ObservableSnapshot<CredentialStatusMap>
  private readonly store = createSnapshotStore<CredentialStatusMap>({})
  private observers = 0
  private epoch = 0

  constructor(private readonly settings: () => S | undefined, private readonly credentials: CredentialDescriber, private readonly refs: (settings: S) => Iterable<string>) {
    this.source = {
      getSnapshot: () => this.store.getSnapshot(),
      subscribe: listener => {
        const unsubscribe = this.store.subscribe(listener)
        this.observers += 1
        if (this.observers === 1) this.refresh()
        return () => {
          this.observers -= 1
          if (this.observers === 0) this.epoch += 1
          unsubscribe()
        }
      },
    }
  }

  refresh(): void {
    if (this.observers === 0) return
    const epoch = ++this.epoch
    const settings = this.settings()
    if (settings === undefined) {
      this.store.set({})
      return
    }
    const refs = new Set(this.refs(settings))
    void this.credentials.describe([...refs]).then(result => {
      if (epoch !== this.epoch) return
      const states: Record<string, 'configured' | 'missing' | 'unknown'> = {}
      for (const ref of refs) {
        const info = result.ok ? result.value[ref] : undefined
        states[ref] = info === undefined ? 'unknown' : info.configured ? 'configured' : 'missing'
      }
      this.store.set(states)
    })
  }
}

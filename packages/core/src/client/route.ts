import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { RouteStore } from './section.ts'
import { routeOf, type Route } from '../shared/route.ts'
import type { ProviderView } from '../shared/selection.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
export interface ProviderRemote { provider(request: Record<string, never>): Promise<RemoteResult<ProviderView>> }

export type WebSelection = Readonly<Record<string, unknown>>
export function clientRoute(web: ConfigFormSnapshot<WebSelection>, host: ProviderView | undefined, field: string): Route {
  if (host === undefined || web.status !== 'ready') return { kind: 'unknown' }
  return routeOf(web.value, field, host.envProvider, host.providerId)
}

export class RouteStatus implements RouteStore {
  readonly source: ObservableSnapshot<Route>
  private readonly store = createSnapshotStore<Route>({ kind: 'unknown' })
  private host: ProviderView | undefined
  private reader: ProviderRemote | undefined
  private observers = 0
  private unwatch: (() => void) | undefined
  private epoch = 0

  constructor(private readonly web: ConfigForm<WebSelection>, private readonly field: string) {
    this.source = {
      getSnapshot: () => this.store.getSnapshot(),
      subscribe: listener => {
        const unsubscribe = this.store.subscribe(listener)
        this.observers += 1
        if (this.observers === 1) {
          this.unwatch = web.subscribe(() => { this.publish() })
          this.publish()
          this.refresh()
        }
        return () => {
          this.observers -= 1
          if (this.observers === 0) {
            if (this.unwatch !== undefined) this.unwatch()
            this.unwatch = undefined
            this.epoch += 1
          }
          unsubscribe()
        }
      },
    }
  }

  attach(reader: ProviderRemote): () => void {
    this.reader = reader
    this.refresh()
    return () => {
      if (this.reader !== reader) return
      this.reader = undefined
      this.host = undefined
      this.epoch += 1
      this.publish()
    }
  }

  refresh(): void {
    const reader = this.reader
    if (reader === undefined || this.observers === 0) return
    const epoch = ++this.epoch
    void reader.provider({}).then(result => {
      if (epoch !== this.epoch) return
      this.host = result.ok ? result.value : undefined
      this.publish()
    })
  }

  /** Publish only a changed route: observers re-render per publish, and some subscribe inside render. */
  private publish(): void {
    const next = clientRoute(this.web.getSnapshot(), this.host, this.field)
    if (!sameRoute(this.store.getSnapshot(), next)) this.store.set(next)
  }
}

function sameRoute(a: Route, b: Route): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'unknown': return true
    case 'this': return true
    case 'auto': return a.providerId === (b as typeof a).providerId
    case 'other': return a.provider === (b as typeof a).provider && a.providerId === (b as typeof a).providerId
  }
}

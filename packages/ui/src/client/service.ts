import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { CapabilityName, ConnectionSection, RouteStore, WebConnectionsService } from 'dsh-tool-web-enhanced-core/client'
import type { Route } from 'dsh-tool-web-enhanced-core/shared'

export { createSnapshotStore }

/**
 * Pure factory for the WebConnectionsService interface.
 */
export function createWebConnectionsService(): WebConnectionsService {
  const store = createSnapshotStore<readonly ConnectionSection[]>([])
  const registered = new Set<ConnectionSection>()
  const routes = createSnapshotStore<ReadonlyMap<CapabilityName, Route>>(new Map())
  const routeSources = new Set<{ readonly capability: CapabilityName; readonly route: RouteStore }>()

  const publishRoutes = (): void => {
    const next = new Map<CapabilityName, Route>()
    for (const entry of routeSources) next.set(entry.capability, entry.route.source.getSnapshot())
    routes.set(next)
  }

  const publish = (): void => {
    const sorted = [...registered].toSorted((a, b) => a.order - b.order)
    store.set(sorted)
  }

  return {
    routes,
    registerRoute(capability, route) {
      const entry = { capability, route }
      routeSources.add(entry)
      const unsubscribe = route.source.subscribe(publishRoutes)
      publishRoutes()
      return () => {
        if (!routeSources.delete(entry)) return
        unsubscribe()
        publishRoutes()
      }
    },
    get sections(): ObservableSnapshot<readonly ConnectionSection[]> {
      return store
    },
    register(section: ConnectionSection): () => void {
      registered.add(section)
      publish()
      return () => {
        if (registered.delete(section)) {
          publish()
        }
      }
    },
  }
}

/**
 * Installs the webConnections service on a Cordis Context.
 */
export function installWebConnectionsService(ctx: Context): WebConnectionsService {
  const service = createWebConnectionsService()
  ctx.provide('webConnections', service)
  return service
}

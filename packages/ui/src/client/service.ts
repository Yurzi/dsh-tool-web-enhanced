import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConnectionSection, WebConnectionsService } from 'dsh-tool-web-enhanced-core/client'

export { createSnapshotStore }

/**
 * Pure factory for the WebConnectionsService interface.
 */
export function createWebConnectionsService(): WebConnectionsService {
  const store = createSnapshotStore<readonly ConnectionSection[]>([])
  const registered = new Set<ConnectionSection>()

  const publish = (): void => {
    const sorted = [...registered].toSorted((a, b) => a.order - b.order)
    store.set(sorted)
  }

  return {
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

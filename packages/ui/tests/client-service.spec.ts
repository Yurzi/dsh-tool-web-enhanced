import { describe, expect, it } from 'vitest'
import type { ConnectionSection } from 'dsh-tool-web-enhanced-core/client'
import type { Route } from 'dsh-tool-web-enhanced-core/shared'
import { Context } from '@deepseek-ai/cordis'
import {
  createSnapshotStore,
  createWebConnectionsService,
  installWebConnectionsService,
} from '../src/client/service.ts'

function mockSection(capability: 'search' | 'fetch', order: number): ConnectionSection {
  return {
    capability,
    order,
    title: () => (capability === 'search' ? 'Web Search' : 'Web Fetch'),
    selection: {
      source: () => createSnapshotStore({ view: undefined, saving: false, readFailure: undefined }),
      load: async () => {},
      set: async () => ({ ok: true }),
    },
    describe: conn => ({ label: conn.label }),
    sourceText: () => 'default',
    writeFailureText: err => err.message,
    settings: createSnapshotStore(undefined),
    remoteServicesOff: createSnapshotStore(false),
  }
}

describe('WebConnectionsService (pure factory)', () => {
  it('publishes route facts independently of sections and releases their subscriptions', () => {
    const service = createWebConnectionsService()
    const source = createSnapshotStore<Route>({ kind: 'this' })
    const unregister = service.registerRoute('search', { source })
    expect(service.sections.getSnapshot()).toEqual([])
    expect(service.routes.getSnapshot().get('search')).toEqual({ kind: 'this' })
    source.set({ kind: 'other', provider: 'http', providerId: 'search-enhanced' })
    expect(service.routes.getSnapshot().get('search')).toEqual({ kind: 'other', provider: 'http', providerId: 'search-enhanced' })
    unregister()
    unregister()
    source.set({ kind: 'this' })
    expect(service.routes.getSnapshot().size).toBe(0)
  })

  it('starts with empty sections', () => {
    const service = createWebConnectionsService()
    expect(service.sections.getSnapshot()).toEqual([])
  })

  it('registers sections and keeps them ordered by order ascending', () => {
    const service = createWebConnectionsService()
    const sFetch = mockSection('fetch', 20)
    const sSearch = mockSection('search', 10)

    // Register fetch first (higher order)
    const unregFetch = service.register(sFetch)
    expect(service.sections.getSnapshot()).toHaveLength(1)
    expect(service.sections.getSnapshot()[0]!.capability).toBe('fetch')

    // Register search (lower order) -> should be placed first
    const unregSearch = service.register(sSearch)
    expect(service.sections.getSnapshot()).toHaveLength(2)
    expect(service.sections.getSnapshot()[0]!.capability).toBe('search')
    expect(service.sections.getSnapshot()[1]!.capability).toBe('fetch')

    // Unregister search
    unregSearch()
    expect(service.sections.getSnapshot()).toHaveLength(1)
    expect(service.sections.getSnapshot()[0]!.capability).toBe('fetch')

    // Unregister fetch
    unregFetch()
    expect(service.sections.getSnapshot()).toHaveLength(0)
  })

  it('allows subscribers to observe section changes', () => {
    const service = createWebConnectionsService()
    const changes: number[] = []
    const unsub = service.sections.subscribe(() => {
      changes.push(service.sections.getSnapshot().length)
    })

    const s1 = mockSection('search', 10)
    const unreg1 = service.register(s1)
    expect(changes).toEqual([1])

    const s2 = mockSection('fetch', 20)
    const unreg2 = service.register(s2)
    expect(changes).toEqual([1, 2])

    unreg1()
    expect(changes).toEqual([1, 2, 1])

    unreg2()
    expect(changes).toEqual([1, 2, 1, 0])

    unsub()
  })
})

describe('WebConnectionsService installation on Cordis Context', () => {
  it('provides webConnections on Context', async () => {
    const ctx = new Context()
    installWebConnectionsService(ctx)

    expect(ctx.webConnections).toBeDefined()
    expect(ctx.webConnections.sections.getSnapshot()).toEqual([])

    const section = mockSection('search', 10)
    const unreg = ctx.webConnections.register(section)
    expect(ctx.webConnections.sections.getSnapshot()).toHaveLength(1)

    unreg()
    expect(ctx.webConnections.sections.getSnapshot()).toHaveLength(0)

    await ctx.fiber.dispose()
  })
})

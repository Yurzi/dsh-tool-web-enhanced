// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { Route } from 'dsh-tool-web-enhanced-core/shared'
import type { SearchSelectionView } from '../src/contract.ts'
import { SearchSelectionStore, type SearchConnectionsRemote } from '../src/client/selection.ts'
import { searchSection } from '../src/client/section.ts'

afterEach(cleanup)

async function fixture(freshness: boolean) {
  const view: SearchSelectionView = {
    selection: { connectionId: 'builtin:exa', revision: 1, options: { freshness: 'auto' } }, source: 'session',
    connections: [{ id: 'builtin:exa', label: 'Exa', kind: 'adapter', remote: true, access: 'keyless', status: 'ready', freshness }],
  }
  const remote = {
    get: vi.fn(async () => ({ ok: true as const, value: view })),
    set: vi.fn(async () => ({ ok: true as const, value: view })),
  }
  const selection = new SearchSelectionStore(remote as unknown as SearchConnectionsRemote)
  await selection.load('s1')
  const section = searchSection(
    selection,
    { source: createSnapshotStore<Route>({ kind: 'this' }) },
    createSnapshotStore<(() => void) | undefined>(undefined),
    (key, params = {}) => typeof params.name === 'string' ? key + ':' + params.name : key,
  )
  if (section.Options === undefined) throw new Error('missing search options')
  render(<section.Options sessionId="s1" />)
  return remote
}

describe('search section options', () => {
  it('does not offer ignored freshness and explains why', async () => {
    await fixture(false)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByText('selector.freshnessIgnored:Exa')).toBeTruthy()
  })

  it('offers freshness only when the Host says it is honored', async () => {
    const remote = await fixture(true)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fresh' } })
    expect(remote.set).toHaveBeenCalledWith({ sessionId: 's1', expectedRevision: 1, options: { freshness: 'fresh' } })
  })
})

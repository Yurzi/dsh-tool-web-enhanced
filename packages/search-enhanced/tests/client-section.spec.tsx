// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SearchSelectionView } from '../src/contract.ts'
import { SearchSelectionStore, type SearchConnectionsRemote } from '../src/client/selection.ts'
import { searchSection } from '../src/client/section.ts'
import { describe as describeConnection, type Translate } from '../src/client/connections.ts'
import { en, zh, type LocaleKey } from '../src/client/locales.ts'
import type { ConnectionView } from 'dsh-tool-web-enhanced-core/shared'

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
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByText('selector.freshnessIgnored:Exa')).toBeTruthy()
  })

  it('offers freshness only when the Host says it is honored', async () => {
    const remote = await fixture(true)
    expect(screen.getByRole('tablist', { name: 'selector.freshness' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'freshness.fresh' }))
    expect(remote.set).toHaveBeenCalledWith({ sessionId: 's1', expectedRevision: 1, options: { freshness: 'fresh' } })
  })
})
const translate = (dictionary: Record<LocaleKey, string>): Translate => (key, params = {}) =>
  dictionary[key as LocaleKey].replace(/\{(\w+)\}/gu, (match, name: string) => name in params ? String(params[name]) : match)

describe('search connection captions', () => {
  const ready = (connection: Partial<ConnectionView> & Pick<ConnectionView, 'id' | 'label'>): ConnectionView =>
    ({ kind: 'adapter', remote: true, access: 'keyless', status: 'ready', ...connection })

  it('says who receives the query for every ready remote connection, by access', () => {
    const t = translate(en)
    expect(describeConnection(ready({ id: 'builtin:exa', label: 'Exa' }), t)).toEqual({ label: 'Exa', caption: 'No key needed · the query is sent to Exa' })
    expect(describeConnection(ready({ id: 'builtin:tavily', label: 'Tavily', access: 'api-key' }), t).caption).toBe('API key · the query is sent to Tavily')
    expect(describeConnection(ready({ id: 'builtin:deepseek-messages', label: 'DeepSeek Messages', kind: 'native', access: 'account' }), t).caption)
      .toBe('DeepSeek account · the query is sent to DeepSeek Messages')
    expect(describeConnection(ready({ id: 'builtin:deepseek-search-api', label: 'DeepSeek Search API', kind: 'native', access: 'api-key' }), translate(zh)).caption)
      .toBe('API Key · 查询会发送给 DeepSeek Search API')
  })

  it('gives only the access summary for a connection that keeps the query local', () => {
    expect(describeConnection(ready({ id: 'custom:model', label: 'Model', kind: 'model', remote: false, access: 'api-key' }), translate(en)).caption).toBe('API key')
  })
})
